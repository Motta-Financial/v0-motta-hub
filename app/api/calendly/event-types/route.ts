import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyListAll } from "@/lib/calendly-api"

/**
 * Lists Calendly event types for a team member's connection. Pages
 * are auto-aggregated so even orgs with >100 event types return
 * complete results.
 *
 * Query params:
 *  - teamMemberId   (defaults to caller)
 *  - active=true|false
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const explicit = request.nextUrl.searchParams.get("teamMemberId")
    const activeOnly = request.nextUrl.searchParams.get("active") !== "false"

    let teamMemberId = explicit
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

    const eventTypes = await calendlyListAll<any>(connection as any, supabase, "/event_types", {
      query: {
        user: connection.calendly_user_uri,
        active: activeOnly,
        count: 100,
      },
    })

    return NextResponse.json(eventTypes)
  } catch (err) {
    console.error("[calendly] /event-types error:", err)
    return NextResponse.json({ error: "Failed to fetch event types" }, { status: 500 })
  }
}
