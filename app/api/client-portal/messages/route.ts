import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/client-portal/messages
 * Returns all messages in the client's portal thread, oldest first.
 * Also marks any unread team messages as read.
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  // Fetch the thread
  const { data: messages, error } = await supabase
    .from("portal_messages")
    .select("id, sender_role, sender_name, body, created_at, read_at")
    .eq("client_id", portalUser.clientId)
    .order("created_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Mark unread team messages as read now that the client has opened the thread
  const unreadTeamIds = (messages ?? [])
    .filter((m) => m.sender_role === "team" && !m.read_at)
    .map((m) => m.id)

  if (unreadTeamIds.length > 0) {
    await supabase
      .from("portal_messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadTeamIds)
  }

  return NextResponse.json({ messages: messages ?? [] })
}

/**
 * POST /api/client-portal/messages
 * Body: { body: string }
 * Creates a new message from the client in their portal thread.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth

  let body: string
  try {
    const json = await request.json()
    body = (json.body ?? "").trim()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 })
  }

  if (body.length > 4000) {
    return NextResponse.json({ error: "Message too long (max 4000 chars)" }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: message, error } = await supabase
    .from("portal_messages")
    .insert({
      client_id: portalUser.clientId,
      sender_id: portalUser.id,
      sender_role: "client",
      sender_name: portalUser.fullName ?? portalUser.email,
      body,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message }, { status: 201 })
}
