import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Team Calendar — DB-backed read endpoint.
 *
 * Reads the already-synced rows in `calendly_events` (plus invitees,
 * tags, and comment counts) for a given window AND `zoom_meetings`
 * (with their own client/work-item tag joins) for the same window,
 * normalises both into the `TeamCalendarEvent` shape, and returns
 * them as one merged list. Unlike the legacy /api/calendly/master-
 * calendar route — which live-fetches from Calendly on every page
 * load — this endpoint trusts our local sync pipelines and renders
 * in milliseconds. The webhook + cron keep both source tables fresh
 * (Calendly via `cron/calendly-sync`, Zoom via webhook + Zoom OAuth
 * sync), so the calendar view stays a single source of truth.
 *
 * Each row carries a `source: "calendly" | "zoom"` discriminator that
 * the UI can use to (a) tag the chip visually and (b) skip the
 * Calendly-specific tag/comment tabs in the detail dialog when the
 * row is a Zoom meeting. Field-level normalisation rules are noted
 * inline alongside the Zoom mapping below.
 *
 * Query params:
 *   • from    ISO date  (default: today)
 *   • to      ISO date  (default: from + 60 days)
 *   • status  active|canceled|all  (default: all — month view shows
 *     both so cancelled meetings don't disappear without warning)
 *   • sources comma list, subset of "calendly,zoom"
 *     (default: "calendly,zoom"). Lets a future UI toggle either side
 *     off without touching the API.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const sp = request.nextUrl.searchParams
    const now = new Date()
    const from = sp.get("from") || new Date(now.getTime() - 7 * 86400000).toISOString()
    const to = sp.get("to") || new Date(now.getTime() + 60 * 86400000).toISOString()
    const status = sp.get("status") || "all"
    // Default to BOTH sources so the calendar shows everything; a future
    // toolbar toggle can drop either side without the API needing to
    // change. Also accept a single value or comma-list of values.
    const sourcesParam = sp.get("sources")
    const sources = sourcesParam
      ? new Set(
          sourcesParam
            .split(",")
            .map((s: string) => s.trim().toLowerCase())
            .filter(Boolean),
        )
      : new Set(["calendly", "zoom"])

    // ── 1. Calendly events ────────────────────────────────────────
    // The Calendly side already ships full invitee/tag/comment joins
    // because those features (auto-matching, comments, etc.) are
    // Calendly-only today. We only run this query if Calendly is in
    // the requested source set so the toggle can fully short-circuit.
    let calendlyEvents: any[] = []
    if (sources.has("calendly")) {
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
            event_type_uuid,
            event_type_name,
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
        console.error("[team-calendar] calendly query failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      calendlyEvents = (data || []).map((row: any) => ({
        ...row,
        // Tag every row with its origin so the client UI can branch
        // on it (chip badge, dialog tab visibility, etc.). We also
        // drop the comment array down to a count to save bandwidth.
        source: "calendly" as const,
        commentCount: Array.isArray(row.calendly_event_comments)
          ? row.calendly_event_comments.length
          : 0,
        calendly_event_comments: undefined,
      }))
    }

    // ── 2. Zoom meetings ──────────────────────────────────────────
    // Zoom doesn't have native "invitees" the way Calendly does — the
    // invitee field on a Zoom meeting is just the host email — so we
    // pull host metadata from `zoom_connections.team_members` and
    // synthesise a single invitee entry from `host_email` so the
    // detail dialog still has someone to render. Tag joins use the
    // `zoom_meeting_clients` / `zoom_meeting_work_items` tables that
    // were added in 046_zoom_meeting_tags.sql.
    //
    // We deliberately filter by `start_time` (the scheduled start),
    // not `started_at` (which only populates after the webhook lands),
    // so future scheduled meetings still show up in the window.
    let zoomEvents: any[] = []
    if (sources.has("zoom")) {
      const { data: zoomRows, error: zoomErr } = await supabase
        .from("zoom_meetings")
        .select(
          `
            id,
            zoom_uuid,
            zoom_meeting_id,
            topic,
            agenda,
            start_time,
            duration,
            status,
            join_url,
            host_email,
            zoom_host_id,
            timezone,
            team_member_id,
            started_at,
            ended_at,
            team_members:team_member_id ( id, full_name, email, avatar_url, title ),
            zoom_meeting_clients ( id, contact_id, organization_id, link_source, match_method, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name ) ),
            zoom_meeting_work_items ( id, work_item_id, work_item:work_items ( id, title, client_name, status ) )
          `,
        )
        .gte("start_time", from)
        .lte("start_time", to)
        .order("start_time", { ascending: true })
        .limit(500)
      if (zoomErr) {
        // Don't fail the whole calendar if Zoom isn't queryable yet —
        // log and fall back to an empty Zoom set so users still see
        // their Calendly meetings.
        console.error("[team-calendar] zoom query failed:", zoomErr)
        zoomEvents = []
      } else {
        zoomEvents = (zoomRows || []).map((m: any) => {
          // Zoom stores duration in minutes; the calendar grid wants a
          // concrete end_time so it can lay the chip out in the day
          // column. Default to 30 minutes if duration is missing so
          // we never render a zero-height chip.
          const startMs = m.start_time ? new Date(m.start_time).getTime() : 0
          const durationMin =
            typeof m.duration === "number" && m.duration > 0 ? m.duration : 30
          const endIso = startMs
            ? new Date(startMs + durationMin * 60_000).toISOString()
            : m.start_time

          // Calendly's `status` is "active" | "canceled". The Zoom
          // table uses Zoom's own vocabulary ("waiting", "started",
          // "finished", null for not-yet-started) — we map those to
          // "active" so the existing month-view filter logic still
          // hides cancelled meetings when the toolbar requests it.
          const normalizedStatus =
            m.status === "canceled" || m.status === "deleted"
              ? "canceled"
              : "active"

          // The grid already has a deterministic name-hash hue for
          // unknown event types, but we'd rather every Zoom meeting
          // share one consistent color across the calendar. Setting
          // `event_type_name = "Zoom"` makes them all chip-colored
          // identically AND lets users override the hue from the
          // existing Colors settings dialog without any new UI.
          const eventTypeName = "Zoom"

          // Synthesise a minimal invitee list from host_email so the
          // detail dialog has a non-empty "Invitees" section. Real
          // attendee tracking is on the roadmap (zoom_meeting_attendees
          // would be the natural home for it) but isn't wired today.
          const fakeInvitees =
            m.host_email
              ? [
                  {
                    id: `host-${m.id}`,
                    name: m.team_members?.full_name ?? m.host_email,
                    email: m.host_email,
                    status: "active",
                    timezone: m.timezone ?? null,
                    questions_answers: null,
                    contact_id: null,
                  },
                ]
              : []

          return {
            // Use the Zoom row's UUID as the calendly-shaped `id`/
            // `calendly_uuid` so the dialog's keyed lookups still
            // work; the `source` discriminator below is what the UI
            // checks before wiring up Calendly-only API calls.
            id: m.id,
            calendly_uuid: m.zoom_uuid || String(m.zoom_meeting_id || m.id),
            source: "zoom" as const,
            zoom_meeting_id: m.zoom_meeting_id, // bigint, useful client-side
            name: m.topic || "Zoom meeting",
            status: normalizedStatus,
            start_time: m.start_time,
            end_time: endIso,
            // The grid uses location_type to pick the icon in the
            // detail dialog header. "video" maps to <Video /> for us
            // (see EventDetailDialog.locationIcon).
            location_type: "video",
            location: m.timezone ? `Zoom · ${m.timezone}` : "Zoom",
            join_url: m.join_url || null,
            team_member_id: m.team_member_id,
            calendly_user_uri: null,
            calendly_user_name: m.team_members?.full_name ?? null,
            calendly_user_email: m.team_members?.email ?? m.host_email ?? null,
            event_type_uuid: null,
            event_type_name: eventTypeName,
            team_members: m.team_members ?? null,
            calendly_invitees: fakeInvitees,
            // Tag tables ARE populated for Zoom — surface them under
            // the same Calendly-shaped keys so the grid badge counts
            // ("Tag · 2") work without any client-side branching.
            calendly_event_clients: m.zoom_meeting_clients ?? [],
            calendly_event_work_items: m.zoom_meeting_work_items ?? [],
            calendly_event_services: [],
            commentCount: 0,
          }
        })
        // Apply the same status filter to Zoom that Calendly uses so
        // the toolbar's "active only" / "canceled only" toggles
        // (re-introduced in a future change) stay consistent.
        if (status !== "all") {
          zoomEvents = zoomEvents.filter((e) => e.status === status)
        }
      }
    }

    // ── 3. Merge & sort ──────────────────────────────────────────
    // Calendly already comes back ordered by start_time but Zoom is
    // ordered separately, so a final sort is required. We compare ISO
    // strings directly because they are lexicographically sortable.
    const events = [...calendlyEvents, ...zoomEvents].sort((a, b) =>
      (a.start_time || "").localeCompare(b.start_time || ""),
    )

    return NextResponse.json({
      events,
      totalEvents: events.length,
      // Lightweight diagnostic counts for the future "by source" UI;
      // the Team Calendar page can ignore these without breaking.
      counts: {
        calendly: calendlyEvents.length,
        zoom: zoomEvents.length,
      },
    })
  } catch (err) {
    console.error("[team-calendar] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
