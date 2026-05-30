/**
 * Hub Meetings sync — populate the unified `public.meetings` table from the
 * Calendly and Zoom records the Hub already syncs, producing one Hub Meeting
 * ID per real-world meeting.
 *
 * The hard part is de-duplication: a single client call can show up as BOTH a
 * `calendly_events` row (how it was booked) AND a `zoom_meetings` row (how it
 * was held). The existing Calendly↔Zoom bridge already figured out which Zoom
 * meeting came from which Calendly event and persisted it on
 * `zoom_meetings.calendly_event_id` (internal calendly uuid). We honor that:
 *
 *   • A BRIDGED pair  → ONE meeting row, keyed by the Calendly event, with the
 *     Zoom meeting attached (carries both event ids → one Hub Meeting ID).
 *   • A lone Calendly event → one meeting row keyed by calendly_event_id.
 *   • A lone Zoom meeting (no bridge) → one meeting row keyed by zoom_meeting_id.
 *
 * `meetings.calendly_event_id` / `meetings.zoom_meeting_id` store the INTERNAL
 * uuids (as text) — matching the convention already used by
 * `lib/calendly-sync.ts`. The partial unique indexes added in migration 334
 * make these upserts idempotent.
 *
 * Client / org / host are copied from the resolved link tables
 * (`calendly_event_clients`, `zoom_meeting_clients`) — we do NOT re-run any
 * matching here; that's the job of the participant sweep / bridge / ALFRED
 * triage. We just mirror whatever they decided.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface SyncHubMeetingsResult {
  calendlyProcessed: number
  zoomProcessed: number
  upserts: number
  errors: string[]
}

interface ClientLink {
  contact_id: string | null
  organization_id: string | null
  confidence: number | null
  needs_review: boolean | null
}

/** Pick the best contact/org link: confirmed over needs_review, then highest confidence. */
function bestLink(links: ClientLink[] | null | undefined): {
  contactId: string | null
  organizationId: string | null
} {
  if (!links || links.length === 0) return { contactId: null, organizationId: null }
  const sorted = [...links].sort((a, b) => {
    if (!!a.needs_review !== !!b.needs_review) return a.needs_review ? 1 : -1
    return (b.confidence ?? 0) - (a.confidence ?? 0)
  })
  const withContact = sorted.find((l) => l.contact_id) ?? sorted[0]
  return {
    contactId: withContact.contact_id ?? null,
    organizationId: withContact.organization_id ?? null,
  }
}

function meetingTypeFromCalendly(name: string | null): string {
  return "client_meeting"
}

/**
 * Run the full sync. Safe to run repeatedly (idempotent upserts).
 */
