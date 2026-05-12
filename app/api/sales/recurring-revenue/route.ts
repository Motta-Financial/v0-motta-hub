import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import {
  ACTIVE_PROPOSAL_STATUSES,
  annualContribution,
  classifyService,
  monthlyContribution,
  normalizeBillingFrequency,
  normalizeClientName,
  type Department,
  type IgnitionBillingFrequency,
} from "@/lib/sales/ignition-recurring"

/**
 * Sales > Recurring Revenue (LIVE from Ignition)
 * ────────────────────────────────────────────────────────────────────────
 * This endpoint replaces the previous CSV-driven curated source. Every
 * tick, it aggregates `ignition_proposal_services` joined to
 * `ignition_proposals` to produce live MRR / ARR roll-ups for Accounting
 * and Tax.
 *
 * Design notes:
 *   1. We aggregate at the SERVICE LINE level, NOT proposal totals. The
 *      proposal-level `recurring_total` / `one_time_total` columns are
 *      null on 463 of the firm's `completed` proposals, so they cannot be
 *      trusted as a primary signal. Service rows always have a
 *      `billing_frequency` and `total_amount` we can sum.
 *
 *   2. Active engagements are proposals where:
 *        accepted_at IS NOT NULL
 *        AND revoked_at IS NULL
 *        AND lost_at IS NULL
 *        AND archived_at IS NULL
 *        AND status IN ('accepted','completed')
 *      ("completed" means the proposal flow finished — the recurring
 *      services on those proposals are still earning.)
 *
 *   3. Monthly recurring contribution rules:
 *        monthly  → +amount
 *        quarterly→ +amount/3
 *        weekly   → +amount × (52/12)
 *        annually → +amount/12
 *        one-time → 0
 *      "Onboarding & Optimization" one-time services are bucketed into
 *      `onboarding_total` instead of generic `one_time_total`.
 *
 *   4. Client grouping uses `organization_id` when present, falls back to
 *      a normalized form of `client_name`. The normalized form matches
 *      the generated column on `motta_recurring_revenue` so partners can
 *      cross-reference with the curated CSV list (which we still surface
 *      as a "Not in Ignition yet" gap diagnostic).
 *
 *   5. The response shape is backward-compatible with the previous
 *      curated-CSV version, with three additive fields:
 *        - lastSyncedAt: ISO of the most recent Ignition sync
 *        - source: "ignition"
 *        - per-client `onboarding_total`, `proposal_count`
 *        - top-level `not_in_ignition`: curated clients with no Ignition
 *          proposal yet — useful for spotting gaps without breaking
 *          render logic.
 */

export const dynamic = "force-dynamic"
// 60-second cache so multiple components on the same page (KPI cards +
// table + chart) share one query, but a router refresh still picks up
// new Ignition data quickly. Don't make this longer — partners do a
// manual sync and expect to see the result within ~1 minute.
export const revalidate = 60

interface ProposalRow {
  proposal_id: string
  status: string | null
  recurring_frequency: string | null
  client_name: string | null
  organization_id: string | null
  contact_id: string | null
  effective_start_date: string | null
  billing_starts_on: string | null
  accepted_at: string | null
}

interface ServiceRow {
  proposal_id: string | null
  service_name: string | null
  billing_frequency: string | null
  billing_type: string | null
  total_amount: number | string | null
  unit_price: number | string | null
  quantity: number | string | null
  status: string | null
}

interface DepartmentRoll {
  department: Department
  mrr: number
  arr: number
  one_time_total: number
  onboarding_total: number
  service_lines: number
  clients: Set<string>
}

interface ServiceRoll {
  department: Department
  service_type: string
  mrr: number
  arr: number
  one_time_total: number
  onboarding_total: number
  service_lines: number
  clients: Set<string>
}

interface ClientRoll {
  department: Department
  client_name: string
  normalized_name: string
  organization_id: string | null
  contact_id: string | null
  service_types: Set<string>
  cadences: Set<IgnitionBillingFrequency>
  mrr: number
  arr: number
  one_time_total: number
  onboarding_total: number
  service_lines: number
  proposal_ids: Set<string>
  effective_start_date: string | null
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // ── 1. Active proposals ──────────────────────────────────────────────
  // Pull the proposal context we'll need for grouping/labeling. We do this
  // separately from the services query so we can keep a tight predicate
  // on `accepted_at IS NOT NULL AND status IN (...)` without joining on a
  // subquery in PostgREST.
  const { data: proposalsData, error: proposalsErr } = await supabase
    .from("ignition_proposals")
    .select(
      "proposal_id, status, recurring_frequency, client_name, organization_id, contact_id, effective_start_date, billing_starts_on, accepted_at, revoked_at, lost_at, archived_at",
    )
    .not("accepted_at", "is", null)
    .is("revoked_at", null)
    .is("lost_at", null)
    .is("archived_at", null)
    .in("status", ACTIVE_PROPOSAL_STATUSES as unknown as string[])

  if (proposalsErr) {
    console.error("[sales/recurring-revenue] proposals query failed:", proposalsErr)
    return NextResponse.json({ error: proposalsErr.message }, { status: 500 })
  }

