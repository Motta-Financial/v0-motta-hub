/**
 * Client Profile Library (Hub-master)
 *
 * Mirrors lib/tax/profile.ts but for the Hub master client (contacts.id OR
 * organizations.id). Provides:
 *
 *   - computeClientProfile(clientId)    — recompute & cache the summary
 *   - getClientProfile(clientId)        — fast read; auto-recomputes if stale
 *   - markClientProfileStale(clientId)  — fire-and-forget invalidation hook
 *   - searchClientProfiles(query)       — ALFRED-friendly fuzzy lookup
 *
 * The summary is intentionally denormalized so ALFRED can answer "who is this
 * client?" with a single SELECT instead of 8 joins.
 */

import { createAdminClient } from "@/lib/supabase/server"

// ============================================================================
// Types
// ============================================================================

export type ClientKind = "contact" | "organization"

export type ClientProfileSummary = {
  clientId: string
  clientKind: ClientKind

  // Identity
  displayName: string | null
  clientType: string | null
  primaryEmail: string | null
  phonePrimary: string | null
  city: string | null
  state: string | null
  status: string | null
  isProspect: boolean

  // Cross-system identifiers
  legacyMottaClientId: string | null
  karbonContactKey: string | null
  karbonOrganizationKey: string | null
  ignitionClientId: string | null
  proconnectClientId: string | null
  userDefinedIdentifier: string | null

  // Owners
  clientOwnerId: string | null
  clientOwnerName: string | null
  clientManagerId: string | null
  clientManagerName: string | null

  // Work items
  totalWorkItems: number
  openWorkItems: number
  completedWorkItems: number
  overdueWorkItems: number
  nextDueDate: string | null
  nextDueWorkItemTitle: string | null
  nextDueWorkItemId: string | null
  activeWorkTypes: string[]

  // Debriefs
  totalDebriefs: number
  lastDebriefDate: string | null
  lastDebriefType: string | null
  lastDebriefNotes: string | null
  lastDebriefId: string | null
  openActionItems: number

  // Communications
  totalCalendlyEvents: number
  totalZoomMeetings: number
  lastMeetingAt: string | null
  nextMeetingAt: string | null

  // Proposals
  totalProposals: number
  activeProposals: number
  proposalsTotalValue: number
  proposalsRecurringTotal: number
  recurringFrequency: string | null

  // Invoices
  totalInvoices: number
  invoicesTotal: number
  invoicesPaid: number
  invoicesOutstanding: number
  lastInvoiceDate: string | null
  lastPaymentDate: string | null
  lifetimeRevenue: number

  // Tags / categorization
  tags: string[]

  // AI
  aiSummary: string | null
  aiKeywords: string[]

  // Quality
  profileCompleteness: number
  needsAttention: boolean
  attentionReasons: string[]

  // Stamps
  computedAt: string
  staleAt: string | null
}

export type ClientProfileSearchResult = {
  clientId: string
  clientKind: ClientKind
  displayName: string | null
  primaryEmail: string | null
  city: string | null
  state: string | null
  clientType: string | null
  totalWorkItems: number
  openWorkItems: number
  lifetimeRevenue: number
  aiSummary: string | null
  matchScore: number
  matchedOn: string[]
}

// ============================================================================
// Resolve which kind of client we have (contact vs organization)
// ============================================================================

async function resolveClientKind(clientId: string): Promise<ClientKind | null> {
  const supabase = createAdminClient()

  const [{ data: contact }, { data: org }] = await Promise.all([
    supabase.from("contacts").select("id").eq("id", clientId).maybeSingle(),
    supabase.from("organizations").select("id").eq("id", clientId).maybeSingle(),
  ])

  if (contact) return "contact"
  if (org) return "organization"
  return null
}

// ============================================================================
// Compute profile
// ============================================================================

/**
 * Recompute the summary for a Hub master client and upsert into
 * client_profile_summaries. Safe to call concurrently — UPSERT keeps the row
 * consistent.
 *
 * Returns the freshly computed summary, or null if the client doesn't exist.
 */
