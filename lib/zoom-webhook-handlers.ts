/**
 * Zoom webhook event handlers.
 *
 * Each handler is responsible for a single Zoom event type. The
 * receiver (`app/api/zoom/webhook/route.ts`) verifies the signature,
 * persists the raw payload, and then dispatches to the right handler
 * here. Handlers are pure async functions that return a small status
 * object; the receiver translates that into a `processing_status`
 * update on `zoom_webhook_events`.
 *
 * Events handled (rolled out incrementally):
 *
 *   recording.completed              -> upsert row in `zoom_recordings`
 *   recording.transcript_completed   -> upsert + download VTT into
 *                                       `zoom_transcripts`
 *   meeting.started                  -> stamp `started_at` on the matching
 *                                       `zoom_meetings` row
 *   meeting.ended                    -> stamp `ended_at`
 *   meeting.summary_completed        -> store AI Companion summary in
 *                                       `zoom_meetings.raw_data.summary`
 *   app.deauthorized                 -> mark connection inactive +
 *                                       `revoked_at = now()` so the user
 *                                       has to re-install
 *
 * Anything else is recorded as `skipped` so the audit log is complete
 * without forcing us to write a handler before we have a use case.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { ingestRecordingFiles, type ZoomRecordingFile } from "@/lib/zoom/ingest-recording-files"
import type { ZoomWebhookPayload } from "@/lib/zoom-webhook"

export type HandlerResult =
  | { ok: true; action: string; details?: Record<string, unknown> }
  | { ok: false; error: string; action?: string }

/** Top-level dispatcher used by the route handler. */
export async function handleZoomEvent(payload: ZoomWebhookPayload): Promise<HandlerResult> {
  const event = payload.event
  switch (event) {
    case "recording.completed":
      return handleRecordingCompleted(payload)
    case "recording.transcript_completed":
      return handleTranscriptCompleted(payload)
    case "meeting.started":
      return handleMeetingLifecycle(payload, "started")
    case "meeting.ended":
      return handleMeetingLifecycle(payload, "ended")
    case "meeting.summary_completed":
      return handleSummaryCompleted(payload)
    case "app.deauthorized":
      return handleAppDeauthorized(payload)
    default:
      console.log(`[v0] [Zoom Webhook] Skipping unhandled event: ${event}`)
      return { ok: true, action: "skipped", details: { reason: "no_handler", event } }
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * recording.completed
 *
 * Fired once Zoom finishes processing every recording file for a
 * meeting (mp4, m4a, chat log, etc.). The payload's
 * `payload.object.recording_files[]` contains every file with a
 * short-lived `download_url` and `download_token`. We upsert the
 * meeting-level record; downloading the files themselves is a future
 * step (likely streamed to Vercel Blob).
 * ───────────────────────────────────────────────────────────────────── */
async function handleRecordingCompleted(payload: ZoomWebhookPayload): Promise<HandlerResult> {
  const obj = payload.payload?.object as ZoomRecordingObject | undefined
  if (!obj?.uuid) return { ok: false, action: "recording.completed", error: "missing_uuid" }

  const admin = createAdminClient()
  const connection = await findConnectionByHost(admin, obj.host_email, obj.host_id)

  const meetingIdNumeric = toBigInt(obj.id)
  const startTime = obj.start_time ? new Date(obj.start_time).toISOString() : null
  const recordingFiles = Array.isArray(obj.recording_files) ? obj.recording_files : []

  const { error } = await admin.from("zoom_recordings").upsert(
    {
      zoom_uuid: obj.uuid,
      zoom_meeting_id: meetingIdNumeric,
      topic: obj.topic ?? null,
      start_time: startTime,
      duration: obj.duration ?? null,
      total_size: obj.total_size ?? null,
      recording_count: obj.recording_count ?? recordingFiles.length,
      recording_files: recordingFiles,
      share_url: obj.share_url ?? null,
      team_member_id: connection?.team_member_id ?? null,
      zoom_connection_id: connection?.id ?? null,
      raw_data: payload as unknown as Record<string, unknown>,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "zoom_uuid" },
  )

  if (error) {
    console.error("[v0] [Zoom Webhook] zoom_recordings upsert failed:", error)
    return { ok: false, action: "recording.completed", error: error.message }
  }

  return {
    ok: true,
    action: "recording.completed",
    details: { uuid: obj.uuid, files: recordingFiles.length },
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * recording.transcript_completed
 *
 * Fires after Zoom's audio transcription pipeline finishes. Each
 * `recording_files[]` entry of file_type === 'TRANSCRIPT' (or 'CC')
 * has its own download URL. We persist a row per file so a meeting
 * with both English and CC tracks ends up with two rows.
 *
 * The actual VTT download happens in a follow-up handler — keeping
 * the webhook 200ms-fast is more important than fetching the body
 * inline, and Zoom's signed URL is valid for 7+ days so a queued
 * worker can grab it later.
 * ───────────────────────────────────────────────────────────────────── */
async function handleTranscriptCompleted(payload: ZoomWebhookPayload): Promise<HandlerResult> {
  const obj = payload.payload?.object as ZoomRecordingObject | undefined
  if (!obj?.uuid) return { ok: false, action: "recording.transcript_completed", error: "missing_uuid" }

  const admin = createAdminClient()
  const connection = await findConnectionByHost(admin, obj.host_email, obj.host_id)
  const meetingIdNumeric = toBigInt(obj.id)
  const downloadToken = (payload as { download_token?: string }).download_token ?? null

  // Find the parent recording row so we can FK back to it.
  const { data: recording } = await admin
    .from("zoom_recordings")
    .select("id")
    .eq("zoom_uuid", obj.uuid)
    .maybeSingle()

  const transcriptFiles = (obj.recording_files ?? []).filter((f) => {
    const t = (f.file_type || "").toUpperCase()
    return t === "TRANSCRIPT" || t === "CC"
  })

  if (transcriptFiles.length === 0) {
    return {
      ok: true,
      action: "recording.transcript_completed",
      details: { uuid: obj.uuid, transcripts: 0, reason: "no_transcript_files" },
    }
  }

  // Download + parse the VTT inline. Transcript files are small (text), so
  // this stays well within the webhook's time budget, and it's what finally
  // produces real transcript text + speaker segments instead of a bare
  // pointer. The signed download_url is authorized by the event's
  // download_token. Larger media files are NOT copied here (that would risk a
  // webhook timeout) — they're handled by the recordings backfill path.
  const result = await ingestRecordingFiles(
    {
      admin,
      meetingUuid: obj.uuid,
      meetingIdNumeric,
      recordingRowId: recording?.id ?? null,
      zoomConnectionId: connection?.id ?? null,
      teamMemberId: connection?.team_member_id ?? null,
      bearerToken: downloadToken,
    },
    transcriptFiles as ZoomRecordingFile[],
  )

  return {
    ok: true,
    action: "recording.transcript_completed",
    details: {
      uuid: obj.uuid,
      transcripts: transcriptFiles.length,
      parsed: result.transcriptsParsed,
      failed: result.transcriptsFailed,
    },
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * meeting.started / meeting.ended
 *
 * Stamp the lifecycle columns on the matching `zoom_meetings` row so
 * the dashboard can show "live now" and "ended X minutes ago" without
 * polling Zoom. We match on `zoom_meeting_id` (numeric), falling back
 * to `zoom_uuid` when present.
 * ───────────────────────────────────────────────────────────────────── */
async function handleMeetingLifecycle(
  payload: ZoomWebhookPayload,
  kind: "started" | "ended",
): Promise<HandlerResult> {
  const obj = payload.payload?.object as ZoomRecordingObject | undefined
  if (!obj) return { ok: false, action: `meeting.${kind}`, error: "missing_object" }

  const admin = createAdminClient()
  const meetingIdNumeric = toBigInt(obj.id)
  const now = new Date().toISOString()

  const update: Record<string, unknown> = {
    last_event_type: `meeting.${kind}`,
    last_event_at: now,
    status: kind === "started" ? "started" : "ended",
    updated_at: now,
  }
  if (kind === "started") update.started_at = now
  if (kind === "ended") update.ended_at = now

  // Try numeric id first (the field used by sync), then the uuid.
  let data: { id: string }[] | null = null
  let lastError: { message: string } | null = null

  if (meetingIdNumeric !== null) {
    const res = await admin
      .from("zoom_meetings")
      .update(update)
      .eq("zoom_meeting_id", meetingIdNumeric)
      .select("id")
    data = (res.data as { id: string }[] | null) ?? null
    lastError = res.error ?? null
  }

  if ((!data || data.length === 0) && obj.uuid) {
    const res = await admin
      .from("zoom_meetings")
      .update(update)
      .eq("zoom_uuid", obj.uuid)
      .select("id")
    data = (res.data as { id: string }[] | null) ?? null
    lastError = res.error ?? null
  }

  if (lastError) {
    console.error(`[v0] [Zoom Webhook] meeting.${kind} update failed:`, lastError)
    return { ok: false, action: `meeting.${kind}`, error: lastError.message }
  }

  // No matching row is not a hard failure — Zoom can fire lifecycle
  // events for ad-hoc personal meetings we never synced. Record a
  // skip so the audit log explains what happened.
  if (!data || data.length === 0) {
    return {
      ok: true,
      action: `meeting.${kind}`,
      details: { reason: "no_matching_meeting_row", id: meetingIdNumeric, uuid: obj.uuid },
    }
  }

  return { ok: true, action: `meeting.${kind}`, details: { meetings_updated: data.length } }
}

/* ─────────────────────────────────────────────────────────────────────
 * meeting.summary_completed
 *
 * Zoom AI Companion (Pro/Business with the addon) emits a structured
 * summary plus a list of next steps. We tuck it into the meeting's
 * `raw_data.summary` so debriefs can pull it without a new column;
 * a dedicated table + UI can come in a follow-up PR once we know the
 * exact shape we want to render.
 * ───────────────────────────────────────────────────────────────────── */
async function handleSummaryCompleted(payload: ZoomWebhookPayload): Promise<HandlerResult> {
  const obj = payload.payload?.object as ZoomRecordingObject | undefined
  if (!obj?.uuid) return { ok: false, action: "meeting.summary_completed", error: "missing_uuid" }

  const admin = createAdminClient()
  const meetingIdNumeric = toBigInt(obj.id)

  // Read existing raw_data, merge summary in, write back. A single
  // RPC would be nicer but this matches the rest of the codebase's
  // pattern.
  type MeetingRow = { id: string; raw_data: Record<string, unknown> | null }
  let row: MeetingRow | null = null
  if (meetingIdNumeric !== null) {
    const res = await admin
      .from("zoom_meetings")
      .select("id, raw_data")
      .eq("zoom_meeting_id", meetingIdNumeric)
      .maybeSingle()
    row = (res.data as MeetingRow | null) ?? null
  } else if (obj.uuid) {
    const res = await admin
      .from("zoom_meetings")
      .select("id, raw_data")
      .eq("zoom_uuid", obj.uuid)
      .maybeSingle()
    row = (res.data as MeetingRow | null) ?? null
  }

  if (!row) {
    return {
      ok: true,
      action: "meeting.summary_completed",
      details: { reason: "no_matching_meeting_row", uuid: obj.uuid },
    }
  }

  const existingRaw = (row.raw_data as Record<string, unknown> | null) ?? {}
  const merged = { ...existingRaw, summary: payload.payload?.object }

  const { error } = await admin
    .from("zoom_meetings")
    .update({
      raw_data: merged,
      last_event_type: "meeting.summary_completed",
      last_event_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)

  if (error) {
    console.error("[v0] [Zoom Webhook] summary update failed:", error)
    return { ok: false, action: "meeting.summary_completed", error: error.message }
  }
  return { ok: true, action: "meeting.summary_completed", details: { meeting_id: row.id } }
}

/* ─────────────────────────────────────────────────────────────────────
 * app.deauthorized
 *
 * Sent when the user removes the Hub from their Zoom account. We
 * flip `is_active = false` and stamp `revoked_at` so the dashboard
 * can prompt them to reconnect, and so refresh attempts stop. Token
 * material is left in place for compliance with Zoom's data-retention
 * webhook (a follow-up `app.deauthorized` data-removal handshake the
 * Marketplace requires for verified apps).
 * ───────────────────────────────────────────────────────────────────── */
async function handleAppDeauthorized(payload: ZoomWebhookPayload): Promise<HandlerResult> {
  const p = payload.payload as
    | { account_id?: string; user_id?: string; deauthorization_time?: string }
    | undefined
  const userId = p?.user_id
  const accountId = p?.account_id

  if (!userId && !accountId) {
    return { ok: false, action: "app.deauthorized", error: "missing_user_or_account_id" }
  }

  const admin = createAdminClient()
  const update = {
    is_active: false,
    sync_enabled: false,
    revoked_at: p?.deauthorization_time ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Prefer matching by zoom_user_id (specific to a single connection)
  // and fall back to zoom_account_id (deauthorize-all on an account).
  const baseQuery = admin.from("zoom_connections").update(update).select("id")
  const filtered = userId
    ? baseQuery.eq("zoom_user_id", userId)
    : baseQuery.eq("zoom_account_id", accountId as string)

  const { data, error } = await filtered
  if (error) {
    console.error("[v0] [Zoom Webhook] app.deauthorized update failed:", error)
    return { ok: false, action: "app.deauthorized", error: error.message }
  }
  return {
    ok: true,
    action: "app.deauthorized",
    details: { connections_revoked: data?.length ?? 0, user_id: userId, account_id: accountId },
  }
}

/* ─────────────────────────��───────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────── */

interface ZoomRecordingObject {
  id?: string | number
  uuid?: string
  topic?: string
  host_id?: string
  host_email?: string
  account_id?: string
  start_time?: string
  duration?: number
  total_size?: number
  recording_count?: number
  share_url?: string
  recording_files?: Array<{
    id?: string
    file_type?: string
    recording_type?: string
    file_size?: number
    duration?: number
    download_url?: string
    play_url?: string
    status?: string
  }>
  status?: string
}

function toBigInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v)
  return null
}

async function findConnectionByHost(
  admin: ReturnType<typeof createAdminClient>,
  hostEmail?: string,
  hostId?: string,
): Promise<{ id: string; team_member_id: string | null } | null> {
  // Prefer the stable Zoom user id; fall back to email since some events
  // omit host_id (e.g. when the meeting was started via SDK).
  if (hostId) {
    const { data } = await admin
      .from("zoom_connections")
      .select("id, team_member_id")
      .eq("zoom_user_id", hostId)
      .eq("is_active", true)
      .maybeSingle()
    if (data) return data
  }
  if (hostEmail) {
    const { data } = await admin
      .from("zoom_connections")
      .select("id, team_member_id")
      .ilike("zoom_email", hostEmail)
      .eq("is_active", true)
      .maybeSingle()
    if (data) return data
  }
  return null
}
