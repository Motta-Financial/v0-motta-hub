import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchMe } from "@/lib/calendly-api"

/**
 * Returns the Calendly user profile for either:
 *  - the currently-authenticated team member (default), or
 *  - a specific team member referenced by `?teamMemberId=...`
 *
 * Always uses the per-team-member OAuth token from `calendly_connections`
 * — there is no fallback to a static `CALENDLY_ACCESS_TOKEN` so each
 * user only sees their own data.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const explicit = request.nextUrl.searchParams.get("teamMemberId")

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

    const me = await fetchMe(connection as any, supabase)
    if (!me) {
      return NextResponse.json(
        { error: "Token invalid; reauthorization required", needsReauth: true },
        { status: 401 },
      )
    }
    return NextResponse.json(me)
  } catch (err) {
    console.error("[calendly] /user error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
