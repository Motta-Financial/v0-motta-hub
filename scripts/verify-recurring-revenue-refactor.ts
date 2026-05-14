/**
 * Verify that the refactored Recurring Revenue route — which now reads
 * from `ignition_proposal_services` — produces the same totals as the
 * legacy payload-JSON path.
 *
 * Expected (per scripts/audit-recurring-revenue-import.ts on the
 * accepted lifecycle): MRR $40,872 / 1,709 service lines / 665 proposals.
 */
import { createClient } from "@supabase/supabase-js"

import {
  classifyService,
  effectiveBillingFrequency,
  normalizeClientName,
  servicePeriodRate,
  type Department,
  type IgnitionBillingFrequency,
  type ServiceRateInput,
} from "../lib/sales/ignition-recurring"

// Mirrors the strict firm policy used by the recurring-revenue route:
// only monthly + quarterly engagements roll into MRR/ARR. Weekly and
// annual services exist but partners do not count them as recurring.
function monthlyContribution(freq: IgnitionBillingFrequency, rate: number): number {
  if (rate <= 0) return 0
  if (freq === "monthly") return rate
  if (freq === "quarterly") return rate / 3
  return 0
}
function annualContribution(freq: IgnitionBillingFrequency, rate: number): number {
  if (rate <= 0) return 0
  if (freq === "monthly") return rate * 12
  if (freq === "quarterly") return rate * 4
  return 0
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

interface ProposalRow {
  proposal_id: string
  organization_id: string | null
  client_name: string | null
  organizations: { id: string; name: string | null } | null
}
interface ServiceRow {
  proposal_id: string
  service_name: string | null
  billing_frequency: string | null
  unit_price: number | string | null
  quantity: number | string | null
  total_amount: number | string | null
  raw_payload: Record<string, unknown> | null
}

async function pullAcceptedProposals(): Promise<ProposalRow[]> {
  const rows: ProposalRow[] = []
  const PAGE = 500
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("ignition_proposals")
      .select("proposal_id, organization_id, client_name, organizations(id, name)")
      .is("archived_at", null)
      .not("accepted_at", "is", null)
      .is("revoked_at", null)
      .is("lost_at", null)
      .in("status", ["accepted", "completed"])
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as unknown as ProposalRow[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

async function pullServices(proposalIds: string[]): Promise<ServiceRow[]> {
  const out: ServiceRow[] = []
  const ID_CHUNK = 300
  for (let i = 0; i < proposalIds.length; i += ID_CHUNK) {
    const ids = proposalIds.slice(i, i + ID_CHUNK)
    const PAGE = 1000
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("ignition_proposal_services")
        .select(
          "proposal_id, service_name, billing_frequency, unit_price, quantity, total_amount, raw_payload",
        )
        .in("proposal_id", ids)
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      const chunk = (data ?? []) as unknown as ServiceRow[]
      out.push(...chunk)
      if (chunk.length < PAGE) break
    }
  }
  return out
}

function oneTimeAmount(svc: ServiceRow): number {
  const total = Number(svc.total_amount) || 0
  if (total > 0) return total
  const unit = Number(svc.unit_price) || 0
  const qty = Number(svc.quantity) || 1
  return unit * qty
}

async function main() {
  const proposals = await pullAcceptedProposals()
  const services = await pullServices(proposals.map((p) => p.proposal_id))

  const byProp = new Map<string, ServiceRow[]>()
  for (const s of services) {
    const arr = byProp.get(s.proposal_id) ?? []
    arr.push(s)
    byProp.set(s.proposal_id, arr)
  }

  let mrr = 0
  let arr = 0
  let oneTime = 0
  let onboarding = 0
  let lines = 0
  const byDept: Record<string, { mrr: number; arr: number; oneTime: number; onboarding: number; lines: number; clients: Set<string> }> = {
    Accounting: { mrr: 0, arr: 0, oneTime: 0, onboarding: 0, lines: 0, clients: new Set() },
    Tax: { mrr: 0, arr: 0, oneTime: 0, onboarding: 0, lines: 0, clients: new Set() },
  }
  const allClients = new Set<string>()

  for (const p of proposals) {
    const rows = byProp.get(p.proposal_id) ?? []
    if (rows.length === 0) continue
    const fallbackName =
      p.organizations?.name?.trim() || p.client_name?.trim() || "Unknown Client"
    const norm = normalizeClientName(fallbackName)
    const clientKey = p.organization_id
      ? `org::${p.organization_id}`
      : norm
        ? `name::${norm}`
        : `proposal::${p.proposal_id}`

    for (const svc of rows) {
      const cls = classifyService(svc.service_name)
      const dept: Department = cls.department
      const freq: IgnitionBillingFrequency = effectiveBillingFrequency(
        svc.billing_frequency,
        dept,
      )
      const rate: ServiceRateInput = {
        unit_price: svc.unit_price,
        quantity: svc.quantity,
        total_amount: svc.total_amount,
        raw_payload: svc.raw_payload,
      }
      const pr = servicePeriodRate(rate)
      const m = monthlyContribution(freq, pr)
      const a = annualContribution(freq, pr)
      const ot = freq === "one-time" ? oneTimeAmount(svc) : 0
      const ob = cls.is_onboarding && freq === "one-time" ? ot : 0

      mrr += m
      arr += a
      oneTime += ot
      onboarding += ob
      lines += 1
      byDept[dept].mrr += m
      byDept[dept].arr += a
      byDept[dept].oneTime += ot
      byDept[dept].onboarding += ob
      byDept[dept].lines += 1
      byDept[dept].clients.add(clientKey)
      allClients.add(clientKey)
    }
  }

  const fmt = (n: number) =>
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  console.log("=== Recurring Revenue — Refactored Route Verification ===")
  console.log(`Accepted proposals:     ${proposals.length}`)
  console.log(`Service lines:          ${lines}`)
  console.log(`Distinct clients:       ${allClients.size}`)
  console.log(`MRR:                    ${fmt(mrr)}`)
  console.log(`ARR:                    ${fmt(arr)}`)
  console.log(`One-time total:         ${fmt(oneTime)}`)
  console.log(`Onboarding total:       ${fmt(onboarding)}`)
  console.log()
  console.log("By department:")
  for (const d of ["Accounting", "Tax"] as const) {
    const x = byDept[d]
    console.log(
      `  ${d.padEnd(11)} mrr=${fmt(x.mrr).padStart(13)}  arr=${fmt(x.arr).padStart(13)}  one-time=${fmt(x.oneTime).padStart(13)}  onboarding=${fmt(x.onboarding).padStart(11)}  lines=${String(x.lines).padStart(4)}  clients=${String(x.clients.size).padStart(3)}`,
    )
  }
  console.log()
  console.log("Expected from audit: MRR $40,872.00 / 1,709 lines / 665 proposals")
  const expectMRR = 40872
  const ok = Math.abs(mrr - expectMRR) < 1 && lines === 1709 && proposals.length === 665
  console.log(`Parity check:           ${ok ? "PASS" : "FAIL"}`)
  if (!ok) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
