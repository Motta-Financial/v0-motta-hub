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
import { computeInvoiceAnchoredRecurring } from "@/lib/sales/invoice-recurring"
import { normalizeState, US_STATE_NAMES } from "@/lib/sales/us-geo"
import { chunk, fetchAllPaged } from "@/lib/supabase/fetch-all"

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
  // Ignition client tags (migration 377) — OR-match; "(untagged)" selects
  // proposals whose client carries no tags.
  const clientTagFilter = sp.get("clientTag")?.split(",").filter(Boolean) ?? []
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
  // PostgREST caps every response at 1,000 rows regardless of .limit(), so
  // we page through the full set with fetchAllPaged. The factory returns a
  // fresh, fully-filtered builder on each call (required — .range() mutates
  // the builder it's called on).
  const buildProposalsQuery = () => {
    let q = supabase
      .from("ignition_proposals")
      .select(
        `proposal_id, proposal_number, title, status, client_name, client_email,
         organization_id, contact_id, ignition_client_id, ignition_url, client_tags,
         total_value, one_time_total, recurring_total, recurring_frequency, currency,
         sent_at, accepted_at, completed_at, lost_at, lost_reason, archived_at,
         client_manager, client_partner, proposal_sent_by,
         billing_starts_on, effective_start_date, last_event_at, created_at, updated_at,
         services:ignition_proposal_services (
           id, service_name, description, quantity, unit_price, total_amount,
           currency, billing_frequency, billing_type, status, ordinal
         )`,
      )

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
    return q
  }

  let proposals: any[]
  try {
    proposals = await fetchAllPaged<any>(buildProposalsQuery)
  } catch (error: any) {
    console.error("[sales-dashboard] proposals query failed:", error)
    return NextResponse.json(
      { error: error?.message || "proposals query failed" },
      { status: 500 },
    )
  }

  // ── Load curated recurring-revenue scrub set ──────────────────────────
  // The Ignition feed flags many one-time engagements as "recurring" because
  // the platform allows monthly billing schedules on fixed-fee work. We use
  // the partner-maintained `motta_recurring_revenue` list as the authoritative
  // source of who's truly on a recurring engagement; everyone else gets their
  // recurring_total shifted into one-time so MRR/ARR calculations are correct.
  const curatedRecurring = await loadRecurringScrubSet()

  // ── Authoritative MRR/ARR roll-up (invoice-anchored) ──────────────────
  // The dashboard's "Annualized Recurring" KPI mirrors
  // /api/sales/recurring-revenue exactly: both call
  // `computeInvoiceAnchoredRecurring`, which counts a service line once
  // it is actually billing monthly/quarterly, at its most recent
  // invoiced amount. Earlier iterations quoted the partner CSV here and
  // proposal service lines on the Recurring Revenue page — the two
  // surfaces disagreed, and the proposal-based number was ~24% high
  // (ended/superseded engagements never leave status "accepted").
  const round2 = (n: number) => Math.round(n * 100) / 100
  let recurringSummary = {
    mrr: 0,
    arr: 0,
    one_time_total: 0,
    distinct_clients: 0,
    service_lines: 0,
  }
  try {
    const invoiceRecurring = await computeInvoiceAnchoredRecurring(supabase)
    recurringSummary = {
      mrr: invoiceRecurring.totals.mrr,
      arr: invoiceRecurring.totals.arr,
      // Not meaningful for the invoice-anchored book; the KPI only
      // renders mrr / arr / distinct_clients.
      one_time_total: 0,
      distinct_clients: invoiceRecurring.totals.distinct_clients,
      service_lines: invoiceRecurring.totals.lines,
    }
  } catch (recErr) {
    // Degrade the KPI to zeros rather than failing the dashboard.
    console.error("[sales-dashboard] recurring computation failed:", recErr)
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
  const igcInfo = new Map<
    string,
    {
      state: string | null
      city: string | null
      country: string | null
      /**
       * Org/contact links carried on the ignition_clients row itself.
       * Proposals synced before the client was matched have null FKs of
       * their own — falling back to these makes the dashboard self-heal
       * as soon as the matcher links the client, without waiting for a
       * proposal re-sync or another backfill migration.
       */
      organization_id: string | null
      contact_id: string | null
    }
  >()

  // The id sets scale with proposal count (~1k each already), so chunk
  // every .in() list — a single unchunked list blows past PostgREST's
  // URL-length limit and silently fails the lookup.
  if (orgIds.size) {
    for (const ids of chunk(Array.from(orgIds))) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, state, city, country")
        .in("id", ids)
      for (const o of orgs ?? []) {
        orgInfo.set(o.id, {
          state: normalizeState(o.state),
          city: o.city,
          country: o.country,
          name: o.name,
        })
      }
    }
  }
  if (contactIds.size) {
    for (const ids of chunk(Array.from(contactIds))) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, full_name, state, city, country, mailing_state, mailing_city")
        .in("id", ids)
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
  }
  if (igcIds.size) {
    for (const ids of chunk(Array.from(igcIds))) {
      const { data: igcs } = await supabase
        .from("ignition_clients")
        .select("ignition_client_id, state, city, country, organization_id, contact_id")
        .in("ignition_client_id", ids)
      for (const ig of igcs ?? []) {
        // Since the Reporting API cutover, ignition_clients.state holds the
        // LIFECYCLE state (lead/active/inactive/archived) — the Reporting
        // API exposes no client address at all. normalizeState() passes
        // unknown strings through as-is, so without the US_STATE_NAMES
        // guard those lifecycle values would surface as bogus "ARCHIVED" /
        // "LEAD" states in the filter list and map. Only the handful of
        // legacy Zapier-era rows still carry a real address state.
        const geoState = normalizeState(ig.state)
        igcInfo.set(ig.ignition_client_id, {
          state: geoState && US_STATE_NAMES[geoState] ? geoState : null,
          city: ig.city,
          country: ig.country,
          organization_id: ig.organization_id,
          contact_id: ig.contact_id,
        })
      }
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
    /** Deep link into the Ignition app for this proposal (migration 377). */
    ignition_url: string | null
    /** Ignition client tags stamped on the proposal at sync time. */
    client_tags: string[]
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

  // Second lookup pass for links that only exist on the ignition_clients
  // row (proposal synced before its client was matched). We collect the
  // extra org/contact ids and hydrate their names/states in one batch so
  // the fallback rows render identically to directly-linked ones.
  const fallbackOrgIds = new Set<string>()
  const fallbackContactIds = new Set<string>()
  for (const p of proposals ?? []) {
    if (p.organization_id || p.contact_id || !p.ignition_client_id) continue
    const igc = igcInfo.get(p.ignition_client_id)
    if (igc?.organization_id && !orgInfo.has(igc.organization_id)) {
      fallbackOrgIds.add(igc.organization_id)
    } else if (igc?.contact_id && !contactInfo.has(igc.contact_id)) {
      fallbackContactIds.add(igc.contact_id)
    }
  }
  if (fallbackOrgIds.size) {
    for (const ids of chunk(Array.from(fallbackOrgIds))) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, state, city, country")
        .in("id", ids)
      for (const o of orgs ?? []) {
        orgInfo.set(o.id, {
          state: normalizeState(o.state),
          city: o.city,
          country: o.country,
          name: o.name,
        })
      }
    }
  }
  if (fallbackContactIds.size) {
    for (const ids of chunk(Array.from(fallbackContactIds))) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, full_name, state, city, country, mailing_state, mailing_city")
        .in("id", ids)
      for (const ct of contacts ?? []) {
        contactInfo.set(ct.id, {
          state: normalizeState(ct.state) ?? normalizeState(ct.mailing_state),
          city: ct.city ?? ct.mailing_city,
          country: ct.country,
          name: ct.full_name,
        })
      }
    }
  }

  const enriched: EnrichedProposal[] = (proposals ?? []).map((p: any) => {
    // Self-healing linkage: when the proposal row itself has no FK, fall
    // back to the links on its ignition_clients row. Newly matched clients
    // (auto-matcher or /admin/ignition) flow through on the next 15-min
    // refresh without waiting for a proposal re-sync.
    const igcLinks = p.ignition_client_id ? igcInfo.get(p.ignition_client_id) : null
    const orgId: string | null =
      p.organization_id ?? (p.contact_id ? null : igcLinks?.organization_id ?? null)
    const contactId: string | null =
      p.contact_id ?? (orgId ? null : igcLinks?.contact_id ?? null)

    const linked =
      (orgId && orgInfo.get(orgId)) ||
      (contactId && contactInfo.get(contactId)) ||
      null
    const entity_kind: EnrichedProposal["entity_kind"] = orgId
      ? "organization"
      : contactId
      ? "contact"
      : null

    // State/city resolution: linked org/contact wins, then the original
    // Ignition client record. The state_source field tells the UI whether
    // the value came from an editable CRM record (org/contact) or from a
    // read-only Ignition import (fallback) so the inline edit can target
    // the right table.
    const igc = igcLinks
    let resolvedState: string | null = linked?.state ?? null
    let resolvedCity: string | null = linked?.city ?? null
    let resolvedCountry: string | null = linked?.country ?? null
    let stateSource: "organization" | "contact" | "ignition_client" | null = null
    if (resolvedState && orgId && linked === orgInfo.get(orgId)) {
      stateSource = "organization"
    } else if (resolvedState && contactId && linked === contactInfo.get(contactId)) {
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
      organization_id: orgId,
      contact_id: contactId,
      entity_kind,
      state: resolvedState,
      city: resolvedCity,
      country: resolvedCountry,
      state_source: stateSource,
      ignition_client_id: p.ignition_client_id ?? null,
      ignition_url: p.ignition_url ?? null,
      client_tags: Array.isArray(p.client_tags) ? p.client_tags : [],
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
    if (clientTagFilter.length) {
      const has =
        p.client_tags.length === 0
          ? clientTagFilter.includes("(untagged)")
          : p.client_tags.some((t) => clientTagFilter.includes(t))
      if (!has) return false
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
  const clientTags = Array.from(
    new Set(enriched.flatMap((p) => p.client_tags)),
  ).sort()

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
  // The table already holds ~1.7k paid rows, past PostgREST's 1,000-row
  // response cap — page through the window instead of trusting .limit().
  const buildPaymentsQuery = () => {
    let payQ = supabase
      .from("ignition_payments")
      .select(
        "ignition_payment_id, amount, fees, net_amount, paid_at, ignition_client_id",
      )
      .not("paid_at", "is", null)
    if (startDate) payQ = payQ.gte("paid_at", startDate)
    if (endDate) payQ = payQ.lte("paid_at", endDate + "T23:59:59")
    return payQ
  }
  let payments: PaymentRow[] = []
  try {
    payments = await fetchAllPaged<PaymentRow>(buildPaymentsQuery)
  } catch (payErr) {
    // Matches the previous error-ignoring destructure: a payments failure
    // degrades the payouts card to zeros instead of failing the dashboard.
    console.error("[sales-dashboard] payments query failed:", payErr)
  }

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

  // ── Invoice payment-state roll-up (migration 377 fields) ──────────────
  // Scoped to Reporting-API rows only (payment_state is always set on
  // them). The table also holds legacy `csv:`-prefixed import rows —
  // including *scheduled future* billing placeholders out to 2028 — that
  // would double-count the same real-world invoices and inflate "billed"
  // with money that hasn't been invoiced yet. The API gives amount +
  // payment_state but no paid/outstanding split, so outstanding is
  // derived: unpaid/partially_paid invoices count their full amount.
  // Voided invoices are excluded — they're cancellations, not revenue.
  type InvoiceRow = {
    payment_state: string | null
    amount: number | null
    due_date: string | null
  }
  const buildInvoicesQuery = () => {
    let invQ = supabase
      .from("ignition_invoices")
      .select("payment_state, amount, due_date")
      .is("voided_at", null)
      .not("payment_state", "is", null)
    if (startDate) invQ = invQ.gte("invoice_date", startDate)
    if (endDate) invQ = invQ.lte("invoice_date", endDate)
    return invQ
  }
  let invoiceRows: InvoiceRow[] = []
  try {
    invoiceRows = await fetchAllPaged<InvoiceRow>(buildInvoicesQuery)
  } catch (invErr) {
    // Same degrade-to-zeros contract as the payments query.
    console.error("[sales-dashboard] invoices query failed:", invErr)
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  let invBilled = 0
  let invCollected = 0
  let invOutstanding = 0
  let invOverdue = 0
  let invOverdueCount = 0
  const invByState = { paid: 0, partially_paid: 0, unpaid: 0 }
  for (const inv of invoiceRows) {
    const amount = Number(inv.amount) || 0
    const ps = (inv.payment_state || "").toLowerCase()
    invBilled += amount
    if (ps === "paid") {
      invCollected += amount
    } else {
      invOutstanding += amount
      if (inv.due_date && inv.due_date < todayIso) {
        invOverdue += amount
        invOverdueCount += 1
      }
    }
    if (ps === "paid" || ps === "partially_paid" || ps === "unpaid") {
      invByState[ps as keyof typeof invByState] += 1
    }
  }
  const invoiceSummary = {
    count: invoiceRows.length,
    billed: round2(invBilled),
    collected: round2(invCollected),
    outstanding: round2(invOutstanding),
    overdue: round2(invOverdue),
    overdueCount: invOverdueCount,
    byPaymentState: invByState,
  }

  // ── Deals pipeline roll-up (ignition_deals, migration 377 fields) ─────
  // The pre-proposal pipeline: open deals grouped by stage with Ignition's
  // own stage win-likelihoods, so partners see what's brewing before a
  // proposal even exists. Small table (~50 rows) so one unfiltered read is
  // fine; deliberately NOT subject to the date-range filter because an
  // open deal is "current state", not history.
  type DealRow = {
    ignition_deal_id: string
    title: string | null
    status: string | null
    client_name: string | null
    stage_name: string | null
    stage_position: number | null
    stage_win_likelihood: number | null
    projected_value: number | null
    value: number | null
    owner_name: string | null
    current_stage_started_at: string | null
    ignition_url: string | null
  }
  let dealRows: DealRow[] = []
  try {
    const { data: deals } = await supabase
      .from("ignition_deals")
      .select(
        "ignition_deal_id, title, status, client_name, stage_name, stage_position, stage_win_likelihood, projected_value, value, owner_name, current_stage_started_at, ignition_url",
      )
      .eq("status", "open")
    dealRows = (deals ?? []) as DealRow[]
  } catch (dealErr) {
    // Degrade to an empty pipeline rather than failing the dashboard.
    console.error("[sales-dashboard] deals query failed:", dealErr)
  }

  type DealStageBucket = {
    stage: string
    position: number
    winLikelihood: number | null
    count: number
    projectedValue: number
    /** projectedValue × the stage's win likelihood (0–1). */
    weightedValue: number
    deals: Array<{
      ignition_deal_id: string
      title: string | null
      client_name: string | null
      projected_value: number
      owner_name: string | null
      in_stage_since: string | null
      ignition_url: string | null
    }>
  }
  const dealStageMap = new Map<string, DealStageBucket>()
  for (const d of dealRows) {
    const stage = d.stage_name || "(no stage)"
    // stage_win_likelihood arrives as either a 0–1 fraction or a percent
    // depending on API vintage — normalize to a fraction.
    const rawWl = d.stage_win_likelihood
    const winLikelihood =
      rawWl == null ? null : rawWl > 1 ? Number(rawWl) / 100 : Number(rawWl)
    const projected = Number(d.projected_value ?? d.value) || 0
    const bucket = dealStageMap.get(stage) ?? {
      stage,
      position: d.stage_position ?? 999,
      winLikelihood,
      count: 0,
      projectedValue: 0,
      weightedValue: 0,
      deals: [],
    }
    bucket.count += 1
    bucket.projectedValue += projected
    bucket.weightedValue += projected * (winLikelihood ?? 0)
    bucket.deals.push({
      ignition_deal_id: d.ignition_deal_id,
      title: d.title,
      client_name: d.client_name,
      projected_value: projected,
      owner_name: d.owner_name,
      in_stage_since: d.current_stage_started_at,
      ignition_url: d.ignition_url,
    })
    dealStageMap.set(stage, bucket)
  }
  const dealStages = Array.from(dealStageMap.values())
    .sort((a, b) => a.position - b.position)
    .map((b) => ({
      ...b,
      projectedValue: round2(b.projectedValue),
      weightedValue: round2(b.weightedValue),
      deals: b.deals.sort((x, y) => y.projected_value - x.projected_value),
    }))
  const dealsSummary = {
    openCount: dealRows.length,
    projectedValue: round2(
      dealStages.reduce((s, b) => s + b.projectedValue, 0),
    ),
    weightedValue: round2(dealStages.reduce((s, b) => s + b.weightedValue, 0)),
    stages: dealStages,
  }

  // ── Client mapping coverage ────────────────────────────────────────────
  // Surfaced in the dashboard header so a partner can see at a glance
  // whether every proposal is attributed to a Hub client — and jump to
  // /admin/ignition to fix the stragglers when not.
  let linkedCount = 0
  for (const p of enriched) {
    if (p.organization_id || p.contact_id) linkedCount++
  }
  const clientCoverage = {
    total: enriched.length,
    linked: linkedCount,
    unlinked: enriched.length - linkedCount,
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
      clientTags,
    },
    serviceLines,
    stateBreakdown,
    // Invoice-anchored recurring roll-up — same computation as
    // /sales/recurring-revenue so the two surfaces always agree. Not
    // subject to the date-range filter: it's a current-state snapshot of
    // what's actually billing.
    recurringSummary,
    // Payouts (collected cash) roll-up for the same date window as the
    // proposals — see comment block above for why this comes from
    // ignition_payments rather than ignition_disbursals.
    payouts: payoutsSummary,
    // Billed / collected / outstanding roll-up from ignition_invoices'
    // payment-lifecycle fields, same window as the proposals.
    invoiceSummary,
    // Open pre-proposal pipeline from ignition_deals, grouped by stage
    // with Ignition's stage win-likelihoods. Current-state snapshot —
    // not subject to the date filter.
    dealsSummary,
    // How many proposals resolve to a Hub client (directly or via the
    // ignition_clients fallback) — drives the header coverage indicator.
    clientCoverage,
    // Server clock at response time — the client renders this as the
    // "Updated …" stamp so it reflects data freshness, not render time.
    generatedAt: new Date().toISOString(),
  })
}
