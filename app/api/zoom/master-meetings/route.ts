// Master meetings endpoint -- returns the union of upcoming meetings
// across every team member who has installed the Hub on their Zoom
// account.
//
// Earlier versions of this route used Zoom Server-to-Server OAuth
// (`/v2/users` admin list + per-user `/users/:id/meetings`), but the
// integration has moved to per-user OAuth: each connected team member
// has a row in `zoom_connections` with their own access_token and we
// can only call `/users/me/meetings` with their token, not arbitrary
// users' meetings via an admin token.
//
// We build the response in two passes:
//   1. Load every active+sync_enabled row from `zoom_connections`.
//      The connection rows already carry the user's display data
//      (zoom_email, zoom_first_name, zoom_pic_url, etc.), so the
//      `users[]` array in the response is constructed from that
//      cached metadata, no live `/users` call needed.
//   2. For each connection, call `/users/me/meetings` with that
//      user's token via `zoomFetch`, which auto-refreshes on 401.
//      Failures for one user don't block others -- we collect errors
//      per-user so the dashboard can surface "Dat's connection failed"
//      without breaking the rest of the master view.
//
// The shape of the response is preserved (`meetings`, `users`, `total`)
// so the existing dashboard component renders without changes.

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getActiveZoomConnections, zoomFetch, type ZoomConnection } from "@/lib/zoom-auth"

type MeetingType = "upcoming" | "scheduled" | "live"

function connectionToUser(c: ZoomConnection) {
  return {
    id: c.zoom_user_id,
    email: c.zoom_email,
    first_name: c.zoom_first_name ?? "",
    last_name: c.zoom_last_name ?? "",
    display_name: c.zoom_display_name ?? c.zoom_email,
    pic_url: c.zoom_pic_url ?? "",
    type: c.zoom_user_type ?? 1,
    status: "active" as const,
    timezone: c.zoom_timezone ?? null,
    team_member_id: c.team_member_id,
    connection_id: c.id,
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = (searchParams.get("type") ?? "upcoming") as MeetingType
    const fromDate = searchParams.get("from")
    const toDate = searchParams.get("to")

    const connections = await getActiveZoomConnections()

    if (connections.length === 0) {
      // No-op response so the dashboard can render an empty state
      // instead of an error banner. The "0 users connected" copy in
      // the UI already tells the user what to do next.
      return NextResponse.json({ meetings: [], users: [], total: 0 })
    }

    const users = connections.map(connectionToUser)

    // Fetch every connection's meetings in parallel. Each request goes
    // through zoomFetch so an expired access_token gets refreshed and
    // retried transparently.
    const perUserResults = await Promise.all(
      connections.map(async (conn) => {
        try {
          const res = await zoomFetch(
            conn,
            `https://api.zoom.us/v2/users/me/meetings?type=${type}&page_size=100`,
          )
          if (!res.ok) {
            const body = await res.text()
            console.error(
              `[v0] [Zoom Master Meetings] /users/me/meetings failed for ${conn.zoom_email}: ${res.status} ${body}`,
            )
            return { conn, meetings: [] as any[], error: `${res.status}` }
          }
          const data = await res.json()
          return { conn, meetings: (data.meetings ?? []) as any[], error: null }
        } catch (err) {
          console.error(`[v0] [Zoom Master Meetings] Exception for ${conn.zoom_email}:`, err)
          return {
            conn,
            meetings: [] as any[],
            error: err instanceof Error ? err.message : "unknown",
          }
        }
      }),
    )

    // Stamp host metadata onto each meeting so the dashboard can group
    // by host without an extra lookup.
    const allMeetings = perUserResults.flatMap(({ conn, meetings }) =>
      meetings.map((meeting: any) => ({
        ...meeting,
        host_name: conn.zoom_display_name ?? conn.zoom_email,
        host_email: conn.zoom_email,
        host_pic_url: conn.zoom_pic_url ?? "",
      })),
    )

    // Sort ascending by start_time so the dashboard shows the next
    // meeting first. Some meetings (recurring with no fixed time) have
    // no start_time -- push those to the end.
    allMeetings.sort((a, b) => {
      const ta = a.start_time ? new Date(a.start_time).getTime() : Number.POSITIVE_INFINITY
      const tb = b.start_time ? new Date(b.start_time).getTime() : Number.POSITIVE_INFINITY
      return ta - tb
    })

    // Optional date filter -- mostly used by the calendar grid view.
    let filtered = allMeetings
    if (fromDate) {
      const from = new Date(fromDate).getTime()
      filtered = filtered.filter((m) => m.start_time && new Date(m.start_time).getTime() >= from)
    }
    if (toDate) {
      const to = new Date(toDate).getTime()
      filtered = filtered.filter((m) => m.start_time && new Date(m.start_time).getTime() <= to)
    }

    return NextResponse.json({
      meetings: filtered,
      users,
      total: filtered.length,
      // Surface per-user errors so the dashboard can show a "1 of 3
      // connections failed to sync" banner if needed. Empty in the
      // happy path.
      errors: perUserResults
        .filter((r) => r.error)
        .map((r) => ({ zoom_email: r.conn.zoom_email, error: r.error })),
    })
  } catch (error) {
    console.error("[v0] [Zoom Master Meetings] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch meetings" },
      { status: 500 },
    )
  }
}

