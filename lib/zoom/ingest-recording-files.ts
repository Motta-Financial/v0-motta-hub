/**
 * Download, parse, and persist Zoom recording files (media + transcripts).
 *
 * This is the single worker shared by:
 *   - the `recording.transcript_completed` / `recording.completed` webhooks
 *     (so live meetings finally get parsed transcript text, not just a pointer)
 *   - the manual transcript backfill route
 *   - (later) the account-wide S2S sync
 *
 * Behaviour:
 *   - TRANSCRIPT / CC files  → download VTT, parse to text + speaker segments,
 *     copy the VTT to Vercel Blob, upsert into `zoom_transcripts`.
 *   - MP4 / M4A / other media → copy to Vercel Blob, write the resulting
 *     blob_url/blob_pathname back into the recording's `recording_files` jsonb.
 *
 * Idempotent: transcripts already `parsed` with a blob_url are skipped, and
 * media files that already carry a blob_url are skipped. Failures bump
 * `download_attempts` and record `error` so retries are observable.
 */

import { put } from "@vercel/blob"
import type { SupabaseClient } from "@supabase/supabase-js"
import { parseVtt } from "./parse-vtt"

/** A single file entry from Zoom's `recording_files[]`. */
export interface ZoomRecordingFile {
  id?: string
  file_type?: string
  file_extension?: string
  recording_type?: string
  download_url?: string
  file_size?: number
  recording_start?: string
  recording_end?: string
  // augmented by this worker:
  blob_url?: string
  blob_pathname?: string
}

export interface IngestContext {
  admin: SupabaseClient
  /** Per-instance meeting UUID (links to zoom_recordings.zoom_uuid). */
  meetingUuid: string
  /** Numeric Zoom meeting id (links to zoom_meetings.zoom_meeting_id). */
  meetingIdNumeric: number | null
  /** uuid of the parent zoom_recordings row, if known (for transcript FK). */
  recordingRowId?: string | null
  zoomConnectionId?: string | null
  teamMemberId?: string | null
  /**
   * Bearer token used to download files. For webhooks this is the
   * `download_token`; for API syncs it's the OAuth/S2S access token.
   */
  bearerToken: string | null
}

export interface IngestResult {
  transcriptsParsed: number
  transcriptsFailed: number
  mediaCopied: number
  mediaFailed: number
  updatedFiles: ZoomRecordingFile[]
}

const TRANSCRIPT_TYPES = new Set(["TRANSCRIPT", "CC", "CLOSED_CAPTION"])
const MEDIA_TYPES = new Set(["MP4", "M4A"])

