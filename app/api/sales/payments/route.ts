import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { normalizeState } from "@/lib/sales/us-geo"

/**
 * Sales > Payments listing endpoint.
 *
 * Returns paginated, filterable rows from `ignition_payments` enriched
 * with the linked invoice's client/organization (payments themselves
 * don't carry FKs to org/contact — they connect via ignition_invoice_id).
 *
 * The stats block summarises GROSS / FEES / NET / REFUNDED across the
 * full unfiltered set so the KPI strip remains stable when filters are
 * narrowed. Same JS-side enrichment + filter approach as the proposals
 * and invoices endpoints, justified by the small (~1.5k row) volume.
 */

export const dynamic = "force-dynamic"

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

// PostgREST's hard cap is 1000 rows per request. We page in 1k chunks
// until we get a short page back so we don't silently drop the tail.
const FETCH_PAGE = 1000

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

    const search = (sp.get("search") || "").trim().toLowerCase()
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

    // The Ignition Reporting API only exposes `paid_at` for payments, so
    // there isn't a separate "billing date" or "created date" field to
    // pivot on the way invoices do. We expose `paid_at` only — keep the
    // shape extensible with a single switch in case future endpoints
    // bring back created/updated cursors.
    const dateField = (sp.get("dateField") || "paid_at") as "paid_at"
    const dateFrom = sp.get("dateFrom") || ""
    const dateTo = sp.get("dateTo") || ""

    const sortBy = sp.get("sortBy") || "paid_at"
    const sortDir = (sp.get("sortDir") || "desc") as "asc" | "desc"

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // ── 1) Pull every payment ────────────────────────────────────────────
    const payments: any[] = []
    for (let offset = 0; ; offset += FETCH_PAGE) {
      const { data, error } = await supabase
        .from("ignition_payments")
        .select(
          `ignition_payment_id, payment_status, amount, fees, net_amount, currency,
           payment_method, paid_at, refunded_at, refund_amount, stripe_charge_id,
           stripe_payment_intent_id, ignition_invoice_id, proposal_id,
           ignition_client_id, organization_id, contact_id, created_at, updated_at`,
        )
        .range(offset, offset + FETCH_PAGE - 1)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      const chunk = data ?? []
      payments.push(...chunk)
      if (chunk.length < FETCH_PAGE) break
      if (offset >= 50_000) break // hard safety stop
    }

    // ── 2) Resolve client info ───────────────────────────────────────────
    // Reality of the Reporting API data shape (verified against live db):
    //   1,493 / 1,531 payments carry `ignition_client_id` DIRECTLY
    //   38     / 1,531 payments carry `ignition_invoice_id` only
    //   0      / 1,531 payments carry `organization_id` or `contact_id`
    //
    // So the primary path is: payment → ignition_client_id → ignition_clients
    // (which holds the mapped organization_id / contact_id from the
    // Client-Mapping admin tab) → organizations / contacts. The invoice
    // hop only matters for the ~2.5% tail with no direct igc_id.

    const invoiceIds = Array.from(
      new Set(
        payments
          .map((p) => p.ignition_invoice_id)
          .filter((v): v is string => !!v),
      ),
    )

    const invoiceInfo = new Map<
      string,
      {
        invoice_number: string | null
        organization_id: string | null
        contact_id: string | null
        ignition_client_id: string | null
      }
    >()
    if (invoiceIds.length) {
      for (let offset = 0; offset < invoiceIds.length; offset += 200) {
        const chunk = invoiceIds.slice(offset, offset + 200)
        const { data } = await supabase
          .from("ignition_invoices")
          .select(
            "ignition_invoice_id, invoice_number, organization_id, contact_id, ignition_client_id",
          )
          .in("ignition_invoice_id", chunk)
        for (const inv of data ?? []) {
          invoiceInfo.set(inv.ignition_invoice_id, {
            invoice_number: inv.invoice_number ?? null,
            organization_id: inv.organization_id ?? null,
            contact_id: inv.contact_id ?? null,
            ignition_client_id: inv.ignition_client_id ?? null,
          })
        }
      }
    }

    // Gather every ignition_client_id we'll need to look up.
    const igcIds = new Set<string>()
    for (const p of payments) {
      const inv = p.ignition_invoice_id ? invoiceInfo.get(p.ignition_invoice_id) : null
      const igcId = p.ignition_client_id || inv?.ignition_client_id
      if (igcId) igcIds.add(igcId)
    }

    // Pull the matched org_id / contact_id from ignition_clients along
    // with the raw Ignition name + state/city (used as a last-resort
    // fallback when the org/contact records don't have geo on file).
    const igcInfo = new Map<
      string,
      {
        name: string | null
        business_name: string | null
        state: string | null
        city: string | null
        organization_id: string | null
        contact_id: string | null
      }
    >()
    if (igcIds.size) {
      const igcArr = Array.from(igcIds)
      for (let offset = 0; offset < igcArr.length; offset += 200) {
        const chunk = igcArr.slice(offset, offset + 200)
        const { data } = await supabase
          .from("ignition_clients")
          .select(
            "ignition_client_id, name, business_name, state, city, organization_id, contact_id",
          )
          .in("ignition_client_id", chunk)
        for (const igc of data ?? []) {
          igcInfo.set(igc.ignition_client_id, {
            name: igc.name ?? null,
            business_name: igc.business_name ?? null,
            state: normalizeState(igc.state),
            city: igc.city ?? null,
            organization_id: igc.organization_id ?? null,
            contact_id: igc.contact_id ?? null,
          })
        }
      }
    }

    // Now collect org/contact ids by following BOTH the direct fields on
    // the payment row AND the mapped ids from ignition_clients (which
    // is what actually populates 866 orgs + 948 contacts in practice).
    const orgIds = new Set<string>()
    const contactIds = new Set<string>()
    for (const p of payments) {
      const inv = p.ignition_invoice_id ? invoiceInfo.get(p.ignition_invoice_id) : null
      const igcId = p.ignition_client_id || inv?.ignition_client_id
      const igc = igcId ? igcInfo.get(igcId) : null
      const orgId = p.organization_id || inv?.organization_id || igc?.organization_id
      const contactId = p.contact_id || inv?.contact_id || igc?.contact_id
      if (orgId) orgIds.add(orgId)
      if (contactId) contactIds.add(contactId)
    }

    const orgInfo = new Map<
      string,
      { name: string; state: string | null; city: string | null }
    >()
    const contactInfo = new Map<
      string,
      { full_name: string; state: string | null; city: string | null }
    >()

    if (orgIds.size) {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, state, city")
        .in("id", Array.from(orgIds))
      for (const o of data ?? []) {
        orgInfo.set(o.id, {
          name: o.name,
          state: normalizeState(o.state),
          city: o.city ?? null,
        })
      }
    }
    if (contactIds.size) {
      const { data } = await supabase
        .from("contacts")
        .select("id, full_name, state, city")
        .in("id", Array.from(contactIds))
      for (const c of data ?? []) {
        contactInfo.set(c.id, {
          full_name: c.full_name,
          state: normalizeState(c.state),
          city: c.city ?? null,
        })
      }
    }

    // ── 3) Enrich every payment row ──────────────────────────────────────
    // Resolution priority (matching what user-facing pages expect):
    //   org name  > contact name  > ignition client (business or raw name)
    //   org state > contact state > ignition client state
    // The org/contact ids may come from THREE different paths — direct
    // on the payment, via the invoice, or via the ignition_clients mapping.
    const enriched = payments.map((p) => {
      const inv = p.ignition_invoice_id ? invoiceInfo.get(p.ignition_invoice_id) : null
      const igcId = p.ignition_client_id || inv?.ignition_client_id || null
      const igc = igcId ? igcInfo.get(igcId) : null

      const orgId = p.organization_id || inv?.organization_id || igc?.organization_id || null
      const contactId = p.contact_id || inv?.contact_id || igc?.contact_id || null

      const org = orgId ? orgInfo.get(orgId) : null
      const contact = contactId ? contactInfo.get(contactId) : null

      const client_name =
        org?.name || contact?.full_name || igc?.business_name || igc?.name || null
      const state = org?.state || contact?.state || igc?.state || null
      const city = org?.city || contact?.city || igc?.city || null

      return {
        ignition_payment_id: p.ignition_payment_id as string,
        payment_status: p.payment_status as string | null,
        amount: p.amount != null ? Number(p.amount) : null,
        fees: p.fees != null ? Number(p.fees) : null,
        net_amount: p.net_amount != null ? Number(p.net_amount) : null,
        currency: p.currency || "USD",
        payment_method: p.payment_method as string | null,
        paid_at: p.paid_at as string | null,
        refunded_at: p.refunded_at as string | null,
        refund_amount: p.refund_amount != null ? Number(p.refund_amount) : null,
        stripe_charge_id: p.stripe_charge_id as string | null,
        stripe_payment_intent_id: p.stripe_payment_intent_id as string | null,
        ignition_invoice_id: p.ignition_invoice_id as string | null,
        invoice_number: inv?.invoice_number ?? null,
        proposal_id: p.proposal_id as string | null,
        organization_id: orgId,
        contact_id: contactId,
        organization: org ? { id: orgId!, name: org.name } : null,
        contact: contact ? { id: contactId!, full_name: contact.full_name } : null,
        client_name,
        state,
        city,
      }
    })

    // ── 4) Stats across the unfiltered set ───────────────────────────────
    // KPIs need to stay stable when the user narrows filters, so we
    // compute them BEFORE the filter step. byStatus is also helpful for
    // building the filter-chip option list with counts later.
    const stats = {
      total: enriched.length,
      totalAmount: 0,
      totalFees: 0,
      totalNet: 0,
      totalRefunded: 0,
      byStatus: {} as Record<string, number>,
    }
    for (const p of enriched) {
      stats.totalAmount += p.amount ?? 0
      stats.totalFees += p.fees ?? 0
      stats.totalNet += p.net_amount ?? 0
      stats.totalRefunded += p.refund_amount ?? 0
      const key = p.payment_status || "(none)"
      stats.byStatus[key] = (stats.byStatus[key] || 0) + 1
    }

    // ── 5) Apply filters ─────────────────────────────────────────────────
    const filtered = enriched.filter((p) => {
      if (statusFilter.length && !statusFilter.includes(p.payment_status || "(none)")) {
        return false
      }
      if (stateFilter.length) {
        const s = p.state || "(unknown)"
        if (!stateFilter.includes(s)) return false
      }
      if (minAmount != null && (p.amount ?? 0) < minAmount) return false
      if (maxAmount != null && (p.amount ?? 0) > maxAmount) return false
      if (dateFrom || dateTo) {
        // Field is hard-coded to paid_at for now (see comment above) —
        // payments with no paid_at fall out of any date filter window.
        const raw = p[dateField]
        if (!raw) return false
        const d = new Date(raw).getTime()
        if (dateFrom && d < new Date(dateFrom).getTime()) return false
        // Use end-of-day for the upper bound so 'today' is inclusive.
        if (dateTo) {
          const upper = new Date(dateTo)
          upper.setHours(23, 59, 59, 999)
          if (d > upper.getTime()) return false
        }
      }
      if (search) {
        const haystack = [
          p.ignition_payment_id,
          p.invoice_number,
          p.proposal_id,
          p.stripe_charge_id,
          p.stripe_payment_intent_id,
          p.client_name,
          p.organization?.name,
          p.contact?.full_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    // ── 6) Sort ──────────────────────────────────────────────────────────
    const sorted = filtered.slice().sort((a, b) => {
      const ax = (a as any)[sortBy]
      const bx = (b as any)[sortBy]
      // Nulls always sink to the bottom, regardless of direction. Same
      // convention as the proposals/invoices endpoints — keeps the UX
      // predictable when users sort by an optional field like fees.
      if (ax == null && bx == null) return 0
      if (ax == null) return 1
      if (bx == null) return -1
      let cmp: number
      if (typeof ax === "number" && typeof bx === "number") {
        cmp = ax - bx
      } else {
        cmp = String(ax).localeCompare(String(bx))
      }
      return sortDir === "asc" ? cmp : -cmp
    })

    // ── 7) Paginate ──────────────────────────────────────────────────────
    const total = sorted.length
    const totalUnfiltered = enriched.length
    const start = (page - 1) * pageSize
    const pageRows = sorted.slice(start, start + pageSize)

    // ── 8) Dimensions ────────────────────────────────────────────────────
    const statusSet = new Set<string>()
    const stateSet = new Set<string>()
    for (const p of enriched) {
      statusSet.add(p.payment_status || "(none)")
      stateSet.add(p.state || "(unknown)")
    }

    return NextResponse.json({
      payments: pageRows,
      page,
      pageSize,
      total,
      totalUnfiltered,
      stats,
      dimensions: {
        statuses: Array.from(statusSet).sort(),
        states: Array.from(stateSet).sort(),
      },
    })
  } catch (err: any) {
    console.error("[sales/payments] error:", err)
    return NextResponse.json(
      { error: err?.message || "unexpected_error" },
      { status: 500 },
    )
  }
}
