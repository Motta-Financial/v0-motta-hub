import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { resolveAlfredUser } from "@/lib/alfred/resolve-user"
import { applyAlfredCors, preflightResponse } from "@/lib/alfred/cors"

export async function OPTIONS(req: NextRequest) {
  return preflightResponse(req)
}

// GET /api/alfred/conversations/[id]
//
// Returns the full chronological message log for one conversation.
// Identity is verified via cookie or Bearer (see lib/alfred/resolve-user);
// ownership is then enforced by an explicit `end_user_team_member_id`
// filter on the conversation row. A user asking for someone else's
// conversation id receives 404 -- never a leak.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  const currentUser = await resolveAlfredUser(req)
  if (!currentUser) {
    return applyAlfredCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      req,
    )
  }

  const supabase = createAdminClient()

  // Conversation row -- scoped to the calling team member. `.maybeSingle()`
  // so a wrong owner surfaces as 404 rather than 500.
  const { data: convo, error: convoErr } = await supabase
    .from("alfred_conversations")
    .select("id, title, audience, created_at, updated_at")
    .eq("id", id)
    .eq("end_user_team_member_id", currentUser.teamMemberId)
    .maybeSingle()

  if (convoErr) {
    return applyAlfredCors(
      NextResponse.json({ error: convoErr.message }, { status: 500 }),
      req,
    )
  }
  if (!convo) {
    return applyAlfredCors(
      NextResponse.json({ error: "Not found" }, { status: 404 }),
      req,
    )
  }

  const { data: messages, error: msgErr } = await supabase
    .from("alfred_messages")
    .select("id, role, content, tool_calls, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })

  if (msgErr) {
    return applyAlfredCors(
      NextResponse.json({ error: msgErr.message }, { status: 500 }),
      req,
    )
  }

  return applyAlfredCors(
    NextResponse.json({ conversation: convo, messages: messages ?? [] }),
    req,
  )
}
