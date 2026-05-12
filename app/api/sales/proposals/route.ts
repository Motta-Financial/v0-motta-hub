import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  loadRecurringScrubSet,
  normalizeClientName,
} from "@/lib/sales/recurring-scrub"
import { classifyService, type ServiceLine } from "@/lib/sales/service-line-classifier"
import {
  canonicalIdFor,
  getCanonicalService,
  CANONICAL_SERVICES,
} from "@/lib/sales/service-catalog"
import { normalizeState } from "@/lib/sales/us-geo"

/**
 * Sales > Proposals listing endpoint.
 *
 * Returns paginated, filterable Ignition proposals with their linked
 * organization name, resolved geographic state (org → contact →
 * ignition_client fallback chain, mirroring the Sales Dashboard), and a
 * `service_lines` summary so the UI can render Tax/Accounting/Advisory/
 * Other badges and filter on them.
 *
 * The set of available filter values (`dimensions`) is computed from the
 * fully enriched, *un*filtered proposal set so that users can always pick
 * any value even after applying other filters that would otherwise hide
 * it (the canonical "facet menu" behaviour).
 *
 * Volumes are modest (~900 proposals, ~440 service lines) so we pull the
 * whole set, enrich in JS, then slice for the requested page. If we ever
 * scale 10x this can move to a dedicated `/dimensions` endpoint, but
 * today the simplicity is worth more than the bandwidth saved.
 */

export const dynamic = "force-dynamic"

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

