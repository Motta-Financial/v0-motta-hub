import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyListAll, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Reads the organization activity log. Requires `activity_log:read`
 * and an admin-level role within the Calendly organization.
 *
 * Optional filters:
 *  - actorType, actorEmail
 *  - namespace, action
 *  - minOccurredAt, maxOccurredAt
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

    if (!connection || !connection.calendly_organization_uri) {
      return NextResponse.json(
        { error: "No connection or organization URI", needsConnect: !connection },
        { status: 404 },
      )
    }

    const entries = await calendlyListAll<any>(
      connection as CalendlyConnectionRow,
      supabase,
      "/activity_log_entries",
      {
        query: {
          organization: connection.calendly_organization_uri,
          actor_type: sp.get("actorType") || undefined,
          actor_email: sp.get("actorEmail") || undefined,
          namespace: sp.get("namespace") || undefined,
          action: sp.get("action") || undefined,
          min_occurred_at: sp.get("minOccurredAt") || undefined,
          max_occurred_at: sp.get("maxOccurredAt") || undefined,
          count: 100,
        },
        // Activity log can be huge — cap to a sensible default.
        maxPages: 5,
      },
    )

    return NextResponse.json({ entries })
  } catch (err: any) {
    console.error("[calendly] /activity-log error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to fetch activity log" },
      { status: err?.status || 500 },
    )
  }
}
