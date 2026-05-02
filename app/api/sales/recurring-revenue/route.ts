import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/**
 * Sales > Recurring Revenue
 * ────────────────────────────────────────────────────────────────────────
 * Returns the curated MRR/ARR roll-ups for Accounting and Tax, sourced
 * from `motta_recurring_revenue` (seeded from the two CSVs the partners
 * keep authoritative). The Ignition feed is intentionally NOT used here —
 * Ignition flags many one-time engagements as "recurring" because the
 * platform allows monthly billing schedules on fixed-fee work; this
 * endpoint is the corrected view.
 *
 * Quarterly fees contribute fee/3 to MRR and fee*4 to ARR.
 */

export const dynamic = "force-dynamic"

type Row = {
  id: string
  department: "Accounting" | "Tax"
  service_type: string
  client_name: string
  normalized_name: string
  cadence: "Monthly" | "Quarterly"
  service_fee: number
  one_time_fee: number
  source: string
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await supabase
    .from("motta_recurring_revenue")
    .select(
      "id, department, service_type, client_name, normalized_name, cadence, service_fee, one_time_fee, source",
    )
    .order("department", { ascending: true })
    .order("service_type", { ascending: true })
    .order("client_name", { ascending: true })

  if (error) {
    console.error("[sales/recurring-revenue] query failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data || []).map((r) => ({
    ...r,
    service_fee: Number(r.service_fee) || 0,
    one_time_fee: Number(r.one_time_fee) || 0,
  })) as Row[]

  const monthlyContribution = (r: Row) =>
    r.cadence === "Monthly" ? r.service_fee : r.service_fee / 3
  const annualContribution = (r: Row) =>
    r.cadence === "Monthly" ? r.service_fee * 12 : r.service_fee * 4

  // Roll-ups by department
  const byDepartment = new Map<
    string,
    {
      department: string
      mrr: number
      arr: number
      one_time_total: number
      service_lines: number
      clients: Set<string>
    }
  >()
  // Roll-ups by department × service_type
  const byService = new Map<
    string,
    {
      department: string
      service_type: string
      mrr: number
      arr: number
      one_time_total: number
      service_lines: number
      clients: Set<string>
    }
  >()
  // Roll-ups per client (primary table on the page)
  const byClient = new Map<
    string,
    {
      department: string
      client_name: string
      normalized_name: string
      service_types: Set<string>
      cadences: Set<string>
      mrr: number
      arr: number
      one_time_total: number
      service_lines: number
    }
  >()

  for (const r of rows) {
    const m = monthlyContribution(r)
    const a = annualContribution(r)

    // department
    const d =
      byDepartment.get(r.department) ?? {
        department: r.department,
        mrr: 0,
        arr: 0,
        one_time_total: 0,
        service_lines: 0,
        clients: new Set<string>(),
      }
    d.mrr += m
    d.arr += a
    d.one_time_total += r.one_time_fee
    d.service_lines += 1
    d.clients.add(r.normalized_name)
    byDepartment.set(r.department, d)

    // service type
    const sKey = `${r.department}::${r.service_type}`
    const s =
      byService.get(sKey) ?? {
        department: r.department,
        service_type: r.service_type,
        mrr: 0,
        arr: 0,
        one_time_total: 0,
        service_lines: 0,
        clients: new Set<string>(),
      }
    s.mrr += m
    s.arr += a
    s.one_time_total += r.one_time_fee
    s.service_lines += 1
    s.clients.add(r.normalized_name)
    byService.set(sKey, s)

    // client (within department)
    const cKey = `${r.department}::${r.normalized_name}`
    const c =
      byClient.get(cKey) ?? {
        department: r.department,
        client_name: r.client_name,
        normalized_name: r.normalized_name,
        service_types: new Set<string>(),
        cadences: new Set<string>(),
        mrr: 0,
        arr: 0,
        one_time_total: 0,
        service_lines: 0,
      }
    c.service_types.add(r.service_type)
    c.cadences.add(r.cadence)
    c.mrr += m
    c.arr += a
    c.one_time_total += r.one_time_fee
    c.service_lines += 1
    byClient.set(cKey, c)
  }

  // Round to cents and serialize the Sets
  const round2 = (n: number) => Math.round(n * 100) / 100

  const departments = Array.from(byDepartment.values())
    .map((d) => ({
      department: d.department,
      mrr: round2(d.mrr),
      arr: round2(d.arr),
      one_time_total: round2(d.one_time_total),
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
      service_lines: s.service_lines,
      client_count: s.clients.size,
    }))
    .sort((a, b) => b.mrr - a.mrr)

  const clients = Array.from(byClient.values())
    .map((c) => ({
      department: c.department,
      client_name: c.client_name,
      normalized_name: c.normalized_name,
      service_types: Array.from(c.service_types).sort(),
      cadences: Array.from(c.cadences).sort(),
      mrr: round2(c.mrr),
      arr: round2(c.arr),
      one_time_total: round2(c.one_time_total),
      service_lines: c.service_lines,
    }))
    .sort((a, b) => b.mrr - a.mrr)

  const totalMrr = departments.reduce((s, d) => s + d.mrr, 0)
  const totalArr = departments.reduce((s, d) => s + d.arr, 0)
  const totalOneTime = departments.reduce((s, d) => s + d.one_time_total, 0)
  const distinctClients = new Set(clients.map((c) => c.normalized_name)).size

  return NextResponse.json({
    totals: {
      mrr: round2(totalMrr),
      arr: round2(totalArr),
      one_time_total: round2(totalOneTime),
      distinct_clients: distinctClients,
      service_lines: rows.length,
      avg_mrr_per_client:
        distinctClients > 0 ? round2(totalMrr / distinctClients) : 0,
    },
    departments,
    serviceBreakdown,
    clients,
    rows, // raw service-line rows (used for the per-client expand view)
  })
}
