import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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

// ─── State normalization ────────────────────────────────────────────────
// CSV imports use a mix of "MA" and "Massachusetts". The dashboard groups by
// state, so we collapse both forms to the 2-letter postal abbreviation.
const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  dc: "DC",
}
function normState(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  if (trimmed.length === 2) return trimmed.toUpperCase()
  const lower = trimmed.toLowerCase()
  return STATE_ABBR[lower] ?? trimmed.toUpperCase()
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sp = url.searchParams

  // ── Filters from query string ──────────────────────────────────────────
  // All filters are optional. Multi-value filters are comma-separated.
  const dateField = (sp.get("dateField") || "created_at") as
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
       organization_id, contact_id,
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
  if (startDate) q = q.gte(dateField, startDate)
  if (endDate) q = q.lte(dateField, endDate + "T23:59:59")
  if (statusFilter.length) q = q.in("status", statusFilter)
  if (partnerFilter.length) q = q.in("client_partner", partnerFilter)
  if (managerFilter.length) q = q.in("client_manager", managerFilter)
  if (sentByFilter.length) q = q.in("proposal_sent_by", sentByFilter)

  q = q.order(dateField, { ascending: false, nullsFirst: false })

  const { data: proposals, error } = await q

  if (error) {
    console.error("[sales-dashboard] proposals query failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Resolve states via the linked org/contact ─────────────────────────
  // Only fetch the org/contact rows we actually need.
  const orgIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const p of proposals ?? []) {
    if (p.organization_id) orgIds.add(p.organization_id)
    if (p.contact_id) contactIds.add(p.contact_id)
  }

  type EntityInfo = { state: string | null; city: string | null; country: string | null; name: string }
  const orgInfo = new Map<string, EntityInfo>()
  const contactInfo = new Map<string, EntityInfo>()

  if (orgIds.size) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, state, city, country")
      .in("id", Array.from(orgIds))
    for (const o of orgs ?? []) {
      orgInfo.set(o.id, {
        state: normState(o.state),
        city: o.city,
        country: o.country,
        name: o.name,
      })
    }
  }
  if (contactIds.size) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, full_name, state, city, country")
      .in("id", Array.from(contactIds))
    for (const ct of contacts ?? []) {
      contactInfo.set(ct.id, {
        state: normState(ct.state),
        city: ct.city,
        country: ct.country,
        name: ct.full_name,
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
    total_value: number
    one_time_total: number
    recurring_total: number
    recurring_frequency: string | null
    annualized_recurring: number
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
    const recurring = Number(p.recurring_total) || 0
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
      state: linked?.state ?? null,
      city: linked?.city ?? null,
      country: linked?.country ?? null,
      total_value: Number(p.total_value) || 0,
      one_time_total: Number(p.one_time_total) || 0,
      recurring_total: recurring,
      recurring_frequency: p.recurring_frequency,
      annualized_recurring: recurring * annualMultiplier,
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
      services: (p.services || []).map((s: any) => ({
        ...s,
        total_amount: Number(s.total_amount) || 0,
      })),
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
  })
}