export async function computeClientProfile(
  clientId: string,
): Promise<ClientProfileSummary | null> {
  const supabase = createAdminClient()

  const kind = await resolveClientKind(clientId)
  if (!kind) {
    console.error("[v0] computeClientProfile: client not found", clientId)
    return null
  }

  // ── Identity ────────────────────────────────────────────────────────────
  let displayName: string | null = null
  let clientType: string | null = null
  let primaryEmail: string | null = null
  let phonePrimary: string | null = null
  let city: string | null = null
  let state: string | null = null
  let status: string | null = null
  let isProspect = false
  let legacyMottaClientId: string | null = null
  let karbonContactKey: string | null = null
  let karbonOrganizationKey: string | null = null
  let userDefinedIdentifier: string | null = null
  let clientOwnerId: string | null = null
  let clientManagerId: string | null = null
  let tags: string[] = []
  let firstName: string | null = null
  let lastName: string | null = null
  let businessName: string | null = null

  if (kind === "contact") {
    const { data: c } = await supabase
      .from("contacts")
      .select(
        "id, full_name, first_name, last_name, contact_type, primary_email, phone_primary, city, state, status, is_prospect, legacy_motta_client_id, karbon_contact_key, user_defined_identifier, client_owner_id, client_manager_id, tags",
      )
      .eq("id", clientId)
      .single()
    if (!c) return null
    displayName = c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || null
    clientType = c.contact_type
    primaryEmail = c.primary_email
    phonePrimary = c.phone_primary
    city = c.city
    state = c.state
    status = c.status
    isProspect = !!c.is_prospect
    legacyMottaClientId = c.legacy_motta_client_id
    karbonContactKey = c.karbon_contact_key
    userDefinedIdentifier = c.user_defined_identifier
    clientOwnerId = c.client_owner_id
    clientManagerId = c.client_manager_id
    tags = Array.isArray(c.tags) ? c.tags : []
    firstName = c.first_name
    lastName = c.last_name
  } else {
    const { data: o } = await supabase
      .from("organizations")
      .select(
        "id, name, legal_name, entity_type, primary_email, phone, city, state, status, karbon_organization_key, user_defined_identifier, tags",
      )
      .eq("id", clientId)
      .single()
    if (!o) return null
    displayName = o.name || o.legal_name
    clientType = o.entity_type
    primaryEmail = o.primary_email
    phonePrimary = o.phone
    city = o.city
    state = o.state
    status = o.status
    karbonOrganizationKey = o.karbon_organization_key
    userDefinedIdentifier = o.user_defined_identifier
    tags = Array.isArray(o.tags) ? o.tags : []
    businessName = displayName
  }

  // ── Work items ──────────────────────────────────────────────────────────
  const workItemFilter =
    kind === "contact" ? { contact_id: clientId } : { organization_id: clientId }
  const { data: workItems } = await supabase
    .from("work_items")
    .select(
      "id, title, work_type, status, primary_status, secondary_status, due_date, completed_date, assignee_name, client_owner_name, client_manager_name, fixed_fee_amount, actual_fee, estimated_fee",
    )
    .match(workItemFilter)

  const today = new Date().toISOString().slice(0, 10)
  const items = workItems || []
  const openItems = items.filter(
    (w) =>
      !w.completed_date &&
      (w.primary_status?.toLowerCase() !== "completed" || w.completed_date == null),
  )
  const completedItems = items.filter((w) => !!w.completed_date)
  const overdueItems = openItems.filter((w) => w.due_date && w.due_date < today)
  const upcomingDueItems = openItems
    .filter((w) => w.due_date && w.due_date >= today)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))

  const nextDueItem = upcomingDueItems[0] || overdueItems.sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0] || null
  const activeWorkTypes = [...new Set(openItems.map((w) => w.work_type).filter(Boolean) as string[])]

  // Owners (fall back to first work item if no contact-level FK)
  let clientOwnerName: string | null = null
  let clientManagerName: string | null = null
  if (items[0]) {
    clientOwnerName = items[0].client_owner_name || null
    clientManagerName = items[0].client_manager_name || null
  }

  // ── Debriefs ────────────────────────────────────────────────────────────
  const debriefFilter =
    kind === "contact" ? { contact_id: clientId } : { organization_id: clientId }
  const { data: debriefs } = await supabase
    .from("debriefs")
    .select("id, debrief_date, debrief_type, notes, action_items")
    .match(debriefFilter)
    .order("debrief_date", { ascending: false, nullsFirst: false })

  const debriefList = debriefs || []
  const lastDebrief = debriefList[0] || null
  let openActionItems = 0
  for (const d of debriefList) {
    const ai = d.action_items as { items?: { status?: string }[] } | null
    if (ai?.items?.length) {
      for (const item of ai.items) {
        if (item.status !== "completed" && item.status !== "done") openActionItems++
      }
    }
  }

  // ── Communications (Calendly + Zoom) ────────────────────────────────────
  const commFilter =
    kind === "contact" ? { contact_id: clientId } : { organization_id: clientId }

  const [{ data: calLinks }, { data: zoomLinks }] = await Promise.all([
    supabase.from("calendly_event_clients").select("calendly_event_id").match(commFilter),
    supabase.from("zoom_meeting_clients").select("zoom_meeting_id").match(commFilter),
  ])

  const calIds = (calLinks || []).map((r) => r.calendly_event_id).filter(Boolean)
  const zoomIds = (zoomLinks || []).map((r) => r.zoom_meeting_id).filter(Boolean)

  const [{ data: calEvents }, { data: zoomMeetings }] = await Promise.all([
    calIds.length
      ? supabase
          .from("calendly_events")
          .select("id, start_time, status")
          .in("id", calIds)
      : Promise.resolve({ data: [] as { id: string; start_time: string | null; status: string | null }[] }),
    zoomIds.length
      ? supabase
          .from("zoom_meetings")
          .select("id, start_time, status")
          .in("id", zoomIds)
      : Promise.resolve({ data: [] as { id: string; start_time: string | null; status: string | null }[] }),
  ])

  const allMeetingTimes: { at: string; future: boolean }[] = []
  const nowIso = new Date().toISOString()
  for (const e of (calEvents || []) as { start_time: string | null; status: string | null }[]) {
    if (!e.start_time) continue
    if (e.status && /cancel/i.test(e.status)) continue
    allMeetingTimes.push({ at: e.start_time, future: e.start_time > nowIso })
  }
  for (const m of (zoomMeetings || []) as { start_time: string | null; status: string | null }[]) {
    if (!m.start_time) continue
    allMeetingTimes.push({ at: m.start_time, future: m.start_time > nowIso })
  }
  allMeetingTimes.sort((a, b) => (a.at < b.at ? -1 : 1))
  const past = allMeetingTimes.filter((m) => !m.future)
  const future = allMeetingTimes.filter((m) => m.future)
  const lastMeetingAt = past[past.length - 1]?.at || null
  const nextMeetingAt = future[0]?.at || null

  // ── Financial: Ignition proposals ───────────────────────────────────────
  const propFilter =
    kind === "contact" ? { contact_id: clientId } : { organization_id: clientId }
  const { data: proposals } = await supabase
    .from("ignition_proposals")
    .select(
      "proposal_id, status, total_value, recurring_total, recurring_frequency, ignition_client_id",
    )
    .match(propFilter)

  const propList = proposals || []
  const activeProposals = propList.filter((p) =>
    /accepted|active|in_progress|signed/i.test(p.status || ""),
  )
  const proposalsTotalValue = propList.reduce(
    (sum, p) => sum + (Number(p.total_value) || 0),
    0,
  )
  const proposalsRecurringTotal = activeProposals.reduce(
    (sum, p) => sum + (Number(p.recurring_total) || 0),
    0,
  )
  // pick most common recurring frequency from active proposals
  const freqCounts: Record<string, number> = {}
  for (const p of activeProposals) {
    if (p.recurring_frequency) freqCounts[p.recurring_frequency] = (freqCounts[p.recurring_frequency] || 0) + 1
  }
  const recurringFrequency =
    Object.entries(freqCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const ignitionClientId = propList.find((p) => p.ignition_client_id)?.ignition_client_id || null

  // ── Financial: invoices (Karbon + Ignition) ─────────────────────────────
  const invFilter =
    kind === "contact" ? { contact_id: clientId } : { organization_id: clientId }

  const [{ data: kInv }, { data: igInv }] = await Promise.all([
    supabase
      .from("karbon_invoices")
      .select("id, total_amount, status, issued_date, paid_date")
      .match(invFilter),
    supabase
      .from("ignition_invoices")
      .select("ignition_invoice_id, amount, amount_paid, status, invoice_date, paid_at")
      .match(invFilter),
  ])

  const allInvoices = [
    ...(kInv || []).map((i) => ({
      total: Number(i.total_amount) || 0,
      paid: /paid/i.test(i.status || "") ? Number(i.total_amount) || 0 : 0,
      issued: i.issued_date,
      paidAt: i.paid_date,
      status: i.status,
    })),
    ...(igInv || []).map((i) => ({
      total: Number(i.amount) || 0,
      paid: Number(i.amount_paid) || 0,
      issued: i.invoice_date,
      paidAt: i.paid_at,
      status: i.status,
    })),
  ]
  const invoicesTotal = allInvoices.reduce((s, i) => s + i.total, 0)
  const invoicesPaid = allInvoices.reduce((s, i) => s + i.paid, 0)
  const invoicesOutstanding = Math.max(0, invoicesTotal - invoicesPaid)
  const issuedDates = allInvoices.map((i) => i.issued).filter(Boolean) as string[]
  const paidDates = allInvoices.map((i) => i.paidAt).filter(Boolean) as string[]
  issuedDates.sort()
  paidDates.sort()
  const lastInvoiceDate = issuedDates[issuedDates.length - 1] || null
  const lastPaymentDate = paidDates[paidDates.length - 1] || null

  const lifetimeRevenue = invoicesPaid

  // ── Cross-system: ProConnect ────────────────────────────────────────────
  // Resolve via legacy_motta_client_id -> proconnect_clients
  let proconnectClientId: string | null = null
  if (legacyMottaClientId) {
    const { data: pc } = await supabase
      .from("proconnect_clients")
      .select("proconnect_client_id")
      .eq("legacy_motta_client_id", legacyMottaClientId)
      .maybeSingle()
    proconnectClientId = pc?.proconnect_client_id || null
  }

  // ── Quality / attention ─────────────────────────────────────────────────
  let completeness = 0
  if (displayName) completeness += 20
  if (primaryEmail) completeness += 15
  if (phonePrimary) completeness += 10
  if (legacyMottaClientId) completeness += 10
  if (items.length > 0) completeness += 15
  if (debriefList.length > 0) completeness += 10
  if (allInvoices.length > 0) completeness += 10
  if (clientOwnerName || clientManagerName) completeness += 10

  const attentionReasons: string[] = []
  if (!primaryEmail) attentionReasons.push("Missing email")
  if (!phonePrimary) attentionReasons.push("Missing phone")
  if (overdueItems.length > 0) attentionReasons.push(`${overdueItems.length} overdue work item(s)`)
  if (openActionItems > 0) attentionReasons.push(`${openActionItems} open action item(s)`)
  if (invoicesOutstanding > 0) attentionReasons.push(`$${invoicesOutstanding.toLocaleString()} outstanding`)
  if (!clientOwnerName && !clientManagerName) attentionReasons.push("No owner/manager assigned")

  const aiSummary = generateAiSummary({
    displayName,
    isProspect,
    kind,
    openWorkItems: openItems.length,
    totalDebriefs: debriefList.length,
    lifetimeRevenue,
    activeProposals: activeProposals.length,
    clientOwnerName,
    nextDueItem,
    lastMeetingAt,
  })
  const aiKeywords = generateKeywords({
    displayName,
    firstName,
    lastName,
    businessName,
    state,
    city,
    activeWorkTypes,
    tags,
  })

  const summary: ClientProfileSummary = {
    clientId,
    clientKind: kind,
    displayName,
    clientType,
    primaryEmail,
    phonePrimary,
    city,
    state,
    status,
    isProspect,
    legacyMottaClientId,
    karbonContactKey,
    karbonOrganizationKey,
    ignitionClientId,
    proconnectClientId,
    userDefinedIdentifier,
    clientOwnerId,
    clientOwnerName,
    clientManagerId,
    clientManagerName,
    totalWorkItems: items.length,
    openWorkItems: openItems.length,
    completedWorkItems: completedItems.length,
    overdueWorkItems: overdueItems.length,
    nextDueDate: nextDueItem?.due_date || null,
    nextDueWorkItemTitle: nextDueItem?.title || null,
    nextDueWorkItemId: nextDueItem?.id || null,
    activeWorkTypes,
    totalDebriefs: debriefList.length,
    lastDebriefDate: lastDebrief?.debrief_date || null,
    lastDebriefType: lastDebrief?.debrief_type || null,
    lastDebriefNotes: lastDebrief?.notes ? lastDebrief.notes.slice(0, 500) : null,
    lastDebriefId: lastDebrief?.id || null,
    openActionItems,
    totalCalendlyEvents: (calEvents || []).length,
    totalZoomMeetings: (zoomMeetings || []).length,
    lastMeetingAt,
    nextMeetingAt,
    totalProposals: propList.length,
    activeProposals: activeProposals.length,
    proposalsTotalValue,
    proposalsRecurringTotal,
    recurringFrequency,
    totalInvoices: allInvoices.length,
    invoicesTotal,
    invoicesPaid,
    invoicesOutstanding,
    lastInvoiceDate,
    lastPaymentDate,
    lifetimeRevenue,
    tags,
    aiSummary,
    aiKeywords,
    profileCompleteness: Math.min(100, completeness),
    needsAttention: attentionReasons.length > 0,
    attentionReasons,
    computedAt: new Date().toISOString(),
    staleAt: null,
  }

  // ── Persist (UPSERT) ────────────────────────────────────────────────────
  const { error: upsertErr } = await supabase
    .from("client_profile_summaries")
    .upsert(
      {
        client_id: summary.clientId,
        client_kind: summary.clientKind,
        display_name: summary.displayName,
        client_type: summary.clientType,
        primary_email: summary.primaryEmail,
        phone_primary: summary.phonePrimary,
        city: summary.city,
        state: summary.state,
        status: summary.status,
        is_prospect: summary.isProspect,
        legacy_motta_client_id: summary.legacyMottaClientId,
        karbon_contact_key: summary.karbonContactKey,
        karbon_organization_key: summary.karbonOrganizationKey,
        ignition_client_id: summary.ignitionClientId,
        proconnect_client_id: summary.proconnectClientId,
        user_defined_identifier: summary.userDefinedIdentifier,
        client_owner_id: summary.clientOwnerId,
        client_owner_name: summary.clientOwnerName,
        client_manager_id: summary.clientManagerId,
        client_manager_name: summary.clientManagerName,
        total_work_items: summary.totalWorkItems,
        open_work_items: summary.openWorkItems,
        completed_work_items: summary.completedWorkItems,
        overdue_work_items: summary.overdueWorkItems,
        next_due_date: summary.nextDueDate,
        next_due_work_item_title: summary.nextDueWorkItemTitle,
        next_due_work_item_id: summary.nextDueWorkItemId,
        active_work_types: summary.activeWorkTypes,
        total_debriefs: summary.totalDebriefs,
        last_debrief_date: summary.lastDebriefDate,
        last_debrief_type: summary.lastDebriefType,
        last_debrief_notes: summary.lastDebriefNotes,
        last_debrief_id: summary.lastDebriefId,
        open_action_items: summary.openActionItems,
        total_calendly_events: summary.totalCalendlyEvents,
        total_zoom_meetings: summary.totalZoomMeetings,
        last_meeting_at: summary.lastMeetingAt,
        next_meeting_at: summary.nextMeetingAt,
        total_proposals: summary.totalProposals,
        active_proposals: summary.activeProposals,
        proposals_total_value: summary.proposalsTotalValue,
        proposals_recurring_total: summary.proposalsRecurringTotal,
        recurring_frequency: summary.recurringFrequency,
        total_invoices: summary.totalInvoices,
        invoices_total: summary.invoicesTotal,
        invoices_paid: summary.invoicesPaid,
        invoices_outstanding: summary.invoicesOutstanding,
        last_invoice_date: summary.lastInvoiceDate,
        last_payment_date: summary.lastPaymentDate,
        lifetime_revenue: summary.lifetimeRevenue,
        tags: summary.tags,
        ai_summary: summary.aiSummary,
        ai_keywords: summary.aiKeywords,
        profile_completeness: summary.profileCompleteness,
        needs_attention: summary.needsAttention,
        attention_reasons: summary.attentionReasons,
        computed_at: summary.computedAt,
        stale_at: null,
      },
      { onConflict: "client_id,client_kind" },
    )

  if (upsertErr) {
    console.error("[v0] computeClientProfile upsert failed:", upsertErr.message)
  }

  return summary
}

