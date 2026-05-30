/**
 * One-off backfill: link every ProConnect tax return to its Karbon work item
 * and Ignition proposal service, persisting results into tax_return_links.
 *
 * Standalone (does NOT import @/lib/supabase/server — that pulls in
 * next/headers which can't run under tsx). It reuses the PURE matcher from
 * lib/tax/return-matcher.ts so the logic stays identical to the runtime path.
 *
 * Run:
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     -r esbuild-register scripts/run-tax-return-linking.ts
 *   (or: pnpm dlx tsx scripts/run-tax-return-linking.ts)
 */

import { createClient } from "@supabase/supabase-js"
import {
  matchEngagementToWorkItem,
  matchEngagementToProposalService,
  type EngagementLike,
  type WorkItemLike,
  type ProposalServiceLike,
} from "../lib/tax/return-matcher"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface LinkRow {
  id: string
  engagement_id: string
  hub_organization_id: string | null
  hub_contact_id: string | null
  work_item_link_source: string
  proposal_link_source: string
}

async function fetchClientWorkItems(orgId: string | null, contactId: string | null): Promise<WorkItemLike[]> {
  let q = sb
    .from("work_items")
    .select("id, karbon_work_item_key, work_template_name, title, tax_year")
    .ilike("work_template_name", "TAX |%")
    .is("deleted_in_karbon_at", null)
  if (orgId) q = q.eq("organization_id", orgId)
  else if (contactId) q = q.eq("contact_id", contactId)
  else return []
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as WorkItemLike[]
}

async function fetchClientServices(orgId: string | null, contactId: string | null): Promise<ProposalServiceLike[]> {
  let pq = sb.from("ignition_proposals").select("proposal_id")
  if (orgId) pq = pq.eq("organization_id", orgId)
  else if (contactId) pq = pq.eq("contact_id", contactId)
  else return []
  const { data: props, error: pErr } = await pq
  if (pErr) throw new Error(pErr.message)
  const ids = (props ?? []).map((p: { proposal_id: string }) => p.proposal_id).filter(Boolean)
  if (ids.length === 0) return []
  const { data, error } = await sb
    .from("ignition_proposal_services")
    .select("id, proposal_id, service_name")
    .in("proposal_id", ids)
  if (error) throw new Error(error.message)
  return (data ?? []) as ProposalServiceLike[]
}

async function main() {
  console.log("[tax-link] loading tax_return_links…")
  const { data: links, error } = await sb
    .from("tax_return_links")
    .select("id, engagement_id, hub_organization_id, hub_contact_id, work_item_link_source, proposal_link_source")
  if (error) throw new Error(error.message)
  const rows = (links ?? []) as LinkRow[]
  console.log(`[tax-link] ${rows.length} link rows`)

  // Engagements lookup.
  const { data: engs, error: eErr } = await sb
    .from("proconnect_engagements")
    .select("engagement_id, tax_year, return_type")
  if (eErr) throw new Error(eErr.message)
  const engById = new Map<string, EngagementLike>(
    (engs ?? []).map((e: EngagementLike) => [e.engagement_id, e]),
  )

  // Group rows by client.
  const byClient = new Map<string, LinkRow[]>()
  for (const l of rows) {
    const key = l.hub_organization_id ? `o:${l.hub_organization_id}` : `c:${l.hub_contact_id}`
    const arr = byClient.get(key) ?? []
    arr.push(l)
    byClient.set(key, arr)
  }

  let processed = 0
  let linked = 0
  let needsReview = 0
  let noMatch = 0
  let skippedManual = 0
  let proposalsLinked = 0

  for (const [key, group] of byClient) {
    const isOrg = key.startsWith("o:")
    const id = key.slice(2)
    const orgId = isOrg ? id : null
    const contactId = isOrg ? null : id
    const [workItems, services] = await Promise.all([
      fetchClientWorkItems(orgId, contactId),
      fetchClientServices(orgId, contactId),
    ])

    for (const link of group) {
      processed += 1
      const eng = engById.get(link.engagement_id)
      if (!eng) {
        noMatch += 1
        continue
      }
      const update: Record<string, unknown> = {}

      if (link.work_item_link_source === "manual") {
        skippedManual += 1
      } else {
        const m = matchEngagementToWorkItem(eng, workItems)
        update.work_item_id = m.workItem?.id ?? null
        update.karbon_work_item_key = m.workItem?.karbon_work_item_key ?? null
        update.work_item_link_source = m.linkSource
        update.work_item_confidence = m.confidence
        update.status = m.status
        if (m.status === "linked") linked += 1
        else if (m.status === "needs_review") needsReview += 1
        else noMatch += 1
      }

      if (link.proposal_link_source !== "manual") {
        const pm = matchEngagementToProposalService(eng, services)
        update.proposal_service_id = pm.service?.id ?? null
        update.ignition_proposal_id = pm.service?.proposal_id ?? null
        update.proposal_link_source = pm.linkSource
        if (pm.linkSource === "auto") proposalsLinked += 1
      }

      if (Object.keys(update).length > 0) {
        const { error: upErr } = await sb.from("tax_return_links").update(update).eq("id", link.id)
        if (upErr) throw new Error(upErr.message)
      }
    }
  }

  console.log("[tax-link] DONE")
  console.log(
    JSON.stringify(
      { processed, linked, needsReview, noMatch, skippedManual, proposalsLinked, clients: byClient.size },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error("[tax-link] FAILED", e)
  process.exit(1)
})
