import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET /api/alfred/conversations
//
// Returns the current user's 20 most recent ALFRED threads. Session-authed:
// we use the SSR Supabase client so the request runs under auth.uid(), which
// is what the alfred_conversations RLS policies join through. That means
// this handler doesn't need to filter by team_member_id itself -- RLS does
// it -- which keeps the trust boundary in one place (the database).
export async function GET(_req: NextRequest) {
  const supabase = await createClient()

  // 401 if no session. We deliberately do NOT also accept the x-alfred-secret
  // here -- this endpoint is per-user, not server-to-server.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("alfred_conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ conversations: data ?? [] })
}
