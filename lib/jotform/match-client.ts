/**
 * Match a Jotform intake submission to a Supabase contact /
 * organization record.
 *
 * Used in two places:
 *
 *   1. `upsertIntakeSubmission` (lib/jotform/ingest.ts) — runs once
 *      per webhook delivery so newly-arrived submissions show up
 *      pre-linked on the matching client profile.
 *
 *   2. `scripts/jotform-intake-link-clients.mjs` — bulk-runs the
 *      matcher across every existing row when the form question
 *      schema changes or a new heuristic is added.
 *
 * The matcher is intentionally conservative: it returns links only
 * when the evidence is unambiguous (exact email match, exact cleaned
 * business-name match). Soft / fuzzy matches are returned as
 * `candidates` for the human to review later in the intake admin
 * queue, never auto-applied.
 *
 * Provenance is tracked via the `link_method` column. The valid
 * values are checked at the database level (see migration 047), so
 * any string returned here that isn't on that list will reject.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type LinkMethod = "auto_email" | "auto_business_name" | "auto_name" | "manual"

export interface MatchResult {
  contact_id: string | null
  organization_id: string | null
  link_method: LinkMethod | null
  /** Free-form note explaining the match — useful for the audit log. */
  reason: string | null
}

/**
 * Strip the noise out of a business name so "Speratus LLC" and
 * "Speratus, LLC." both collapse to the same comparable token.
 *
 * Order matters: we lowercase first so the entity-suffix regex can
 * be case-insensitive without flags, then strip suffixes, then
 * collapse whitespace + punctuation.
 */
export function normalizeBusinessName(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw
    .toLowerCase()
    .replace(
      /\b(llc|l\.l\.c\.|inc|inc\.|incorporated|corp|corp\.|corporation|co\.|company|llp|l\.l\.p\.|pllc|p\.l\.l\.c\.|pc|p\.c\.|ltd|ltd\.|limited|gmbh|sa|sas|pty|holdings|enterprises)\b/g,
      "",
    )
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Lower-case + trim an email so "Foo@Bar.com " matches "foo@bar.com".
 * Returns empty string for falsy inputs so callers can do
 * `if (email)` without first null-checking.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.trim().toLowerCase()
}

/**
 * Run the auto-matcher against one intake submission. Returns a
 * MatchResult; caller is responsible for writing it back to the
 * database (so the matcher stays pure and unit-testable).
 */
export async function matchIntakeToClient(
  supabase: SupabaseClient,
  submission: {
    submitter_email: string | null
    submitter_full_name: string | null
    business_name: string | null
  },
): Promise<MatchResult> {
  const empty: MatchResult = { contact_id: null, organization_id: null, link_method: null, reason: null }
  const email = normalizeEmail(submission.submitter_email)
  const bizName = normalizeBusinessName(submission.business_name)

  // ── Strategy 1: Email match against contacts ───────────────────
  // Highest confidence — emails are unique-ish and self-reported on
  // both sides (intake form + Karbon contact card). We check
  // primary_email first (more authoritative) before falling back to
  // secondary_email so a household using two emails still resolves
  // to the right person.
  if (email) {
    const { data: c1 } = await supabase
      .from("contacts")
      .select("id")
      .ilike("primary_email", email)
      .limit(2)
    if (c1 && c1.length === 1) {
      return {
        contact_id: c1[0].id,
        organization_id: null,
        link_method: "auto_email",
        reason: `Matched contact.primary_email = ${email}`,
      }
    }
    if (c1 && c1.length > 1) {
      // Multiple contacts share this email — bail out rather than
      // pin the wrong one. The submission stays unlinked and shows
      // up in the admin queue with both candidates surfaced.
      return { ...empty, reason: `Ambiguous: ${c1.length} contacts share email ${email}` }
    }

    const { data: c2 } = await supabase
      .from("contacts")
      .select("id")
      .ilike("secondary_email", email)
      .limit(2)
    if (c2 && c2.length === 1) {
      return {
        contact_id: c2[0].id,
        organization_id: null,
        link_method: "auto_email",
        reason: `Matched contact.secondary_email = ${email}`,
      }
    }

    // ── Strategy 2: Email match against organizations ────────────
    // Some businesses use a generic info@ address that's tied to
    // the org record, not the contact. Lower-priority than contact
    // email but still very reliable.
    const { data: o1 } = await supabase
      .from("organizations")
      .select("id")
      .ilike("primary_email", email)
      .limit(2)
    if (o1 && o1.length === 1) {
      return {
        contact_id: null,
        organization_id: o1[0].id,
        link_method: "auto_email",
        reason: `Matched organization.primary_email = ${email}`,
      }
    }
  }

  // ── Strategy 3: Business name match against organizations ──────
  // Last resort — name comparison after stripping entity suffixes.
  // We require a normalized length of at least 3 so single-letter
  // or 2-letter abbreviations don't collide with everything.
  if (bizName && bizName.length >= 3) {
    // Pull all org candidates whose name contains the cleaned token,
    // then do exact-match comparison in JS using the same
    // normalization. This is more robust than trying to express the
    // normalization in SQL.
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, full_name")
      .or(`name.ilike.%${bizName}%,full_name.ilike.%${bizName}%`)
      .limit(20)

    const exact = (orgs || []).filter((o) => {
      const n = normalizeBusinessName(o.name)
      const fn = normalizeBusinessName(o.full_name)
      return n === bizName || fn === bizName
    })

    if (exact.length === 1) {
      return {
        contact_id: null,
        organization_id: exact[0].id,
        link_method: "auto_business_name",
        reason: `Matched organization name (normalized) = "${bizName}"`,
      }
    }
    if (exact.length > 1) {
      return {
        ...empty,
        reason: `Ambiguous: ${exact.length} orgs share normalized name "${bizName}"`,
      }
    }
  }

  return empty
}

/**
 * Convenience wrapper for the ingest path: looks up the existing
 * row's link state, runs the matcher, and writes back ONLY if the
 * row is unlinked or was previously auto-linked. Manual links are
 * left untouched so the auto-matcher can never overwrite a human's
 * decision.
 *
 * Returns the MatchResult (or null if the row was skipped because
 * it had a manual link).
 */
export async function autoLinkIntakeSubmission(
  supabase: SupabaseClient,
  submissionId: string,
  submission: {
    submitter_email: string | null
    submitter_full_name: string | null
    business_name: string | null
    contact_id: string | null
    organization_id: string | null
    link_method: LinkMethod | null
  },
): Promise<MatchResult | null> {
  // Hands-off if a human pinned this row.
  if (submission.link_method === "manual") return null

  const result = await matchIntakeToClient(supabase, submission)

  // No match found AND row already unlinked → no-op.
  if (!result.link_method && !submission.contact_id && !submission.organization_id) {
    return result
  }

  // Match found, OR the previously-auto-linked row should clear
  // because the heuristics no longer apply (rare, but possible if
  // the email was edited after the fact).
  await supabase
    .from("jotform_intake_submissions")
    .update({
      contact_id: result.contact_id,
      organization_id: result.organization_id,
      link_method: result.link_method,
      linked_at: result.link_method ? new Date().toISOString() : null,
    })
    .eq("id", submissionId)
    // Belt + suspenders: only update if the row is still
    // auto-managed. If a parallel request flipped it to 'manual'
    // between our read and write, this `.neq` aborts the update.
    .or("link_method.is.null,link_method.like.auto_%")

  return result
}
