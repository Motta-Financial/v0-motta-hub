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
