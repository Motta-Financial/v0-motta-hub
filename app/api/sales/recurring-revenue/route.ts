import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import {
  ACTIVE_PROPOSAL_STATUSES,
  classifyService,
  extractPayloadServices,
  normalizeClientName,
  type Department,
  type IgnitionBillingFrequency,
  type PayloadService,
} from "@/lib/sales/ignition-recurring"

/**
 * Sales > Recurring Revenue (LIVE from Ignition)
 * ────────────────────────────────────────────────────────────────────────
 * This endpoint aggregates services straight from Ignition's authoritative
 * JSON payload (`ignition_proposals.payload.services`) for every active
 * proposal, then rolls them up by department / service type / client.
 *
 * Why JSON, not the normalized `ignition_proposal_services` table?
 *   • PROP-3021 (Synergy Rehab Scottsbluff) and ~460 other ACTIVE
 *     proposals have zero rows in `ignition_proposal_services` because
 *     the sync that populates it doesn't always run on every proposal.
 *   • The Ignition payload JSON ALWAYS contains the full services array
 *     — it's the same data Ignition's UI renders from.
 *   • Reading the payload directly removes our dependency on a fragile
 *     normalization step. If sync ever lags or skips a proposal, the
 *     numbers still match what partners see in Ignition.
 *
 * Active engagements are proposals where:
 *     accepted_at IS NOT NULL
 *     AND revoked_at IS NULL
 *     AND lost_at IS NULL
 *     AND archived_at IS NULL
 *     AND status IN ('accepted','completed')
 *
 * For each service inside the proposal's payload:
 *   • `frequency` is derived from Ignition's `billing.is_recurring` flag
 *     plus the cadence string ("every month" / "every quarter" / etc.).
 *     Tax services are POLICY-FORCED to "one-time" regardless of cadence,
 *     because Ignition lets partners enter a monthly schedule for an
 *     installment-billed tax return that is still fundamentally one-time.
 *   • `period_rate` is `pricing.minimum_period_value.amount × quantity`
 *     — the per-cycle billed amount, which already reflects partner
 *     discounts. MRR contribution: monthly → rate, quarterly → rate/3,
 *     weekly → rate × 52/12, annually → rate / 12, one-time → 0.
 *   • For one-time services we report `pricing.minimum_contract_value`
 *     as the billed amount (covers deposit-style multi-invoice cases).
 *     Onboarding & Optimization fees are sub-bucketed via the classifier
 *     so partners can read them as a dedicated column.
 *
 * The response shape is unchanged so the existing page renders without
 * modification.
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
  payload: Record<string, unknown> | null
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

/**
 * Compute monthly + annual contribution from a normalized payload service.
 * Pulled out of the loop so the policy (tax→one-time, cadence rules) is
 * exercised by a single code path that's easy to reason about.
 */
