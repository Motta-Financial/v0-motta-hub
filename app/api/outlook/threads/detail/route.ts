import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import {
  describeGraphError,
  fetchThreadDetail,
  GraphApiError,
  type OutlookConnectionRow,
} from "@/lib/outlook-api"

/**
 * GET /api/outlook/threads/detail?conversationId=... → every message in
 * one conversation, full plain-text body included. conversationId is
 * passed as a query param (not a dynamic route segment) because Graph's
 * IDs contain characters like `/` and `+` that don't survive path
 * encoding cleanly.
 *
 * As a side effect, unread inbound messages in the thread are marked
 * read — this is what "opening" the thread from Triage means.
 */
export async function GET(request: Request) {
  try {
    const conversationId = new URL(request.url).searchParams.get("conversationId")
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 })
    }

    const supabase = await createClient()

    const {
      data: { user },
    } = await getAuthenticatedUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { data: teamMember } = await supabase
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .single()

    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    }

    const { data: connection } = await supabase
      .from("outlook_connections")
      .select("*")
      .eq("team_member_id", teamMember.id)
      .maybeSingle()

    if (!connection || connection.is_active === false) {
      return NextResponse.json({ error: "Outlook is not connected" }, { status: 409 })
    }

    const detail = await fetchThreadDetail(connection as OutlookConnectionRow, supabase, conversationId)
    if (!detail) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (err) {
    if (err instanceof GraphApiError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json(
        { error: "Outlook access needs to be reconnected to view this thread." },
        { status: 409 },
      )
    }
    console.error("[outlook] thread detail error:", err)
    // Pass Graph's own sentence through. "Please try again" on a query
    // Graph will reject every time is a dead end for whoever hits it.
    return NextResponse.json({ error: describeGraphError(err) }, { status: 500 })
  }
}
