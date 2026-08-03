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
import { findOrCreateDeal } from "@/lib/deals/find-or-create-deal"
import { chunk, fetchAllPaged } from "@/lib/supabase/fetch-all"

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

interface CalendlyEventRow {
  id: string
  name: string | null
  status: string | null
  start_time: string | null
  end_time: string | null
  location_type: string | null
  join_url: string | null
  team_member_id: string | null
  event_type_name: string | null
}

interface ZoomMeetingRow {
  id: string
  zoom_meeting_id: string | null
  topic: string | null
  status: string | null
  start_time: string | null
  duration: number | null
  join_url: string | null
  team_member_id: string | null
  calendly_event_id: string | null
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

  // Deal resolution cache for this run. Every meeting that has a resolved
  // client should hang off that contact's single open Deal (the sales
  // opportunity). Contacts repeat across many meetings, so we memoize the
  // find-or-create per contact/org key to avoid N duplicate lookups. The
  // partial unique index on deals guarantees we never create two open
  // deals for the same contact even across concurrent syncs.
  const dealCache = new Map<string, string | null>()
  async function resolveDealId(
    contactId: string | null,
    organizationId: string | null,
    title: string | null,
  ): Promise<string | null> {
    const key = contactId ? `c:${contactId}` : organizationId ? `o:${organizationId}` : null
    if (!key) return null
    if (dealCache.has(key)) return dealCache.get(key) ?? null
    let dealId: string | null = null
    try {
      const res = await findOrCreateDeal(
        {
          contactId,
          organizationId: contactId ? null : organizationId,
          title,
          source: "unknown",
        },
        { supabase: admin },
      )
      dealId = res.deal_id
    } catch (err) {
      errors.push(`deal resolve (${key}): ${(err as Error).message}`)
    }
    dealCache.set(key, dealId)
    return dealId
  }

  // ── 1. Load Calendly events + their client links + host ──────────────
  // Paged — PostgREST caps every response at 1,000 rows, so an un-ranged
  // select would silently stop mirroring meetings past that.
  let calEvents: CalendlyEventRow[] = []
  try {
    calEvents = await fetchAllPaged<CalendlyEventRow>(() =>
      admin
        .from("calendly_events")
        .select("id, name, status, start_time, end_time, location_type, join_url, team_member_id, event_type_name"),
    )
  } catch (err) {
    errors.push(`calendly_events: ${(err as Error).message}`)
  }

  const calEventIds = calEvents.map((e) => e.id)
  const calLinksByEvent = new Map<string, ClientLink[]>()
  // Chunk the .in() list (long lists blow up the request URL) and page each
  // chunk — a truncated link set would overwrite previously-linked meetings
  // with NULL contact/org on re-run.
  for (const idBatch of chunk(calEventIds)) {
    try {
      const calLinks = await fetchAllPaged<ClientLink & { calendly_event_id: string }>(() =>
        admin
          .from("calendly_event_clients")
          .select("calendly_event_id, contact_id, organization_id, confidence, needs_review")
          .in("calendly_event_id", idBatch),
      )
      for (const l of calLinks) {
        const arr = calLinksByEvent.get(l.calendly_event_id) ?? []
        arr.push(l)
        calLinksByEvent.set(l.calendly_event_id, arr)
      }
    } catch (err) {
      errors.push(`calendly_event_clients: ${(err as Error).message}`)
    }
  }

  // Map of calendly internal id -> its bridged zoom meeting (internal id).
  const zoomByCalendly = new Map<string, string>()
  try {
    const bridgedZoom = await fetchAllPaged<{ id: string; calendly_event_id: string | null }>(() =>
      admin
        .from("zoom_meetings")
        .select("id, calendly_event_id")
        .not("calendly_event_id", "is", null),
    )
    for (const z of bridgedZoom) {
      if (z.calendly_event_id) zoomByCalendly.set(z.calendly_event_id, z.id)
    }
  } catch (err) {
    errors.push(`zoom bridge: ${(err as Error).message}`)
  }

