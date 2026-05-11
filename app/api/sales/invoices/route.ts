import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { normalizeState } from "@/lib/sales/us-geo"

/**
 * Sales > Invoices listing endpoint.
 *
 * Returns paginated, filterable Ignition invoices with their linked
 * organization or contact and a resolved geographic state (org → contact
 * → ignition_client fallback). Stats block summarises totals across the
 * full unfiltered set so the KPI strip stays stable as filters change.
 *
 * Volumes are tiny (~660 invoices) so we pull the full set, enrich, and
 * filter in JS — same approach as the proposals endpoint.
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
      Math.max(
        1,
        Number.parseInt(sp.get("pageSize") || String(PAGE_SIZE_DEFAULT), 10),
      ),
    )

    const search = (sp.get("search") || "").trim()
    const statusFilter = (sp.get("status") || "").split(",").filter(Boolean)
    const stateFilter = (sp.get("state") || "").split(",").filter(Boolean)
    const minAmount =
      sp.get("minAmount") !== null && sp.get("minAmount") !== ""
        ? Number(sp.get("minAmount"))
        : null
    const maxAmount =
      sp.get("maxAmount") !== null && sp.get("maxAmount") !== ""
        ? Number(sp.get("maxAmount"))
        : null

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

    // ── Pull all invoices ────────────────────────────────────────────────
    // Supabase / PostgREST hard-caps result sets at `db.max-rows` (1000 in
    // this project). With ~1,012 invoices today and growth ahead, we must
    // page with `range()` instead of a single `limit()` call to avoid
    // silently dropping the tail. We fetch in 1k chunks until we get back
    // a short page.
    const PAGE = 1000
    const invoices: any[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("ignition_invoices")
        .select(
          `ignition_invoice_id, invoice_number, status, amount, amount_paid, amount_outstanding,
           currency, invoice_date, due_date, sent_at, paid_at, voided_at, stripe_invoice_id,
           proposal_id, organization_id, contact_id, ignition_client_id, created_at, updated_at,
           organizations(id, name),
           contacts(id, full_name)`,
        )
        .range(offset, offset + PAGE - 1)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      const chunk = data ?? []
      invoices.push(...chunk)
      if (chunk.length < PAGE) break
      // Safety stop in case max-rows is even smaller than 1000 — bail out
      // after 20k rows.
      if (offset >= 20_000) break
    }

    // ── Resolve state via the org → contact → ignition_client chain ──────
    const orgIds = new Set<string>()
    const contactIds = new Set<string>()
    const igcIds = new Set<string>()
    for (const inv of invoices) {
      if (inv.organization_id) orgIds.add(inv.organization_id)
      if (inv.contact_id) contactIds.add(inv.contact_id)
      if (inv.ignition_client_id) igcIds.add(inv.ignition_client_id)
    }

    const orgInfo = new Map<string, { state: string | null; city: string | null }>()
    const contactInfo = new Map<string, { state: string | null; city: string | null }>()
    const igcInfo = new Map<string, { state: string | null; city: string | null }>()

    if (orgIds.size) {
      const { data } = await supabase
        .from("organizations")
        .select("id, state, city")
        .in("id", Array.from(orgIds))
      for (const o of data ?? []) {
        orgInfo.set(o.id, { state: normalizeState(o.state), city: o.city ?? null })
      }
    }
    if (contactIds.size) {
      const { data } = await supabase
        .from("contacts")
        .select("id, state, city, mailing_state, mailing_city")
        .in("id", Array.from(contactIds))
      for (const ct of data ?? []) {
        contactInfo.set(ct.id, {
          state: normalizeState(ct.state) ?? normalizeState(ct.mailing_state),
          city: ct.city ?? ct.mailing_city ?? null,
        })
      }
    }
    if (igcIds.size) {
      const { data } = await supabase
        .from("ignition_clients")
        .select("ignition_client_id, state, city")
        .in("ignition_client_id", Array.from(igcIds))
      for (const ig of data ?? []) {
        igcInfo.set(ig.ignition_client_id, {
          state: normalizeState(ig.state),
          city: ig.city ?? null,
        })
      }
    }

    // ── Enrich every invoice ─────────────────────────────────────────────
    type EnrichedInvoice = {
      ignition_invoice_id: string
      invoice_number: string | null
      status: string | null
      amount: number | null
      amount_paid: number | null
      amount_outstanding: number | null
      currency: string | null
      invoice_date: string | null
      due_date: string | null
      sent_at: string | null
      paid_at: string | null
      voided_at: string | null
      stripe_invoice_id: string | null
      proposal_id: string | null
      organization_id: string | null
      contact_id: string | null
      organizations: { id: string; name: string } | null
      contacts: { id: string; full_name: string } | null
      state: string | null
      city: string | null
    }

    const enriched: EnrichedInvoice[] = invoices.map((inv: any) => {
      const orgState = inv.organization_id ? orgInfo.get(inv.organization_id) : null
      const ctState = inv.contact_id ? contactInfo.get(inv.contact_id) : null
      const igcState = inv.ignition_client_id
        ? igcInfo.get(inv.ignition_client_id)
        : null
      const state =
        orgState?.state ?? ctState?.state ?? igcState?.state ?? null
      const city = orgState?.city ?? ctState?.city ?? igcState?.city ?? null
      return { ...inv, state, city }
    })

    // ── Stats from the unfiltered set (so KPI strip stays stable) ────────
    // We intentionally do NOT scope stats to the current filter set. The
    // strip is meant to be a "business-wide" pulse — collections health
    // and AR position — that shouldn't move every time someone toggles
    // a state filter.
    const totalAmount = sum(enriched, "amount")
    const totalPaid = sum(enriched, "amount_paid")
    const totalOutstanding = sum(enriched, "amount_outstanding")
    const byStatus = countBy(enriched, "status")

    // ── Overdue analysis ────────────────────────────────────────────────
    // The DB has a `status='overdue'` value, but the *real* overdue set
    // is "invoices with outstanding balance whose due_date is in the
    // past" — that's broader because it includes `issued` / `outstanding`
    // rows that have aged past their due dates without the status being
    // refreshed. The Ignition Reporting API only re-syncs status on
    // certain events, so we always recompute aging from the dates.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const day = 24 * 60 * 60 * 1000

    const aging = {
      current: { count: 0, amount: 0 },
      d1to30: { count: 0, amount: 0 },
      d31to60: { count: 0, amount: 0 },
      d61to90: { count: 0, amount: 0 },
      d90plus: { count: 0, amount: 0 },
    }
    let overdueCount = 0
    let overdueAmount = 0
    for (const inv of enriched) {
      const out = Number(inv.amount_outstanding) || 0
      if (out <= 0) continue
      if (!inv.due_date) {
        // No due date — bucket as current so we don't double-count it
        // into a fake aging bucket.
        aging.current.count++
        aging.current.amount += out
        continue
      }
      const due = new Date(inv.due_date)
      due.setHours(0, 0, 0, 0)
      const daysPast = Math.floor((today.getTime() - due.getTime()) / day)
      if (daysPast <= 0) {
        aging.current.count++
        aging.current.amount += out
      } else {
        overdueCount++
        overdueAmount += out
        if (daysPast <= 30) {
          aging.d1to30.count++
          aging.d1to30.amount += out
        } else if (daysPast <= 60) {
          aging.d31to60.count++
          aging.d31to60.amount += out
        } else if (daysPast <= 90) {
          aging.d61to90.count++
          aging.d61to90.amount += out
        } else {
          aging.d90plus.count++
          aging.d90plus.amount += out
        }
      }
    }

    // ── Collection-rate + payment-timing ─────────────────────────────────
    // collectionRate is paid / billed across the full history. It's a
    // gentler signal than "% of invoices marked paid" because partial
    // payments (rare here, but possible) still count.
    const collectionRate = totalAmount > 0 ? totalPaid / totalAmount : 0

    // Median days-to-pay among invoices we *know* were paid. Using the
    // median rather than mean because Motta has a long tail of legacy
    // ACH/Bill.com invoices that take 30-60 days to clear and would
    // skew a mean.
    const daysToPay: number[] = []
    for (const inv of enriched) {
      if (!inv.paid_at || !inv.invoice_date) continue
      const paid = new Date(inv.paid_at).getTime()
      const billed = new Date(inv.invoice_date).getTime()
      if (Number.isNaN(paid) || Number.isNaN(billed)) continue
      const d = (paid - billed) / day
      if (d < 0) continue
      daysToPay.push(d)
    }
    daysToPay.sort((a, b) => a - b)
    const medianDaysToPay =
      daysToPay.length === 0
        ? null
        : daysToPay[Math.floor(daysToPay.length / 2)]

    // ── Monthly trend (last 12 months on invoice_date) ──────────────────
    // We synthesize the bucket keys deterministically so months with
    // zero invoices still appear on the chart (otherwise the chart
    // collapses to whatever months happened to have activity).
    const trendMonths: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      trendMonths.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      )
    }
    const trendMap = new Map(
      trendMonths.map((m) => [
        m,
        { month: m, billed: 0, paid: 0, outstanding: 0, count: 0 },
      ]),
    )
    for (const inv of enriched) {
      if (!inv.invoice_date) continue
      const m = inv.invoice_date.slice(0, 7)
      const bucket = trendMap.get(m)
      if (!bucket) continue // outside the 12-month window
      bucket.billed += Number(inv.amount) || 0
      bucket.paid += Number(inv.amount_paid) || 0
      bucket.outstanding += Number(inv.amount_outstanding) || 0
      bucket.count++
    }
    const trend = Array.from(trendMap.values()).map((b) => ({
      ...b,
      billed: round2(b.billed),
      paid: round2(b.paid),
      outstanding: round2(b.outstanding),
    }))

    // ── Top 10 clients by outstanding balance ───────────────────────────
    // The most actionable view on this page: "who owes us money right
    // now". We dedupe by org > contact > "(Unknown)" so an org with
    // multiple contact-attached invoices still rolls up to one row.
    type TopRow = {
      key: string
      name: string
      id: string | null
      kind: "organization" | "contact" | null
      count: number
      billed: number
      outstanding: number
    }
    const topMap = new Map<string, TopRow>()
    for (const inv of enriched) {
      const out = Number(inv.amount_outstanding) || 0
      if (out <= 0) continue
      const orgName = inv.organizations?.name
      const ctName = inv.contacts?.full_name
      const name = orgName || ctName || "(Unknown client)"
      const id = inv.organization_id || inv.contact_id || null
      const kind: "organization" | "contact" | null = inv.organization_id
        ? "organization"
        : inv.contact_id
        ? "contact"
        : null
      const key = id || `name:${name}`
      const cur = topMap.get(key) ?? {
        key,
        name,
        id,
        kind,
        count: 0,
        billed: 0,
        outstanding: 0,
      }
      cur.count++
      cur.billed += Number(inv.amount) || 0
      cur.outstanding += out
      topMap.set(key, cur)
    }
    const topOutstanding = Array.from(topMap.values())
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10)
      .map((r) => ({
        ...r,
        billed: round2(r.billed),
        outstanding: round2(r.outstanding),
      }))

    const stats = {
      total: enriched.length,
      totalAmount: round2(totalAmount),
      totalPaid: round2(totalPaid),
      totalOutstanding: round2(totalOutstanding),
      byStatus,
      // Computed-overdue (date-based) — see comment block above. This is
      // the metric KPIs and the bucket chip use, not the raw status
      // count.
      overdueCount,
      overdueAmount: round2(overdueAmount),
      collectionRate,
      medianDaysToPay,
      // Aging buckets keyed by the standard 0/30/60/90 cutoffs.
      aging,
    }

    // ── Filter dimensions (full domain, ignoring current filters) ────────
    const dimensions = {
      statuses: uniqueSorted(enriched.map((d) => d.status)),
      states: uniqueSorted(enriched.map((d) => d.state)),
    }

    // ── Apply filters ────────────────────────────────────────────────────
    const lcSearch = search.toLowerCase()
    let filtered = enriched.filter((inv) => {
      if (statusFilter.length && (!inv.status || !statusFilter.includes(inv.status)))
        return false
      if (stateFilter.length) {
        const st = inv.state ?? "(unknown)"
        if (!stateFilter.includes(st)) return false
      }
      if (
        minAmount !== null &&
        !Number.isNaN(minAmount) &&
        (Number(inv.amount) || 0) < minAmount
      )
        return false
      if (
        maxAmount !== null &&
        !Number.isNaN(maxAmount) &&
        (Number(inv.amount) || 0) > maxAmount
      )
        return false
      if (dateFrom || dateTo) {
        const dv = (inv as any)[dateField] as string | null
        if (!dv) return false
        if (dateFrom && dv < dateFrom) return false
        if (dateTo && dv > dateTo + "T23:59:59") return false
      }
      if (lcSearch) {
        const hay =
          (inv.invoice_number || "").toLowerCase() +
          " " +
          (inv.proposal_id || "").toLowerCase() +
          " " +
          (inv.organizations?.name || "").toLowerCase() +
          " " +
          (inv.contacts?.full_name || "").toLowerCase()
        if (!hay.includes(lcSearch)) return false
      }
      return true
    })

    // ── Sort ─────────────────────────────────────────────────────────────
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
    filtered = [...filtered].sort((a: any, b: any) => {
      const av = a[finalSort]
      const bv = b[finalSort]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === "string") {
        return sortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av))
      }
      return sortDir === "asc" ? av - bv : bv - av
    })

    const totalFiltered = filtered.length
    const from = (page - 1) * pageSize
    const paged = filtered.slice(from, from + pageSize)

    return NextResponse.json({
      invoices: paged,
      page,
      pageSize,
      total: totalFiltered,
      totalUnfiltered: enriched.length,
      stats,
      dimensions,
      // Analytics blocks for the charts strip. These are intentionally
      // computed off the *unfiltered* set so the charts give a stable
      // business overview even when filters narrow the table.
      trend,
      topOutstanding,
    })
  } catch (error) {
    console.error("[sales/invoices] Error:", error)
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 })
  }
}

// Round to 2dp the cheap way. We do this on every aggregated number so
// the JSON payload doesn't ship floating-point cruft like 12345.679999996
// (an actual issue caused by repeated += on numeric columns).
function round2(n: number): number {
  return Math.round(n * 100) / 100
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
