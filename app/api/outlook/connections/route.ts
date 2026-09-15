import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

/**
 * GET → the signed-in user's own Outlook connection, shaped for
 * components/settings/outlook-dashboard.tsx. Unlike the Calendly
 * connections route, this does NOT use the admin client — Outlook is a
 * personal mailbox connection, not a firm-wide roster, so RLS scoping
 * the response to the caller's own row is exactly what we want.
 *
 * Token fields are never selected here.
 */
export async function GET() {
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

    const { data: connection, error } = await supabase
      .from("outlook_connections")
      .select(
        `id,
         outlook_email,
         outlook_display_name,
         is_active,
         sync_enabled,
         last_synced_at,
         last_sync_error,
         webhook_subscribed,
         emails_synced_count,
         events_synced_count,
         created_at,
         updated_at`,
      )
      .eq("team_member_id", teamMember.id)
      .maybeSingle()

    if (error) {
      console.error("[outlook] connection lookup failed:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!connection) {
      return NextResponse.json({
        status: "not_connected",
        mailbox: null,
        connectedAt: null,
        lastSyncAt: null,
        emailsSynced: 0,
        calendarEventsSynced: 0,
        webhookConfigured: false,
        reconnectReason: null,
        brokenAt: null,
      })
    }

    const status = connection.is_active === false ? "needs_reconnect" : "connected"

    return NextResponse.json({
      status,
      mailbox: connection.outlook_email || connection.outlook_display_name,
      connectedAt: connection.created_at,
      lastSyncAt: connection.last_synced_at,
      emailsSynced: connection.emails_synced_count ?? 0,
      calendarEventsSynced: connection.events_synced_count ?? 0,
      webhookConfigured: connection.webhook_subscribed ?? false,
      reconnectReason:
        status === "needs_reconnect"
          ? connection.last_sync_error || "Your password changed, or access was revoked."
          : null,
      brokenAt: status === "needs_reconnect" ? connection.updated_at : null,
    })
  } catch (err) {
    console.error("[outlook] connections error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
