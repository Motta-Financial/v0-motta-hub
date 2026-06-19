/**
 * Hub-first contact resolution.
 *
 * The Motta Hub `contacts` table (+ `organizations`) is the canonical
 * record for every person we touch — Karbon, ProConnect, Ignition, and
 * the rest are platform projections of the Hub contact, not the other
 * way around. See v0_memories/user/motta-hub-data-model.md.
 *
 * Historically `findOrCreateClient` from `lib/karbon/client-sync.ts`
 * was the only way new contacts entered the system, which meant the
 * Hub row only existed if Karbon round-tripped successfully. That
 * coupled three intake channels (Jotform, Calendly, Zoom) to a single
 * external API's availability.
 *
 * `findOrCreateHubContact` decouples them:
 *   1. Search Supabase by email → business name → name+phone (no
 *      Karbon roundtrip).
 *   2. If no match, INSERT directly into `contacts` (or
 *      `organizations`) stamped with the calling channel's `source`
 *      tag and `is_prospect = true`.
 *   3. Return whether the row was matched or freshly created. Caller
 *      decides whether to push the new contact to Karbon, ProConnect,
 *      Ignition, etc.
 *
 * What this helper deliberately does NOT do:
 *   - Touch Karbon. Karbon-first creation still flows through
 *     `findOrCreateClient` (used by the public Jotform intake — that
 *     pipeline auto-creates a Karbon contact on every public submission
 *     by design).
 *   - Decide who the assignee/owner is. That's the caller's job.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  deriveLegacyMottaClientId,
  isValidLegacyId,
} from "@/lib/legacy-client-id"

export type HubContactSource =
  | "jotform_intake"
  | "calendly"
  | "zoom"
  | "prospect_form"
  | "website_contact"
  | "manual"

export interface HubContactInput {
  email?: string | null
  fullName?: string | null
  firstName?: string | null
  lastName?: string | null
  businessName?: string | null
  phone?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

export interface HubContactResult {
  /** UUID of the matched/created `contacts` row. Mutually exclusive w/ organization_id. */
  contact_id: string | null
  /** UUID of the matched/created `organizations` row. */
  organization_id: string | null
  /** True if we just inserted this row in this call. */
  created: boolean
  /** How we resolved — for debug, audit logs, and the prospect row's `link_method`. */
  method:
    | "supabase_email"
    | "supabase_business_name"
    | "supabase_name_phone"
    | "created_contact"
    | "created_organization"
    | "skipped_internal"
    | "insufficient_data"
  reason: string
}

function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured")
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Heuristic: is this email plausibly an internal teammate / company
 * mailbox? We use this to skip auto-creation from sources where every
 * meeting attendee gets considered (Zoom mainly) — we don't want to
 * create a "Tommy Motta" contact every time a teammate joins their
 * own meeting.
 */
const INTERNAL_DOMAINS = new Set(["motta.cpa", "mottafinancial.com"])

export function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const lower = email.trim().toLowerCase()
  const at = lower.lastIndexOf("@")
  if (at < 0) return false
  return INTERNAL_DOMAINS.has(lower.slice(at + 1))
}

function splitFullName(
  full: string | null | undefined,
): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null }
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts[parts.length - 1] }
}

function lastTen(digits: string): string {
  return digits.length > 10 ? digits.slice(-10) : digits
}

function normPhone(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.replace(/\D+/g, "")
}

function cleanedBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|pllc)\b/gi, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Match-or-create a Hub organization by email → cleaned business name.
 *
 * Karbon-free by design (this module never touches Karbon — callers push
 * to Karbon afterward via `pushHubOrganizationToKarbon`). Used to build the
 * "business half" of a business prospect so a person contact and their
 * company both exist and can be linked. Never throws.
 */
