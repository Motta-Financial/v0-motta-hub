/**
 * Link a freshly-created prospect to their referrer.
 *
 * The prospect form gives us EITHER a referrer the teammate matched in
 * the contacts database (`referredByContactId`) OR a free-text referrer
 * name (`referredByRaw`). Either way the *referee* is the new prospect
 * contact — Karbon's `referrals` table requires exactly one of
 * `referee_contact_id` / `referee_jotform_submission_id` (the
 * `referrals_referee_present_chk` constraint), so this MUST run after
 * the Hub contact exists.
 *
 * Matching policy mirrors the Motta Hub referral state machine
 * (v0_memories/user/motta-hub-data-model.md §4):
 *   - A picked contact → `match_status='matched'`, fully linked.
 *   - Free-text with no match → classified via `resolveReferral` into
 *     `unmatched_format` / `external_referrer`, surfaced for human
 *     review. We NEVER auto-create a contact for the referrer.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveReferral } from "@/lib/referrals/resolve"

export interface LinkReferralArgs {
  /** The new prospect's Hub contact id (the referee). Required. */
  refereeContactId: string
  refereeName?: string | null
  /** Matched referrer contact id, when the teammate picked one. */
  referredByContactId?: string | null
  /** Free-text referrer name, when no contact was matched. */
  referredByRaw?: string | null
}

export interface LinkReferralResult {
  referralId: string | null
  matchStatus: string | null
  skipped?: "no_referrer"
  error?: string
}

export async function linkReferral(
  supabase: SupabaseClient,
  args: LinkReferralArgs,
): Promise<LinkReferralResult> {
  const refereeContactId = args.refereeContactId
  const referredByContactId = args.referredByContactId?.trim() || null
  const referredByRaw = args.referredByRaw?.trim() || null

  if (!refereeContactId) {
    return { referralId: null, matchStatus: null, error: "refereeContactId is required" }
  }
  if (!referredByContactId && !referredByRaw) {
    return { referralId: null, matchStatus: null, skipped: "no_referrer" }
  }

  // ── Matched path: teammate picked a real contact ────────────────
  if (referredByContactId) {
    const { data: referrer } = await supabase
      .from("contacts")
      .select("id, full_name, karbon_contact_key")
      .eq("id", referredByContactId)
      .maybeSingle()

    const { data: inserted, error } = await supabase
      .from("referrals")
      .insert({
        referee_contact_id: refereeContactId,
        referee_name: args.refereeName ?? null,
        referred_by_contact_id: referredByContactId,
        referred_by_name: referrer?.full_name ?? referredByRaw ?? null,
        referred_by_karbon_key: referrer?.karbon_contact_key ?? null,
        referred_by_raw: referredByRaw,
        match_status: "matched",
        match_confidence: 1,
        source: "prospect_form",
        referral_date: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single()

    if (error) {
      return { referralId: null, matchStatus: null, error: error.message }
    }
    return { referralId: inserted.id, matchStatus: "matched" }
  }

  // ── Free-text path: classify, surface for review, never auto-create ─
  const resolution = resolveReferral({ raw: referredByRaw, lookup: new Map() })
  const { data: inserted, error } = await supabase
    .from("referrals")
    .insert({
      referee_contact_id: refereeContactId,
      referee_name: args.refereeName ?? null,
      referred_by_raw: referredByRaw,
      referred_by_legacy_id: resolution.referred_by_legacy_id,
      referred_by_name: referredByRaw,
      match_status: resolution.match_status,
      source: "prospect_form",
      referral_date: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single()

  if (error) {
    return { referralId: null, matchStatus: null, error: error.message }
  }
  return { referralId: inserted.id, matchStatus: resolution.match_status }
}
