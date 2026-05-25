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
  MATCHER_VERSION,
  type ProconnectClientLite,
} from "@/lib/tax/proconnect-client-match"

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

  const { data: clients, error } = await sb
    .from("proconnect_clients")
    .select(
      "proconnect_client_id, client_type, email, first_name, last_name, business_name, display_name, tax_id, state",
    )
    .is("hub_contact_id", null)
    .is("hub_organization_id", null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Block previously-rejected pairs from being auto-applied
  const { data: rejections } = await sb
    .from("tax_proconnect_client_link_log")
    .select("proconnect_client_id, hub_contact_id, hub_organization_id")
    .eq("status", "rejected")
  const excludePairs = new Set(
    (rejections || []).map(
      (r) =>
        `${(r as { proconnect_client_id: string }).proconnect_client_id}|${
          (r as { hub_contact_id: string | null }).hub_contact_id ||
          (r as { hub_organization_id: string | null }).hub_organization_id
        }`,
    ),
  )

  const proposed: Array<{
    proconnect_client_id: string
    kind: "contact" | "organization"
    candidate_id: string
    score: number
    signals: string[]
  }> = []

  for (const c of (clients as ProconnectClientLite[] | null) || []) {
    const candidates = await rankHubCandidates(sb, c, { excludePairs })
    const top = pickAutoApply(candidates)
    if (!top) continue
    proposed.push({
      proconnect_client_id: c.proconnect_client_id,
      kind: top.kind,
      candidate_id: top.id,
      score: top.score,
      signals: top.signals,
    })
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      total_unmapped: clients?.length ?? 0,
      auto_applicable: proposed.length,
      proposed,
    })
  }

  let applied = 0
  for (const p of proposed) {
    const { error: upErr } = await sb
      .from("proconnect_clients")
      .update({
        hub_contact_id: p.kind === "contact" ? p.candidate_id : null,
        hub_organization_id: p.kind === "organization" ? p.candidate_id : null,
        link_source: "auto_fuzzy",
      })
      .eq("proconnect_client_id", p.proconnect_client_id)
    if (upErr) {
      console.error(
        "[client-links auto-link] update failed",
        p.proconnect_client_id,
        upErr.message,
      )
      continue
    }
    await sb.from("tax_proconnect_client_link_log").insert({
      proconnect_client_id: p.proconnect_client_id,
      hub_contact_id: p.kind === "contact" ? p.candidate_id : null,
      hub_organization_id: p.kind === "organization" ? p.candidate_id : null,
      status: "applied",
      score: p.score,
      signals: p.signals,
      matcher_version: MATCHER_VERSION,
      acted_by: "auto_fuzzy",
    } as never)
    applied++
  }

  return NextResponse.json({
    total_unmapped: clients?.length ?? 0,
    auto_applicable: proposed.length,
    applied,
  })
}