// ============================================================================
// Read profile (uses cache, recomputes if stale)
// ============================================================================

export type GetProfileOptions = {
  /** force a recompute even if the cached row is fresh */
  recompute?: boolean
  /** how many seconds after `computed_at` we should consider the row stale enough to refresh on read; default 600 */
  maxAgeSeconds?: number
}

export async function getClientProfile(
  clientId: string,
  options: GetProfileOptions = {},
): Promise<ClientProfileSummary | null> {
  const { recompute = false, maxAgeSeconds = 600 } = options
  const supabase = createAdminClient()

  if (recompute) return computeClientProfile(clientId)

  const { data: cached } = await supabase
    .from("client_profile_summaries")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle()

  if (!cached) return computeClientProfile(clientId)

  // Stale if explicitly marked or older than maxAgeSeconds
  const isStale =
    !!cached.stale_at ||
    Date.now() - new Date(cached.computed_at).getTime() > maxAgeSeconds * 1000

  if (isStale) return computeClientProfile(clientId)

  return rowToSummary(cached)
}

/**
 * Mark the cached profile as stale so the next read recomputes. Cheap — used
 * as a fire-and-forget hook from anywhere that mutates client-related data.
 */
export async function markClientProfileStale(clientId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("client_profile_summaries")
    .update({ stale_at: new Date().toISOString() })
    .eq("client_id", clientId)
}

