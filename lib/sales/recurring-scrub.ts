import { createClient } from "@supabase/supabase-js"

/**
 * Recurring-revenue scrub
 * ────────────────────────────────────────────────────────────────────────
 * The Ignition feed flags many one-time engagements as "recurring" because
 * the platform allows monthly billing schedules on fixed-fee work. The
 * `motta_recurring_revenue` table is the partner-maintained authoritative
 * list of clients on real recurring engagements.
 *
 * `loadRecurringScrubSet()` returns a Set of normalized client names that
 * SHOULD keep their `recurring_total`. Anyone not in the set has their
 * recurring shifted into one-time on the response side.
 *
 * Normalization mirrors the SQL generated column on `motta_recurring_revenue`:
 *   lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))
 */

export function normalizeClientName(name: string | null | undefined): string {
  if (!name) return ""
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

let cached: { set: Set<string>; expiresAt: number } | null = null
const TTL_MS = 60_000

export async function loadRecurringScrubSet(): Promise<Set<string>> {
  if (cached && cached.expiresAt > Date.now()) return cached.set
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data, error } = await supabase
    .from("motta_recurring_revenue")
    .select("normalized_name")
  if (error) {
    console.error("[recurring-scrub] failed to load curated list:", error)
    // Fail-open: empty set means everything gets scrubbed → safest under-count
    return new Set()
  }
  const set = new Set<string>(
    (data || []).map((r) => r.normalized_name).filter(Boolean) as string[],
  )
  cached = { set, expiresAt: Date.now() + TTL_MS }
  return set
}

/**
 * Scrubs a single proposal's recurring vs one-time totals based on whether
 * its linked organization / client_name appears in the curated list.
 *
 * Returns a NEW object with the corrected totals; the original `total_value`
 * is preserved and one-time absorbs whatever recurring is removed.
 */
export function applyRecurringScrub<
  T extends {
    client_name: string | null
    organization_name?: string | null
    recurring_total: number | null
    one_time_total: number | null
    total_value: number | null
    recurring_frequency?: string | null
  },
>(proposal: T, curatedSet: Set<string>): T & { is_curated_recurring: boolean } {
  const candidates = [
    proposal.organization_name,
    proposal.client_name,
  ].filter(Boolean) as string[]
  const isCurated = candidates.some((n) =>
    curatedSet.has(normalizeClientName(n)),
  )

  const recurring = Number(proposal.recurring_total) || 0
  const oneTime = Number(proposal.one_time_total) || 0
  const total = Number(proposal.total_value) || 0

  if (isCurated) {
    return { ...proposal, is_curated_recurring: true }
  }
  // Not curated: zero out recurring; preserve total_value by absorbing it
  // into one-time. Keeps row totals consistent with what users expect.
  return {
    ...proposal,
    recurring_total: 0,
    one_time_total: Math.max(oneTime + recurring, total > 0 ? total : 0),
    is_curated_recurring: false,
  }
}