  // ── 2. Upsert one meeting per Calendly event ─────────────────────────
  const calRows: Record<string, unknown>[] = []
  for (const ev of calEvents) {
    const { contactId, organizationId } = bestLink(calLinksByEvent.get(ev.id))
    const bridgedZoomId = zoomByCalendly.get(ev.id) ?? null
    const dealId = await resolveDealId(
      contactId,
      organizationId,
      ev.name ?? ev.event_type_name ?? null,
    )

    calRows.push({
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
      deal_id: dealId,
      host_id: ev.team_member_id ?? null,
      updated_at: new Date().toISOString(),
    })
  }

  // Batched upsert — one round trip per ~500 rows instead of one per meeting.
  // Every event id is unique, so no batch conflicts with itself.
  for (const batch of chunk(calRows, 500)) {
    const { error } = await admin
      .from("meetings")
      .upsert(batch, { onConflict: "calendly_event_id", ignoreDuplicates: false })
    if (error) errors.push(`meetings (calendly batch of ${batch.length}): ${error.message}`)
    else upserts += batch.length
  }

  // ── 3. Load Zoom meetings + their client links ───────────────────────
  // Paged for the same reason as the Calendly reads above.
  let zoomMeetings: ZoomMeetingRow[] = []
  try {
    zoomMeetings = await fetchAllPaged<ZoomMeetingRow>(() =>
      admin
        .from("zoom_meetings")
        .select("id, zoom_meeting_id, topic, status, start_time, duration, join_url, team_member_id, calendly_event_id"),
    )
  } catch (err) {
    errors.push(`zoom_meetings: ${(err as Error).message}`)
  }

  const zoomIds = zoomMeetings.map((z) => z.id)
  const zoomLinksByMeeting = new Map<string, ClientLink[]>()
  for (const idBatch of chunk(zoomIds)) {
    try {
      const zoomLinks = await fetchAllPaged<ClientLink & { zoom_meeting_id: string }>(() =>
        admin
          .from("zoom_meeting_clients")
          .select("zoom_meeting_id, contact_id, organization_id, confidence, needs_review")
          .in("zoom_meeting_id", idBatch),
      )
      for (const l of zoomLinks) {
        const arr = zoomLinksByMeeting.get(l.zoom_meeting_id) ?? []
        arr.push(l)
        zoomLinksByMeeting.set(l.zoom_meeting_id, arr)
      }
    } catch (err) {
      errors.push(`zoom_meeting_clients: ${(err as Error).message}`)
    }
  }

  // ── 4. Upsert one meeting per UN-bridged Zoom meeting ────────────────
  // Bridged Zoom meetings were already attached to their Calendly row above.
  const zoomRows: Record<string, unknown>[] = []
  for (const zm of zoomMeetings) {
    if (zm.calendly_event_id) continue // already represented by the Calendly meeting

    const { contactId, organizationId } = bestLink(zoomLinksByMeeting.get(zm.id))
    const dealId = await resolveDealId(contactId, organizationId, zm.topic ?? null)
    const end =
      zm.start_time && zm.duration
        ? new Date(new Date(zm.start_time).getTime() + zm.duration * 60_000).toISOString()
        : null

    zoomRows.push({
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
      deal_id: dealId,
      host_id: zm.team_member_id ?? null,
      updated_at: new Date().toISOString(),
    })
  }

  for (const batch of chunk(zoomRows, 500)) {
    const { error } = await admin
      .from("meetings")
      .upsert(batch, { onConflict: "zoom_meeting_id", ignoreDuplicates: false })
    if (error) errors.push(`meetings (zoom batch of ${batch.length}): ${error.message}`)
    else upserts += batch.length
  }

  return {
    calendlyProcessed: calEvents.length,
    zoomProcessed: zoomMeetings.length,
    upserts,
    errors,
  }
}
