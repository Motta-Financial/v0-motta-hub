/**
 * Find-or-create the OPEN deal for a contact / organization.
 *
 * A Deal = ONE sales opportunity per prospect/client (see migration
 * 337_deals_model.sql). A prospect enters the Hub via an intake form, a
 * Calendly booking, or the in-person prospect form; at that moment a
 * `contacts` row exists and we want exactly one open Deal to hang their
 * meetings + debrief off of.
 *
 * This helper is the single funnel every intake channel calls so we
 * never create duplicate open deals for the same person:
 *   1. If an OPEN deal already exists for the contact (or, when there is
 *      no contact, the organization), return it.
 *   2. Otherwise INSERT one, stamped with the originating `source`.
 *
 * It NEVER throws — callers run it best-effort alongside contact
 * creation and a deal failure must not break intake. A partial unique
 * index (`deals_one_open_per_contact`) is the hard backstop against
 * races: if two requests try to create simultaneously, one insert loses
 * and we re-select the winner.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export type DealSource =
  | "intake_form"
  | "calendly"
  | "prospect_form"
  | "manual"
  | "zoom"
  | "unknown"

export interface FindOrCreateDealInput {
  contactId?: string | null
  organizationId?: string | null
  /** Used only to title a freshly created deal. */
  title?: string | null
  source?: DealSource
  ownerTeamMemberId?: string | null
  /** When the opportunity first made contact (defaults to now on create). */
  firstContactAt?: string | null
}

export interface FindOrCreateDealResult {
  deal_id: string | null
  created: boolean
  method: "existing_open" | "created" | "raced_existing" | "insufficient_data" | "error"
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

export async function findOrCreateDeal(
  input: FindOrCreateDealInput,
  options?: { supabase?: SupabaseClient },
): Promise<FindOrCreateDealResult> {
  const supabase = options?.supabase ?? getServiceClient()

  const contactId = input.contactId ?? null
  const organizationId = input.organizationId ?? null
  const source: DealSource = input.source ?? "unknown"

  if (!contactId && !organizationId) {
    return {
      deal_id: null,
      created: false,
      method: "insufficient_data",
      reason: "findOrCreateDeal needs a contactId or organizationId",
    }
  }

  // ── 1. Existing open deal? Contact takes precedence over org because
  //       the open-deal uniqueness index is keyed on contact_id. ──────
  try {
    const existingQuery = supabase
      .from("deals")
      .select("id")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(1)

    if (contactId) existingQuery.eq("contact_id", contactId)
    else existingQuery.eq("organization_id", organizationId as string)

    const { data: existing } = await existingQuery.maybeSingle()
    if (existing) {
      return {
        deal_id: existing.id,
        created: false,
        method: "existing_open",
        reason: `Reused existing open deal ${existing.id}`,
      }
    }
  } catch (err) {
    console.error("[deals] find existing open deal failed:", err)
    // fall through to create
  }

  // ── 2. Create ─────────────────────────────────────────────────────
  const title = input.title?.trim() || "New Deal"
  const nowIso = new Date().toISOString()

  const { data: created, error } = await supabase
    .from("deals")
    .insert({
      contact_id: contactId,
      organization_id: organizationId,
      title,
      stage: "new",
      status: "open",
      source,
      owner_team_member_id: input.ownerTeamMemberId ?? null,
      first_contact_at: input.firstContactAt ?? nowIso,
    })
    .select("id")
    .single()

  if (!error && created) {
    return {
      deal_id: created.id,
      created: true,
      method: "created",
      reason: `Created deal ${created.id} (source=${source})`,
    }
  }

  // ── 3. Lost a race against the partial unique index? Re-select. ────
  // Postgres unique_violation = 23505. The other request won; reuse it.
  if (error && (error.code === "23505" || /duplicate key/i.test(error.message))) {
    const raceQuery = supabase.from("deals").select("id").eq("status", "open").limit(1)
    if (contactId) raceQuery.eq("contact_id", contactId)
    else raceQuery.eq("organization_id", organizationId as string)
    const { data: raced } = await raceQuery.maybeSingle()
    if (raced) {
      return {
        deal_id: raced.id,
        created: false,
        method: "raced_existing",
        reason: `Reused deal ${raced.id} after unique-violation race`,
      }
    }
  }

  console.error("[deals] create deal failed:", error)
  return {
    deal_id: null,
    created: false,
    method: "error",
    reason: `Deal insert failed: ${error?.message ?? "unknown"}`,
  }
}
