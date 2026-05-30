/**
 * Zoom participants → Master Hub Contact bridge
 * ─────────────────────────────────────────────
 *
 * For every past Zoom meeting we've synced, we want to make sure each
 * external (non-Motta) participant exists as a Hub contact and is
 * linked to the meeting via `zoom_meeting_clients`. Zoom is one of the
 * three canonical intake channels (Jotform / Calendly / Zoom), so a
 * stranger who shows up on a Zoom call must become a Hub contact even
 * if no teammate ever manually tagged the meeting.
 *
 * Why we don't store every participant
 * ────────────────────────────────────
 * Zoom's `/past_meetings/{uuid}/participants` returns dozens of fields
 * per row, but the only ones that matter for Hub creation are name +
 * email. We process them, delegate to `findOrCreateHubContact`, and
 * write the link to `zoom_meeting_clients` (the same table the manual
 * tag dialog writes to). The participant raw payload is left in
 * `zoom_meetings.raw_participants` for forensic use.
 *
 * Watermarking
 * ────────────
 * `zoom_meetings.participants_processed_at` lets the sync sweep skip
 * meetings we've already processed. This is set on success only — a
 * thrown error leaves the watermark null so the next sync retries.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { zoomFetch, type ZoomConnection } from "@/lib/zoom-auth"
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import { bridgeZoomToCalendly } from "@/lib/zoom/bridge-to-calendly"
import { runAlfredZoomTriage } from "@/lib/alfred/zoom-triage"

interface ZoomParticipant {
  id?: string
  user_id?: string
  name?: string | null
  user_email?: string | null
  email?: string | null
  participant_user_id?: string | null
  status?: string | null
  duration?: number | null
}

export interface ProcessResult {
  meetingsScanned: number
  participantsSeen: number
  contactsCreated: number
  contactsMatched: number
  linksWritten: number
  bridgedFromCalendly: number
  alfredTagged: number
  errors: Array<{ meeting_uuid: string; error: string }>
}

/**
 * Zoom meeting UUIDs may contain `/` or start with `/`. Per the API
 * docs, those characters require **double** URL encoding when used in
 * a path segment — single encoding gets stripped by Zoom's gateway and
 * the request 404s.
 */
function encodeMeetingUuid(uuid: string): string {
  return encodeURIComponent(encodeURIComponent(uuid))
}

/**
 * Pulls the participant list for a single Zoom meeting and returns
 * them. Returns `null` when Zoom returns 404 (instant meeting that was
 * never recorded, or a meeting older than Zoom's reporting window) so
 * the caller can mark it as processed and move on.
 */
/**
 * A bound fetcher that performs an authenticated Zoom API GET. The
 * connection sweep passes `(url) => zoomFetch(conn, url)`; the account-wide
 * S2S sweep passes `(url) => s2sFetch(url)`. Keeping participant tagging
 * agnostic to the auth source means one code path (bridge + ALFRED +
 * hub-contact resolution) serves both.
 */
export type ZoomApiFetcher = (url: string) => Promise<Response>

async function fetchParticipants(
  zoomGet: ZoomApiFetcher,
  meetingUuid: string,
): Promise<ZoomParticipant[] | null> {
  const url = `https://api.zoom.us/v2/past_meetings/${encodeMeetingUuid(
    meetingUuid,
  )}/participants?page_size=300`
  const res = await zoomGet(url)
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `past_meetings/participants ${res.status}: ${body.slice(0, 200)}`,
    )
  }
  const data = (await res.json()) as { participants?: ZoomParticipant[] }
  return data.participants ?? []
}

/**
 * Process the participant list for one meeting. Idempotent: re-running
 * is safe because `findOrCreateHubContact` is dedupe-aware and the
 * `zoom_meeting_clients` upsert keys on (zoom_meeting_id, contact_id).
 */
