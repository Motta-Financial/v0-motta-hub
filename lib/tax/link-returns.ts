/**
 * Tax return linking — applies the deterministic matcher (return-matcher.ts)
 * against the database and persists results into `tax_return_links`.
 *
 * Used by:
 *   - the one-off backfill script (scripts/run-tax-return-linking.ts)
 *   - the nightly ProConnect sync (after engagements upsert)
 *   - the TaxReturn webhook (re-link a single engagement on create/update)
 *
 * Golden rule: NEVER overwrite a row whose link source is 'manual'. The matcher
 * only ever fills/refreshes rows that are 'none' or previously 'auto'.
 */

import { createAdminClient } from "@/lib/supabase/server"
import {
  matchEngagementToWorkItem,
  matchEngagementToProposalService,
  type EngagementLike,
  type WorkItemLike,
  type ProposalServiceLike,
} from "@/lib/tax/return-matcher"

type Supa = ReturnType<typeof createAdminClient>

export interface LinkResult {
  processed: number
  linked: number
  needsReview: number
  noMatch: number
  skippedManual: number
}

function emptyResult(): LinkResult {
  return { processed: 0, linked: 0, needsReview: 0, noMatch: 0, skippedManual: 0 }
}

// Fetch the TAX work items for a Hub client (org preferred, contact fallback).
async function fetchClientWorkItems(
  supabase: Supa,
  orgId: string | null,
  contactId: string | null,
): Promise<WorkItemLike[]> {
  let query = supabase
    .from("work_items")
    .select("id, karbon_work_item_key, work_template_name, title, tax_year")
    .ilike("work_template_name", "TAX |%")
    .is("deleted_in_karbon_at", null)

  if (orgId) query = query.eq("organization_id", orgId)
  else if (contactId) query = query.eq("contact_id", contactId)
  else return []

  const { data, error } = await query
  if (error) throw new Error(`work_items fetch failed: ${error.message}`)
  return (data ?? []) as WorkItemLike[]
}

// Fetch the client's Ignition proposal services (across all their proposals).
async function fetchClientProposalServices(
  supabase: Supa,
  orgId: string | null,
  contactId: string | null,
): Promise<ProposalServiceLike[]> {
  let propQuery = supabase.from("ignition_proposals").select("proposal_id")
  if (orgId) propQuery = propQuery.eq("organization_id", orgId)
  else if (contactId) propQuery = propQuery.eq("contact_id", contactId)
  else return []

  const { data: proposals, error: propErr } = await propQuery
  if (propErr) throw new Error(`ignition_proposals fetch failed: ${propErr.message}`)
  const proposalIds = (proposals ?? []).map((p: { proposal_id: string }) => p.proposal_id).filter(Boolean)
  if (proposalIds.length === 0) return []

  const { data: services, error: svcErr } = await supabase
    .from("ignition_proposal_services")
    .select("id, proposal_id, service_name")
    .in("proposal_id", proposalIds)
  if (svcErr) throw new Error(`ignition_proposal_services fetch failed: ${svcErr.message}`)
  return (services ?? []) as ProposalServiceLike[]
}

interface LinkRow {
  id: string
  engagement_id: string
  hub_organization_id: string | null
  hub_contact_id: string | null
  work_item_link_source: string
  proposal_link_source: string
}