/** Fetch a Zoom download URL with bearer auth, falling back to query token. */
async function downloadZoomFile(url: string, token: string | null): Promise<Response> {
  if (token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) return res
    // Some Zoom endpoints only accept the access_token query param.
    if (res.status === 401) {
      const sep = url.includes("?") ? "&" : "?"
      return fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`)
    }
    return res
  }
  return fetch(url)
}

function extForFile(file: ZoomRecordingFile): string {
  const e = (file.file_extension || file.file_type || "bin").toLowerCase()
  return e.replace(/[^a-z0-9]/g, "") || "bin"
}

/**
 * Ingest every file in a recording set. Returns counts + the (possibly
 * mutated) recording_files array so the caller can persist blob links back to
 * `zoom_recordings.recording_files`.
 */
export async function ingestRecordingFiles(
  ctx: IngestContext,
  files: ZoomRecordingFile[],
): Promise<IngestResult> {
  const result: IngestResult = {
    transcriptsParsed: 0,
    transcriptsFailed: 0,
    mediaCopied: 0,
    mediaFailed: 0,
    updatedFiles: Array.isArray(files) ? [...files] : [],
  }

  for (let i = 0; i < result.updatedFiles.length; i++) {
    const file = result.updatedFiles[i]
    const type = (file.file_type || "").toUpperCase()

    if (TRANSCRIPT_TYPES.has(type)) {
      const ok = await ingestTranscript(ctx, file)
      if (ok) result.transcriptsParsed++
      else result.transcriptsFailed++
    } else if (MEDIA_TYPES.has(type)) {
      // Skip if already copied.
      if (file.blob_url) continue
      const copied = await copyMediaToBlob(ctx, file)
      if (copied) {
        result.updatedFiles[i] = { ...file, ...copied }
        result.mediaCopied++
      } else {
        result.mediaFailed++
      }
    }
  }

  return result
}

/** Download + parse a single transcript file, upserting zoom_transcripts. */
async function ingestTranscript(ctx: IngestContext, file: ZoomRecordingFile): Promise<boolean> {
  const { admin, meetingUuid } = ctx
  const recordingFileId = file.id ?? null

  // Idempotency: already parsed with a blob copy → nothing to do.
  const { data: existing } = await admin
    .from("zoom_transcripts")
    .select("id, status, blob_url, download_attempts")
    .eq("zoom_meeting_uuid", meetingUuid)
    .eq("recording_file_id", recordingFileId)
    .maybeSingle()

  if (existing?.status === "parsed" && existing.blob_url) return true

  const attempts = (existing?.download_attempts ?? 0) + 1

  if (!file.download_url) {
    await upsertTranscriptFailure(ctx, file, attempts, "missing_download_url")
    return false
  }

  try {
    const res = await downloadZoomFile(file.download_url, ctx.bearerToken)
    if (!res.ok) {
      // 401 after a valid-looking token usually means the signed URL expired.
      const reason = res.status === 401 || res.status === 410 ? "expired" : `http_${res.status}`
      await upsertTranscriptFailure(ctx, file, attempts, reason, reason === "expired")
      return false
    }

    const vtt = await res.text()
    const { text, segments } = parseVtt(vtt)

    // Copy the raw VTT to Blob for permanence.
    let blobUrl: string | null = null
    let blobPathname: string | null = null
    try {
      const pathname = `zoom/${meetingUuid}/${recordingFileId || "transcript"}.vtt`
      const blob = await put(pathname, vtt, {
        access: "private",
        contentType: "text/vtt",
        addRandomSuffix: false,
        allowOverwrite: true,
      })
      blobUrl = blob.url
      blobPathname = blob.pathname
    } catch (blobErr) {
      console.warn(
        "[v0] [Zoom Ingest] VTT blob upload failed (continuing):",
        blobErr instanceof Error ? blobErr.message : blobErr,
      )
    }

    const row: Record<string, unknown> = {
      zoom_connection_id: ctx.zoomConnectionId ?? null,
      team_member_id: ctx.teamMemberId ?? null,
      zoom_meeting_id: ctx.meetingIdNumeric,
      zoom_meeting_uuid: meetingUuid,
      recording_file_id: recordingFileId,
      file_type: file.file_type ?? null,
      recording_type: file.recording_type ?? null,
      download_url: file.download_url ?? null,
      vtt_content: vtt,
      text_content: text,
      segments,
      blob_url: blobUrl,
      blob_pathname: blobPathname,
      duration_seconds: null,
      file_size: file.file_size ?? null,
      status: "parsed" as const,
      error: null,
      parsed_at: new Date().toISOString(),
      download_attempts: attempts,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    // Only set the FK when we actually have it (avoid nulling an existing link).
    if (ctx.recordingRowId) row.zoom_recording_id = ctx.recordingRowId

    const { error } = await admin
      .from("zoom_transcripts")
      .upsert(row, { onConflict: "zoom_meeting_uuid,recording_file_id" })

    if (error) {
      console.error("[v0] [Zoom Ingest] transcript upsert failed:", error.message)
      return false
    }
    return true
  } catch (err) {
    await upsertTranscriptFailure(ctx, file, attempts, err instanceof Error ? err.message : "unknown")
    return false
  }
}

/** Record a transcript download/parse failure for retry visibility. */
async function upsertTranscriptFailure(
  ctx: IngestContext,
  file: ZoomRecordingFile,
  attempts: number,
  reason: string,
  expired = false,
): Promise<void> {
  await ctx.admin.from("zoom_transcripts").upsert(
    {
      zoom_connection_id: ctx.zoomConnectionId ?? null,
      team_member_id: ctx.teamMemberId ?? null,
      zoom_meeting_id: ctx.meetingIdNumeric,
      zoom_meeting_uuid: ctx.meetingUuid,
      recording_file_id: file.id ?? null,
      file_type: file.file_type ?? null,
      download_url: file.download_url ?? null,
      status: expired ? ("expired" as const) : ("failed" as const),
      error: reason,
      download_attempts: attempts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "zoom_meeting_uuid,recording_file_id" },
  )
}

/** Stream a media file to Vercel Blob, returning its blob link. */
async function copyMediaToBlob(
  ctx: IngestContext,
  file: ZoomRecordingFile,
): Promise<{ blob_url: string; blob_pathname: string } | null> {
  if (!file.download_url) return null
  try {
    const res = await downloadZoomFile(file.download_url, ctx.bearerToken)
    if (!res.ok || !res.body) return null

    const ext = extForFile(file)
    const pathname = `zoom/${ctx.meetingUuid}/${file.id || file.recording_type || "media"}.${ext}`
    const blob = await put(pathname, res.body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return { blob_url: blob.url, blob_pathname: blob.pathname }
  } catch (err) {
    console.warn(
      "[v0] [Zoom Ingest] media blob copy failed:",
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