export async function processOneMeeting(
  supabase: SupabaseClient,
  zoomGet: ZoomApiFetcher,
  meeting: {
    id: string
    zoom_uuid: string | null
    zoom_meeting_id: string
    topic?: string | null
    agenda?: string | null
    start_time?: string | null
    host_email?: string | null
    team_member_id?: string | null
  },
  result: ProcessResult,
): Promise<void> {
  if (!meeting.zoom_uuid) return

  const participants = await fetchParticipants(zoomGet, meeting.zoom_uuid)
  if (participants === null) {
    // 404 — Zoom doesn't have participants for this meeting. Still
    // give the bridge a chance (some Calendly-booked meetings 404 at
    // the participants endpoint but still match by URL), then mark
    // processed.
    try {
      const bridge = await bridgeZoomToCalendly(supabase, {
        zoomMeetingId: meeting.id,
      })
      if (bridge.bridged > 0) result.bridgedFromCalendly += 1
    } catch (err) {
      console.warn("[v0] [zoom participants] bridge failed (404 path):", err)
    }
    await supabase
      .from("zoom_meetings")
      .update({ participants_processed_at: new Date().toISOString() })
      .eq("id", meeting.id)
    return
  }

  result.participantsSeen += participants.length

  // Track each participant's resolved contact_id so we can pass them
  // through to ALFRED at the end. ALFRED uses these as priors when it
  // chooses among multiple Hub candidates with the same name.
  const enrichedParticipants: Array<{
    name: string | null
    email: string | null
    matched_contact_id: string | null
  }> = []

  // Dedupe within a single meeting — Zoom emits one row per
  // join/leave, so the same person can appear 3+ times.
  const seenEmails = new Set<string>()
  const seenNamesNoEmail = new Set<string>()

  for (const p of participants) {
    const email = (p.user_email || p.email || "").trim().toLowerCase() || null
    const name = (p.name || "").trim() || null
    if (!email && !name) continue

    if (email) {
      if (seenEmails.has(email)) continue
      seenEmails.add(email)
    } else if (name) {
      const nKey = name.toLowerCase()
      if (seenNamesNoEmail.has(nKey)) continue
      seenNamesNoEmail.add(nKey)
    }

    try {
      const created = await findOrCreateHubContact(
        { email, fullName: name },
        {
          source: "zoom",
          supabase,
          // Don't auto-create Hub contacts for teammates — Zoom
          // participant lists almost always include the host.
          skipInternal: true,
        },
      )
      if (!created.contact_id) {
        // Likely an internal teammate (skipInternal). Still pass the
        // raw participant info to ALFRED so it has the room context.
        enrichedParticipants.push({ name, email, matched_contact_id: null })
        continue
      }
      if (created.created) result.contactsCreated += 1
      else result.contactsMatched += 1

      // Link to zoom_meeting_clients with link_source='auto'. The
      // table mirrors `calendly_event_clients` so the existing tag UI
      // renders these the same way.
      const { error: linkErr } = await supabase
        .from("zoom_meeting_clients")
        .upsert(
          {
            zoom_meeting_id: meeting.id,
            contact_id: created.contact_id,
            link_source: "auto",
            match_method: created.created ? "auto_created" : created.method,
          },
          { onConflict: "zoom_meeting_id,contact_id", ignoreDuplicates: true },
        )
      if (!linkErr) result.linksWritten += 1

      enrichedParticipants.push({
        name,
        email,
        matched_contact_id: created.contact_id,
      })
    } catch (err) {
      console.error(
        `[v0] [zoom participants] hub upsert failed for ${email ?? name}:`,
        err,
      )
      enrichedParticipants.push({ name, email, matched_contact_id: null })
    }
  }

  // ── Calendly → Zoom bridge ──────────────────────────────────────
  // Deterministic carryover of tags (clients + work-items) from a
  // matching Calendly event. Runs BEFORE ALFRED so ALFRED can skip
  // when the bridge already covered the meeting.
  let bridgedFromCalendlyEventId: string | null = null
  try {
    const bridge = await bridgeZoomToCalendly(supabase, {
      zoomMeetingId: meeting.id,
    })
    if (bridge.bridged > 0 || bridge.alreadyBridged > 0) {
      result.bridgedFromCalendly += 1
      const { data: m } = await supabase
        .from("zoom_meetings")
        .select("calendly_event_id")
        .eq("id", meeting.id)
        .maybeSingle()
      bridgedFromCalendlyEventId = m?.calendly_event_id ?? null
    }
  } catch (err) {
    console.warn("[v0] [zoom participants] calendly bridge failed (non-fatal):", err)
  }

  // ── ALFRED triage ───────────────────────────────────────────────
  // Bounded: model failures must never break the parent sync. The
  // triage function itself swallows all errors and writes an audit
  // row regardless of outcome.
  try {
    const triage = await runAlfredZoomTriage(supabase, {
      zoomMeetingId: meeting.id,
      zoomMeetingNumericId: meeting.zoom_meeting_id ?? null,
      topic: meeting.topic ?? null,
      agenda: meeting.agenda ?? null,
      startTime: meeting.start_time ?? null,
      hostEmail: meeting.host_email ?? null,
      hostTeamMemberId: meeting.team_member_id ?? null,
      participants: enrichedParticipants,
      bridgedFromCalendlyEventId,
    })
    if (triage.outcome === "tagged" || triage.outcome === "tagged_review") {
      result.alfredTagged += 1
    }
  } catch (err) {
    console.warn("[v0] [zoom participants] ALFRED triage threw (non-fatal):", err)
  }

  // Mark watermark so we never re-process this meeting unless someone
  // explicitly clears the column.
  await supabase
    .from("zoom_meetings")
    .update({ participants_processed_at: new Date().toISOString() })
    .eq("id", meeting.id)
}

/**
 * Sweep recent ended meetings for a single connection and process
 * participants for any that haven't been processed yet.
 *
 * Bounded by `maxMeetings` to keep individual sync runs predictable —
 * the cron job will catch up over multiple invocations.
 */
export async function processRecentZoomParticipants(
  supabase: SupabaseClient,
  conn: ZoomConnection,
  opts: { maxMeetings?: number; sinceDays?: number } = {},
): Promise<ProcessResult> {
  const { maxMeetings = 50, sinceDays = 60 } = opts
  const result: ProcessResult = {
    meetingsScanned: 0,
    participantsSeen: 0,
    contactsCreated: 0,
    contactsMatched: 0,
    linksWritten: 0,
    bridgedFromCalendly: 0,
    alfredTagged: 0,
    errors: [],
  }

  const sinceIso = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data: meetings, error } = await supabase
    .from("zoom_meetings")
    .select(
      "id, zoom_uuid, zoom_meeting_id, start_time, topic, agenda, host_email, team_member_id",
    )
    .eq("zoom_connection_id", conn.id)
    .is("participants_processed_at", null)
    .not("zoom_uuid", "is", null)
    .gte("start_time", sinceIso)
    // Process oldest unprocessed first so a backlog drains in order
    // rather than starving the bottom of the queue.
    .order("start_time", { ascending: true })
    .limit(maxMeetings)

  if (error) {
    result.errors.push({ meeting_uuid: "select", error: error.message })
    return result
  }

  for (const m of meetings ?? []) {
    result.meetingsScanned += 1
    try {
      await processOneMeeting(supabase, (url) => zoomFetch(conn, url), m as any, result)
    } catch (err) {
      result.errors.push({
        meeting_uuid: (m as any).zoom_uuid ?? (m as any).zoom_meeting_id,
        error: err instanceof Error ? err.message : "unknown",
      })
    }
  }

  return result
}