// Core: process a set of tax_return_links rows that all belong to ONE client.
async function processClientLinks(
  supabase: Supa,
  links: LinkRow[],
  orgId: string | null,
  contactId: string | null,
): Promise<LinkResult> {
  const result = emptyResult()
  if (links.length === 0) return result

  const engagementIds = links.map((l) => l.engagement_id)
  const { data: engagements, error: engErr } = await supabase
    .from("proconnect_engagements")
    .select("engagement_id, tax_year, return_type")
    .in("engagement_id", engagementIds)
  if (engErr) throw new Error(`engagements fetch failed: ${engErr.message}`)
  const engById = new Map<string, EngagementLike>(
    (engagements ?? []).map((e: EngagementLike) => [e.engagement_id, e]),
  )

  const [workItems, services] = await Promise.all([
    fetchClientWorkItems(supabase, orgId, contactId),
    fetchClientProposalServices(supabase, orgId, contactId),
  ])

  for (const link of links) {
    result.processed += 1
    const engagement = engById.get(link.engagement_id)
    if (!engagement) {
      result.noMatch += 1
      continue
    }

    const update: Record<string, unknown> = {}

    // ── Work item ──────────────────────────────────────────────────────────
    // Skip if a human linked it manually.
    if (link.work_item_link_source === "manual") {
      result.skippedManual += 1
    } else {
      const wiMatch = matchEngagementToWorkItem(engagement, workItems)
      update.work_item_id = wiMatch.workItem?.id ?? null
      update.karbon_work_item_key = wiMatch.workItem?.karbon_work_item_key ?? null
      update.work_item_link_source = wiMatch.linkSource
      update.work_item_confidence = wiMatch.confidence
      update.status = wiMatch.status
    }

    // ── Proposal service ─────────────────────────────────────────────────────
    if (link.proposal_link_source !== "manual") {
      const propMatch = matchEngagementToProposalService(engagement, services)
      update.proposal_service_id = propMatch.service?.id ?? null
      update.ignition_proposal_id = propMatch.service?.proposal_id ?? null
      update.proposal_link_source = propMatch.linkSource
    }

    if (Object.keys(update).length > 0) {
      const { error: upErr } = await supabase
        .from("tax_return_links")
        .update(update)
        .eq("id", link.id)
      if (upErr) throw new Error(`tax_return_links update failed: ${upErr.message}`)
    }

    // Tally final status (manual rows keep their existing status — treat as linked).
    const finalStatus =
      link.work_item_link_source === "manual" ? "linked" : (update.status as string) ?? "no_match"
    if (finalStatus === "linked") result.linked += 1
    else if (finalStatus === "needs_review") result.needsReview += 1
    else result.noMatch += 1
  }

  return result
}

function mergeResults(a: LinkResult, b: LinkResult): LinkResult {
  return {
    processed: a.processed + b.processed,
    linked: a.linked + b.linked,
    needsReview: a.needsReview + b.needsReview,
    noMatch: a.noMatch + b.noMatch,
    skippedManual: a.skippedManual + b.skippedManual,
  }
}

/** Re-link every return belonging to a single Hub client. */
export async function linkReturnsForHubClient(opts: {
  organizationId?: string | null
  contactId?: string | null
}): Promise<LinkResult> {
  const supabase = createAdminClient()
  const orgId = opts.organizationId ?? null
  const contactId = opts.contactId ?? null

  let query = supabase
    .from("tax_return_links")
    .select("id, engagement_id, hub_organization_id, hub_contact_id, work_item_link_source, proposal_link_source")
  if (orgId) query = query.eq("hub_organization_id", orgId)
  else if (contactId) query = query.eq("hub_contact_id", contactId)
  else return emptyResult()

  const { data: links, error } = await query
  if (error) throw new Error(`tax_return_links fetch failed: ${error.message}`)
  return processClientLinks(supabase, (links ?? []) as LinkRow[], orgId, contactId)
}

/**
 * Ensure a 'tax_return' project + a tax_return_links row exist for a single
 * engagement, creating them if missing. Returns the link row (or null when the
 * engagement is not tied to a Hub client yet). Idempotent.
 *
 * Used by the keep-fresh paths (nightly sync / webhook) so newly-synced returns
 * are onboarded incrementally without re-running the SQL seed.
 */