function contributions(svc: PayloadService, dept: Department): { m: number; a: number } {
  // Tax is never recurring (firm policy) — overrides whatever Ignition
  // says about cadence. See `effectiveBillingFrequency` in the lib for
  // the full rationale.
  const effFreq: IgnitionBillingFrequency =
    dept === "Tax" ? "one-time" : svc.frequency

  const rate = svc.period_rate
  if (rate <= 0) return { m: 0, a: 0 }

  switch (effFreq) {
    case "monthly":   return { m: rate,              a: rate * 12 }
    case "quarterly": return { m: rate / 3,          a: rate * 4 }
    case "weekly":    return { m: rate * (52 / 12),  a: rate * 52 }
    case "annually":  return { m: rate / 12,         a: rate }
    default:          return { m: 0,                 a: 0 }
  }
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // ── 1. Active proposals (with payload JSON for service extraction) ───
  // We pull `payload` here because it carries the services array we'll
  // aggregate over. This is the single source of truth — Ignition's own
  // representation of the proposal — and replaces the broken
  // `ignition_proposal_services` join used previously.
  const { data: proposalsData, error: proposalsErr } = await supabase
    .from("ignition_proposals")
    .select(
      "proposal_id, status, recurring_frequency, client_name, organization_id, contact_id, effective_start_date, billing_starts_on, accepted_at, revoked_at, lost_at, archived_at, payload",
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

  // ── 2. Roll up by department / service_type / client ─────────────────
  const byDepartment = new Map<Department, DepartmentRoll>()
  const byService = new Map<string, ServiceRoll>()
  const byClient = new Map<string, ClientRoll>()
  // Raw service-line rows for the per-client expand view.
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

  let totalServiceLines = 0

  for (const proposal of proposals) {
    // Extract services straight from the Ignition JSON payload. If a
    // proposal has no payload or no services array (rare, malformed
    // imports), we skip it silently — it'll be visible in the overall
    // proposal count diagnostic.
    const services = extractPayloadServices(proposal.payload)
    if (services.length === 0) continue

    // Client identity: organization_id wins, contact_id is a fallback for
    // unincorporated individual engagements, and the normalized name is
    // the last resort so we never lose a row to missing metadata.
    const clientName = proposal.client_name?.trim() || "Unknown Client"
    const normalized = normalizeClientName(clientName)
    const clientKey =
      proposal.organization_id ??
      proposal.contact_id ??
      `name::${normalized || clientName}`

    for (const svc of services) {
      totalServiceLines += 1

      const cls = classifyService(svc.name)
      const dept = cls.department
      const { m, a } = contributions(svc, dept)

      // The "billed amount" for one-time services is the contract total,
      // since Ignition models deposit-style fees as a single contract
      // value spread across multiple invoice events. For PROP-3021's
      // billed-on-acceptance line, period_rate === contract_amount === $300.
      const isOneTime = m === 0
      const oneTime = isOneTime ? svc.contract_amount || svc.period_rate : 0
      const onboarding = isOneTime && cls.is_onboarding ? oneTime : 0

      // Effective frequency we display / store on the roll-up (Tax forced
      // to one-time, recurring services keep their cadence).
      const displayFreq: IgnitionBillingFrequency =
        dept === "Tax" ? "one-time" : svc.frequency

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

      // Client roll-up (per department so a client with both Tax and
      // Accounting service lines shows up twice in the table).
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
        effective_start_date:
          proposal.effective_start_date ?? proposal.billing_starts_on ?? null,
      }
      cRoll.service_types.add(cls.service_type)
      cRoll.cadences.add(displayFreq)
      cRoll.mrr += m
      cRoll.arr += a
      cRoll.one_time_total += oneTime
      cRoll.onboarding_total += onboarding
      cRoll.service_lines += 1
      if (proposal.proposal_id) cRoll.proposal_ids.add(proposal.proposal_id)
      byClient.set(cKey, cRoll)

      // Only emit recurring lines into rawRows (the per-client expand view
      // on the page only renders monthly/quarterly rows historically).
      // `service_fee` is the PER-PERIOD rate (e.g. $300/mo or $750/qtr),
      // not the multi-period contract total — matches how the page labels it.
      if (m > 0) {
        rawRows.push({
          id: `${proposal.proposal_id ?? "x"}::${rawRows.length}`,
          department: dept,
          service_type: cls.service_type,
          client_name: clientName,
          cadence: displayFreq === "quarterly" ? "Quarterly" : "Monthly",
          service_fee: svc.period_rate,
          one_time_fee: 0,
          is_onboarding: false,
        })
      }
    }
  }

  // ── 3. Serialize ─────────────────────────────────────────────────────
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
        .map((cad) =>
          cad === "monthly" ? "Monthly" : cad === "quarterly" ? "Quarterly" : cad,
        )
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
  const distinctClients = new Set(
    clients.map((c) => c.normalized_name || c.client_name),
  ).size

  // ── 4. Freshness metadata ────────────────────────────────────────────
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

  // ── 5. Gap diagnostic: curated clients NOT in Ignition yet ───────────
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
    const ignitionKeys = new Set(
      clients.map((c) => c.normalized_name).filter(Boolean),
    )
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
      service_lines: totalServiceLines,
      avg_mrr_per_client:
        distinctClients > 0 ? round2(totalMrr / distinctClients) : 0,
      active_proposals: proposals.length,
    },
    departments,
    serviceBreakdown,
    clients,
    rows: rawRows,
    not_in_ignition: notInIgnition,
  })
}
