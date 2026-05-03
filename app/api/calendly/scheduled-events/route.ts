import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyListAll } from "@/lib/calendly-api"

/**
 * Lists scheduled events for a team member's Calendly connection.
 * Time window defaults to "from now → +90 days"; callers can override
 * via `min_start_time` / `max_start_time`.
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

    const status = sp.get("status") || "active"
    const minStartTime = sp.get("min_start_time") || new Date().toISOString()
    const maxStartTime =
      sp.get("max_start_time") ||
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()

    const events = await calendlyListAll<any>(connection as any, supabase, "/scheduled_events", {
      query: {
        user: connection.calendly_user_uri,
        status,
        min_start_time: minStartTime,
        max_start_time: maxStartTime,
        sort: "start_time:asc",
        count: 100,
      },
    })

    return NextResponse.json(events)
  } catch (err) {
    console.error("[calendly] /scheduled-events error:", err)
    return NextResponse.json({ error: "Failed to fetch scheduled events" }, { status: 500 })
  }
}