  const proposals = (proposalsData ?? []) as ProposalRow[]
  const proposalById = new Map<string, ProposalRow>()
  for (const p of proposals) {
    if (p.proposal_id) proposalById.set(p.proposal_id, p)
  }
  const activeProposalIds = Array.from(proposalById.keys())

  // ── 2. Services for those proposals ──────────────────────────────────
  // We pull every service line for every active proposal in one shot.
  // PostgREST caps `.in()` at ~1000 ids by default; we paginate to stay
  // safe in case the firm's proposal count grows past that. The firm
  // currently has ~200 active proposals so a single batch is fine, but
  // the loop makes the code future-proof.
  const services: ServiceRow[] = []
  const BATCH = 500
  for (let i = 0; i < activeProposalIds.length; i += BATCH) {
    const slice = activeProposalIds.slice(i, i + BATCH)
    if (slice.length === 0) break
    const { data, error } = await supabase
      .from("ignition_proposal_services")
      .select(
        "proposal_id, service_name, billing_frequency, billing_type, total_amount, unit_price, quantity, status",
      )
      .in("proposal_id", slice)
    if (error) {
      console.error("[sales/recurring-revenue] services query failed:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    services.push(...((data ?? []) as ServiceRow[]))
  }

  // ── 3. Roll up by department / service_type / client ─────────────────
  const byDepartment = new Map<Department, DepartmentRoll>()
  const byService = new Map<string, ServiceRoll>()
  const byClient = new Map<string, ClientRoll>()
  // Raw service-line rows for the (optional) per-client expand view.
  const rawRows: Array<{
    id: string
    department: Department
    service_type: string
    client_name: string
    cadence: "Monthly" | "Quarterly"
    service_fee: number
    one_time_fee: number
    is_onboarding: boolean
  }> = []

  for (const svc of services) {
    const proposal = svc.proposal_id ? proposalById.get(svc.proposal_id) : null
    if (!proposal) continue // belongs to a non-active proposal; skip

    const amount = Number(svc.total_amount) || 0
    const freq = normalizeBillingFrequency(svc.billing_frequency)
    const cls = classifyService(svc.service_name)
    const dept = cls.department
    const m = monthlyContribution(amount, freq)
    const a = annualContribution(amount, freq)
    // "one_time_total" counts every non-recurring line; "onboarding_total"
    // is the subset of that bucket flagged by `detectOnboarding`. Partners
    // see both — onboarding is the bundled fee, one-time is everything
    // else (extra returns, ad-hoc work bolted onto a recurring deal).
    const isOneTime = m === 0
    const oneTime = isOneTime ? amount : 0
    const onboarding = isOneTime && cls.is_onboarding ? amount : 0

    // Client identity: organization_id wins, contact_id is a fallback for
    // unincorporated individual engagements, and the normalized name is
    // the last resort so we never lose a row to missing metadata.
    const clientName = proposal.client_name?.trim() || "Unknown Client"
    const normalized = normalizeClientName(clientName)
    const clientKey =
      proposal.organization_id ??
      proposal.contact_id ??
      `name::${normalized || clientName}`

    // Department roll-up
    const deptRoll = byDepartment.get(dept) ?? {
      department: dept,
      mrr: 0,
      arr: 0,
      one_time_total: 0,
      onboarding_total: 0,
      service_lines: 0,
      clients: new Set<string>(),
    }
    deptRoll.mrr += m
    deptRoll.arr += a
    deptRoll.one_time_total += oneTime
    deptRoll.onboarding_total += onboarding
    deptRoll.service_lines += 1
    deptRoll.clients.add(clientKey)
    byDepartment.set(dept, deptRoll)

    // Service-type roll-up
    const sKey = `${dept}::${cls.service_type}`
    const sRoll = byService.get(sKey) ?? {
      department: dept,
      service_type: cls.service_type,
      mrr: 0,
      arr: 0,
      one_time_total: 0,
      onboarding_total: 0,
      service_lines: 0,
      clients: new Set<string>(),
    }
    sRoll.mrr += m
    sRoll.arr += a
    sRoll.one_time_total += oneTime
    sRoll.onboarding_total += onboarding
    sRoll.service_lines += 1
    sRoll.clients.add(clientKey)
    byService.set(sKey, sRoll)

    // Client roll-up (per department so a client with both Tax and Accounting
    // service lines shows up twice in the table — matches the CSV behavior).
    const cKey = `${dept}::${clientKey}`
    const cRoll = byClient.get(cKey) ?? {
      department: dept,
      client_name: clientName,
      normalized_name: normalized,
      organization_id: proposal.organization_id ?? null,
      contact_id: proposal.contact_id ?? null,
      service_types: new Set<string>(),
      cadences: new Set<IgnitionBillingFrequency>(),
      mrr: 0,
      arr: 0,
      one_time_total: 0,
      onboarding_total: 0,
      service_lines: 0,
      proposal_ids: new Set<string>(),
      effective_start_date: proposal.effective_start_date ?? proposal.billing_starts_on ?? null,
    }
    cRoll.service_types.add(cls.service_type)
    cRoll.cadences.add(freq)
    cRoll.mrr += m
    cRoll.arr += a
    cRoll.one_time_total += oneTime
    cRoll.onboarding_total += onboarding
    cRoll.service_lines += 1
    if (svc.proposal_id) cRoll.proposal_ids.add(svc.proposal_id)
    byClient.set(cKey, cRoll)

    // Only emit recurring lines into rawRows (the per-client expand view
    // on the page only ever rendered monthly/quarterly rows historically).
    if (m > 0) {
      rawRows.push({
        id: `${svc.proposal_id ?? "x"}::${rawRows.length}`,
        department: dept,
        service_type: cls.service_type,
        client_name: clientName,
        cadence: freq === "quarterly" ? "Quarterly" : "Monthly",
        service_fee: amount,
        one_time_fee: 0,
        is_onboarding: false,
      })
    }
  }

  // ── 4. Serialize ─────────────────────────────────────────────────────
  const round2 = (n: number) => Math.round(n * 100) / 100

  const departments = Array.from(byDepartment.values())
    .map((d) => ({
      department: d.department,
      mrr: round2(d.mrr),
      arr: round2(d.arr),
      one_time_total: round2(d.one_time_total),
      onboarding_total: round2(d.onboarding_total),
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
      onboarding_total: round2(s.onboarding_total),
      service_lines: s.service_lines,
      client_count: s.clients.size,
    }))
    .sort((a, b) => b.mrr - a.mrr)

  const clients = Array.from(byClient.values())
    .map((c) => ({
      department: c.department,
      client_name: c.client_name,
      normalized_name: c.normalized_name,
      organization_id: c.organization_id,
      contact_id: c.contact_id,
      service_types: Array.from(c.service_types).sort(),
      cadences: Array.from(c.cadences)
        .map((cad) => (cad === "monthly" ? "Monthly" : cad === "quarterly" ? "Quarterly" : cad))
        .sort(),
      mrr: round2(c.mrr),
      arr: round2(c.arr),
      one_time_total: round2(c.one_time_total),
      onboarding_total: round2(c.onboarding_total),
      service_lines: c.service_lines,
      proposal_count: c.proposal_ids.size,
      effective_start_date: c.effective_start_date,
    }))
    .sort((a, b) => b.mrr - a.mrr)

  const totalMrr = departments.reduce((s, d) => s + d.mrr, 0)
  const totalArr = departments.reduce((s, d) => s + d.arr, 0)
  const totalOneTime = departments.reduce((s, d) => s + d.one_time_total, 0)
  const totalOnboarding = departments.reduce((s, d) => s + d.onboarding_total, 0)
  const distinctClients = new Set(clients.map((c) => c.normalized_name || c.client_name)).size

  // ── 5. Freshness metadata ────────────────────────────────────────────
  // Show the most recent Ignition connection sync so users know how
  // current the data is. Falls back to null if no connection is active
  // (which surfaces a "Connect Ignition" callout client-side rather than
  // a wrong "live" indicator).
  let lastSyncedAt: string | null = null
  {
    const { data: conn } = await supabase
      .from("ignition_connections")
      .select("last_synced_at")
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    lastSyncedAt = conn?.last_synced_at ?? null
  }

  // ── 6. Gap diagnostic: curated clients NOT in Ignition yet ───────────
  // Partners want to spot recurring relationships that exist in the firm
  // (and therefore appear in `motta_recurring_revenue`) but haven't yet
  // been converted to an Ignition proposal. We surface those as a small
  // sidebar list rather than mixing them into the live totals — keeping
  // the headline MRR honest.
  let notInIgnition: Array<{
    department: Department
    client_name: string
    normalized_name: string
    service_types: string[]
    mrr: number
  }> = []
  {
    const { data: curated } = await supabase
      .from("motta_recurring_revenue_by_client")
      .select("department, client_name, normalized_name, service_types, mrr")
      .order("mrr", { ascending: false })
    const ignitionKeys = new Set(clients.map((c) => c.normalized_name).filter(Boolean))
    notInIgnition = (curated ?? [])
      .filter((c) => c.normalized_name && !ignitionKeys.has(c.normalized_name))
      .map((c) => ({
        department: c.department as Department,
        client_name: c.client_name,
        normalized_name: c.normalized_name,
        service_types: String(c.service_types ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        mrr: Number(c.mrr) || 0,
      }))
  }

  return NextResponse.json({
    source: "ignition" as const,
    lastSyncedAt,
    totals: {
      mrr: round2(totalMrr),
      arr: round2(totalArr),
      one_time_total: round2(totalOneTime),
      onboarding_total: round2(totalOnboarding),
      distinct_clients: distinctClients,
      service_lines: services.length,
      avg_mrr_per_client: distinctClients > 0 ? round2(totalMrr / distinctClients) : 0,
      active_proposals: proposals.length,
    },
    departments,
    serviceBreakdown,
    clients,
    rows: rawRows,
    not_in_ignition: notInIgnition,
  })
}