/**
 * Mark profiles stale by either contact_id or organization_id. Convenience for
 * write-time hooks that have a work_item / debrief in hand.
 */
export async function markClientProfilesStaleForRefs(
  refs: { contactId?: string | null; organizationId?: string | null }[],
): Promise<void> {
  const ids = new Set<string>()
  for (const r of refs) {
    if (r.contactId) ids.add(r.contactId)
    if (r.organizationId) ids.add(r.organizationId)
  }
  if (ids.size === 0) return
  const supabase = createAdminClient()
  await supabase
    .from("client_profile_summaries")
    .update({ stale_at: new Date().toISOString() })
    .in("client_id", [...ids])
}

// ============================================================================
// Search
// ============================================================================

export async function searchClientProfiles(
  query: string,
  options: { limit?: number } = {},
): Promise<ClientProfileSearchResult[]> {
  const { limit = 10 } = options
  const supabase = createAdminClient()
  const q = query.trim().toLowerCase()
  if (!q) return []

  const isEmail = q.includes("@")
  const isLegacy = /^[A-Z]{2}_/i.test(query)

  const out: ClientProfileSearchResult[] = []
  const seen = new Set<string>()

  // 1. Exact: legacy id
  if (isLegacy) {
    const { data } = await supabase
      .from("client_profile_summaries")
      .select("*")
      .ilike("legacy_motta_client_id", query.toUpperCase())
      .limit(limit)
    for (const row of data || []) {
      if (seen.has(row.client_id)) continue
      seen.add(row.client_id)
      out.push(mapSearch(row, 100, ["legacy_id"]))
    }
  }

  // 2. Exact: email
  if (isEmail && out.length < limit) {
    const { data } = await supabase
      .from("client_profile_summaries")
      .select("*")
      .eq("search_email", q)
      .limit(limit - out.length)
    for (const row of data || []) {
      if (seen.has(row.client_id)) continue
      seen.add(row.client_id)
      out.push(mapSearch(row, 100, ["email"]))
    }
  }

  // 3. Trigram name match
  if (out.length < limit && !isEmail) {
    const { data } = await supabase
      .from("client_profile_summaries")
      .select("*")
      .ilike("search_name", `%${q}%`)
      .limit(limit - out.length)
    for (const row of data || []) {
      if (seen.has(row.client_id)) continue
      seen.add(row.client_id)
      out.push(mapSearch(row, 70, ["name"]))
    }
  }

  out.sort((a, b) => b.matchScore - a.matchScore)
  return out.slice(0, limit)
}

