import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import {
  ACTIVE_PROPOSAL_STATUSES,
  normalizeClientName,
  type Department,
} from "@/lib/sales/ignition-recurring"

/**
 * Sales > Recurring Revenue (Curated CSV is the source of truth)
 * ────────────────────────────────────────────────────────────────────────
 * Earlier versions of this endpoint aggregated MRR directly from active
 * Ignition proposals. That produced numbers that drifted from the firm's
 * own books because:
 *
 *   1. Ignition lets partners enter monthly billing schedules on what
 *      are really one-time engagements (e.g. installment-billed tax
 *      prep) — those got counted as MRR.
 *   2. Many clients on real recurring engagements haven't been moved
 *      onto Ignition yet, so the live feed under-reports Accounting MRR
 *      vs. the partner-maintained CSV.
 *   3. Several Ignition proposals carry stale or duplicate service
 *      rows that have since been re-priced in the firm's records.
 *
 * The partner team maintains an authoritative CSV that lives in the
 * `motta_recurring_revenue` table. Every row is one service line for one
 * client with a fee, cadence, department, and service type. That table
 * (and its companion `motta_recurring_revenue_by_client` view) now drive
 * the totals, department breakdown, service breakdown, per-client roll-up,
 * and the raw rows shown on the page.
 *
 * Ignition is still consulted for two things only:
 *   • `lastSyncedAt` / `active_proposals` — freshness metadata so users
 *     can confirm Ignition is connected and syncing.
 *   • The "Not in Ignition yet" gap callout — curated clients with no
 *     active Ignition proposal. This is the lever partners use to bring
 *     the live Ignition picture into alignment with their CSV.
 */

export const dynamic = "force-dynamic"
// 60-second cache so KPI cards + table + chart on the same page share a
// single query, but a router refresh still picks up CSV edits quickly.
export const revalidate = 60

interface CuratedRow {
  id: string
  department: string | null
  service_type: string | null
  client_name: string | null
  normalized_name: string | null
  cadence: string | null
  service_fee: number | string | null
  one_time_fee: number | string | null
}

interface CuratedByClient {
  department: string | null
  client_name: string | null
  normalized_name: string | null
  service_types: string | null
  mrr: number | string | null
  arr: number | string | null
  one_time_total: number | string | null
  service_line_count: number | string | null
  has_monthly: boolean | null
  has_quarterly: boolean | null
}

/** Department guard — anything outside the known buckets is skipped. */
function asDept(value: string | null): Department | null {
  if (value === "Accounting" || value === "Tax") return value
  return null
}

/** Monthly contribution from one curated row, given its cadence + fee. */
function monthlyContribution(cadence: string | null, fee: number): number {
  if (fee <= 0) return 0
  if (cadence === "Monthly") return fee
  if (cadence === "Quarterly") return fee / 3
  // Anything else (e.g. "Annual", null) is treated as non-recurring and
  // contributes 0 to MRR. The fee still appears as one_time on the row.
  return 0
}

