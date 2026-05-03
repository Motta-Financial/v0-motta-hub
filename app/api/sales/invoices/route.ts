import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/**
 * Sales > Invoices listing endpoint.
 *
 * Returns paginated, filterable Ignition invoices with their linked
 * organization and proposal context. Stats block summarises totals across
 * the full filtered set (not just the current page) so the UI can render
 * "Total / Paid / Outstanding" without a second round-trip.
 */

export const dynamic = "force-dynamic"

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const sp = url.searchParams

    const page = Math.max(1, Number.parseInt(sp.get("page") || "1", 10))
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number.parseInt(sp.get("pageSize") || String(PAGE_SIZE_DEFAULT), 10)),
  )
  const status = sp.get("status") || ""
  const search = (sp.get("search") || "").trim()
  const dateField = (sp.get("dateField") || "invoice_date") as
    | "invoice_date"
    | "due_date"
    | "paid_at"
    | "sent_at"
    | "created_at"
  const dateFrom = sp.get("dateFrom") || ""
  const dateTo = sp.get("dateTo") || ""
  const sortBy = sp.get("sortBy") || "invoice_date"
  const sortDir = (sp.get("sortDir") || "desc") as "asc" | "desc"

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let query = supabase
    .from("ignition_invoices")
    .select(
      `ignition_invoice_id, invoice_number, status, amount, amount_paid, amount_outstanding,
       currency, invoice_date, due_date, sent_at, paid_at, voided_at, stripe_invoice_id,
       proposal_id, organization_id, contact_id, created_at, updated_at,
       organizations(id, name),
       contacts(id, full_name)`,
      { count: "exact" },
    )

  if (status) {
    const list = status.split(",").filter(Boolean)
    if (list.length > 0) query = query.in("status", list)
  }
  if (dateFrom) query = query.gte(dateField, dateFrom)
  if (dateTo) query = query.lte(dateField, dateTo)
  if (search) {
    const safe = search.replace(/[%,]/g, "")
    query = query.or(`invoice_number.ilike.%${safe}%,proposal_id.ilike.%${safe}%`)
  }

  const validSortFields = new Set([
    "invoice_date",
    "due_date",
    "paid_at",
    "sent_at",
    "created_at",
    "amount",
    "amount_paid",
    "amount_outstanding",
    "status",
    "invoice_number",
  ])
  const finalSort = validSortFields.has(sortBy) ? sortBy : "invoice_date"
  query = query.order(finalSort, { ascending: sortDir === "asc", nullsFirst: false })

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  query = query.range(from, to)

  const { data, error, count } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Aggregate stats — across ALL invoices regardless of status filter so the
  // header KPIs are consistent. Cheap because table is small (~118 rows).
  const { data: allInvoices } = await supabase
    .from("ignition_invoices")
    .select("status, amount, amount_paid, amount_outstanding")

  const stats = {
    total: allInvoices?.length || 0,
    totalAmount: sum(allInvoices, "amount"),
    totalPaid: sum(allInvoices, "amount_paid"),
    totalOutstanding: sum(allInvoices, "amount_outstanding"),
    byStatus: countBy(allInvoices, "status"),
  }

  const dimensions = {
    statuses: uniqueSorted(allInvoices?.map((d) => d.status)),
  }

    return NextResponse.json({
      invoices: data || [],
      page,
      pageSize,
      total: count || 0,
      stats,
      dimensions,
    })
  } catch (error) {
    console.error("[sales/invoices] Error:", error)
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 })
  }
}

function sum(arr: any[] | null | undefined, key: string): number {
  if (!arr) return 0
  return arr.reduce((acc, row) => acc + (Number(row?.[key]) || 0), 0)
}
function countBy(arr: any[] | null | undefined, key: string): Record<string, number> {
  const out: Record<string, number> = {}
  if (!arr) return out
  for (const row of arr) {
    const k = (row?.[key] as string) || "unknown"
    out[k] = (out[k] || 0) + 1
  }
  return out
}
function uniqueSorted(arr: (string | null | undefined)[] | undefined): string[] {
  if (!arr) return []
  const set = new Set<string>()
  for (const v of arr) {
    if (v && typeof v === "string") set.add(v)
  }
  return Array.from(set).sort()
}