export async function syncHubMeetings(admin: SupabaseClient): Promise<SyncHubMeetingsResult> {
  const errors: string[] = []
  let upserts = 0

  // ── 1. Load Calendly events + their client links + host ──────────────
  const { data: calEvents, error: calErr } = await admin
    .from("calendly_events")
    .select("id, name, status, start_time, end_time, location_type, join_url, team_member_id, event_type_name")
  if (calErr) errors.push(`calendly_events: ${calErr.message}`)

  const calEventIds = (calEvents ?? []).map((e) => e.id)
  const calLinksByEvent = new Map<string, ClientLink[]>()
  if (calEventIds.length > 0) {
    const { data: calLinks } = await admin
      .from("calendly_event_clients")
      .select("calendly_event_id, contact_id, organization_id, confidence, needs_review")
      .in("calendly_event_id", calEventIds)
    for (const l of calLinks ?? []) {
      const arr = calLinksByEvent.get(l.calendly_event_id) ?? []
      arr.push(l)
      calLinksByEvent.set(l.calendly_event_id, arr)
    }
  }

  // Map of calendly internal id -> its bridged zoom meeting (internal id).
  const { data: bridgedZoom } = await admin
    .from("zoom_meetings")
    .select("id, calendly_event_id")
    .not("calendly_event_id", "is", null)
  const zoomByCalendly = new Map<string, string>()
  for (const z of bridgedZoom ?? []) {
    if (z.calendly_event_id) zoomByCalendly.set(z.calendly_event_id, z.id)
  }

  // ── 2. Upsert one meeting per Calendly event ─────────────────────────
  for (const ev of calEvents ?? []) {
    const { contactId, organizationId } = bestLink(calLinksByEvent.get(ev.id))
    const bridgedZoomId = zoomByCalendly.get(ev.id) ?? null

    const row: Record<string, unknown> = {
      calendly_event_id: ev.id, // internal uuid as text
      zoom_meeting_id: bridgedZoomId, // attach bridged zoom → one Hub Meeting ID
      title: ev.name ?? ev.event_type_name ?? "Meeting",
      scheduled_start: ev.start_time,
      scheduled_end: ev.end_time,
      status: ev.status === "active" ? "scheduled" : "cancelled",
      location_type: ev.location_type || "virtual",
      video_link: ev.join_url,
      meeting_type: meetingTypeFromCalendly(ev.name),
      contact_id: contactId,
      organization_id: organizationId,
      host_id: ev.team_member_id ?? null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await admin
      .from("meetings")
      .upsert(row, { onConflict: "calendly_event_id", ignoreDuplicates: false })
    if (error) errors.push(`meeting (calendly ${ev.id}): ${error.message}`)
    else upserts++
  }

  // ── 3. Load Zoom meetings + their client links ───────────────────────
  const { data: zoomMeetings, error: zoomErr } = await admin
    .from("zoom_meetings")
    .select("id, zoom_meeting_id, topic, status, start_time, duration, join_url, team_member_id, calendly_event_id")
  if (zoomErr) errors.push(`zoom_meetings: ${zoomErr.message}`)

  const zoomIds = (zoomMeetings ?? []).map((z) => z.id)
  const zoomLinksByMeeting = new Map<string, ClientLink[]>()
  if (zoomIds.length > 0) {
    const { data: zoomLinks } = await admin
      .from("zoom_meeting_clients")
      .select("zoom_meeting_id, contact_id, organization_id, confidence, needs_review")
      .in("zoom_meeting_id", zoomIds)
    for (const l of zoomLinks ?? []) {
      const arr = zoomLinksByMeeting.get(l.zoom_meeting_id) ?? []
      arr.push(l)
      zoomLinksByMeeting.set(l.zoom_meeting_id, arr)
    }
  }

  // ── 4. Upsert one meeting per UN-bridged Zoom meeting ────────────────
  // Bridged Zoom meetings were already attached to their Calendly row above.
  for (const zm of zoomMeetings ?? []) {
    if (zm.calendly_event_id) continue // already represented by the Calendly meeting

    const { contactId, organizationId } = bestLink(zoomLinksByMeeting.get(zm.id))
    const end =
      zm.start_time && zm.duration
        ? new Date(new Date(zm.start_time).getTime() + zm.duration * 60_000).toISOString()
        : null

    const row: Record<string, unknown> = {
      zoom_meeting_id: zm.id, // internal uuid as text
      title: zm.topic ?? "Zoom meeting",
      scheduled_start: zm.start_time,
      scheduled_end: end,
      status: zm.status === "ended" ? "completed" : "scheduled",
      location_type: "virtual",
      video_link: zm.join_url,
      meeting_type: "client_meeting",
      contact_id: contactId,
      organization_id: organizationId,
      host_id: zm.team_member_id ?? null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await admin
      .from("meetings")
      .upsert(row, { onConflict: "zoom_meeting_id", ignoreDuplicates: false })
    if (error) errors.push(`meeting (zoom ${zm.id}): ${error.message}`)
    else upserts++
  }

  return {
    calendlyProcessed: calEvents?.length ?? 0,
    zoomProcessed: zoomMeetings?.length ?? 0,
    upserts,
    errors,
  }
}
