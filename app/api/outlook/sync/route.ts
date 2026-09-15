import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import {
  fetchRecentMessages,
  fetchSyncCounts,
  fetchUpcomingEvents,
  type OutlookConnectionRow,
} from "@/lib/outlook-api"

/**
 * POST → live-syncs the signed-in user's Outlook connection: pulls
 * recent inbox messages + upcoming calendar events from Microsoft
 * Graph, refreshes the stat-tile counts, and returns everything the
 * dashboard's tabs need in one round trip. Backs both the "Sync now"
 * and "Refresh" buttons in the dashboard.
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

    if (!connection) {
      return NextResponse.json({ error: "Outlook is not connected" }, { status: 404 })
    }
    if (connection.is_active === false) {
      return NextResponse.json({ error: "Connection needs to be reauthorized" }, { status: 409 })
    }

    const row = connection as OutlookConnectionRow

    const [messages, events, counts] = await Promise.all([
      fetchRecentMessages(row, supabase, 10),
      fetchUpcomingEvents(row, supabase, 10),
      fetchSyncCounts(row, supabase),
    ])

    const now = new Date().toISOString()
    await supabase
      .from("outlook_connections")
      .update({
        last_synced_at: now,
        emails_synced_count: counts.emails,
        events_synced_count: counts.events,
        last_sync_error: null,
        updated_at: now,
      })
      .eq("id", row.id)

    return NextResponse.json({
      lastSyncAt: now,
      emailsSynced: counts.emails,
      calendarEventsSynced: counts.events,
      recentEmails: messages.map((m) => ({
        id: m.id,
        subject: m.subject || "(no subject)",
        from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Unknown sender",
        receivedAt: m.receivedDateTime,
        preview: m.bodyPreview || "",
      })),
      calendarEvents: events.map((e) => ({
        id: e.id,
        title: e.subject || "(no title)",
        startsAt: e.start?.dateTime ? `${e.start.dateTime}Z`.replace("ZZ", "Z") : new Date().toISOString(),
        attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
        location: e.location?.displayName || null,
      })),
    })
  } catch (err) {
    console.error("[outlook] sync error:", err)
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
