import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyListAll, calendlyRequest, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Reads availability data for a team member's Calendly connection.
 * Requires `availability:read`.
 *
 * Returns:
 *  - schedules           the user's recurring availability rules
 *  - busyTimes           busy slots in the supplied window (default ±7d)
 *  - eventTypeAvail      availability per event type (when ?eventType=...)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const sp = request.nextUrl.searchParams

    let teamMemberId = sp.get("teamMemberId")
    if (!teamMemberId) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      const { data: tm } = await supabase
        .from("team_members")
        .select("id")
        .eq("auth_user_id", user.id)
        .single()
      teamMemberId = tm?.id ?? null
    }
    if (!teamMemberId) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    }

    const { data: connection } = await supabase
      .from("calendly_connections")
      .select("*")
      .eq("team_member_id", teamMemberId)
      .eq("is_active", true)
      .maybeSingle()

    if (!connection) {
      return NextResponse.json(
        { error: "Calendly not connected", needsConnect: true },
        { status: 404 },
      )
    }
    const conn = connection as CalendlyConnectionRow

    const startTime = sp.get("start_time") || new Date().toISOString()
    const endTime =
      sp.get("end_time") ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const eventTypeUri = sp.get("eventType")

    const [schedules, busyTimes, eventTypeAvail] = await Promise.all([
      calendlyListAll<any>(conn, supabase, "/user_availability_schedules", {
        query: { user: conn.calendly_user_uri, count: 100 },
      }).catch(() => []),
      calendlyListAll<any>(conn, supabase, "/user_busy_times", {
        query: {
          user: conn.calendly_user_uri,
          start_time: startTime,
          end_time: endTime,
          count: 100,
        },
      }).catch(() => []),
      eventTypeUri
        ? calendlyRequest<any>(conn, supabase, "/event_type_available_times", {
            query: {
              event_type: eventTypeUri,
              start_time: startTime,
              end_time: endTime,
            },
          }).catch(() => null)
        : Promise.resolve(null),
    ])

    return NextResponse.json({
      schedules,
      busyTimes,
      eventTypeAvailability: eventTypeAvail,
      window: { startTime, endTime },
    })
  } catch (err: any) {
    console.error("[calendly] /availability error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to fetch availability" },
      { status: err?.status || 500 },
    )
  }
}