const SERVICE_LINES: ServiceLine[] = ["Tax", "Accounting", "Advisory", "Other"]

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const sp = url.searchParams

    // ── Parse filters ───────────────────────────────────────────────────
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
    const partnerFilter = (sp.get("partner") || "").split(",").filter(Boolean)
    const managerFilter = (sp.get("manager") || "").split(",").filter(Boolean)
    const sentByFilter = (sp.get("sentBy") || "").split(",").filter(Boolean)
    const stateFilter = (sp.get("state") || "").split(",").filter(Boolean)
    const serviceLineFilter = (sp.get("serviceLine") || "")
      .split(",")
      .filter(Boolean)
    // Canonical-service filter: any of the supplied canonical ids must
    // appear in this proposal's `canonical_services` set. Uses canonical
    // ids (e.g. "tax-prep-1040") not display labels — the UI looks up
    // the label from the dimensions array we return below.
    const canonicalServiceFilter = (sp.get("canonicalService") || "")
      .split(",")
      .filter(Boolean)

    const minValue =
      sp.get("minValue") !== null && sp.get("minValue") !== ""
        ? Number(sp.get("minValue"))
        : null
    const maxValue =
      sp.get("maxValue") !== null && sp.get("maxValue") !== ""
        ? Number(sp.get("maxValue"))
        : null

    const dateField = (sp.get("dateField") || "created_at") as
      | "created_at"
      | "accepted_at"
      | "sent_at"
      | "completed_at"
    const dateFrom = sp.get("dateFrom") || ""
    const dateTo = sp.get("dateTo") || ""

    const sortBy = sp.get("sortBy") || "created_at"
    const sortDir = (sp.get("sortDir") || "desc") as "asc" | "desc"

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // ── Pull all proposals with their service lines ─────────────────────
    // We deliberately don't use the `count: 'exact'` strategy from the
    // previous implementation — once we have the fully enriched set in
    // memory, total count comes from `filteredCount` after JS-side
    // filtering, which is the only count that matches what the user sees.
    //
    // Supabase / PostgREST hard-caps result sets at db.max-rows (1000 on
    // this project). We're at ~880 non-archived proposals today; once
    // growth crosses the cap, a single `.limit(2000)` would silently
    // truncate. Paginate with `.range()` to be safe.
    const PAGE = 1000
    const proposals: any[] = []
    for (let offset = 0; ; offset += PAGE) {
      // Field selection notes:
      // - `signed_url` is populated for ~679/912 proposals (the rendered
      //   PDF Ignition serves) and previously wasn't surfaced anywhere.
      // - We pull `total_amount` + `billing_frequency` on the embedded
      //   services so the table can show a "Services" cell with both
      //   the count and the summed line-item value (442/457 service
      //   rows have these populated; service_name is universal).
      const { data, error } = await supabase
        .from("ignition_proposals")
        .select(
          `proposal_id, proposal_number, title, status, total_value, one_time_total,
           recurring_total, recurring_frequency, currency, client_name, client_email,
           client_partner, client_manager, proposal_sent_by, billing_starts_on,
           sent_at, accepted_at, completed_at, lost_at, lost_reason, created_at, updated_at,
           organization_id, contact_id, ignition_client_id, signed_url,
           organizations(id, name),
           services:ignition_proposal_services(service_name, total_amount, billing_frequency)`,
        )
        .is("archived_at", null)
        .range(offset, offset + PAGE - 1)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      const chunk = data ?? []
      proposals.push(...chunk)
      if (chunk.length < PAGE) break
      if (offset >= 20_000) break
    }

    // ── Resolve state via the org → contact → ignition_client chain ─────
    // Identical resolution to /api/sales/dashboard so both pages agree on
    // a proposal's "state".
    const orgIds = new Set<string>()
    const contactIds = new Set<string>()
    const igcIds = new Set<string>()
    for (const p of proposals) {
      if (p.organization_id) orgIds.add(p.organization_id)
      if (p.contact_id) contactIds.add(p.contact_id)
      if (p.ignition_client_id) igcIds.add(p.ignition_client_id)
    }

    const orgInfo = new Map<string, { state: string | null; city: string | null }>()
    const contactInfo = new Map<string, { state: string | null; city: string | null }>()
    const igcInfo = new Map<string, { state: string | null; city: string | null }>()

    if (orgIds.size) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, state, city")
        .in("id", Array.from(orgIds))
      for (const o of orgs ?? []) {
        orgInfo.set(o.id, {
          state: normalizeState(o.state),
          city: o.city ?? null,
        })
      }
    }
    if (contactIds.size) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, state, city, mailing_state, mailing_city")
        .in("id", Array.from(contactIds))
      for (const ct of contacts ?? []) {
        contactInfo.set(ct.id, {
          state: normalizeState(ct.state) ?? normalizeState(ct.mailing_state),
          city: ct.city ?? ct.mailing_city ?? null,
        })
      }
    }
    if (igcIds.size) {
      const { data: igcs } = await supabase
        .from("ignition_clients")
        .select("ignition_client_id, state, city")
        .in("ignition_client_id", Array.from(igcIds))
      for (const ig of igcs ?? []) {
        igcInfo.set(ig.ignition_client_id, {
          state: normalizeState(ig.state),
          city: ig.city ?? null,
        })
      }
    }

    // ── Apply curated recurring-revenue scrub ───────────────────────────
    // Keep recurring_total only when the linked client is actually on the
    // partner-curated CSV; otherwise fold it into one-time. Same logic as
    // the dashboard.
    const curatedRecurring = await loadRecurringScrubSet()

    // ── Enrich every proposal in JS ─────────────────────────────────────
    type EnrichedProposal = {
      proposal_id: string
      proposal_number: string | null
      title: string | null
      status: string | null
      total_value: number
      one_time_total: number
      recurring_total: number
      recurring_frequency: string | null
      currency: string | null
      client_name: string | null
      client_email: string | null
      client_partner: string | null
      client_manager: string | null
      proposal_sent_by: string | null
      billing_starts_on: string | null
      sent_at: string | null
      accepted_at: string | null
      completed_at: string | null
      lost_at: string | null
      lost_reason: string | null
      created_at: string | null
      updated_at: string | null
      organization_id: string | null
      organizations: { id: string; name: string } | null
      state: string | null
      city: string | null
      service_lines: ServiceLine[]
      /** Canonical service ids (e.g. "tax-prep-1040") matched by this
       *  proposal's line items. Lets users filter by what a proposal
       *  actually contained, regardless of how the line was named on the
       *  Ignition side. */
      canonical_services: string[]
      is_curated_recurring: boolean
      /** Direct link to the rendered Ignition proposal PDF. */
      signed_url: string | null
      /** Count of line items on this proposal. */
      service_count: number
      /** Whether ANY line item has billing_frequency != 'one-time'. */
      has_recurring_line: boolean
    }

    const enriched: EnrichedProposal[] = proposals.map((p: any) => {
      const orgState = p.organization_id ? orgInfo.get(p.organization_id) : null
      const ctState = p.contact_id ? contactInfo.get(p.contact_id) : null
      const igcState = p.ignition_client_id
        ? igcInfo.get(p.ignition_client_id)
        : null

      const state =
        orgState?.state ?? ctState?.state ?? igcState?.state ?? null
      const city =
        orgState?.city ?? ctState?.city ?? igcState?.city ?? null

      // Service line categorisation: collect every distinct line touched
      // by this proposal's services. A proposal can hit multiple lines
      // (e.g. an engagement bundling Tax + Advisory) and we want it to
      // surface under either filter.
      const serviceLineSet = new Set<ServiceLine>()
      // Canonical-service set: same idea but at the catalog-rollup level
      // ("Tax Prep — Individual Federal (1040)" etc.) so the UI can
      // filter on the unified service rather than on whatever name the
      // proposal happened to use that day.
      const canonicalSet = new Set<string>()
      let serviceCount = 0
      let hasRecurringLine = false
      for (const s of p.services ?? []) {
        serviceCount++
        if (
          s.billing_frequency &&
          s.billing_frequency !== "one-time"
        ) {
          hasRecurringLine = true
        }
        if (s.service_name) {
          serviceLineSet.add(classifyService(s.service_name))
          const cid = canonicalIdFor(s.service_name)
          if (cid) canonicalSet.add(cid)
        }
      }

      // Curated-recurring scrub
      const candidates = [p.organizations?.name, p.client_name].filter(
        Boolean,
      ) as string[]
      const isCurated = candidates.some((n) =>
        curatedRecurring.has(normalizeClientName(n)),
      )
      let recurring = Number(p.recurring_total) || 0
      let oneTime = Number(p.one_time_total) || 0
      const total = Number(p.total_value) || 0
      if (!isCurated) {
        oneTime = Math.max(oneTime + recurring, total > 0 ? total : 0)
        recurring = 0
      }

      return {
        proposal_id: p.proposal_id,
        proposal_number: p.proposal_number,
        title: p.title,
        status: p.status,
        total_value: total,
        one_time_total: oneTime,
        recurring_total: recurring,
        recurring_frequency: isCurated ? p.recurring_frequency : null,
        currency: p.currency,
        client_name: p.client_name,
        client_email: p.client_email,
        client_partner: p.client_partner,
        client_manager: p.client_manager,
        proposal_sent_by: p.proposal_sent_by,
        billing_starts_on: p.billing_starts_on,
        sent_at: p.sent_at,
        accepted_at: p.accepted_at,
        completed_at: p.completed_at,
        lost_at: p.lost_at,
        lost_reason: p.lost_reason,
        created_at: p.created_at,
        updated_at: p.updated_at,
        organization_id: p.organization_id,
        organizations: p.organizations ?? null,
        state,
        city,
        service_lines: Array.from(serviceLineSet),
        canonical_services: Array.from(canonicalSet),
        is_curated_recurring: isCurated,
        signed_url: p.signed_url ?? null,
        service_count: serviceCount,
        has_recurring_line: hasRecurringLine,
      }
    })

    // ── Compute filter dimensions from the *unfiltered* enriched set ─────
    const dimensions = {
      statuses: uniqueSorted(enriched.map((p) => p.status)),
      partners: uniqueSorted(enriched.map((p) => p.client_partner)),
      managers: uniqueSorted(enriched.map((p) => p.client_manager)),
      sentBy: uniqueSorted(enriched.map((p) => p.proposal_sent_by)),
      states: uniqueSorted(enriched.map((p) => p.state)),
      serviceLines: SERVICE_LINES.filter((line) =>
        enriched.some((p) => p.service_lines.includes(line)),
      ) as string[],
      // Only emit canonical services that actually appear on at least
      // one proposal — keeps the dropdown short and relevant. The UI
      // displays the label but submits the id back as the filter value.
      canonicalServices: (() => {
        const seen = new Set<string>()
        for (const p of enriched) for (const id of p.canonical_services) seen.add(id)
        return CANONICAL_SERVICES.filter((c) => seen.has(c.id))
          .map((c) => ({
            id: c.id,
            label: c.label,
            serviceLine: c.serviceLine as string,
          }))
          .sort((a, b) => a.label.localeCompare(b.label))
      })(),
    }

    // ── Apply filters ────────────────────────────────────────────────────
    const lcSearch = search.toLowerCase()
    let filtered = enriched.filter((p) => {
      if (statusFilter.length && (!p.status || !statusFilter.includes(p.status))) return false
      if (partnerFilter.length && (!p.client_partner || !partnerFilter.includes(p.client_partner))) return false
      if (managerFilter.length && (!p.client_manager || !managerFilter.includes(p.client_manager))) return false
      if (sentByFilter.length && (!p.proposal_sent_by || !sentByFilter.includes(p.proposal_sent_by))) return false
      if (stateFilter.length) {
        // "(unknown)" is a sentinel for proposals with no resolved state —
        // keeps the option visible in the picker as an explicit choice.
        const st = p.state ?? "(unknown)"
        if (!stateFilter.includes(st)) return false
      }
      if (serviceLineFilter.length) {
        const has = p.service_lines.some((line) =>
          serviceLineFilter.includes(line),
        )
        if (!has) return false
      }
      if (canonicalServiceFilter.length) {
        // OR-match: keep the proposal if ANY of its line items rolled up
        // into one of the selected canonical services. This mirrors how
        // serviceLine works above so the UX is consistent.
        const has = p.canonical_services.some((id) =>
          canonicalServiceFilter.includes(id),
        )
        if (!has) return false
      }
      if (minValue !== null && !Number.isNaN(minValue) && p.total_value < minValue)
        return false
      if (maxValue !== null && !Number.isNaN(maxValue) && p.total_value > maxValue)
        return false
      if (dateFrom || dateTo) {
        const dv = p[dateField] as string | null
        if (!dv) return false
        // Compare ISO strings directly — works for both "yyyy-MM-dd" and
        // full timestamp values because date-only strings come before any
        // time-bearing string for the same day.
        if (dateFrom && dv < dateFrom) return false
        if (dateTo && dv > dateTo + "T23:59:59") return false
      }
      if (lcSearch) {
        const hay =
          (p.client_name || "").toLowerCase() +
          " " +
          (p.organizations?.name || "").toLowerCase() +
          " " +
          (p.title || "").toLowerCase() +
          " " +
          (p.proposal_number || "").toLowerCase() +
          " " +
          (p.client_email || "").toLowerCase()
        if (!hay.includes(lcSearch)) return false
      }
      return true
    })

    // ── Sort ────────────────────────────────────────────────────────────
    const validSortFields = new Set([
      "created_at",
      "accepted_at",
      "sent_at",
      "completed_at",
      "total_value",
      "client_name",
      "status",
      "proposal_number",
    ])
    const finalSort = validSortFields.has(sortBy) ? sortBy : "created_at"
    filtered = [...filtered].sort((a: any, b: any) => {
      const av = a[finalSort]
      const bv = b[finalSort]
      // Push nulls to the bottom regardless of direction
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

    // ── Analytics computed on the *filtered* set ─────────────────────────
    // KPIs and charts read this block. Same pattern as the invoices /
    // payments endpoints: stats reflect the active filter so when the
    // user is on YTD the dashboard tells the YTD story, not all-time.
    // The trend buckets each proposal on its primary status-event date
    // (accepted/lost/sent/created in priority order) so a proposal sent
    // in January but won in March shows up as a March win — which is
    // how partners actually narrate revenue.
    const acceptedStatuses = new Set(["accepted", "completed"])
    const lostStatuses = new Set(["lost", "declined"])
    const openStatuses = new Set(["awaiting_acceptance", "draft", "sent", "revoked"])

    type Stats = {
      total: number
      totalValue: number
      byStatus: Record<string, number>
      valueByStatus: Record<string, number>
      acceptedCount: number
      acceptedValue: number
      openCount: number
      openValue: number
      lostCount: number
      lostValue: number
      winRate: number
      valueWinRate: number
      avgDealSize: number
      medianDaysToAccept: number | null
    }
    const stats: Stats = {
      total: filtered.length,
      totalValue: 0,
      byStatus: {},
      valueByStatus: {},
      acceptedCount: 0,
      acceptedValue: 0,
      openCount: 0,
      openValue: 0,
      lostCount: 0,
      lostValue: 0,
      winRate: 0,
      valueWinRate: 0,
      avgDealSize: 0,
      medianDaysToAccept: null,
    }

    const daysToAccept: number[] = []
    for (const p of filtered) {
      const v = Number(p.total_value) || 0
      const s = p.status || "(none)"
      stats.totalValue += v
      stats.byStatus[s] = (stats.byStatus[s] || 0) + 1
      stats.valueByStatus[s] = (stats.valueByStatus[s] || 0) + v
      if (acceptedStatuses.has(s)) {
        stats.acceptedCount += 1
        stats.acceptedValue += v
      } else if (lostStatuses.has(s)) {
        stats.lostCount += 1
        stats.lostValue += v
      } else if (openStatuses.has(s)) {
        stats.openCount += 1
        stats.openValue += v
      }
      if (p.accepted_at && p.sent_at) {
        const d =
          (new Date(p.accepted_at).getTime() -
            new Date(p.sent_at).getTime()) /
          (1000 * 60 * 60 * 24)
        if (Number.isFinite(d) && d >= 0) daysToAccept.push(d)
      }
    }
    const decisions = stats.acceptedCount + stats.lostCount
    stats.winRate = decisions > 0 ? stats.acceptedCount / decisions : 0
    const decisionValue = stats.acceptedValue + stats.lostValue
    stats.valueWinRate =
      decisionValue > 0 ? stats.acceptedValue / decisionValue : 0
    stats.avgDealSize =
      stats.acceptedCount > 0 ? stats.acceptedValue / stats.acceptedCount : 0
    if (daysToAccept.length) {
      daysToAccept.sort((a, b) => a - b)
      stats.medianDaysToAccept = Math.round(
        daysToAccept[Math.floor(daysToAccept.length / 2)],
      )
    }

    // Monthly trend over the past 12 months. We pre-seed all 12 buckets
    // so the x-axis stays stable even when a tight filter window
    // produces empty months; missing months just render as zero bars.
    const today = new Date()
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
        {
          month: m,
          accepted: 0,
          lost: 0,
          open: 0,
          acceptedValue: 0,
          lostValue: 0,
          openValue: 0,
        },
      ]),
    )
    for (const p of filtered) {
      const s = p.status || "(none)"
      // Bucket each proposal on the date that matches its current
      // status: when it was won / lost / sent. Falls back to created_at
      // so every proposal lands somewhere even if upstream dates are
      // empty.
      let eventDate: string | null = null
      if (acceptedStatuses.has(s))
        eventDate = p.accepted_at ?? p.sent_at ?? p.created_at
      else if (lostStatuses.has(s))
        eventDate = p.lost_at ?? p.sent_at ?? p.created_at
      else eventDate = p.sent_at ?? p.created_at
      if (!eventDate) continue
      const m = eventDate.slice(0, 7)
      const bucket = trendMap.get(m)
      if (!bucket) continue // outside the 12-month window
      const v = Number(p.total_value) || 0
      if (acceptedStatuses.has(s)) {
        bucket.accepted += 1
        bucket.acceptedValue += v
      } else if (lostStatuses.has(s)) {
        bucket.lost += 1
        bucket.lostValue += v
      } else {
        bucket.open += 1
        bucket.openValue += v
      }
    }
    const trend = Array.from(trendMap.values()).map((b) => ({
      ...b,
      acceptedValue: Math.round(b.acceptedValue * 100) / 100,
      lostValue: Math.round(b.lostValue * 100) / 100,
      openValue: Math.round(b.openValue * 100) / 100,
    }))

    // Top clients by *accepted* value within the filtered window. We
    // group on the resolved organization_id when present and fall back
    // to client_name so unlinked rows still aggregate cleanly.
    type TopClientBucket = {
      key: string
      name: string
      orgId: string | null
      count: number
      acceptedValue: number
    }
    const topMap = new Map<string, TopClientBucket>()
    for (const p of filtered) {
      const s = p.status || "(none)"
      if (!acceptedStatuses.has(s)) continue
      const key = p.organization_id || p.client_name || "(unknown)"
      const v = Number(p.total_value) || 0
      const existing = topMap.get(key)
      if (existing) {
        existing.count += 1
        existing.acceptedValue += v
      } else {
        topMap.set(key, {
          key,
          name: p.organizations?.name || p.client_name || "Unknown client",
          orgId: p.organization_id || null,
          count: 1,
          acceptedValue: v,
        })
      }
    }
    const topClients = Array.from(topMap.values())
      .sort((a, b) => b.acceptedValue - a.acceptedValue)
      .slice(0, 10)
      .map((b) => ({
        ...b,
        acceptedValue: Math.round(b.acceptedValue * 100) / 100,
      }))

    const total = filtered.length
    const from = (page - 1) * pageSize
    const paged = filtered.slice(from, from + pageSize)

    return NextResponse.json({
      proposals: paged,
      page,
      pageSize,
      total,
      totalUnfiltered: enriched.length,
      stats,
      trend,
      topClients,
      dimensions,
    })
  } catch (error) {
    console.error("[sales/proposals] Error:", error)
    return NextResponse.json({ error: "Failed to load proposals" }, { status: 500 })
  }
}

function uniqueSorted(arr: (string | null | undefined)[] | undefined): string[] {
  if (!arr) return []
  const set = new Set<string>()
  for (const v of arr) {
    if (v && typeof v === "string") set.add(v)
  }
  return Array.from(set).sort()
}
