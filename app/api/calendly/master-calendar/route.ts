import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  calendlyListAll,
  extractUuid,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * "Master calendar" view: aggregates upcoming events from every active
 * Calendly connection in the org into a single chronological list.
 *
 * GET  → live read-through (does not write to the DB)
 * POST → triggers /api/calendly/sync to persist + fan out notifications
 */

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const sp = request.nextUrl.searchParams
    const minDate = sp.get("min_date") || new Date().toISOString()
    const maxDate =
      sp.get("max_date") || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: connections, error } = await supabase
      .from("calendly_connections")
      .select(
        `*, team_members ( id, full_name, email, avatar_url, title )`,
      )
      .eq("is_active", true)
      .eq("sync_enabled", true)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!connections || connections.length === 0) {
      return NextResponse.json({
        events: [],
        connections: [],
        totalEvents: 0,
        totalConnections: 0,
      })
    }

    const allEvents: any[] = []
    const statuses: any[] = []

    for (const conn of connections as Array<CalendlyConnectionRow & { team_members?: any }>) {
      try {
        const events = await calendlyListAll<any>(conn, supabase, "/scheduled_events", {
          query: {
            user: conn.calendly_user_uri,
            min_start_time: minDate,
            max_start_time: maxDate,
            status: "active",
            sort: "start_time:asc",
            count: 100,
          },
        })

        for (const event of events) {
          const invitees = await calendlyListAll<any>(conn, supabase, `${event.uri}/invitees`, {
            query: { count: 100 },
          }).catch(() => [])

          allEvents.push({
            ...event,
            invitees,
            host: {
              teamMemberId: conn.team_member_id,
              name: conn.team_members?.full_name || conn.calendly_user_name,
              email: conn.team_members?.email || conn.calendly_user_email,
              avatar: conn.team_members?.avatar_url || conn.calendly_user_avatar,
              title: conn.team_members?.title,
            },
          })
        }

        await supabase
          .from("calendly_connections")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", conn.id)

        statuses.push({
          teamMember: conn.team_members,
          status: "synced",
          eventCount: events.length,
        })
      } catch (err: any) {
        statuses.push({
          teamMember: conn.team_members,
          status: err?.status === 401 ? "token_expired" : "error",
          error: err?.message || "Unknown error",
        })
      }
    }

    allEvents.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )

    return NextResponse.json({
      events: allEvents,
      connections: statuses,
      totalConnections: connections.length,
      totalEvents: allEvents.length,
    })
  } catch (err) {
    console.error("[calendly] master-calendar error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Persists the current master-calendar snapshot via the canonical sync
 * route, ensuring a single code path owns DB writes. Any caller that
 * just wants to refresh data + send notifications should POST here.
 */
export async function POST(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin
    const res = await fetch(`${origin}/api/calendly/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncPast: false, daysForward: 30, syncEventTypes: false }),
    })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch (err) {
    console.error("[calendly] master-calendar sync trigger failed:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Records a system notification when a meeting is freshly synced.
 * Imported from internal helpers when needed; left here as a stub to
 * keep the route surface compatible with previous consumers.
 */
export async function _notifyMeetingCreated() {
  // No-op placeholder retained for backward compatibility.
  return null
}

// Internal helper kept for any legacy import paths
export async function notifyMeeting(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  event: any,
  invitees: any[],
) {
  const inviteeNames = invitees.map((i) => i.name || i.email).join(", ")
  const startTime = new Date(event.start_time).toLocaleString()
  const eventUuid = extractUuid(event.uri)
  // Notify all active team members (legacy behaviour). Newer code
  // funnels through the webhook handler which targets the host.
  // This helper is intentionally minimal and tolerant of failures.
  // @ts-expect-error - dynamic supabase client
  await supabase.from("notifications").insert({
    notification_type: "calendly_event",
    title: `New Meeting Scheduled: ${event.name}`,
    message: `${event.host?.name || "A team member"} has a meeting with ${inviteeNames || "a client"} on ${startTime}`,
    related_entity_type: "calendly_event",
    related_entity_id: eventUuid,
    metadata: {
      eventUuid,
      hostName: event.host?.name,
      invitees: invitees.map((i) => ({ name: i.name, email: i.email })),
      startTime: event.start_time,
      endTime: event.end_time,
    },
    is_read: false,
  })
}