// POST -- sync upcoming meetings to `zoom_meetings` table and post
// notifications. Uses the same per-connection iteration as GET.
export async function POST() {
  try {
    const supabaseAdmin = createAdminClient()
    const connections = await getActiveZoomConnections()

    if (connections.length === 0) {
      return NextResponse.json({ success: true, meetingsSynced: 0, todayMeetings: 0 })
    }

    let meetingsSynced = 0
    const allMeetings: any[] = []

    for (const conn of connections) {
      try {
        const res = await zoomFetch(
          conn,
          `https://api.zoom.us/v2/users/me/meetings?type=upcoming&page_size=100`,
        )
        if (!res.ok) {
          console.error(
            `[v0] [Zoom Master Meetings] Sync failed for ${conn.zoom_email}: ${res.status}`,
          )
          continue
        }
        const data = await res.json()
        const meetings = (data.meetings ?? []) as any[]

        for (const meeting of meetings) {
          // Upsert the meeting into Supabase. The unique key is the
          // Zoom-assigned numeric meeting ID. raw_data captures the
          // entire payload for any future fields we haven't mapped.
          const { error } = await supabaseAdmin.from("zoom_meetings").upsert(
            {
              zoom_meeting_id: meeting.id,
              zoom_uuid: meeting.uuid,
              zoom_host_id: meeting.host_id,
              topic: meeting.topic,
              meeting_type: meeting.type,
              status: meeting.status ?? "scheduled",
              start_time: meeting.start_time,
              duration: meeting.duration,
              timezone: meeting.timezone,
              agenda: meeting.agenda,
              join_url: meeting.join_url,
              password: meeting.password,
              host_email: conn.zoom_email,
              raw_data: meeting,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "zoom_meeting_id" },
          )

          if (!error) {
            meetingsSynced++
            allMeetings.push({
              ...meeting,
              host_name: conn.zoom_display_name ?? conn.zoom_email,
              host_email: conn.zoom_email,
            })
          } else {
            console.error(`[v0] [Zoom Master Meetings] Upsert failed for ${meeting.id}:`, error)
          }
        }

        await supabaseAdmin
          .from("zoom_connections")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", conn.id)
      } catch (err) {
        console.error(`[v0] [Zoom Master Meetings] Sync exception for ${conn.zoom_email}:`, err)
      }
    }

    await supabaseAdmin.from("zoom_sync_log").insert({
      sync_type: "meetings",
      status: "completed",
      completed_at: new Date().toISOString(),
      meetings_synced: meetingsSynced,
    })

    // Notify team members about meetings happening today.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todayMeetings = allMeetings.filter((m) => {
      if (!m.start_time) return false
      const startTime = new Date(m.start_time)
      return startTime >= today && startTime < tomorrow
    })

    if (todayMeetings.length > 0) {
      const { data: teamMembers } = await supabaseAdmin
        .from("team_members")
        .select("id")
        .eq("is_active", true)
        .not("role", "eq", "Company")
        .not("role", "eq", "Alumni")

      if (teamMembers && teamMembers.length > 0) {
        const notifications = teamMembers.map((tm) => ({
          team_member_id: tm.id,
          type: "zoom_meeting",
          title: `${todayMeetings.length} Zoom meeting${todayMeetings.length > 1 ? "s" : ""} scheduled today`,
          message: todayMeetings
            .map((m) => `${m.topic} at ${new Date(m.start_time).toLocaleTimeString()}`)
            .join(", "),
          is_read: false,
        }))

        await supabaseAdmin.from("notifications").insert(notifications)
      }
    }

    return NextResponse.json({
      success: true,
      meetingsSynced,
      todayMeetings: todayMeetings.length,
    })
  } catch (error) {
    console.error("[v0] [Zoom Master Meetings] Sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync meetings" },
      { status: 500 },
    )
  }
}
