import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

import {
  classifyService,
  effectiveBillingFrequency,
  extractPayloadServices,
  normalizeClientName,
  type Department,
  type IgnitionBillingFrequency,
} from "@/lib/sales/ignition-recurring"

/**
 * Lifecycle filter — mirrors the Sales Dashboard's status grouping so the
 * two surfaces stay consistent.
 *
 *   accepted  — won deals currently producing revenue (default; what we
 *               consider "the live recurring book")
 *   pipeline  — sent / awaiting_acceptance / draft proposals that haven't
 *               closed yet. MRR here represents what MAY come in.
 *   lost      — declined deals (status=lost OR lost_at populated). MRR
 *               here represents recurring revenue we missed out on.
 *   all       — every non-archived proposal regardless of state.
 */
type Lifecycle = "accepted" | "pipeline" | "lost" | "all"
const VALID_LIFECYCLES: Lifecycle[] = ["accepted", "pipeline", "lost", "all"]

const PIPELINE_STATUSES = ["sent", "awaiting_acceptance", "draft"]
const ACCEPTED_STATUSES = ["accepted", "completed"]

/**
 * Sales > Recurring Revenue (live from Ignition)
 * ────────────────────────────────────────────────────────────────────────
 * MRR / ARR / Onboarding totals computed from active Ignition proposals
 * via the raw `payload.services` JSON — not the `ignition_proposal_services`
 * normalized table. That table is populated by an incomplete sync that
 * drops rows for ~460 of the firm's active proposals (including PROP-3021
 * "BKPG | Synergy Rehab Scottsbluff", which shows correctly in Ignition as
 * "$300 billed on acceptance + $300/mo recurring" but has zero rows in
 * the normalized table). Reading from the payload directly fixes that.
 *
 * Algorithm:
 *   1. Pull every active proposal (accepted, not revoked / lost / archived).
 *   2. For each service line in `payload.services`:
 *        • classify into Department + service_type via the catalog
 *        • apply firm policy via `effectiveBillingFrequency` — Tax is
 *          never recurring, even when Ignition records monthly cadence
 *          (installment billing for one-time returns is common)
 *        • monthly contribution: period_rate for Monthly, period_rate/3
 *          for Quarterly, 0 otherwise
 *        • one-time contribution: contract_amount when the line is not
 *          recurring (captures Onboarding & Optimization too)
 *   3. Roll up by department, service_type, and client (grouped by
 *      organization_id when present, else normalized client name).
 *
 * The partner-curated `motta_recurring_revenue` table is still consulted
 * for the "Not in Ignition yet" gap callout — curated clients with no
 * active Ignition proposal — so the team can see which clients still
 * need a proposal sent through Ignition.
 */

export const dynamic = "force-dynamic"
// 60-second cache so KPI cards + table + chart on the same page share a
// single query, but a router refresh still picks up new Ignition data
// quickly.
export const revalidate = 60

interface ProposalRow {
  proposal_id: string
  proposal_number: string | null
  status: string | null
  client_name: string | null
  organization_id: string | null
  contact_id: string | null
  accepted_at: string | null
  sent_at: string | null
  lost_at: string | null
  lost_reason: string | null
  created_at: string | null
  total_value: number | null
  recurring_total: number | null
  one_time_total: number | null
  payload: Record<string, unknown> | null
  organizations: { id: string; name: string | null } | null
}

interface DeptAgg {
  department: Department
  mrr: number
  arr: number
  one_time_total: number
  onboarding_total: number
  service_lines: number
  clients: Set<string>
}

interface ServiceAgg {
  department: Department
  service_type: string
  mrr: number
  arr: number
  one_time_total: number
  onboarding_total: number
  service_lines: number
  clients: Set<string>
}

interface ClientAgg {
  client_key: string
  department: Department
  client_name: string
  normalized_name: string
  organization_id: string | null
  contact_id: string | null
  mrr: number
  arr: number
  one_time_total: number
  onboarding_total: number
  service_lines: number
  proposals: Set<string>
  service_types: Set<string>
  cadences: Set<string>
  earliest_accepted_at: string | null
}

/** Monthly contribution from one classified service line. */
function monthlyContribution(
  freq: IgnitionBillingFrequency,
  periodRate: number,
): number {
  if (periodRate <= 0) return 0
  if (freq === "monthly") return periodRate
  if (freq === "quarterly") return periodRate / 3
  // Weekly, annual, etc. don't roll into MRR — the firm's partners count
  // only true monthly / quarterly recurring engagements.
  return 0
}

