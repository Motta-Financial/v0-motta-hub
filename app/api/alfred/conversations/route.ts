import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { resolveAlfredUser } from "@/lib/alfred/resolve-user"
import { applyAlfredCors, preflightResponse } from "@/lib/alfred/cors"

// OPTIONS preflight for cross-origin fetch from alfred.motta.cpa.
// Browsers send this without credentials, so we cannot require auth
// here -- CORS headers are the entire response.
export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req)
}

// GET /api/alfred/conversations
//
// Returns the calling team member's 20 most-recent ALFRED threads.
// Identity is resolved via cookie OR Authorization: Bearer; the body
// is not consulted. We then query through the admin client and filter
// explicitly by `end_user_team_member_id` -- with Bearer-based auth
// there is no Supabase session for RLS to read, so explicit filtering
// is the canonical scoping mechanism for this endpoint.
export async function GET(req: NextRequest) {
  const currentUser = await resolveAlfredUser(req)
  if (!currentUser) {
    return applyAlfredCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      req,
    )
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("alfred_conversations")
    .select("id, title, updated_at")
    .eq("end_user_team_member_id", currentUser.teamMemberId)
    .order("updated_at", { ascending: false })
    .limit(20)

  if (error) {
    return applyAlfredCors(
      NextResponse.json({ error: error.message }, { status: 500 }),
      req,
    )
  }

  return applyAlfredCors(
    NextResponse.json({ conversations: data ?? [] }),
    req,
  )
}

// DELETE /api/alfred/conversations
//
// Clears ALL of the calling team member's conversations. Identity is
// resolved via cookie or Bearer; scoping is enforced by an explicit
// `end_user_team_member_id` filter. Messages are removed first (we look
// up the member's conversation ids and delete their messages), then the
// conversation rows themselves.
export async function DELETE(req: NextRequest) {
  const currentUser = await resolveAlfredUser(req)
  if (!currentUser) {
    return applyAlfredCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      req,
    )
  }

  const supabase = createAdminClient()

  // Gather this member's conversation ids so we can purge their messages.
  const { data: convos, error: listErr } = await supabase
    .from("alfred_conversations")
    .select("id")
    .eq("end_user_team_member_id", currentUser.teamMemberId)

  if (listErr) {
    return applyAlfredCors(
      NextResponse.json({ error: listErr.message }, { status: 500 }),
      req,
    )
  }

  const ids = (convos ?? []).map((c) => c.id)
  if (ids.length === 0) {
    return applyAlfredCors(NextResponse.json({ ok: true, deleted: 0 }), req)
  }

  const { error: msgErr } = await supabase
    .from("alfred_messages")
    .delete()
    .in("conversation_id", ids)

  if (msgErr) {
    return applyAlfredCors(
      NextResponse.json({ error: msgErr.message }, { status: 500 }),
      req,
    )
  }

  const { error: delErr } = await supabase
    .from("alfred_conversations")
    .delete()
    .eq("end_user_team_member_id", currentUser.teamMemberId)

  if (delErr) {
    return applyAlfredCors(
      NextResponse.json({ error: delErr.message }, { status: 500 }),
      req,
    )
  }

  return applyAlfredCors(NextResponse.json({ ok: true, deleted: ids.length }), req)
}