export async function ensureLinkRowForEngagement(engagementId: string): Promise<LinkRow | null> {
  const supabase = createAdminClient()

  // Already have a link row? Done.
  const { data: existing } = await supabase
    .from("tax_return_links")
    .select("id, engagement_id, hub_organization_id, hub_contact_id, work_item_link_source, proposal_link_source")
    .eq("engagement_id", engagementId)
    .maybeSingle()
  if (existing) return existing as LinkRow

  // Resolve the engagement → ProConnect client → Hub master record.
  const { data: eng } = await supabase
    .from("proconnect_engagements")
    .select("engagement_id, proconnect_client_id, tax_year, return_type")
    .eq("engagement_id", engagementId)
    .maybeSingle()
  if (!eng) return null

  const { data: pc } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id, display_name, hub_organization_id, hub_contact_id")
    .eq("proconnect_client_id", eng.proconnect_client_id)
    .maybeSingle()
  // No Hub link yet → can't onboard (per data-model rule we never auto-create).
  if (!pc || (!pc.hub_organization_id && !pc.hub_contact_id)) return null

  const orgId: string | null = pc.hub_organization_id
  const contactId: string | null = orgId ? null : pc.hub_contact_id

  // Ensure the client's tax_return project exists.
  let projectId: string | null = null
  {
    let q = supabase.from("projects").select("id").eq("kind", "tax_return")
    q = orgId ? q.eq("organization_id", orgId) : q.eq("contact_id", contactId as string)
    const { data: proj } = await q.maybeSingle()
    if (proj) {
      projectId = proj.id
    } else {
      // Resolve a display name for the project label.
      let clientName = pc.display_name ?? "Untitled"
      if (orgId) {
        const { data: o } = await supabase.from("organizations").select("name, full_name").eq("id", orgId).maybeSingle()
        clientName = o?.name ?? o?.full_name ?? clientName
      } else if (contactId) {
        const { data: ct } = await supabase.from("contacts").select("full_name").eq("id", contactId).maybeSingle()
        clientName = ct?.full_name ?? clientName
      }
      const { data: created, error: cErr } = await supabase
        .from("projects")
        .insert({
          name: `${clientName} — Tax`,
          kind: "tax_return",
          status: "active",
          organization_id: orgId,
          contact_id: contactId,
          work_type_pattern: "Tax",
          work_template_pattern: "TAX |",
          description: "Auto-created from ProConnect tax engagements.",
        })
        .select("id")
        .maybeSingle()
      // On a race the partial unique index rejects the dup — re-read.
      if (cErr || !created) {
        let q2 = supabase.from("projects").select("id").eq("kind", "tax_return")
        q2 = orgId ? q2.eq("organization_id", orgId) : q2.eq("contact_id", contactId as string)
        const { data: again } = await q2.maybeSingle()
        projectId = again?.id ?? null
      } else {
        projectId = created.id
      }
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from("tax_return_links")
    .insert({
      engagement_id: eng.engagement_id,
      proconnect_client_id: eng.proconnect_client_id,
      tax_year: eng.tax_year,
      return_type: eng.return_type,
      project_id: projectId,
      hub_organization_id: orgId,
      hub_contact_id: contactId,
      status: "no_match",
    })
    .select("id, engagement_id, hub_organization_id, hub_contact_id, work_item_link_source, proposal_link_source")
    .maybeSingle()
  if (insErr) {
    // Unique violation race → re-read.
    const { data: again } = await supabase
      .from("tax_return_links")
      .select("id, engagement_id, hub_organization_id, hub_contact_id, work_item_link_source, proposal_link_source")
      .eq("engagement_id", engagementId)
      .maybeSingle()
    return (again as LinkRow) ?? null
  }
  return inserted as LinkRow
}

/** Re-link a single engagement/return (used by the webhook). Onboards first. */
export async function relinkEngagement(engagementId: string): Promise<LinkResult> {
  const supabase = createAdminClient()
  const row = await ensureLinkRowForEngagement(engagementId)
  if (!row) return emptyResult()
  return processClientLinks(supabase, [row], row.hub_organization_id, row.hub_contact_id)
}

/** Re-link every return in the system (backfill / full refresh). */
export async function linkAllReturns(): Promise<LinkResult> {
  const supabase = createAdminClient()
  const { data: links, error } = await supabase
    .from("tax_return_links")
    .select("id, engagement_id, hub_organization_id, hub_contact_id, work_item_link_source, proposal_link_source")
  if (error) throw new Error(`tax_return_links fetch failed: ${error.message}`)

  // Group by client so candidate work items/services are fetched once per client.
  const byClient = new Map<string, LinkRow[]>()
  for (const l of (links ?? []) as LinkRow[]) {
    const key = l.hub_organization_id ? `o:${l.hub_organization_id}` : `c:${l.hub_contact_id}`
    const arr = byClient.get(key) ?? []
    arr.push(l)
    byClient.set(key, arr)
  }

  let total = emptyResult()
  for (const [key, group] of byClient) {
    const isOrg = key.startsWith("o:")
    const id = key.slice(2)
    const res = await processClientLinks(supabase, group, isOrg ? id : null, isOrg ? null : id)
    total = mergeResults(total, res)
  }
  return total
}

/**
 * Create tax_return projects + link rows for any Hub-linked engagement that
 * doesn't have one yet (e.g. clients added since the last sync). Idempotent.
 * Returns the number of newly-seeded link rows.
 */
export async function seedMissingLinks(): Promise<{ seeded: number; scanned: number }> {
  const supabase = createAdminClient()

  // Engagements that already have a link row (so we can skip them fast).
  const { data: existing } = await supabase.from("tax_return_links").select("engagement_id")
  const have = new Set<string>((existing ?? []).map((r: { engagement_id: string }) => r.engagement_id))

  // All engagements (page through to beat the 1000-row default).
  const all: { engagement_id: string }[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("proconnect_engagements")
      .select("engagement_id")
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`engagements page fetch failed: ${error.message}`)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < pageSize) break
  }

  let seeded = 0
  for (const e of all) {
    if (have.has(e.engagement_id)) continue
    const row = await ensureLinkRowForEngagement(e.engagement_id)
    if (row) seeded += 1
  }
  return { seeded, scanned: all.length }
}
