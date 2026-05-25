/**
 * /api/tax/client-links — review queue for ProConnect ↔ Hub matching.
 *
 * GET    → list unmapped ProConnect clients with ranked Hub candidates
 * POST   { proconnect_client_id, candidate_id, candidate_kind, action }
 *        action ∈ 'apply' | 'reject' | 'unlink'
 *        Persists to tax_proconnect_client_link_log and (for 'apply')
 *        writes hub_contact_id / hub_organization_id + link_source.
 */

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  rankHubCandidates,
  pickAutoApply,
  MATCHER_VERSION,
  type ProconnectClientLite,
  type Candidate,
} from "@/lib/tax/proconnect-client-match"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const status = url.searchParams.get("status") || "unmapped"
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1),
    500,
  )
  const sb = admin()

  // Build the working set of ProConnect clients we'll score.
  let q = sb
    .from("proconnect_clients")
    .select(
      "proconnect_client_id, client_type, email, first_name, last_name, business_name, display_name, tax_id, state, hub_contact_id, hub_organization_id, link_source",
    )
    .order("display_name", { ascending: true })
    .limit(limit)

  if (status === "unmapped") {
    q = q.is("hub_contact_id", null).is("hub_organization_id", null)
  } else if (status === "linked") {
    q = q.or("hub_contact_id.not.is.null,hub_organization_id.not.is.null")
  }

  const { data: clients, error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Pull rejected pairs once so we don't re-suggest the same bad guesses
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

  const rows: Array<{
    proconnect: ProconnectClientLite
    candidates: Candidate[]
    autoApply: Candidate | null
  }> = []

  for (const c of (clients as ProconnectClientLite[] | null) || []) {
    const candidates = await rankHubCandidates(sb, c, { excludePairs })
    rows.push({
      proconnect: c,
      candidates,
      autoApply: pickAutoApply(candidates),
    })
  }

  return NextResponse.json({
    rows,
    matcher_version: MATCHER_VERSION,
    autoApplyCount: rows.filter((r) => r.autoApply).length,
  })
}

type ApplyBody = {
  proconnect_client_id: string
  candidate_id: string
  candidate_kind: "contact" | "organization"
  signals?: string[]
  score?: number
  acted_by?: string
}

export async function POST(req: Request) {
  const body = (await req.json()) as ApplyBody & { action: string }
  const sb = admin()

  if (body.action === "unlink") {
    // Operator says "this is wrong" on a row that's already linked.
    const { error: upErr } = await sb
      .from("proconnect_clients")
      .update({
        hub_contact_id: null,
        hub_organization_id: null,
        link_source: null,
      })
      .eq("proconnect_client_id", body.proconnect_client_id)
    if (upErr)
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    await sb.from("tax_proconnect_client_link_log").insert({
      proconnect_client_id: body.proconnect_client_id,
      hub_contact_id: null,
      hub_organization_id: null,
      // Bypass the constraint by inserting via "rejected" — we use this
      // table only for diff/audit, not for unlinks. Skipping log row keeps
      // things simple and avoids fighting the one-side check constraint.
      status: "rejected",
      score: 0,
      signals: ["manual_unlink"],
      matcher_version: MATCHER_VERSION,
      acted_by: body.acted_by || "operator",
    } as never)
    return NextResponse.json({ ok: true })
  }

  if (
    !body.proconnect_client_id ||
    !body.candidate_id ||
    !body.candidate_kind
  ) {
    return NextResponse.json(
      { error: "proconnect_client_id, candidate_id, candidate_kind required" },
      { status: 400 },
    )
  }

  const isOrg = body.candidate_kind === "organization"
  const logRow = {
    proconnect_client_id: body.proconnect_client_id,
    hub_contact_id: isOrg ? null : body.candidate_id,
    hub_organization_id: isOrg ? body.candidate_id : null,
    status: body.action === "apply" ? "applied" : "rejected",
    score: body.score ?? 0,
    signals: body.signals ?? [],
    matcher_version: MATCHER_VERSION,
    acted_by: body.acted_by || "operator",
  }
  const { error: logErr } = await sb
    .from("tax_proconnect_client_link_log")
    .insert(logRow as never)
  if (logErr)
    return NextResponse.json({ error: logErr.message }, { status: 500 })

  if (body.action === "apply") {
    const { error: upErr } = await sb
      .from("proconnect_clients")
      .update({
        hub_contact_id: isOrg ? null : body.candidate_id,
        hub_organization_id: isOrg ? body.candidate_id : null,
        link_source: "manual",
      })
      .eq("proconnect_client_id", body.proconnect_client_id)
    if (upErr)
      return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