/** Annual contribution (ARR) from one classified service line. */
function annualContribution(
  freq: IgnitionBillingFrequency,
  periodRate: number,
): number {
  if (periodRate <= 0) return 0
  if (freq === "monthly") return periodRate * 12
  if (freq === "quarterly") return periodRate * 4
  return 0
}

export async function GET(req: NextRequest) {
  // Lifecycle param — defaults to "accepted" so the page behaves
  // identically to before unless a user explicitly switches tabs.
  const lifecycleParam = req.nextUrl.searchParams.get("lifecycle") ?? "accepted"
  const lifecycle: Lifecycle = VALID_LIFECYCLES.includes(
    lifecycleParam as Lifecycle,
  )
    ? (lifecycleParam as Lifecycle)
    : "accepted"

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // ── 1. Pull every proposal matching the lifecycle filter ─────────────
  // Paginate to safely walk past the PostgREST 1000-row cap. We always
  // exclude `archived_at` rows — archived proposals are tombstones,
  // never useful for any view. Other filters are applied per lifecycle.
  const proposals: ProposalRow[] = []
  {
    const PAGE = 500
    for (let offset = 0; ; offset += PAGE) {
      // Each iteration must build its own query — PostgREST builders are
      // mutable and we'd accumulate filters across pages otherwise.
      let query = supabase
        .from("ignition_proposals")
        .select(
          `proposal_id, proposal_number, status, client_name, organization_id, contact_id,
           accepted_at, sent_at, lost_at, lost_reason, created_at, total_value, recurring_total,
           one_time_total, payload,
           organizations(id, name)`,
        )
        .is("archived_at", null)
        .range(offset, offset + PAGE - 1)

      if (lifecycle === "accepted") {
        // Live recurring book: won and still in force.
        query = query
          .not("accepted_at", "is", null)
          .is("revoked_at", null)
          .is("lost_at", null)
          .in("status", ACCEPTED_STATUSES)
      } else if (lifecycle === "pipeline") {
        // In-flight: not yet accepted, not lost.
        query = query
          .is("accepted_at", null)
          .is("lost_at", null)
          .in("status", PIPELINE_STATUSES)
      } else if (lifecycle === "lost") {
        // Decided-and-lost. `lost_at` is the canonical signal — status
        // can lag behind on Ignition's side.
        query = query.not("lost_at", "is", null)
      }
      // lifecycle === "all" → no additional filters (just archived_at null).

      const { data, error } = await query
      if (error) {
        console.error("[sales/recurring-revenue] proposals query failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      const chunk = (data ?? []) as unknown as ProposalRow[]
      proposals.push(...chunk)
      if (chunk.length < PAGE) break
      if (offset >= 20_000) break
    }
  }

  // ── 2. Aggregate every service line in every proposal ────────────────
  const byDepartment = new Map<Department, DeptAgg>()
  const byService = new Map<string, ServiceAgg>()
  const byClient = new Map<string, ClientAgg>()
  // Raw rows for the per-client expand view — recurring lines only.
  const rawRows: Array<{
    id: string
    department: Department
    service_type: string
    client_name: string
    cadence: "Monthly" | "Quarterly"
    service_fee: number
    one_time_fee: number
  }> = []

  let totalServiceLines = 0
  for (const p of proposals) {
    const services = extractPayloadServices(p.payload)
    if (services.length === 0) continue

    // Client identity: prefer organization_id when present so two
    // proposals for the same org merge cleanly. Fall back to the
    // normalized client name (matches the `motta_recurring_revenue` SQL
    // generated column so curated vs. live numbers reconcile).
    const fallbackName =
      p.organizations?.name?.trim() || p.client_name?.trim() || "Unknown Client"
    const normalized = normalizeClientName(fallbackName)
    const clientKey = p.organization_id
      ? `org::${p.organization_id}`
      : normalized
        ? `name::${normalized}`
        : `proposal::${p.proposal_id}`

    let svcIdx = 0
    for (const svc of services) {
      const cls = classifyService(svc.name)
      const dept = cls.department
      const serviceType = cls.service_type
      const isOnboarding = cls.is_onboarding

      // Firm policy: Tax is never recurring, even when Ignition records
      // monthly cadence (installment-billed returns are common).
      const freq = effectiveBillingFrequency(svc.raw_cadence, dept)

      const m = monthlyContribution(freq, svc.period_rate)
      const a = annualContribution(freq, svc.period_rate)

      // One-time bucket: when the effective frequency is one-time we
      // attribute the full contract amount. `contract_amount` carries
      // the on-acceptance fee for the line (e.g. PROP-3021 has a $300
      // "Billed on acceptance" line that lands here as $300 one-time).
      const oneTime =
        freq === "one-time"
          ? svc.contract_amount > 0
            ? svc.contract_amount
            : svc.period_rate
          : 0
      const onboarding = isOnboarding && freq === "one-time" ? oneTime : 0

      totalServiceLines += 1

      // ── Department roll-up ─────────────────────────────────────────
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

      // ── Service-type roll-up ───────────────────────────────────────
      const sKey = `${dept}::${serviceType}`
      const sRoll = byService.get(sKey) ?? {
        department: dept,
        service_type: serviceType,
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

      // ── Client roll-up ─────────────────────────────────────────────
      const cRoll = byClient.get(clientKey) ?? {
        client_key: clientKey,
        department: dept,
        client_name: fallbackName,
        normalized_name: normalized,
        organization_id: p.organization_id,
        contact_id: p.contact_id,
        mrr: 0,
        arr: 0,
        one_time_total: 0,
        onboarding_total: 0,
        service_lines: 0,
        proposals: new Set<string>(),
        service_types: new Set<string>(),
        cadences: new Set<string>(),
        earliest_accepted_at: null as string | null,
      }
      cRoll.mrr += m
      cRoll.arr += a
      cRoll.one_time_total += oneTime
      cRoll.onboarding_total += onboarding
      cRoll.service_lines += 1
      cRoll.proposals.add(p.proposal_id)
      if (serviceType) cRoll.service_types.add(serviceType)
      // Promote dept if any line on this client is Accounting (some
      // clients have mixed Tax + Accounting proposals — the page tabs
      // are scoped to where the recurring revenue actually sits).
      if (m > 0 || a > 0) cRoll.department = dept
      if (freq === "monthly") cRoll.cadences.add("Monthly")
      if (freq === "quarterly") cRoll.cadences.add("Quarterly")
      // Effective lifecycle date for the client roll-up. Prefer
      // accepted_at; fall back through lost_at → sent_at → created_at so
      // the column is still meaningful in the Pipeline / Lost / All
      // tabs (those rows may not have an accepted_at).
      const effectiveDate =
        p.accepted_at ?? p.lost_at ?? p.sent_at ?? p.created_at ?? null
      if (
        effectiveDate &&
        (!cRoll.earliest_accepted_at ||
          effectiveDate < cRoll.earliest_accepted_at)
      ) {
        cRoll.earliest_accepted_at = effectiveDate
      }
      byClient.set(clientKey, cRoll)

      // ── Raw row for the page expand view (recurring lines only) ────
      if (freq === "monthly" || freq === "quarterly") {
        rawRows.push({
          id: `${p.proposal_id}::${svcIdx}`,
          department: dept,
          service_type: serviceType,
          client_name: fallbackName,
          cadence: freq === "monthly" ? "Monthly" : "Quarterly",
          service_fee: svc.period_rate,
          one_time_fee: 0,
        })
      }
      svcIdx += 1
    }
  }

  // ── 3. Serialize aggregates ──────────────────────────────────────────
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
      cadences: Array.from(c.cadences).sort(),
      mrr: round2(c.mrr),
      arr: round2(c.arr),
      one_time_total: round2(c.one_time_total),
      onboarding_total: round2(c.onboarding_total),
      service_lines: c.service_lines,
      proposal_count: c.proposals.size,
      effective_start_date: c.earliest_accepted_at,
    }))
    .sort((a, b) => b.mrr - a.mrr)

  let totalMrr = 0
  let totalArr = 0
  let totalOneTime = 0
  let totalOnboarding = 0
  for (const d of departments) {
    totalMrr += d.mrr
    totalArr += d.arr
    totalOneTime += d.one_time_total
    totalOnboarding += d.onboarding_total
  }

  // ── 4. Ignition freshness metadata ───────────────────────────────────
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

  // ── 5. Gap diagnostic: curated clients NOT in Ignition yet ───────────
  // Surfaces clients that the partner team tracks on the CSV but haven't
  // been moved onto Ignition yet — so the live totals are honest while
  // the team can still see the gap they need to close. The CSV is from
  // the firm's records and is treated as a reference list here, not as
  // an authoritative MRR source (those numbers can drift from the live
  // Ignition picture).
  //
  // Only run this for the "accepted" lifecycle — the curated CSV
  // represents the firm's live recurring book, so it only makes sense
  // to reconcile it against the accepted proposal set. In Pipeline /
  // Lost / All views, surfacing a "Not in Ignition yet" callout would
  // be confusing (those proposals aren't representing today's revenue).
  let notInIgnition: Array<{
    department: Department
    client_name: string
    normalized_name: string
    service_types: string[]
    mrr: number
  }> = []
  if (lifecycle === "accepted") {
    const ignitionKeys = new Set<string>()
    for (const c of clients) {
      if (c.normalized_name) ignitionKeys.add(c.normalized_name)
    }
    const { data: curatedRaw } = await supabase
      .from("motta_recurring_revenue_by_client")
      .select(
        "department, client_name, normalized_name, service_types, mrr, has_monthly, has_quarterly",
      )
      .order("mrr", { ascending: false, nullsFirst: false })
    type CuratedRow = {
      department: string | null
      client_name: string | null
      normalized_name: string | null
      service_types: string | null
      mrr: number | string | null
      has_monthly: boolean | null
      has_quarterly: boolean | null
    }
    notInIgnition = (curatedRaw as CuratedRow[] | null ?? [])
      .filter((c) => {
        const dept = c.department === "Accounting" || c.department === "Tax"
        return dept && c.normalized_name && !ignitionKeys.has(c.normalized_name)
      })
      .map((c) => ({
        department: (c.department as Department) ?? "Accounting",
        client_name: c.client_name ?? "Unknown Client",
        normalized_name: c.normalized_name ?? "",
        service_types: String(c.service_types ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        mrr: Number(c.mrr) || 0,
      }))
  }

  // ── 6. Lifecycle counts — used by the tab badges in the UI ───────────
  // Cheap to compute (one count query per bucket) and gives the user
  // the same "what's in each tab" affordance the Sales Dashboard has.
  // Errors here are non-fatal; if any of these counts fail we just
  // return null and the UI hides the badge.
  const baseCountQuery = () =>
    supabase
      .from("ignition_proposals")
      .select("proposal_id", { count: "exact", head: true })
      .is("archived_at", null)
  let lifecycleCounts: {
    accepted: number | null
    pipeline: number | null
    lost: number | null
    all: number | null
  } = { accepted: null, pipeline: null, lost: null, all: null }
  try {
    const [acceptedRes, pipelineRes, lostRes, allRes] = await Promise.all([
      baseCountQuery()
        .not("accepted_at", "is", null)
        .is("revoked_at", null)
        .is("lost_at", null)
        .in("status", ACCEPTED_STATUSES),
      baseCountQuery()
        .is("accepted_at", null)
        .is("lost_at", null)
        .in("status", PIPELINE_STATUSES),
      baseCountQuery().not("lost_at", "is", null),
      baseCountQuery(),
    ])
    lifecycleCounts = {
      accepted: acceptedRes.count ?? null,
      pipeline: pipelineRes.count ?? null,
      lost: lostRes.count ?? null,
      all: allRes.count ?? null,
    }
  } catch (err) {
    console.error("[sales/recurring-revenue] lifecycle counts failed:", err)
  }

  return NextResponse.json({
    source: "ignition" as const,
    lifecycle,
    lifecycleCounts,
    lastSyncedAt,
    totals: {
      mrr: round2(totalMrr),
      arr: round2(totalArr),
      one_time_total: round2(totalOneTime),
      onboarding_total: round2(totalOnboarding),
      distinct_clients: clients.length,
      service_lines: totalServiceLines,
      avg_mrr_per_client:
        clients.length > 0 ? round2(totalMrr / clients.length) : 0,
      active_proposals: proposals.length,
    },
    departments,
    serviceBreakdown,
    clients,
    rows: rawRows,
    not_in_ignition: notInIgnition,
  })
}
