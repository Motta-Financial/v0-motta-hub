import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  loadRecurringScrubSet,
  normalizeClientName,
} from "@/lib/sales/recurring-scrub"
import {
  classifyService,
  type ServiceLine,
} from "@/lib/sales/service-line-classifier"
import {
  canonicalIdFor,
  getCanonicalService,
} from "@/lib/sales/service-catalog"
import { normalizeState } from "@/lib/sales/us-geo"

/**
 * Sales Dashboard data endpoint.
 *
 * Returns the *filtered* set of Ignition proposals (with linked
 * client/state info and embedded service line items) plus the full set of
 * filter dimensions in one round-trip. The client computes every
 * aggregation (KPIs, charts, tables) from this dataset so filter changes
 * feel instant — only switching to a date range outside the current cache
 * forces another fetch.
 *
 * Volumes are modest (~900 proposals, ~440 service lines), so shipping the
 * full filtered dataset is well within budget. If we ever scale 10x, this
 * endpoint can be split into a /summary aggregator + a /proposals paginator
 * without changing the client contract.
 */

export const dynamic = "force-dynamic"

// State normalization moved to lib/sales/us-geo so the same logic powers
// API enrichment and the client-side map.

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sp = url.searchParams

  // ── Filters from query string ──────────────────────────────────────────
  // All filters are optional. Multi-value filters are comma-separated.
  //
  // `dateField=activity` (the default) treats a proposal as "in window"
  // when ANY of its lifecycle dates (accepted_at, lost_at, sent_at,
  // created_at) falls inside the range. Previously the dashboard
  // defaulted to `accepted_at`, which silently hid every lost / draft /
  // awaiting_acceptance proposal because those rows have a null
  // accepted_at — so users opening the page never saw deals that were
  // still in flight or that fell through. The explicit single-column
  // modes are kept for users who want a strict "won in YTD" lens.
  const dateField = (sp.get("dateField") || "activity") as
    | "activity"
    | "created_at"
    | "accepted_at"
    | "sent_at"
  const startDate = sp.get("startDate") // ISO date YYYY-MM-DD
  const endDate = sp.get("endDate")
  const statusFilter = sp.get("status")?.split(",").filter(Boolean) ?? []
  const partnerFilter = sp.get("partner")?.split(",").filter(Boolean) ?? []
  const managerFilter = sp.get("manager")?.split(",").filter(Boolean) ?? []
  const sentByFilter = sp.get("sentBy")?.split(",").filter(Boolean) ?? []
  const stateFilter = sp.get("state")?.split(",").filter(Boolean) ?? []
  const minValue = sp.get("minValue") ? Number(sp.get("minValue")) : null
  const maxValue = sp.get("maxValue") ? Number(sp.get("maxValue")) : null
  const search = sp.get("search")?.trim() || ""
  const includeArchived = sp.get("includeArchived") === "1"

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // ── Build proposals query with FK + service lines embedded ────────────
  let q = supabase
    .from("ignition_proposals")
    .select(
      `proposal_id, proposal_number, title, status, client_name, client_email,
       organization_id, contact_id, ignition_client_id,
       total_value, one_time_total, recurring_total, recurring_frequency, currency,
       sent_at, accepted_at, completed_at, lost_at, lost_reason, archived_at,
       client_manager, client_partner, proposal_sent_by,
       billing_starts_on, effective_start_date, last_event_at, created_at, updated_at,
       services:ignition_proposal_services (
         id, service_name, description, quantity, unit_price, total_amount,
         currency, billing_frequency, billing_type, status, ordinal
       )`,
    )
    .limit(2000)

  if (!includeArchived) q = q.is("archived_at", null)

  // Apply server-side filters when provided. We deliberately skip state,
  // value, and search filters here — they're computed against the *enriched*
  // record (after joining state from contacts/orgs) and are cheap enough to
  // do in JS once we have ~900 rows in memory.
  //
  // For the activity (any-date) mode we emit an .or() bundling the four
  // lifecycle date columns so PostgREST treats them as a single
  // predicate. Without this PostgREST would AND them together and zero
  // rows would match.
  if (dateField === "activity") {
    if (startDate) {
      q = q.or(
        [
          `accepted_at.gte.${startDate}`,
          `lost_at.gte.${startDate}`,
          `sent_at.gte.${startDate}`,
          `created_at.gte.${startDate}`,
        ].join(","),
      )
    }
    if (endDate) {
      const upper = endDate + "T23:59:59"
      q = q.or(
        [
          `accepted_at.lte.${upper}`,
          `lost_at.lte.${upper}`,
          `sent_at.lte.${upper}`,
          `created_at.lte.${upper}`,
        ].join(","),
      )
    }
  } else {
    if (startDate) q = q.gte(dateField, startDate)
    if (endDate) q = q.lte(dateField, endDate + "T23:59:59")
  }
  if (statusFilter.length) q = q.in("status", statusFilter)
  if (partnerFilter.length) q = q.in("client_partner", partnerFilter)
  if (managerFilter.length) q = q.in("client_manager", managerFilter)
  if (sentByFilter.length) q = q.in("proposal_sent_by", sentByFilter)

  // Order by the most recent activity touch for the activity mode so the
  // proposal list reads chronologically regardless of which lifecycle
  // event fired last (won, lost, sent, etc).
  if (dateField === "activity") {
    q = q.order("updated_at", { ascending: false, nullsFirst: false })
  } else {
    q = q.order(dateField, { ascending: false, nullsFirst: false })
  }

  const { data: proposals, error } = await q

  if (error) {
    console.error("[sales-dashboard] proposals query failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Load curated recurring-revenue scrub set ──────────────────────────
  // The Ignition feed flags many one-time engagements as "recurring" because
  // the platform allows monthly billing schedules on fixed-fee work. We use
  // the partner-maintained `motta_recurring_revenue` list as the authoritative
  // source of who's truly on a recurring engagement; everyone else gets their
  // recurring_total shifted into one-time so MRR/ARR calculations are correct.
  const curatedRecurring = await loadRecurringScrubSet()

  // ── Authoritative MRR/ARR roll-up from the curated table ──────────────
  // The dashboard's "Annualized Recurring" KPI used to sum
  // `recurring_total × 12` across every accepted Ignition proposal, which
  // double-counted clients with multiple historical renewals AND
  // mis-classified annual engagements that Ignition exports as monthly
  // billing schedules. We now mirror /api/sales/recurring-revenue and pull
  // the curated CSV totals so both pages quote the same number.
  // Quarterly fees contribute fee/3 to MRR and fee*4 to ARR.
  const { data: curatedRows } = await supabase
    .from("motta_recurring_revenue")
    .select("normalized_name, cadence, service_fee, one_time_fee")
  let curatedMrr = 0
  let curatedArr = 0
  let curatedOneTime = 0
  const curatedClientSet = new Set<string>()
  for (const r of curatedRows ?? []) {
    const fee = Number(r.service_fee) || 0
    const oneTime = Number(r.one_time_fee) || 0
    curatedClientSet.add(r.normalized_name)
    curatedOneTime += oneTime
    if (r.cadence === "Monthly") {
      curatedMrr += fee
      curatedArr += fee * 12
    } else if (r.cadence === "Quarterly") {
      curatedMrr += fee / 3
      curatedArr += fee * 4
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100
  const recurringSummary = {
    mrr: round2(curatedMrr),
    arr: round2(curatedArr),
    one_time_total: round2(curatedOneTime),
    distinct_clients: curatedClientSet.size,
    service_lines: curatedRows?.length ?? 0,
  }

  // ── Resolve states via the linked org/contact, with ignition_clients
  //    as a third fallback ──────────────────────────────────────────────
  // ~21% of proposals have no org/contact state on file. The original
  // Ignition import carries its own address — we use it as a backstop so
  // those proposals still appear on the map.
  const orgIds = new Set<string>()
  const contactIds = new Set<string>()
  const igcIds = new Set<string>()
  for (const p of proposals ?? []) {
    if (p.organization_id) orgIds.add(p.organization_id)
    if (p.contact_id) contactIds.add(p.contact_id)
    if (p.ignition_client_id) igcIds.add(p.ignition_client_id)
  }

  type EntityInfo = { state: string | null; city: string | null; country: string | null; name: string }
  const orgInfo = new Map<string, EntityInfo>()
  const contactInfo = new Map<string, EntityInfo>()
  const igcInfo = new Map<string, { state: string | null; city: string | null; country: string | null }>()

  if (orgIds.size) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, state, city, country")
      .in("id", Array.from(orgIds))
    for (const o of orgs ?? []) {
      orgInfo.set(o.id, {
        state: normalizeState(o.state),
        city: o.city,
        country: o.country,
        name: o.name,
      })
    }
  }
  if (contactIds.size) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, full_name, state, city, country, mailing_state, mailing_city")
      .in("id", Array.from(contactIds))
    for (const ct of contacts ?? []) {
      contactInfo.set(ct.id, {
        // contacts.state can be the residential or mailing — try residential
        // first, then fall back to mailing
        state: normalizeState(ct.state) ?? normalizeState(ct.mailing_state),
        city: ct.city ?? ct.mailing_city,
        country: ct.country,
        name: ct.full_name,
      })
    }
  }
  if (igcIds.size) {
    const { data: igcs } = await supabase
      .from("ignition_clients")
      .select("ignition_client_id, state, city, country")
      .in("ignition_client_id", Array.from(igcIds))
    for (const ig of igcs ?? []) {
      igcInfo.set(ig.ignition_client_id, {
        state: normalizeState(ig.state),
        city: ig.city,
        country: ig.country,
      })
    }
  }

  // ── Enrich + apply remaining filters in JS ─────────────────────────────
  type EnrichedProposal = {
    proposal_id: string
    proposal_number: string | null
    title: string | null
    status: string
    client_name: string | null
    client_email: string | null
    client_display: string
    organization_id: string | null
    contact_id: string | null
    entity_kind: "organization" | "contact" | null
    state: string | null
    city: string | null
    country: string | null
    /**
     * Where did `state` come from? Drives the inline state-edit UI:
     *  - "organization" / "contact": editing updates that table directly
     *  - "ignition_client": original import row, also editable
     *  - null: no state on file — the picker writes to the linked
     *    org/contact when present, otherwise to ignition_clients
     */
    state_source: "organization" | "contact" | "ignition_client" | null
    ignition_client_id: string | null
    total_value: number
    one_time_total: number
    recurring_total: number
    recurring_frequency: string | null
    annualized_recurring: number
    is_curated_recurring: boolean
    currency: string
    sent_at: string | null
    accepted_at: string | null
    completed_at: string | null
    lost_at: string | null
    lost_reason: string | null
    archived_at: string | null
    client_partner: string | null
    client_manager: string | null
    proposal_sent_by: string | null
    billing_starts_on: string | null
    effective_start_date: string | null
    last_event_at: string | null
    created_at: string | null
    services: Array<{
      id: string
      service_name: string
      /**
       * Canonical-catalog display name. Falls back to the raw `service_name`
       * when the line item doesn't match any catalog alias/pattern. Always
       * use this value when rendering or aggregating in UI surfaces so
       * historical naming variants (e.g. "Outsourced | Tax Prep (1120s):
       * S-Corporation") roll up to their canonical label
       * ("Tax Prep — S-Corp (1120s)").
       */
      display_name: string
      canonical_id: string | null
      description: string | null
      quantity: number | null
      unit_price: number | null
      total_amount: number
      currency: string | null
      billing_frequency: string | null
      billing_type: string | null
      status: string | null
      ordinal: number | null
    }>
  }

  const enriched: EnrichedProposal[] = (proposals ?? []).map((p: any) => {
    const linked =
      (p.organization_id && orgInfo.get(p.organization_id)) ||
      (p.contact_id && contactInfo.get(p.contact_id)) ||
      null
    const entity_kind: EnrichedProposal["entity_kind"] = p.organization_id
      ? "organization"
      : p.contact_id
      ? "contact"
      : null

    // State/city resolution: linked org/contact wins, then the original
    // Ignition client record. The state_source field tells the UI whether
    // the value came from an editable CRM record (org/contact) or from a
    // read-only Ignition import (fallback) so the inline edit can target
    // the right table.
    const igc = p.ignition_client_id ? igcInfo.get(p.ignition_client_id) : null
    let resolvedState: string | null = linked?.state ?? null
    let resolvedCity: string | null = linked?.city ?? null
    let resolvedCountry: string | null = linked?.country ?? null
    let stateSource: "organization" | "contact" | "ignition_client" | null = null
    if (resolvedState && p.organization_id && linked === orgInfo.get(p.organization_id)) {
      stateSource = "organization"
    } else if (resolvedState && p.contact_id && linked === contactInfo.get(p.contact_id)) {
      stateSource = "contact"
    }
    if (!resolvedState && igc?.state) {
      resolvedState = igc.state
      resolvedCity = igc.city ?? resolvedCity
      resolvedCountry = igc.country ?? resolvedCountry
      stateSource = "ignition_client"
    }
    // Even if state came from org/contact, fill missing city from
    // ignition_clients when available.
    if (!resolvedCity && igc?.city) {
      resolvedCity = igc.city
    }

    // Apply curated recurring-revenue scrub: only proposals tied to a client
    // in the partner-maintained list keep their recurring_total. Everyone
    // else has it absorbed into one-time so MRR/ARR aren't inflated by
    // Ignition's misclassified engagements.
    const candidates = [linked?.name, p.client_name].filter(Boolean) as string[]
    const isCuratedRecurring = candidates.some((n) =>
      curatedRecurring.has(normalizeClientName(n)),
    )
    const rawRecurring = Number(p.recurring_total) || 0
    const rawOneTime = Number(p.one_time_total) || 0
    const totalValue = Number(p.total_value) || 0

    const recurring = isCuratedRecurring ? rawRecurring : 0
    const oneTime = isCuratedRecurring
      ? rawOneTime
      : Math.max(rawOneTime + rawRecurring, totalValue > 0 ? totalValue : 0)

    // Annualize recurring revenue. We only see "monthly" today but we're
    // defensive about other frequencies for when Ignition adds them.
    const freq = (p.recurring_frequency || "").toLowerCase()
    const annualMultiplier =
      freq === "monthly"
        ? 12
        : freq === "quarterly"
        ? 4
        : freq === "weekly"
        ? 52
        : freq === "yearly" || freq === "annually"
        ? 1
        : 0
    return {
      proposal_id: p.proposal_id,
      proposal_number: p.proposal_number,
      title: p.title,
      status: p.status,
      client_name: p.client_name,
      client_email: p.client_email,
      client_display: linked?.name || p.client_name || "(Unknown)",
      organization_id: p.organization_id,
      contact_id: p.contact_id,
      entity_kind,
      state: resolvedState,
      city: resolvedCity,
      country: resolvedCountry,
      state_source: stateSource,
      ignition_client_id: p.ignition_client_id ?? null,
      total_value: totalValue,
      one_time_total: oneTime,
      recurring_total: recurring,
      recurring_frequency: isCuratedRecurring ? p.recurring_frequency : null,
      annualized_recurring: recurring * annualMultiplier,
      is_curated_recurring: isCuratedRecurring,
      currency: p.currency || "USD",
      sent_at: p.sent_at,
      accepted_at: p.accepted_at,
      completed_at: p.completed_at,
      lost_at: p.lost_at,
      lost_reason: p.lost_reason,
      archived_at: p.archived_at,
      client_partner: p.client_partner,
      client_manager: p.client_manager,
      proposal_sent_by: p.proposal_sent_by,
      billing_starts_on: p.billing_starts_on,
      effective_start_date: p.effective_start_date,
      last_event_at: p.last_event_at,
      created_at: p.created_at,
      services: (p.services || []).map((s: any) => {
        // Resolve each line item to its canonical catalog entry once at the
        // API layer so every downstream aggregation (top-services list,
        // per-service-line rollup, future drilldowns) shares one
        // authoritative display name. Lines that don't match any catalog
        // alias/pattern keep their raw name so we never silently lose data.
        const canonicalId = canonicalIdFor(s.service_name)
        const canonical = getCanonicalService(canonicalId)
        return {
          ...s,
          canonical_id: canonicalId,
          display_name: canonical?.label || s.service_name,
          total_amount: Number(s.total_amount) || 0,
        }
      }),
    }
  })

  const lcSearch = search.toLowerCase()
  const filtered = enriched.filter((p) => {
    if (stateFilter.length) {
      const st = p.state || "(unknown)"
      if (!stateFilter.includes(st)) return false
    }
    if (minValue != null && p.total_value < minValue) return false
    if (maxValue != null && p.total_value > maxValue) return false
    if (lcSearch) {
      const hay =
        (p.client_display || "").toLowerCase() +
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

  // ── Filter dimensions (always full domain, ignoring current filters) ──
  // We pull these from the *unfiltered* enriched set so the user can select
  // any value even after applying other filters that would otherwise hide it.
  const states = Array.from(
    new Set(enriched.map((p) => p.state).filter(Boolean) as string[]),
  ).sort()
  const partners = Array.from(
    new Set(enriched.map((p) => p.client_partner).filter(Boolean) as string[]),
  ).sort()
  const managers = Array.from(
    new Set(enriched.map((p) => p.client_manager).filter(Boolean) as string[]),
  ).sort()
  const sentByList = Array.from(
    new Set(enriched.map((p) => p.proposal_sent_by).filter(Boolean) as string[]),
  ).sort()
  const statuses = Array.from(new Set(enriched.map((p) => p.status))).sort()

  // ── Service Line breakdown (only for accepted/completed proposals) ────
  const serviceLineMap = new Map<
    ServiceLine,
    {
      revenue: number
      count: number
      servicesMap: Map<string, { revenue: number; count: number }>
    }
  >()

  for (const p of filtered) {
    // Only count revenue from won deals
    if (p.status !== "accepted" && p.status !== "completed") continue

    for (const s of p.services) {
      // Use display_name (canonical-catalog label, raw fallback) so the
      // per-service-line "Top services" list rolls historical naming
      // variants up to one canonical row instead of showing them as
      // separate items. The keyword classifier still owns the Tax /
      // Accounting / Advisory / Other bucket — it accepts either form.
      const line = classifyService(s.service_name)
      const bucketName = s.display_name
      const current = serviceLineMap.get(line) || {
        revenue: 0,
        count: 0,
        servicesMap: new Map(),
      }

      current.revenue += s.total_amount
      current.count += 1

      const serviceCurrent = current.servicesMap.get(bucketName) || {
        revenue: 0,
        count: 0,
      }
      serviceCurrent.revenue += s.total_amount
      serviceCurrent.count += 1
      current.servicesMap.set(bucketName, serviceCurrent)

      serviceLineMap.set(line, current)
    }
  }

  const serviceLines = (["Tax", "Accounting", "Advisory", "Other"] as ServiceLine[])
    .filter((line) => serviceLineMap.has(line))
    .map((line) => {
      const data = serviceLineMap.get(line)!
      return {
        serviceLine: line,
        revenue: data.revenue,
        count: data.count,
        topServices: Array.from(data.servicesMap.entries())
          .map(([name, stats]) => ({
            name,
            revenue: stats.revenue,
            count: stats.count,
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  // ── State breakdown with clients, cities, and per-service-line slices ─
  // The map exposes three toggles (metric, service line, view) — all of
  // which the client computes from this single per-state structure.
  const SERVICE_LINES_ORDER: ServiceLine[] = ["Tax", "Accounting", "Advisory", "Other"]

  type CityStats = {
    city: string
    state: string
    proposalCount: number
    acceptedValue: number
    clientKeys: Set<string>
  }
  type StateAgg = {
    state: string
    proposalCount: number
    acceptedValue: number
    totalValue: number
    pipelineValue: number
    clients: Map<string, { name: string; id: string | null; kind: "organization" | "contact" | null; value: number; proposals: number }>
    /** revenue/count split by service line — only counts accepted deals */
    byServiceLine: Record<ServiceLine, { revenue: number; count: number }>
    cities: Map<string, CityStats>
  }

  const stateBreakdownMap = new Map<string, StateAgg>()
  const ensureState = (st: string): StateAgg => {
    let cur = stateBreakdownMap.get(st)
    if (!cur) {
      cur = {
        state: st,
        proposalCount: 0,
        acceptedValue: 0,
        totalValue: 0,
        pipelineValue: 0,
        clients: new Map(),
        byServiceLine: {
          Tax: { revenue: 0, count: 0 },
          Accounting: { revenue: 0, count: 0 },
          Advisory: { revenue: 0, count: 0 },
          Other: { revenue: 0, count: 0 },
        },
        cities: new Map(),
      }
      stateBreakdownMap.set(st, cur)
    }
    return cur
  }

  for (const p of filtered) {
    const st = p.state || "Unknown"
    const cur = ensureState(st)

    cur.proposalCount += 1
    cur.totalValue += p.total_value

    const isAccepted = p.status === "accepted" || p.status === "completed"
    if (isAccepted) cur.acceptedValue += p.total_value
    if (p.status === "sent") cur.pipelineValue += p.total_value

    // Track client (always — not just accepted) so the "clients" toggle
    // surfaces unique-client counts even for pipeline-only states.
    const clientKey = p.organization_id || p.contact_id || p.client_display
    const existingClient = cur.clients.get(clientKey) || {
      name: p.client_display,
      id: p.organization_id || p.contact_id,
      kind: p.entity_kind,
      value: 0,
      proposals: 0,
    }
    existingClient.proposals += 1
    if (isAccepted) existingClient.value += p.total_value
    cur.clients.set(clientKey, existingClient)

    // Per-service-line revenue (only accepted, mirrors the global serviceLines table)
    if (isAccepted) {
      for (const s of p.services) {
        const line = classifyService(s.service_name)
        cur.byServiceLine[line].revenue += s.total_amount
        cur.byServiceLine[line].count += 1
      }
    }

    // City rollup for the map's "Cities" view. We only emit a city entry
    // when there's a real city string — proposals without one fall back
    // to the state-level aggregate.
    if (p.city) {
      const cityKey = `${p.city.trim().toLowerCase()}|${st}`
      let cs = cur.cities.get(cityKey)
      if (!cs) {
        cs = {
          city: p.city.trim(),
          state: st,
          proposalCount: 0,
          acceptedValue: 0,
          clientKeys: new Set(),
        }
        cur.cities.set(cityKey, cs)
      }
      cs.proposalCount += 1
      if (isAccepted) cs.acceptedValue += p.total_value
      cs.clientKeys.add(clientKey)
    }
  }

  const stateBreakdown = Array.from(stateBreakdownMap.values())
    .map((s) => ({
      state: s.state,
      proposalCount: s.proposalCount,
      acceptedValue: s.acceptedValue,
      totalValue: s.totalValue,
      pipelineValue: s.pipelineValue,
      clientCount: s.clients.size,
      clients: Array.from(s.clients.values())
        .sort((a, b) => b.value - a.value)
        .slice(0, 15),
      byServiceLine: SERVICE_LINES_ORDER.map((line) => ({
        serviceLine: line,
        revenue: s.byServiceLine[line].revenue,
        count: s.byServiceLine[line].count,
      })),
      cities: Array.from(s.cities.values())
        .map((c) => ({
          city: c.city,
          state: c.state,
          proposalCount: c.proposalCount,
          acceptedValue: c.acceptedValue,
          clientCount: c.clientKeys.size,
        }))
        .sort((a, b) => b.acceptedValue - a.acceptedValue || b.proposalCount - a.proposalCount),
    }))
    .sort((a, b) => b.acceptedValue - a.acceptedValue)

  // ── Payouts roll-up (collected cash from ignition_payments) ───────────
  // The `ignition_disbursals` table is the legacy Zapier-fed stream and
  // is effectively empty in production (no net_amount / arrival_date
  // populated). The Reporting API doesn't expose disbursals either, so
  // "Payouts" on the dashboard actually means "money collected from
  // clients" — sourced from `ignition_payments.paid_at`. That's the
  // number partners care about anyway (cash in vs. proposals won).
  //
  // The date range matches the proposals window so the two surfaces
  // tell one consistent story — if the user is looking at YTD
  // proposals, they see YTD collections beside them.
  type PaymentRow = {
    ignition_payment_id: string
    amount: number | null
    fees: number | null
    net_amount: number | null
    paid_at: string | null
    ignition_client_id: string | null
  }
  let payQ = supabase
    .from("ignition_payments")
    .select(
      "ignition_payment_id, amount, fees, net_amount, paid_at, ignition_client_id",
    )
    .not("paid_at", "is", null)
    .limit(5000)
  if (startDate) payQ = payQ.gte("paid_at", startDate)
  if (endDate) payQ = payQ.lte("paid_at", endDate + "T23:59:59")
  const { data: paymentRows } = await payQ
  const payments = (paymentRows ?? []) as PaymentRow[]

  let payoutsGross = 0
  let payoutsFees = 0
  let payoutsNet = 0
  const payoutsByMonth = new Map<
    string,
    { month: string; count: number; gross: number; net: number; fees: number }
  >()
  const payoutsByClient = new Map<
    string,
    { ignition_client_id: string; count: number; gross: number; net: number }
  >()

  for (const p of payments) {
    const amount = Number(p.amount) || 0
    const fees = Number(p.fees) || 0
    const net = Number(p.net_amount) || amount - fees
    payoutsGross += amount
    payoutsFees += fees
    payoutsNet += net

    if (p.paid_at) {
      const month = p.paid_at.slice(0, 7) // "YYYY-MM"
      const bucket = payoutsByMonth.get(month) ?? {
        month,
        count: 0,
        gross: 0,
        net: 0,
        fees: 0,
      }
      bucket.count += 1
      bucket.gross += amount
      bucket.net += net
      bucket.fees += fees
      payoutsByMonth.set(month, bucket)
    }

    if (p.ignition_client_id) {
      const bucket = payoutsByClient.get(p.ignition_client_id) ?? {
        ignition_client_id: p.ignition_client_id,
        count: 0,
        gross: 0,
        net: 0,
      }
      bucket.count += 1
      bucket.gross += amount
      bucket.net += net
      payoutsByClient.set(p.ignition_client_id, bucket)
    }
  }

  // Hydrate the top-paying clients with display names + linked
  // org/contact ids so the dashboard can render them as actual links
  // rather than opaque Ignition uuids. We only look up the top 10 by
  // gross — anything beyond that is noise on the dashboard.
  const topPayoutClientsRaw = Array.from(payoutsByClient.values())
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 10)
  const topClientIds = topPayoutClientsRaw.map((c) => c.ignition_client_id)
  type IgcNameRow = {
    ignition_client_id: string
    name: string | null
    business_name: string | null
    organization_id: string | null
    contact_id: string | null
  }
  const igcNameMap = new Map<string, IgcNameRow>()
  if (topClientIds.length) {
    const { data: igcs } = await supabase
      .from("ignition_clients")
      .select(
        "ignition_client_id, name, business_name, organization_id, contact_id",
      )
      .in("ignition_client_id", topClientIds)
    for (const ig of (igcs ?? []) as IgcNameRow[]) {
      igcNameMap.set(ig.ignition_client_id, ig)
    }
  }

  const topPayoutClients = topPayoutClientsRaw.map((c) => {
    const ig = igcNameMap.get(c.ignition_client_id)
    const linkedKind: "organization" | "contact" | null = ig?.organization_id
      ? "organization"
      : ig?.contact_id
      ? "contact"
      : null
    const linkedId = ig?.organization_id ?? ig?.contact_id ?? null
    return {
      ignition_client_id: c.ignition_client_id,
      name:
        // Org/contact name (after linking) > Ignition's business_name >
        // Ignition's raw name. Falls back to a generic label only if
        // the entire client record is missing.
        (linkedKind === "organization"
          ? orgInfo.get(ig?.organization_id ?? "")?.name
          : linkedKind === "contact"
          ? contactInfo.get(ig?.contact_id ?? "")?.name
          : null) ||
        ig?.business_name ||
        ig?.name ||
        "(Unknown client)",
      kind: linkedKind,
      id: linkedId,
      payment_count: c.count,
      gross: c.gross,
      net: c.net,
    }
  })

  const payoutsSummary = {
    count: payments.length,
    gross: round2(payoutsGross),
    fees: round2(payoutsFees),
    net: round2(payoutsNet),
    distinctClients: payoutsByClient.size,
    byMonth: Array.from(payoutsByMonth.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
    topClients: topPayoutClients,
  }

  return NextResponse.json({
    proposals: filtered,
    totalUnfiltered: enriched.length,
    dimensions: {
      states,
      partners,
      managers,
      sentBy: sentByList,
      statuses,
    },
    serviceLines,
    stateBreakdown,
    // Authoritative recurring-revenue roll-up from the curated CSV table.
    // The dashboard's ARR KPI reads this so it matches /sales/recurring-revenue
    // exactly. It is intentionally not subject to the date-range filter
    // because the curated CSV is a current-state snapshot, not history.
    recurringSummary,
    // Payouts (collected cash) roll-up for the same date window as the
    // proposals — see comment block above for why this comes from
    // ignition_payments rather than ignition_disbursals.
    payouts: payoutsSummary,
  })
}
