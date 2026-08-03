/**
 * /api/tax/client-links/auto-link — bulk apply high-confidence Hub matches.
 *
 * Walks every unmapped ProConnect client, runs the fuzzy matcher, and
 * for each row that pickAutoApply() approves writes:
 *   - hub_contact_id / hub_organization_id (link_source='auto_fuzzy')
 *   - an 'applied' row in tax_proconnect_client_link_log
 *
 * Body: { dryRun?: boolean }
 *   When dryRun=true, returns the proposed updates without writing.
 *   We always return per-row signals + score so the operator can audit.
 */

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  rankHubCandidates,
  pickAutoApply,
  fetchOrgsWithEin,
  MATCHER_VERSION,
  type ProconnectClientLite,
  type OrgEinRow,
} from "@/lib/tax/proconnect-client-match"
import { fetchAllPaged, chunk } from "@/lib/supabase/fetch-all"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 120

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean }
  const dryRun = body.dryRun ?? false
  const sb = admin()

  // Paged fetches — bare selects silently truncate at the 1,000-row
  // PostgREST cap, which would skip unmapped clients and (worse) let
  // previously-rejected pairs slip past the exclusion set.
  let clients: ProconnectClientLite[]
  let excludePairs: Set<string>
  let einOrgs: OrgEinRow[]
  try {
    clients = await fetchAllPaged<ProconnectClientLite>(() =>
      sb
        .from("proconnect_clients")
        .select(
          "proconnect_client_id, client_type, email, first_name, last_name, business_name, display_name, tax_id, state",
        )
        .is("hub_contact_id", null)
        .is("hub_organization_id", null),
    )

    // Block previously-rejected pairs from being auto-applied
    const rejections = await fetchAllPaged<{
      proconnect_client_id: string
      hub_contact_id: string | null
      hub_organization_id: string | null
    }>(() =>
      sb
        .from("tax_proconnect_client_link_log")
        .select("proconnect_client_id, hub_contact_id, hub_organization_id")
        .eq("status", "rejected"),
    )
    excludePairs = new Set(
      rejections.map(
        (r) =>
          `${r.proconnect_client_id}|${r.hub_contact_id || r.hub_organization_id}`,
      ),
    )

    // Pre-fetch the org EIN index once — rankHubCandidates would otherwise
    // re-download the organizations table for every client.
    einOrgs = await fetchOrgsWithEin(sb)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const proposed: Array<{
    proconnect_client_id: string
    kind: "contact" | "organization"
    candidate_id: string
    score: number
    signals: string[]
  }> = []

  for (const batch of chunk(clients, 5)) {
    const ranked = await Promise.all(
      batch.map((c) => rankHubCandidates(sb, c, { excludePairs, einOrgs })),
    )
    batch.forEach((c, i) => {
      const top = pickAutoApply(ranked[i])
      if (!top) return
      proposed.push({
        proconnect_client_id: c.proconnect_client_id,
        kind: top.kind,
        candidate_id: top.id,
        score: top.score,
        signals: top.signals,
      })
    })
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      total_unmapped: clients.length,
      auto_applicable: proposed.length,
      proposed,
    })
  }

  let applied = 0
  const logRows: Array<Record<string, unknown>> = []
  for (const batch of chunk(proposed, 10)) {
    const results = await Promise.all(
      batch.map(async (p) => {
        const { error: upErr } = await sb
          .from("proconnect_clients")
          .update({
            hub_contact_id: p.kind === "contact" ? p.candidate_id : null,
            hub_organization_id:
              p.kind === "organization" ? p.candidate_id : null,
            link_source: "auto_fuzzy",
          })
          .eq("proconnect_client_id", p.proconnect_client_id)
        if (upErr) {
          console.error(
            "[client-links auto-link] update failed",
            p.proconnect_client_id,
            upErr.message,
          )
          return null
        }
        return p
      }),
    )
    for (const p of results) {
      if (!p) continue
      logRows.push({
        proconnect_client_id: p.proconnect_client_id,
        hub_contact_id: p.kind === "contact" ? p.candidate_id : null,
        hub_organization_id: p.kind === "organization" ? p.candidate_id : null,
        status: "applied",
        score: p.score,
        signals: p.signals,
        matcher_version: MATCHER_VERSION,
        acted_by: "auto_fuzzy",
      })
      applied++
    }
  }
  // Batched audit-log insert (one row per applied link) instead of one
  // round trip per row.
  for (const rows of chunk(logRows, 500)) {
    const { error: logErr } = await sb
      .from("tax_proconnect_client_link_log")
      .insert(rows as never[])
    if (logErr)
      console.error(
        "[client-links auto-link] log insert failed",
        logErr.message,
      )
  }

  return NextResponse.json({
    total_unmapped: clients.length,
    auto_applicable: proposed.length,
    applied,
  })
}
