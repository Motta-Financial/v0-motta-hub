import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyRequest, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Creates a single-use scheduling link from an existing event type.
 * Requires `scheduling_links:write`.
 *
 * POST body: { eventTypeUri, maxEventCount?, teamMemberId? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { eventTypeUri, maxEventCount = 1, teamMemberId } = await request.json()
    if (!eventTypeUri) {
      return NextResponse.json({ error: "eventTypeUri required" }, { status: 400 })
    }

    let resolvedTeamMember: string | null = teamMemberId ?? null
    if (!resolvedTeamMember) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      const { data: tm } = await supabase
        .from("team_members")
        .select("id")
        .eq("auth_user_id", user.id)
        .single()
      resolvedTeamMember = tm?.id ?? null
    }
    if (!resolvedTeamMember) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    }

    const { data: connection } = await supabase
      .from("calendly_connections")
      .select("*")
      .eq("team_member_id", resolvedTeamMember)
      .eq("is_active", true)
      .maybeSingle()
    if (!connection) {
      return NextResponse.json(
        { error: "Calendly not connected", needsConnect: true },
        { status: 404 },
      )
    }

    const created = await calendlyRequest<{ resource: any }>(
      connection as CalendlyConnectionRow,
      supabase,
      "/scheduling_links",
      {
        method: "POST",
        body: {
          owner: eventTypeUri,
          owner_type: "EventType",
          max_event_count: maxEventCount,
        },
      },
    )

    return NextResponse.json({ link: created?.resource ?? null })
  } catch (err: any) {
    console.error("[calendly] /scheduling-links error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to create scheduling link" },
      { status: err?.status || 500 },
    )
  }
}