export async function findOrCreateHubOrganization(
  args: {
    name: string
    email?: string | null
    phone?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
    source: HubContactSource
  },
  supabase?: SupabaseClient,
): Promise<{ organization_id: string | null; created: boolean }> {
  const db = supabase ?? getServiceClient()
  const name = args.name.trim()
  if (name.length < 2) return { organization_id: null, created: false }
  const email = args.email?.trim().toLowerCase() || null

  // Match by email first (most reliable), then by cleaned business name.
  if (email) {
    const { data } = await db.from("organizations").select("id").ilike("primary_email", email).limit(1)
    if (data && data.length > 0) return { organization_id: data[0].id, created: false }
  }
  const cleaned = cleanedBusinessName(name)
  if (cleaned.length >= 2) {
    const { data: orgs } = await db
      .from("organizations")
      .select("id, name")
      .ilike("name", `%${cleaned}%`)
      .limit(5)
    const exact = (orgs || []).find((o) => cleanedBusinessName(o.name || "") === cleaned)
    if (exact) return { organization_id: exact.id, created: false }
  }

  const nowIso = new Date().toISOString()
  const { data: newOrg, error } = await db
    .from("organizations")
    .insert({
      name,
      primary_email: email,
      phone: args.phone?.trim() || null,
      state: args.state?.trim() || null,
      city: args.city?.trim() || null,
      zip_code: args.zip?.trim() || null,
      status: "Active",
      source: args.source,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single()
  if (error || !newOrg) {
    console.error("[hub] organization insert failed:", error)
    return { organization_id: null, created: false }
  }
  return { organization_id: newOrg.id, created: true }
}

/**
 * Link a person contact to an organization in the `contact_organizations`
 * junction. Deduped (no-op if the link already exists) and best-effort.
 */
export async function linkContactToOrganization(
  contactId: string,
  organizationId: string,
  options: { supabase?: SupabaseClient; role?: string; isPrimary?: boolean } = {},
): Promise<void> {
  const db = options.supabase ?? getServiceClient()
  const { data: existing } = await db
    .from("contact_organizations")
    .select("id")
    .eq("contact_id", contactId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (existing) return
  const { error } = await db.from("contact_organizations").insert({
    contact_id: contactId,
    organization_id: organizationId,
    is_primary_contact: options.isPrimary ?? true,
    role_or_title: options.role ?? "Owner",
  })
  if (error) console.error("[hub] contact_organizations link failed:", error.message)
}

/**
 * Hub-first match-or-create. NEVER throws — returns a structured result
 * with `method = "insufficient_data"` when there isn't enough signal.
 */
export async function findOrCreateHubContact(
  input: HubContactInput,
  options: {
    source: HubContactSource
    /** When true, refuse to create from internal/teammate emails. Default true for `zoom`. */
    skipInternal?: boolean
    supabase?: SupabaseClient
  },
): Promise<HubContactResult> {
  const supabase = options.supabase ?? getServiceClient()
  const source = options.source
  const skipInternal = options.skipInternal ?? source === "zoom"

  const email = input.email?.trim().toLowerCase() || null
  const businessName = input.businessName?.trim() || null
  const phone = input.phone?.trim() || null

  // Resolve a usable first/last from whatever the caller gave us.
  let firstName = input.firstName?.trim() || null
  let lastName = input.lastName?.trim() || null
  if ((!firstName || !lastName) && input.fullName) {
    const split = splitFullName(input.fullName)
    firstName = firstName || split.first
    lastName = lastName || split.last
  }
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    input.fullName?.trim() ||
    null

  if (skipInternal && email && isInternalEmail(email)) {
    return {
      contact_id: null,
      organization_id: null,
      created: false,
      method: "skipped_internal",
      reason: `Refusing to create Hub contact for internal email: ${email}`,
    }
  }

  // ── 1. Match by email (contacts then organizations) ────────────────
  if (email) {
    const { data: hits } = await supabase
      .from("contacts")
      .select("id, full_name")
      .or(`primary_email.ilike.${email},secondary_email.ilike.${email}`)
      .limit(1)
    if (hits && hits.length > 0) {
      return {
        contact_id: hits[0].id,
        organization_id: null,
        created: false,
        method: "supabase_email",
        reason: `Matched Hub contact by email: ${hits[0].full_name ?? email}`,
      }
    }
    const { data: orgHits } = await supabase
      .from("organizations")
      .select("id, name")
      .ilike("primary_email", email)
      .limit(1)
    if (orgHits && orgHits.length > 0) {
      return {
        contact_id: null,
        organization_id: orgHits[0].id,
        created: false,
        method: "supabase_email",
        reason: `Matched Hub organization by email: ${orgHits[0].name}`,
      }
    }
  }

  // ── 2. Match organization by business name ─────────────────────────
  if (businessName && businessName.length >= 3) {
    const cleaned = cleanedBusinessName(businessName)
    if (cleaned.length >= 3) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name")
        .ilike("name", `%${cleaned}%`)
        .limit(5)
      const exact = (orgs || []).find(
        (o) => cleanedBusinessName(o.name || "") === cleaned,
      )
      if (exact) {
        return {
          contact_id: null,
          organization_id: exact.id,
          created: false,
          method: "supabase_business_name",
          reason: `Matched Hub organization by business name: ${exact.name}`,
        }
      }
    }
  }

  // ── 3. Match contact by name + phone ───────────────────────────────
  if (firstName && lastName && phone) {
    const phoneTail = lastTen(normPhone(phone))
    if (phoneTail.length === 10) {
      const { data: nameHits } = await supabase
        .from("contacts")
        .select("id, full_name, phone_primary, phone_mobile, phone_work")
        .ilike("first_name", firstName)
        .ilike("last_name", lastName)
        .limit(10)
      const phoneMatch = (nameHits || []).find((c) => {
        const phones = [c.phone_primary, c.phone_mobile, c.phone_work]
          .map((p) => lastTen(normPhone(p)))
          .filter(Boolean)
        return phones.includes(phoneTail)
      })
      if (phoneMatch) {
        return {
          contact_id: phoneMatch.id,
          organization_id: null,
          created: false,
          method: "supabase_name_phone",
          reason: `Matched Hub contact by name + phone: ${phoneMatch.full_name}`,
        }
      }
    }
  }

  // ── 4. Create — prefer organization when business name is the only signal ─
  const hasPersonName = !!(firstName && lastName)
  const hasBusinessName = !!(businessName && businessName.length >= 2)

  if (!hasPersonName && !hasBusinessName) {
    return {
      contact_id: null,
      organization_id: null,
      created: false,
      method: "insufficient_data",
      reason:
        "Cannot create Hub contact — need at least first+last name or a business name",
    }
  }

  const nowIso = new Date().toISOString()

  // Strategy: if we have a person name, create a contact (most common
  // case for Calendly/Jotform). If only a business name, create an
  // organization. If both, create the contact and let the caller link
  // up the org separately (matches the existing intake pipeline shape).
  if (hasPersonName) {
    const legacyResult = deriveLegacyMottaClientId({
      first_name: firstName,
      last_name: lastName,
      state: input.state ?? null,
      phone,
    })

    const insertPayload: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      // full_name is a GENERATED ALWAYS column in Supabase — writing it
      // makes Postgres reject the row ("cannot insert a non-DEFAULT value
      // into column full_name"). The DB derives it from first/last name.
      primary_email: email,
      phone_primary: phone,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      zip_code: input.zip?.trim() || null,
      status: "Active",
      is_prospect: true,
      source: source,
      created_at: nowIso,
      updated_at: nowIso,
    }
    if (isValidLegacyId(legacyResult.legacy_id)) {
      insertPayload.legacy_motta_client_id = legacyResult.legacy_id
    }

    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert(insertPayload)
      .select("id")
      .single()

    if (error || !newContact) {
      console.error("[hub] contact insert failed:", error)
      return {
        contact_id: null,
        organization_id: null,
        created: false,
        method: "insufficient_data",
        reason: `Hub contact insert failed: ${error?.message ?? "unknown"}`,
      }
    }

    return {
      contact_id: newContact.id,
      organization_id: null,
      created: true,
      method: "created_contact",
      reason: `Created Hub contact: ${fullName} (source=${source}${
        legacyResult.legacy_id ? `, legacy_id=${legacyResult.legacy_id}` : ", legacy_id=null"
      })`,
    }
  }

  // Org-only path
  const { data: newOrg, error: orgErr } = await supabase
    .from("organizations")
    .insert({
      name: businessName,
      primary_email: email,
      phone,
      state: input.state?.trim() || null,
      city: input.city?.trim() || null,
      zip_code: input.zip?.trim() || null,
      status: "Active",
      source: source,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single()

  if (orgErr || !newOrg) {
    console.error("[hub] organization insert failed:", orgErr)
    return {
      contact_id: null,
      organization_id: null,
      created: false,
      method: "insufficient_data",
      reason: `Hub organization insert failed: ${orgErr?.message ?? "unknown"}`,
    }
  }

  return {
    contact_id: null,
    organization_id: newOrg.id,
    created: true,
    method: "created_organization",
    reason: `Created Hub organization: ${businessName} (source=${source})`,
  }
}
