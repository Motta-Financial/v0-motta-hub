import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Team Calendar — DB-backed read endpoint.
 *
 * Reads the already-synced rows in `calendly_events` (plus invitees,
 * tags, and comment counts) for a given window. Unlike the legacy
 * /api/calendly/master-calendar route — which live-fetches from
 * Calendly on every page load — this endpoint trusts our local sync
 * pipeline and renders in milliseconds. The webhook + cron keep the
 * underlying tables fresh, so a user clicking "Sync & Notify" still
 * works against the same source of truth.
 *
 * Query params:
 *   • from   ISO date  (default: today)
 *   • to     ISO date  (default: from + 60 days)
 *   • status active|canceled|all  (default: all — month view shows both
 *     so cancelled meetings don't disappear without warning)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const sp = request.nextUrl.searchParams
    const now = new Date()
    const from = sp.get("from") || new Date(now.getTime() - 7 * 86400000).toISOString()
    const to = sp.get("to") || new Date(now.getTime() + 60 * 86400000).toISOString()
    const status = sp.get("status") || "all"

    let q = supabase
      .from("calendly_events")
      .select(
        `
          id,
          calendly_uuid,
          name,
          status,
          start_time,
          end_time,
          location_type,
          location,
          join_url,
          team_member_id,
          calendly_user_uri,
          calendly_user_name,
          calendly_user_email,
          team_members:team_member_id ( id, full_name, email, avatar_url, title ),
          calendly_invitees ( id, name, email, status, timezone, questions_answers, contact_id ),
          calendly_event_clients ( id, contact_id, organization_id, link_source, match_method, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name ) ),
          calendly_event_work_items ( id, work_item_id, work_item:work_items ( id, title, client_name, status ) ),
          calendly_event_services ( id, service_id, service:services ( id, name, category ) ),
          calendly_event_comments ( id )
        `,
      )
      .gte("start_time", from)
      .lte("start_time", to)
      .order("start_time", { ascending: true })
      .limit(500)

    if (status !== "all") {
      q = q.eq("status", status)
    }

    const { data, error } = await q
    if (error) {
      console.error("[team-calendar] query failed:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Flatten the comment array down to a count — saves bandwidth and the
    // detail dialog re-fetches comments on demand anyway.
    const events = (data || []).map((row: any) => ({
      ...row,
      commentCount: Array.isArray(row.calendly_event_comments)
        ? row.calendly_event_comments.length
        : 0,
      // Drop the heavy field once we've counted it.
      calendly_event_comments: undefined,
    }))

    return NextResponse.json({ events, totalEvents: events.length })
  } catch (err) {
    console.error("[team-calendar] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
