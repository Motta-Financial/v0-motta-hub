import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { revokeToken } from "@/lib/calendly-api"

/**
 * Removes a Calendly connection and revokes the underlying token at
 * Calendly's auth server. Only the connection's owner (or an admin)
 * can perform this action.
 *
 * Webhook subscriptions are intentionally left in place: if a user
 * disconnects then reconnects, the existing subscription survives.
 * To remove a webhook entirely, use the dedicated webhook DELETE route.
 */
export async function POST(request: NextRequest) {
  try {
    const { teamMemberId } = await request.json()
    if (!teamMemberId) {
      return NextResponse.json({ error: "teamMemberId required" }, { status: 400 })
    }

    const supabase = await createClient()

    // Pull the connection so we can revoke the token before deleting.
    const { data: connection } = await supabase
      .from("calendly_connections")
      .select("id, access_token, calendly_user_uri")
      .eq("team_member_id", teamMemberId)
      .maybeSingle()

    if (connection?.access_token) {
      await revokeToken(connection.access_token)
    }

    const { error } = await supabase
      .from("calendly_connections")
      .delete()
      .eq("team_member_id", teamMemberId)

    if (error) {
      console.error("[calendly] disconnect delete failed:", error)
      return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
    }

    // Deactivate this person's event types so they stop appearing as a
    // discovery-call booking host immediately — otherwise the stale
    // scheduling_url from before the disconnect keeps being offered to
    // prospects until the next cron sync happens to notice (or forever,
    // if they never reconnect). Admin client because this is a
    // system-table cleanup, not a user-owned row.
    if (connection?.calendly_user_uri) {
      const admin = createAdminClient()
      const { error: eventTypeErr } = await admin
        .from("calendly_event_types")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("calendly_user_uri", connection.calendly_user_uri)
      if (eventTypeErr) {
        console.error("[calendly] disconnect: failed to deactivate event types:", eventTypeErr.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[calendly] disconnect error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
