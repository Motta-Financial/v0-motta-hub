/**
 * Ignition client match management.
 *
 * GET  /api/ignition/clients/[id]/match
 *   Returns the full Ignition client record + the top N candidates from the
 *   suggest_ignition_client_candidates RPC (the admin UI's match-picker).
 *
 * POST /api/ignition/clients/[id]/match
 *   body: { match_kind: 'contact'|'organization'|'no_match', matched_id?: uuid, notes?: string }
 *   Applies the override. Cascades the FK to proposals/invoices/payments via
 *   the apply_ignition_client_match RPC.
 *
 * DELETE /api/ignition/clients/[id]/match
 *   Resets the client back to 'unmatched' state so the auto-matcher can
 *   re-evaluate it on the next webhook arrival.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: RouteCtx) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const [{ data: client, error: clientErr }, { data: candidates, error: candErr }] = await Promise.all([
    supabase.from("ignition_clients").select("*").eq("ignition_client_id", id).maybeSingle(),
    supabase.rpc("suggest_ignition_client_candidates", {
      p_ignition_client_id: id,
      p_limit: 10,
    }),
  ])

  if (clientErr) return NextResponse.json({ error: clientErr.message }, { status: 500 })
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 })
  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 500 })

  return NextResponse.json({
    client,
    candidates: candidates || [],
  })
}

export async function POST(req: Request, { params }: RouteCtx) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { match_kind, matched_id, notes } = body as {
    match_kind?: string
    matched_id?: string | null
    notes?: string | null
  }

  // Normalize + validate up front so we return a proper 400 instead of letting
  // the RPC throw a generic 500.
  if (!match_kind || !["contact", "organization", "no_match"].includes(match_kind)) {
    return NextResponse.json(
      { error: "match_kind must be 'contact', 'organization', or 'no_match'" },
      { status: 400 },
    )
  }
  if (match_kind !== "no_match" && !matched_id) {
    return NextResponse.json(
      { error: `matched_id is required when match_kind = '${match_kind}'` },
      { status: 400 },
    )
  }

  const { data, error } = await supabase.rpc("apply_ignition_client_match", {
    p_ignition_client_id: id,
    p_match_kind: match_kind,
    p_matched_id: matched_id || null,
    p_notes: notes || null,
  })

  if (error) {
    // RPC throws for FK violations / bad UUIDs. Surface the message.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ result: data?.[0] || null })
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Reset to unmatched so the next webhook re-runs auto-matching.
  const { error } = await supabase
    .from("ignition_clients")
    .update({
      match_status: "unmatched",
      match_confidence: null,
      match_method: null,
      match_notes: null,
      contact_id: null,
      organization_id: null,
    })
    .eq("ignition_client_id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Also clear cascaded FKs on dependent tables.
  await Promise.all([
    supabase
      .from("ignition_proposals")
      .update({ contact_id: null, organization_id: null })
      .eq("ignition_client_id", id),
    supabase
      .from("ignition_invoices")
      .update({ contact_id: null, organization_id: null })
      .eq("ignition_client_id", id),
    supabase
      .from("ignition_payments")
      .update({ contact_id: null, organization_id: null })
      .eq("ignition_client_id", id),
  ])

  return NextResponse.json({ ok: true })
}