/** Annual contribution (ARR) from one curated row. */
function annualContribution(cadence: string | null, fee: number): number {
  if (fee <= 0) return 0
  if (cadence === "Monthly") return fee * 12
  if (cadence === "Quarterly") return fee * 4
  return 0
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // ── 1. Pull the curated CSV (authoritative) ──────────────────────────
  // Every row is one service line. We aggregate by department, by
  // service_type, and by client below. The companion view
  // `motta_recurring_revenue_by_client` is used for the per-client
  // roll-up because it already collapses service lines and computes
  // mrr/arr per client using the same cadence rules.
  const { data: curatedRowsRaw, error: curatedErr } = await supabase
    .from("motta_recurring_revenue")
    .select(
      "id, department, service_type, client_name, normalized_name, cadence, service_fee, one_time_fee",
    )

  if (curatedErr) {
    console.error("[sales/recurring-revenue] curated CSV query failed:", curatedErr)
    return NextResponse.json({ error: curatedErr.message }, { status: 500 })
  }

  const curatedRows = (curatedRowsRaw ?? []) as CuratedRow[]

  // ── 2. Headline totals + per-department / per-service roll-ups ───────
  interface DeptAgg {
    department: Department
    mrr: number
    arr: number
    one_time_total: number
    service_lines: number
    clients: Set<string>
  }
  interface ServiceAgg {
    department: Department
    service_type: string
    mrr: number
    arr: number
    one_time_total: number
    service_lines: number
    clients: Set<string>
  }

  const byDepartment = new Map<Department, DeptAgg>()
  const byService = new Map<string, ServiceAgg>()
  const distinctClients = new Set<string>()
  let totalMrr = 0
  let totalArr = 0
  let totalOneTime = 0
  let totalServiceLines = 0

  // Raw rows for the per-client expand view on the page. We only emit
  // rows with a recurring cadence (Monthly / Quarterly) — the page
  // historically renders the expand view from recurring service lines
  // only. One-time fees still roll into the totals above.
  const rawRows: Array<{
    id: string
    department: Department
    service_type: string
    client_name: string
    cadence: "Monthly" | "Quarterly"
    service_fee: number
    one_time_fee: number
  }> = []

  for (const r of curatedRows) {
    const dept = asDept(r.department)
    if (!dept) continue

    const fee = Number(r.service_fee) || 0
    const oneTime = Number(r.one_time_fee) || 0
    const cadence = r.cadence
    const serviceType = r.service_type?.trim() || "Uncategorized"
    const clientName = r.client_name?.trim() || "Unknown Client"
    const normalized =
      r.normalized_name || normalizeClientName(clientName)
    const clientKey = normalized || `name::${clientName}`

    const m = monthlyContribution(cadence, fee)
    const a = annualContribution(cadence, fee)

    totalMrr += m
    totalArr += a
    totalOneTime += oneTime
    totalServiceLines += 1
    distinctClients.add(clientKey)

    // Department roll-up
    const deptRoll = byDepartment.get(dept) ?? {
      department: dept,
      mrr: 0,
      arr: 0,
      one_time_total: 0,
      service_lines: 0,
      clients: new Set<string>(),
    }
    deptRoll.mrr += m
    deptRoll.arr += a
    deptRoll.one_time_total += oneTime
    deptRoll.service_lines += 1
    deptRoll.clients.add(clientKey)
    byDepartment.set(dept, deptRoll)

    // Service-type roll-up
    const sKey = `${dept}::${serviceType}`
    const sRoll = byService.get(sKey) ?? {
      department: dept,
      service_type: serviceType,
      mrr: 0,
      arr: 0,
      one_time_total: 0,
      service_lines: 0,
      clients: new Set<string>(),
    }
    sRoll.mrr += m
    sRoll.arr += a
    sRoll.one_time_total += oneTime
    sRoll.service_lines += 1
    sRoll.clients.add(clientKey)
    byService.set(sKey, sRoll)

    // Emit a raw row for recurring lines only (page expand view).
    if (cadence === "Monthly" || cadence === "Quarterly") {
      rawRows.push({
        id: r.id,
        department: dept,
        service_type: serviceType,
        client_name: clientName,
        cadence,
        service_fee: fee,
        one_time_fee: oneTime,
      })
    }
  }

  // ── 3. Per-client roll-up via the dedicated view ─────────────────────
  // `motta_recurring_revenue_by_client` already collapses service lines
  // and exposes `mrr`, `arr`, `one_time_total`, `service_types` (comma-
  // delimited), `has_monthly`, and `has_quarterly`. Using it directly
  // guarantees the per-client numbers reconcile with the underlying
  // rows aggregated above.
  const { data: clientRowsRaw, error: clientErr } = await supabase
    .from("motta_recurring_revenue_by_client")
    .select(
      "department, client_name, normalized_name, service_types, mrr, arr, one_time_total, service_line_count, has_monthly, has_quarterly",
    )
    .order("mrr", { ascending: false, nullsFirst: false })

  if (clientErr) {
    console.error(
      "[sales/recurring-revenue] curated by-client view query failed:",
      clientErr,
    )
    return NextResponse.json({ error: clientErr.message }, { status: 500 })
  }

  const clientRows = (clientRowsRaw ?? []) as CuratedByClient[]
  const clients = clientRows
    .map((c) => {
      const dept = asDept(c.department)
      if (!dept) return null
      const cadences: string[] = []
      if (c.has_monthly) cadences.push("Monthly")
      if (c.has_quarterly) cadences.push("Quarterly")
      return {
        department: dept,
        client_name: c.client_name ?? "Unknown Client",
        normalized_name: c.normalized_name ?? "",
        organization_id: null as string | null,
        contact_id: null as string | null,
        service_types: String(c.service_types ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        cadences,
        mrr: Number(c.mrr) || 0,
        arr: Number(c.arr) || 0,
        one_time_total: Number(c.one_time_total) || 0,
        onboarding_total: 0, // CSV doesn't distinguish onboarding from generic one-time
        service_lines: Number(c.service_line_count) || 0,
        proposal_count: 0,
        effective_start_date: null as string | null,
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  // ── 4. Serialize aggregates ──────────────────────────────────────────
  const round2 = (n: number) => Math.round(n * 100) / 100

  const departments = Array.from(byDepartment.values())
    .map((d) => ({
      department: d.department,
      mrr: round2(d.mrr),
      arr: round2(d.arr),
      one_time_total: round2(d.one_time_total),
      onboarding_total: 0,
      service_lines: d.service_lines,
      client_count: d.clients.size,
    }))
    .sort((a, b) => a.department.localeCompare(b.department))

  const serviceBreakdown = Array.from(byService.values())
    .map((s) => ({
      department: s.department,
      service_type: s.service_type,
      mrr: round2(s.mrr),
      arr: round2(s.arr),
      one_time_total: round2(s.one_time_total),
      onboarding_total: 0,
      service_lines: s.service_lines,
      client_count: s.clients.size,
    }))
    .sort((a, b) => b.mrr - a.mrr)

  // ── 5. Ignition freshness metadata (informational only) ──────────────
  let lastSyncedAt: string | null = null
  let activeProposals = 0
  {
    const { data: conn } = await supabase
      .from("ignition_connections")
      .select("last_synced_at")
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    lastSyncedAt = conn?.last_synced_at ?? null

    const { count } = await supabase
      .from("ignition_proposals")
      .select("proposal_id", { count: "exact", head: true })
      .not("accepted_at", "is", null)
      .is("revoked_at", null)
      .is("lost_at", null)
      .is("archived_at", null)
      .in("status", ACTIVE_PROPOSAL_STATUSES as unknown as string[])
    activeProposals = count ?? 0
  }

  // ── 6. Gap diagnostic: curated clients NOT in Ignition yet ───────────
  // We compare the curated client list against the normalized client
  // names attached to active Ignition proposals. Anyone curated but not
  // present in Ignition is surfaced as a "to-do: send a proposal" hint.
  let notInIgnition: Array<{
    department: Department
    client_name: string
    normalized_name: string
    service_types: string[]
    mrr: number
  }> = []
  {
    const { data: activeProps } = await supabase
      .from("ignition_proposals")
      .select("client_name, organization_id, contact_id")
      .not("accepted_at", "is", null)
      .is("revoked_at", null)
      .is("lost_at", null)
      .is("archived_at", null)
      .in("status", ACTIVE_PROPOSAL_STATUSES as unknown as string[])

    const ignitionKeys = new Set<string>()
    for (const p of activeProps ?? []) {
      if (p.client_name) ignitionKeys.add(normalizeClientName(p.client_name))
    }

    notInIgnition = clients
      .filter((c) => c.normalized_name && !ignitionKeys.has(c.normalized_name))
      .map((c) => ({
        department: c.department,
        client_name: c.client_name,
        normalized_name: c.normalized_name,
        service_types: c.service_types,
        mrr: c.mrr,
      }))
      .sort((a, b) => b.mrr - a.mrr)
  }

  return NextResponse.json({
    source: "curated" as const,
    lastSyncedAt,
    totals: {
      mrr: round2(totalMrr),
      arr: round2(totalArr),
      one_time_total: round2(totalOneTime),
      onboarding_total: 0,
      distinct_clients: distinctClients.size,
      service_lines: totalServiceLines,
      avg_mrr_per_client:
        distinctClients.size > 0
          ? round2(totalMrr / distinctClients.size)
          : 0,
      active_proposals: activeProposals,
    },
    departments,
    serviceBreakdown,
    clients,
    rows: rawRows,
    not_in_ignition: notInIgnition,
  })
}
