/**
 * Translates legacy Zapier-era IDs into their Reporting-API slug equivalents.
 *
 * Background:
 *   - Until the Reporting API connection landed, Ignition resources reached us
 *     only via Zapier webhooks that carry numeric IDs (e.g. proposal_id=12345).
 *   - The Reporting API uses slug IDs (e.g. prop_xxx, cli_xxx, inv_xxx, con_xxx,
 *     pmt_xxx, srv_xxx) which we treat as the canonical key going forward.
 *   - We've already merged historical legacy rows into their slug counterparts
 *     and deleted the legacy rows. From here on, every write needs to land on
 *     the slug-keyed row — including writes triggered by Zapier webhooks that
 *     still arrive with legacy IDs.
 *
 * Strategy:
 *   - If the incoming ID is already a slug (prefix match), pass through.
 *   - Otherwise look up the slug row by the natural key embedded in the same
 *     payload (proposal_number, invoice_number, business_name, email).
 *   - If no slug match is found, return the original (legacy) ID — that means
 *     either we received a brand-new record before the next OAuth sync pulled
 *     it in, or the natural key is empty. Either way the existing
 *     reconciliation script can clean it up on the next pass.
 *
 * Caching:
 *   - Each handler call typically resolves the same 1-3 IDs, so we add a
 *     short-lived in-process cache to avoid hammering Supabase for repeat
 *     translations within the same webhook event.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

// -------- Slug detection -------------------------------------------------

const SLUG_PREFIXES = {
  client: "cli_",
  contact: "con_",
  proposal: "prop_",
  invoice: "inv_",
  payment: "pmt_",
  service: "srv_",
  deal: "dea_",
  dealStage: "sta_",
} as const

export type IgnitionResourceKind = keyof typeof SLUG_PREFIXES

function looksLikeSlug(id: string | null | undefined, kind: IgnitionResourceKind): boolean {
  if (!id) return false
  return id.startsWith(SLUG_PREFIXES[kind])
}

// -------- Per-request cache ----------------------------------------------

type CacheKey = `${IgnitionResourceKind}:${string}`
const NEGATIVE_CACHE_VALUE = "__NEG__" as const

/**
 * Build a resolver bound to a single webhook invocation. Caches both
 * positive hits (legacy → slug) and negative hits (no slug found) so we
 * never look up the same key twice in one request.
 */
export function createIdResolver(supabase: SupabaseClient) {
  const cache = new Map<CacheKey, string>()

  async function lookupSlug(
    table: string,
    selectCol: string,
    matchCol: string,
    matchValue: string,
    prefix: string,
  ): Promise<string | null> {
    const trimmed = matchValue.trim()
    if (!trimmed) return null
    const { data, error } = await supabase
      .from(table)
      .select(selectCol)
      .eq(matchCol, trimmed)
      .like(selectCol, `${prefix}%`)
      .limit(1)
      .maybeSingle()
    if (error) {
      // Don't fail the webhook on a translation lookup error — just fall
      // back to the legacy ID. The reconciliation script will mop up.
      console.warn(`[id-resolver] ${table}.${matchCol}='${trimmed}' lookup failed: ${error.message}`)
      return null
    }
    return (data as any)?.[selectCol] ?? null
  }

  /**
   * Resolve an Ignition resource ID to its slug form. Returns the input
   * unchanged if it's already a slug, the matched slug if a natural-key
   * lookup succeeds, or the input as a fallback (caller proceeds with
   * the legacy ID).
   */
  async function resolve(
    kind: IgnitionResourceKind,
    incomingId: string | null | undefined,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    if (!incomingId) return null
    if (looksLikeSlug(incomingId, kind)) return incomingId

    const cacheKey: CacheKey = `${kind}:${incomingId}`
    const cached = cache.get(cacheKey)
    if (cached === NEGATIVE_CACHE_VALUE) return incomingId
    if (cached) return cached

    let resolved: string | null = null

    if (kind === "proposal") {
      const num = pickString(payload, [
        "proposal_number",
        "number",
        "proposal__number",
      ])
      if (num) {
        resolved = await lookupSlug(
          "ignition_proposals",
          "proposal_id",
          "proposal_number",
          num,
          SLUG_PREFIXES.proposal,
        )
      }
    } else if (kind === "invoice") {
      const num = pickString(payload, [
        "invoice_number",
        "number",
        "invoice__number",
      ])
      if (num) {
        resolved = await lookupSlug(
          "ignition_invoices",
          "ignition_invoice_id",
          "invoice_number",
          num,
          SLUG_PREFIXES.invoice,
        )
      }
    } else if (kind === "client") {
      // The Reporting API stores the practice's "Client Name" in the `name`
      // column (regardless of whether the client is a person or a business);
      // `business_name` is empty for OAuth-fed rows. Try `name` first, then
      // `business_name` (for legacy rows that still use it), then email.
      // Comparison is case-insensitive to match the reconciliation step,
      // which used lower(trim(...)).
      const candidates = pickString(payload, [
        "business_name",
        "company_name",
        "company",
        "organization_name",
        "client__business_name",
        "client__company_name",
        "name",
        "client_name",
        "client__name",
      ])
      if (candidates) {
        // Try `name` first (Reporting API canonical column).
        resolved = await lookupSlugCI(
          "ignition_clients",
          "ignition_client_id",
          "name",
          candidates,
          SLUG_PREFIXES.client,
        )
        // Fall back to `business_name` for rows where it was populated.
        if (!resolved) {
          resolved = await lookupSlugCI(
            "ignition_clients",
            "ignition_client_id",
            "business_name",
            candidates,
            SLUG_PREFIXES.client,
          )
        }
      }
      if (!resolved) {
        const email = pickString(payload, [
          "email",
          "client_email",
          "client__email",
          "primary_email",
        ])
        if (email) {
          resolved = await lookupSlugCI(
            "ignition_clients",
            "ignition_client_id",
            "email",
            email,
            SLUG_PREFIXES.client,
          )
        }
      }
    } else if (kind === "contact") {
      const email = pickString(payload, [
        "email",
        "contact_email",
        "primary_email",
      ])
      if (email) {
        resolved = await lookupSlugCI(
          "ignition_contacts",
          "ignition_contact_id",
          "email",
          email,
          SLUG_PREFIXES.contact,
        )
      }
    }
    // Payments, services, deals have no reliable natural key from the
    // Zapier payload — they cascade through FK translation instead.

    if (resolved) {
      cache.set(cacheKey, resolved)
      return resolved
    }
    cache.set(cacheKey, NEGATIVE_CACHE_VALUE)
    return incomingId
  }

  /** Case-insensitive variant for fields like email / business_name where the
   *  merge step used `lower(trim(...))` as the match key. */
  async function lookupSlugCI(
    table: string,
    selectCol: string,
    matchCol: string,
    matchValue: string,
    prefix: string,
  ): Promise<string | null> {
    const trimmed = matchValue.trim()
    if (!trimmed) return null
    const { data, error } = await supabase
      .from(table)
      .select(selectCol)
      .ilike(matchCol, trimmed)
      .like(selectCol, `${prefix}%`)
      .limit(1)
      .maybeSingle()
    if (error) {
      console.warn(`[id-resolver] ${table}.${matchCol}~'${trimmed}' lookup failed: ${error.message}`)
      return null
    }
    return (data as any)?.[selectCol] ?? null
  }

  return { resolve, looksLikeSlug }
}

// -------- Helpers --------------------------------------------------------

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== "") return String(v)
  }
  return null
}
