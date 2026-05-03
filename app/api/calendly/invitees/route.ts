import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyListAll, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Returns invitees for a Calendly scheduled event. We pick the
 * connection that owns the event (matched against `event_memberships`
 * on the parent event row) so we use a token authorized to read it.
 *
 * Query params:
 *  - event           Calendly event URI (required)
 *  - teamMemberId    (optional; otherwise we resolve from the event)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const eventUri = request.nextUrl.searchParams.get("event")
    if (!eventUri) {
      return NextResponse.json({ error: "event URI required" }, { status: 400 })
    }
    const explicitTeamMember = request.nextUrl.searchParams.get("teamMemberId")

    // Strategy 1: caller told us which connection to use.
    let connection: CalendlyConnectionRow | null = null
    if (explicitTeamMember) {
      const { data } = await supabase
        .from("calendly_connections")
        .select("*")
        .eq("team_member_id", explicitTeamMember)
        .eq("is_active", true)
        .maybeSingle()
      connection = (data as CalendlyConnectionRow | null) ?? null
    }

    // Strategy 2: look up via the synced event row to find the host.
    if (!connection) {
      const { data: eventRow } = await supabase
        .from("calendly_events")
        .select("calendly_user_uri, calendly_connection_id")
        .eq("calendly_uri", eventUri)
        .maybeSingle()
      if (eventRow?.calendly_connection_id) {
        const { data } = await supabase
          .from("calendly_connections")
          .select("*")
          .eq("id", eventRow.calendly_connection_id)
          .eq("is_active", true)
          .maybeSingle()
        connection = (data as CalendlyConnectionRow | null) ?? null
      } else if (eventRow?.calendly_user_uri) {
        const { data } = await supabase
          .from("calendly_connections")
          .select("*")
          .eq("calendly_user_uri", eventRow.calendly_user_uri)
          .eq("is_active", true)
          .maybeSingle()
        connection = (data as CalendlyConnectionRow | null) ?? null
      }
    }

    // Strategy 3: fall back to the caller's own connection.
    if (!connection) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const { data: tm } = await supabase
          .from("team_members")
          .select("id")
          .eq("auth_user_id", user.id)
          .single()
        if (tm) {
          const { data } = await supabase
            .from("calendly_connections")
            .select("*")
            .eq("team_member_id", tm.id)
            .eq("is_active", true)
            .maybeSingle()
          connection = (data as CalendlyConnectionRow | null) ?? null
        }
      }
    }

    if (!connection) {
      return NextResponse.json(
        { error: "No Calendly connection authorized to read this event", needsConnect: true },
        { status: 404 },
      )
    }

    const invitees = await calendlyListAll<any>(connection, supabase, `${eventUri}/invitees`, {
      query: { count: 100 },
    })
    return NextResponse.json(invitees)
  } catch (err) {
    console.error("[calendly] /invitees error:", err)
    return NextResponse.json({ error: "Failed to fetch invitees" }, { status: 500 })
  }
}
