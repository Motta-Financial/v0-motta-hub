import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET /api/alfred/conversations/[id]
//
// Returns the full message log of one conversation, chronologically. The
// SSR Supabase client runs under the requesting user's auth.uid(), and the
// alfred_messages RLS policy joins back to alfred_conversations to check
// ownership -- so a user who guesses someone else's conversation id sees
// an empty array (or 404), never another user's messages.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Confirm the conversation exists & is visible. We `.maybeSingle()` so RLS
  // failures surface as 404 rather than 500.
  const { data: convo, error: convoErr } = await supabase
    .from("alfred_conversations")
    .select("id, title, audience, created_at, updated_at")
    .eq("id", id)
    .maybeSingle()

  if (convoErr) {
    return NextResponse.json({ error: convoErr.message }, { status: 500 })
  }
  if (!convo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data: messages, error: msgErr } = await supabase
    .from("alfred_messages")
    .select("id, role, content, tool_calls, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 })
  }

  return NextResponse.json({ conversation: convo, messages: messages ?? [] })
}
