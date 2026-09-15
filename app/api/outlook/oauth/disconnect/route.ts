import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { removeWebhookSubscriptions, type OutlookConnectionRow } from "@/lib/outlook-api"

/**
 * Removes the signed-in user's own Outlook connection. Unlike Calendly's
 * disconnect route, this is a strictly self-service action — the Hub
 * doesn't let one teammate disconnect another's mailbox, so there's no
 * teamMemberId in the request body; it's resolved from the session.
 */
export async function POST() {
  try {
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

    if (connection) {
      await removeWebhookSubscriptions(connection as OutlookConnectionRow, supabase)
    }

    const { error } = await supabase
      .from("outlook_connections")
      .delete()
      .eq("team_member_id", teamMember.id)

    if (error) {
      console.error("[outlook] disconnect delete failed:", error)
      return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[outlook] disconnect error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Kept for compatibility with clients that call DELETE.
export const DELETE = POST
