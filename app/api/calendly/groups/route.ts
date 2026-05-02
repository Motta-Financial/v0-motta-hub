import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyListAll, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Lists Calendly groups in the organization. Requires `groups:read`.
 * Optionally returns each group's relationships (members) when
 * `includeRelationships=true` is passed.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const sp = request.nextUrl.searchParams
    const explicit = sp.get("teamMemberId")
    const includeRelationships = sp.get("includeRelationships") === "true"

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

    if (!connection || !connection.calendly_organization_uri) {
      return NextResponse.json(
        { error: "No connection or organization URI", needsConnect: !connection },
        { status: 404 },
      )
    }

    const groups = await calendlyListAll<any>(
      connection as CalendlyConnectionRow,
      supabase,
      "/groups",
      { query: { organization: connection.calendly_organization_uri, count: 100 } },
    )

    if (!includeRelationships) {
      return NextResponse.json({ groups })
    }

    const enriched = await Promise.all(
      groups.map(async (group: any) => {
        const relationships = await calendlyListAll<any>(
          connection as CalendlyConnectionRow,
          supabase,
          "/group_relationships",
          { query: { group: group.uri, count: 100 } },
        ).catch(() => [])
        return { ...group, relationships }
      }),
    )
    return NextResponse.json({ groups: enriched })
  } catch (err: any) {
    console.error("[calendly] /groups error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to fetch groups" },
      { status: err?.status || 500 },
    )
  }
}
