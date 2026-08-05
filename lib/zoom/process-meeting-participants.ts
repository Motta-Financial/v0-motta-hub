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
  join_time?: string | null
  leave_time?: string | null
  registrant_id?: string | null
  failover?: boolean | null
  internal_user?: boolean | null
  [key: string]: unknown
}

/** Shape of `GET /past_meetings/{uuid}` — the post-meeting rollup. */
interface ZoomPastMeetingDetails {
  uuid?: string
  id?: number
  host_id?: string
  type?: number
  topic?: string
  user_name?: string
  user_email?: string
  start_time?: string
  end_time?: string
  duration?: number
  total_minutes?: number
  participants_count?: number
  dept?: string
  source?: string
}

export interface ProcessResult {
  meetingsScanned: number
  participantsSeen: number
  contactsCreated: number
  contactsMatched: number
  linksWritten: number
  bridgedFromCalendly: number
  alfredTagged: number
  /** Rows written to zoom_meeting_participants (full-fidelity import). */
  participantsPersisted?: number
  /** Meetings whose /past_meetings rollup (participants_count etc.) was stored. */
  pastDetailsSynced?: number
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
 * Fetch the post-meeting rollup (`GET /past_meetings/{uuid}`): actual
 * start/end, participants_count, total_minutes, host name/dept/source.
 * Returns null on 404 or a scope error — the caller treats it as
 * best-effort enrichment, never a blocker.
 */
async function fetchPastMeetingDetails(
  zoomGet: ZoomApiFetcher,
  meetingUuid: string,
): Promise<ZoomPastMeetingDetails | null> {
  const res = await zoomGet(
    `https://api.zoom.us/v2/past_meetings/${encodeMeetingUuid(meetingUuid)}`,
  )
  if (!res.ok) return null
  return (await res.json()) as ZoomPastMeetingDetails
}

/**
 * Replace the persisted participant rows for one meeting with the fresh
 * list from Zoom. Delete-then-insert keeps the operation idempotent
 * without needing an upsert key across nullable columns (a person can
 * legitimately appear N times — once per join session).
 */
async function persistParticipants(
  supabase: SupabaseClient,
  meeting: { id: string; zoom_uuid: string | null; zoom_meeting_id: string },
  participants: ZoomParticipant[],
  contactByEmail: Map<string, string>,
  methodByEmail: Map<string, string>,
): Promise<number> {
  const { error: delErr } = await supabase
    .from("zoom_meeting_participants")
    .delete()
    .eq("zoom_meeting_id", meeting.id)
  if (delErr) throw new Error(`participants delete: ${delErr.message}`)

  if (participants.length === 0) return 0

  const numericId = Number(meeting.zoom_meeting_id)
  const nowIso = new Date().toISOString()
  const rows = participants.map((p) => {
    const email = (p.user_email || p.email || "").trim().toLowerCase() || null
    return {
      zoom_meeting_id: meeting.id,
      zoom_meeting_uuid: meeting.zoom_uuid,
      zoom_meeting_numeric_id: Number.isFinite(numericId) ? numericId : null,
      zoom_participant_id: p.id || null,
      zoom_user_id: p.user_id || null,
      participant_user_id: p.participant_user_id || null,
      name: (p.name || "").trim() || null,
      email,
      join_time: p.join_time || null,
      leave_time: p.leave_time || null,
      duration: typeof p.duration === "number" ? p.duration : null,
      registrant_id: p.registrant_id || null,
      failover: typeof p.failover === "boolean" ? p.failover : null,
      status: p.status || null,
      internal_user: typeof p.internal_user === "boolean" ? p.internal_user : null,
      contact_id: email ? contactByEmail.get(email) ?? null : null,
      match_method: email ? methodByEmail.get(email) ?? null : null,
      raw_data: p,
      synced_at: nowIso,
    }
  })

  const { error: insErr } = await supabase.from("zoom_meeting_participants").insert(rows)
  if (insErr) throw new Error(`participants insert: ${insErr.message}`)
  return rows.length
}

/**
 * Recover an email for a name-only participant from the synced Zoom
 * contact directory (`zoom_contacts`). Guests frequently join without
 * exposing an email; if exactly ONE directory contact carries that
 * display name, its email is trustworthy enough to resolve against the
 * Hub. Ambiguous names (0 or 2+ distinct emails) return null.
 */
async function lookupZoomContactEmailByName(
  supabase: SupabaseClient,
  name: string,
): Promise<string | null> {
  const needle = name.trim()
  if (needle.length < 3) return null

  const { data } = await supabase
    .from("zoom_contacts")
    .select("email, display_name, first_name, last_name")
    .eq("contact_type", "external")
    .not("email", "is", null)
    .ilike("display_name", needle)
    .limit(5)

  let candidates = data ?? []
  if (candidates.length === 0) {
    const parts = needle.split(/\s+/)
    if (parts.length < 2) return null
    const { data: byParts } = await supabase
      .from("zoom_contacts")
      .select("email, display_name, first_name, last_name")
      .eq("contact_type", "external")
      .not("email", "is", null)
      .ilike("first_name", parts[0])
      .ilike("last_name", parts[parts.length - 1])
      .limit(5)
    candidates = byParts ?? []
  }

  const emails = Array.from(
    new Set(candidates.map((c) => (c.email || "").toLowerCase()).filter(Boolean)),
  )
  return emails.length === 1 ? emails[0] : null
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
    duration?: number | null
    host_email?: string | null
    team_member_id?: string | null
    alfred_triage_at?: string | null
  },
  result: ProcessResult,
): Promise<void> {
  if (!meeting.zoom_uuid) return

  // Never process a meeting that hasn't plausibly ENDED. Zoom's
  // /past_meetings endpoints 404 for future/ongoing meetings, and the
  // 404 path below stamps the done-watermark — which permanently skips
  // the meeting once it actually happens. Meetings sync into the Hub
  // days ahead of their start, so without this guard the hourly sweeps
  // burned every scheduled meeting's watermark before it ever ran
  // (found 2026-08-05: 74 of 148 watermarks were stamped pre-end and
  // zero participant rows had ever been written). Skip WITHOUT
  // stamping so the sweep retries after the meeting ends.
  if (meeting.start_time) {
    const startMs = new Date(meeting.start_time).getTime()
    const endedByMs = startMs + (meeting.duration ?? 60) * 60_000 + 10 * 60_000
    if (Number.isFinite(startMs) && Date.now() < endedByMs) {
      return
    }
  }

  // The participant fetch can fail for reasons that should NOT block the
  // rest of tagging: e.g. the S2S token is missing the
  // `meeting:read:list_past_participants:admin` scope. In that case we still
  // run the Calendly bridge + ALFRED triage (neither needs the participant
  // list) and deliberately DO NOT set participants_processed_at, so the
  // meeting is retried once the scope is granted.
  let participants: ZoomParticipant[] | null
  try {
    participants = await fetchParticipants(zoomGet, meeting.zoom_uuid)
  } catch (err) {
    console.warn(
      "[v0] [zoom participants] fetch failed; running bridge+ALFRED without participant list:",
      err,
    )
    try {
      const bridge = await bridgeZoomToCalendly(supabase, { zoomMeetingId: meeting.id })
      let bridgedFromCalendlyEventId: string | null = null
      if (bridge.bridged > 0 || bridge.alreadyBridged > 0) {
        result.bridgedFromCalendly += 1
        const { data: mm } = await supabase
          .from("zoom_meetings")
          .select("calendly_event_id")
          .eq("id", meeting.id)
          .maybeSingle()
        bridgedFromCalendlyEventId = mm?.calendly_event_id ?? null
      }
      // Already triaged on a previous sweep? Don't burn another model
      // call — this path re-runs hourly for as long as the participant
      // fetch keeps failing (e.g. missing S2S scope), and re-triaging
      // the same meeting without new evidence produced the 26k-row
      // zoom_alfred_triage_log churn. The full-participant path below
      // still re-triages once participants finally arrive.
      if (!meeting.alfred_triage_at) {
        const triage = await runAlfredZoomTriage(supabase, {
          zoomMeetingId: meeting.id,
          zoomMeetingNumericId: meeting.zoom_meeting_id ?? null,
          topic: meeting.topic ?? null,
          agenda: meeting.agenda ?? null,
          startTime: meeting.start_time ?? null,
          hostEmail: meeting.host_email ?? null,
          hostTeamMemberId: meeting.team_member_id ?? null,
          participants: [],
          bridgedFromCalendlyEventId,
        })
        if (triage.outcome === "tagged" || triage.outcome === "tagged_review") {
          result.alfredTagged += 1
        }
      }
    } catch (inner) {
      console.warn("[v0] [zoom participants] bridge/ALFRED fallback failed:", inner)
    }
    // Surface the original fetch error but leave the watermark unset for retry.
    result.errors.push({
      meeting_uuid: meeting.zoom_uuid,
      error: err instanceof Error ? err.message : "participant fetch failed",
    })
    return
  }

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

  // Resolution maps keyed on the participant's (possibly recovered)
  // email, consumed by persistParticipants so every stored row carries
  // its Hub contact link.
  const contactByEmail = new Map<string, string>()
  const methodByEmail = new Map<string, string>()

  for (const p of participants) {
    let email = (p.user_email || p.email || "").trim().toLowerCase() || null
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

    // Guests often join without exposing an email. If the synced Zoom
    // contact directory has exactly one external contact with this
    // display name, adopt its email so the Hub resolution below can
    // match instead of creating a bare name-only contact.
    let emailFromDirectory = false
    if (!email && name) {
      try {
        const recovered = await lookupZoomContactEmailByName(supabase, name)
        if (recovered) {
          email = recovered
          emailFromDirectory = true
          if (seenEmails.has(email)) continue
          seenEmails.add(email)
        }
      } catch {
        // Directory lookup is best-effort only.
      }
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

      const matchMethod = emailFromDirectory
        ? "zoom_contact_directory"
        : created.created
          ? "auto_created"
          : created.method
      if (email) {
        contactByEmail.set(email, created.contact_id)
        methodByEmail.set(email, matchMethod)
      }

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
            match_method: matchMethod,
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

  // ── Persist the full participant list ──────────────────────────
  // Every row Zoom returned (one per join session, all fields) lands in
  // zoom_meeting_participants with its resolved Hub contact. Replaced
  // wholesale per meeting, so re-runs stay idempotent.
  try {
    const persisted = await persistParticipants(
      supabase,
      { id: meeting.id, zoom_uuid: meeting.zoom_uuid, zoom_meeting_id: meeting.zoom_meeting_id },
      participants,
      contactByEmail,
      methodByEmail,
    )
    result.participantsPersisted = (result.participantsPersisted ?? 0) + persisted
  } catch (err) {
    console.warn("[v0] [zoom participants] persist failed (non-fatal):", err)
  }

  // ── Past-meeting rollup ─────────────────────────────────────────
  // Actual start/end, participants_count, total_minutes, host name/dept
  // from GET /past_meetings/{uuid}. Best-effort enrichment.
  try {
    const details = await fetchPastMeetingDetails(zoomGet, meeting.zoom_uuid)
    if (details) {
      // Only write fields Zoom actually sent — a partial payload must
      // not null out webhook-stamped started_at/ended_at.
      const update: Record<string, unknown> = {
        past_details_synced_at: new Date().toISOString(),
      }
      if (details.participants_count != null) update.participants_count = details.participants_count
      if (details.total_minutes != null) update.total_minutes = details.total_minutes
      if (details.user_name) update.host_name = details.user_name
      if (details.dept) update.dept = details.dept
      if (details.source) update.meeting_source = details.source
      if (details.start_time) update.started_at = details.start_time
      if (details.end_time) update.ended_at = details.end_time

      await supabase.from("zoom_meetings").update(update).eq("id", meeting.id)
      result.pastDetailsSynced = (result.pastDetailsSynced ?? 0) + 1
    }
  } catch (err) {
    console.warn("[v0] [zoom participants] past-details fetch failed (non-fatal):", err)
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
  // Only meetings that plausibly ended — future/ongoing meetings 404 at
  // the participants endpoint (processOneMeeting guards per-row against
  // long meetings still running past this coarse cutoff).
  const endedIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const { data: meetings, error } = await supabase
    .from("zoom_meetings")
    .select(
      "id, zoom_uuid, zoom_meeting_id, start_time, duration, topic, agenda, host_email, team_member_id, alfred_triage_at",
    )
    .eq("zoom_connection_id", conn.id)
    .is("participants_processed_at", null)
    .not("zoom_uuid", "is", null)
    .gte("start_time", sinceIso)
    .lt("start_time", endedIso)
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
