/**
 * Calendly invitee → CRM contact matching.
 *
 * The basic Calendly webhook payload gives us the invitee's name, email,
 * and (if the booking form asks for it) phone number. We want to link
 * each meeting to the matching record in our `contacts` table so the
 * Team Calendar can show "this is a meeting with X" without a manual
 * tagging step.
 *
 * Match priority — first hit wins:
 *   1. Email match (primary or secondary, case-insensitive)
 *   2. First name + last name + phone match (any phone column)
 *   3. First name + last name (only if there's exactly one match —
 *      otherwise we abstain rather than guess wrong)
 *
 * If nothing matches we return null and the meeting stays unlinked,
 * which is the same behaviour we had before this helper existed.
 *
 * The match writes a row into `calendly_event_clients` with
 * `link_source = 'auto'` so the new Team Calendar UI can render the
 * matched client as a tag (and the user can override / add more).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface InviteeMatchInput {
  email?: string | null
  name?: string | null
  /**
   * Phone number harvested from invitee.questions_and_answers (Calendly
   * doesn't promote phone to a top-level field — it lives in the
   * booking-form Q&A). Caller is responsible for digging it out.
   */
  phone?: string | null
}

export interface InviteeMatchResult {
  contactId: string
  matchMethod: "email" | "name_phone" | "name"
}

/**
 * Strip every non-digit character so "(555) 123-4567", "+1.555.123.4567",
 * and "5551234567" all compare equal. Returns "" when no digits remain.
 */
function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.replace(/\D+/g, "")
}

/** Last 10 digits — enough to compare US numbers regardless of country code. */
function lastTen(digits: string): string {
  return digits.length > 10 ? digits.slice(-10) : digits
}

/**
 * Splits "Jane Q. Doe" into ["Jane", "Doe"] using the simplest possible
 * heuristic: first token = first name, last token = last name. Middle
 * tokens are ignored. Suitable for Calendly invitees, where most names
 * arrive as "First Last".
 */
function splitName(name: string | null | undefined): { first: string; last: string } | null {
  if (!name) return null
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
  if (parts.length < 2) return null
  return { first: parts[0]!, last: parts[parts.length - 1]! }
}

/**
 * Best-effort match — see priority list at the top of the file.
 * Never throws: any unexpected DB error returns `null` so the upstream
 * sync/webhook keeps making progress even if matching breaks.
 */
export async function matchInviteeToContact(
  supabase: SupabaseClient,
  invitee: InviteeMatchInput,
): Promise<InviteeMatchResult | null> {
  // 1. Email match. Use `.eq` rather than `.ilike` because we always
  //    lowercased emails on the contacts side; a wildcard-free equality
  //    check is index-friendly.
  if (invitee.email) {
    const email = invitee.email.trim().toLowerCase()
    if (email) {
      const { data } = await supabase
        .from("contacts")
        .select("id")
        .or(`primary_email.ilike.${email},secondary_email.ilike.${email}`)
        .limit(1)
        .maybeSingle()
      if (data?.id) {
        return { contactId: data.id, matchMethod: "email" }
      }
    }
  }

  // 2 & 3. Name-based match — only attempted when we can confidently
  //        split into first + last. Single-token names ("Tommy") would
  //        match too aggressively.
  const split = splitName(invitee.name)
  if (!split) return null

  const { first, last } = split

  // Pull every contact whose first AND last name match. Case-insensitive.
  // Limit to a small number — if more than ~10 share a name, name-based
  // matching is hopeless anyway.
  const { data: nameCandidates } = await supabase
    .from("contacts")
    .select("id, phone_primary, phone_mobile, phone_work")
    .ilike("first_name", first)
    .ilike("last_name", last)
    .limit(10)

  if (!nameCandidates || nameCandidates.length === 0) return null

  // 2. Name + phone match.
  const inviteePhone = lastTen(normalizePhone(invitee.phone))
  if (inviteePhone) {
    for (const c of nameCandidates) {
      const phones = [c.phone_primary, c.phone_mobile, c.phone_work]
        .map((p) => lastTen(normalizePhone(p)))
        .filter(Boolean)
      if (phones.includes(inviteePhone)) {
        return { contactId: c.id, matchMethod: "name_phone" }
      }
    }
  }

  // 3. Name only — accept if there's exactly one candidate. Refusing to
  //    pick when there are duplicates is intentional: a wrong link is
  //    worse than no link.
  if (nameCandidates.length === 1) {
    return { contactId: nameCandidates[0]!.id, matchMethod: "name" }
  }

  return null
}

/**
 * Pull the phone number out of a Calendly invitee's questions_and_answers
 * payload. Calendly doesn't have a structured phone field — it lives in
 * a booking-form question whose `question` text is up to whoever set up
 * the event type. We scan for any answer whose question text contains
 * "phone" (case-insensitive) and return the first non-empty answer.
 */
export function extractPhoneFromInvitee(invitee: any): string | null {
  const qa = invitee?.questions_and_answers
  if (!Array.isArray(qa)) return null
  for (const item of qa) {
    const q = String(item?.question ?? "").toLowerCase()
    if (q.includes("phone") || q.includes("mobile") || q.includes("cell")) {
      const a = String(item?.answer ?? "").trim()
      if (a) return a
    }
  }
  return null
}

/**
 * Idempotently insert a `calendly_event_clients` row for an auto-matched
 * contact. Safe to call repeatedly — the unique index on
 * (calendly_event_id, contact_id) keeps duplicates out, and we map the
 * "duplicate key" error code to a no-op so retries don't surface noise.
 */
export async function upsertAutoClientLink(
  supabase: SupabaseClient,
  params: {
    calendlyEventId: string
    contactId: string
    matchMethod: InviteeMatchResult["matchMethod"]
  },
): Promise<void> {
  const { error } = await supabase.from("calendly_event_clients").insert({
    calendly_event_id: params.calendlyEventId,
    contact_id: params.contactId,
    organization_id: null,
    link_source: "auto",
    match_method: params.matchMethod,
  })
  // 23505 = unique_violation. We're fine with that — it just means the
  // auto-link already exists from a previous sync pass.
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[calendly] auto client link insert warning:", error.message)
  }
}