// ============================================================================
// Helpers
// ============================================================================

function mapSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  score: number,
  matchedOn: string[],
): ClientProfileSearchResult {
  return {
    clientId: row.client_id,
    clientKind: row.client_kind,
    displayName: row.display_name,
    primaryEmail: row.primary_email,
    city: row.city,
    state: row.state,
    clientType: row.client_type,
    totalWorkItems: row.total_work_items || 0,
    openWorkItems: row.open_work_items || 0,
    lifetimeRevenue: Number(row.lifetime_revenue) || 0,
    aiSummary: row.ai_summary,
    matchScore: score,
    matchedOn,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSummary(r: any): ClientProfileSummary {
  return {
    clientId: r.client_id,
    clientKind: r.client_kind,
    displayName: r.display_name,
    clientType: r.client_type,
    primaryEmail: r.primary_email,
    phonePrimary: r.phone_primary,
    city: r.city,
    state: r.state,
    status: r.status,
    isProspect: !!r.is_prospect,
    legacyMottaClientId: r.legacy_motta_client_id,
    karbonContactKey: r.karbon_contact_key,
    karbonOrganizationKey: r.karbon_organization_key,
    ignitionClientId: r.ignition_client_id,
    proconnectClientId: r.proconnect_client_id,
    userDefinedIdentifier: r.user_defined_identifier,
    clientOwnerId: r.client_owner_id,
    clientOwnerName: r.client_owner_name,
    clientManagerId: r.client_manager_id,
    clientManagerName: r.client_manager_name,
    totalWorkItems: r.total_work_items || 0,
    openWorkItems: r.open_work_items || 0,
    completedWorkItems: r.completed_work_items || 0,
    overdueWorkItems: r.overdue_work_items || 0,
    nextDueDate: r.next_due_date,
    nextDueWorkItemTitle: r.next_due_work_item_title,
    nextDueWorkItemId: r.next_due_work_item_id,
    activeWorkTypes: r.active_work_types || [],
    totalDebriefs: r.total_debriefs || 0,
    lastDebriefDate: r.last_debrief_date,
    lastDebriefType: r.last_debrief_type,
    lastDebriefNotes: r.last_debrief_notes,
    lastDebriefId: r.last_debrief_id,
    openActionItems: r.open_action_items || 0,
    totalCalendlyEvents: r.total_calendly_events || 0,
    totalZoomMeetings: r.total_zoom_meetings || 0,
    lastMeetingAt: r.last_meeting_at,
    nextMeetingAt: r.next_meeting_at,
    totalProposals: r.total_proposals || 0,
    activeProposals: r.active_proposals || 0,
    proposalsTotalValue: Number(r.proposals_total_value) || 0,
    proposalsRecurringTotal: Number(r.proposals_recurring_total) || 0,
    recurringFrequency: r.recurring_frequency,
    totalInvoices: r.total_invoices || 0,
    invoicesTotal: Number(r.invoices_total) || 0,
    invoicesPaid: Number(r.invoices_paid) || 0,
    invoicesOutstanding: Number(r.invoices_outstanding) || 0,
    lastInvoiceDate: r.last_invoice_date,
    lastPaymentDate: r.last_payment_date,
    lifetimeRevenue: Number(r.lifetime_revenue) || 0,
    tags: r.tags || [],
    aiSummary: r.ai_summary,
    aiKeywords: r.ai_keywords || [],
    profileCompleteness: r.profile_completeness || 0,
    needsAttention: !!r.needs_attention,
    attentionReasons: r.attention_reasons || [],
    computedAt: r.computed_at,
    staleAt: r.stale_at,
  }
}

function generateAiSummary(input: {
  displayName: string | null
  isProspect: boolean
  kind: ClientKind
  openWorkItems: number
  totalDebriefs: number
  lifetimeRevenue: number
  activeProposals: number
  clientOwnerName: string | null
  nextDueItem: { title: string; due_date: string | null } | null | undefined
  lastMeetingAt: string | null
}): string {
  const name = input.displayName || (input.kind === "organization" ? "This organization" : "This client")
  const role = input.isProspect ? "prospect" : input.kind === "organization" ? "organization" : "individual client"
  const article = /^[aeiou]/i.test(role) ? "an" : "a"
  const parts: string[] = [`${name} is ${article} ${role}.`]

  if (input.openWorkItems > 0) {
    parts.push(`${input.openWorkItems} open work item${input.openWorkItems === 1 ? "" : "s"}.`)
  }

  if (input.nextDueItem?.title && input.nextDueItem.due_date) {
    parts.push(`Next due: "${input.nextDueItem.title}" on ${input.nextDueItem.due_date}.`)
  }

  if (input.activeProposals > 0) {
    parts.push(`${input.activeProposals} active proposal${input.activeProposals === 1 ? "" : "s"}.`)
  }

  if (input.lifetimeRevenue > 0) {
    parts.push(`Lifetime revenue: $${Math.round(input.lifetimeRevenue).toLocaleString()}.`)
  }

  if (input.clientOwnerName) parts.push(`Owner: ${input.clientOwnerName}.`)
  if (input.lastMeetingAt) parts.push(`Last meeting: ${input.lastMeetingAt.slice(0, 10)}.`)
  if (input.totalDebriefs > 0) {
    parts.push(`${input.totalDebriefs} debrief${input.totalDebriefs === 1 ? "" : "s"} on file.`)
  }

  return parts.join(" ")
}

function generateKeywords(input: {
  displayName: string | null
  firstName: string | null
  lastName: string | null
  businessName: string | null
  state: string | null
  city: string | null
  activeWorkTypes: string[]
  tags: string[]
}): string[] {
  const out = new Set<string>()
  for (const v of [
    input.firstName,
    input.lastName,
    input.businessName,
    input.state,
    input.city,
    ...input.activeWorkTypes,
    ...input.tags,
  ]) {
    if (!v) continue
    for (const part of String(v).toLowerCase().split(/\s+/)) {
      if (part) out.add(part)
    }
  }
  return [...out]
}
