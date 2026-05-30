/**
 * Shared read-only stats for the account-wide Zoom recording pipeline.
 *
 * Used by:
 *   - the admin status route (`/api/zoom/recordings/status`) that powers
 *     the "Zoom Recordings" admin page, and
 *   - the ALFRED `getZoomRecordingStatus` tool.
 *
 * Counts are deliberately cheap (head/count queries + one small recent
 * page) so this can run inside the 60s ALFRED chat budget. It never reads
 * transcript bodies — only status columns — so it's safe to surface in
 * chat without leaking meeting content.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface ZoomRecordingStats {
  recordingsTotal: number
  transcriptsTotal: number
  transcriptsParsed: number
  transcriptsFailed: number
  transcriptsExpired: number
  /** Recordings that have at least one media file copied to Vercel Blob. */
  mediaArchived: number
  /** ISO timestamp of the most recently synced recording, if any. */
  lastSyncedAt: string | null
  /** ISO start_time of the newest meeting we hold a recording for. */
  newestRecordingStart: string | null
  recent: Array<{
    id: string
    topic: string | null
    start_time: string | null
    duration: number | null
    hasMediaInBlob: boolean
  }>
}

async function countRows(
  admin: SupabaseClient,
  table: string,
  filter?: { column: string; value: string },
): Promise<number> {
  let q = admin.from(table).select("id", { count: "exact", head: true })
  if (filter) q = q.eq(filter.column, filter.value)
  const { count, error } = await q
  if (error) return 0
  return count ?? 0
}

function fileHasBlob(files: unknown): boolean {
  if (!Array.isArray(files)) return false
  return files.some(
    (f) => f && typeof f === "object" && typeof (f as { blob_pathname?: unknown }).blob_pathname === "string",
  )
}

export async function getZoomRecordingStats(admin: SupabaseClient): Promise<ZoomRecordingStats> {
  const [recordingsTotal, transcriptsTotal, transcriptsParsed, transcriptsFailed, transcriptsExpired] =
    await Promise.all([
      countRows(admin, "zoom_recordings"),
      countRows(admin, "zoom_transcripts"),
      countRows(admin, "zoom_transcripts", { column: "status", value: "parsed" }),
      countRows(admin, "zoom_transcripts", { column: "status", value: "failed" }),
      countRows(admin, "zoom_transcripts", { column: "status", value: "expired" }),
    ])

  // One recent page to compute media-in-blob count + a recent list. We cap
  // the scan so this stays cheap even as the table grows.
  const { data: recentRows } = await admin
    .from("zoom_recordings")
    .select("id, topic, start_time, duration, synced_at, recording_files")
    .order("start_time", { ascending: false, nullsFirst: false })
    .limit(200)

  const rows = recentRows ?? []
  let mediaArchived = 0
  let lastSyncedAt: string | null = null
  let newestRecordingStart: string | null = null
  for (const r of rows) {
    if (fileHasBlob(r.recording_files)) mediaArchived++
    if (r.synced_at && (!lastSyncedAt || r.synced_at > lastSyncedAt)) lastSyncedAt = r.synced_at
    if (r.start_time && (!newestRecordingStart || r.start_time > newestRecordingStart)) {
      newestRecordingStart = r.start_time
    }
  }

  return {
    recordingsTotal,
    transcriptsTotal,
    transcriptsParsed,
    transcriptsFailed,
    transcriptsExpired,
    mediaArchived,
    lastSyncedAt,
    newestRecordingStart,
    recent: rows.slice(0, 10).map((r) => ({
      id: r.id,
      topic: r.topic ?? null,
      start_time: r.start_time ?? null,
      duration: r.duration ?? null,
      hasMediaInBlob: fileHasBlob(r.recording_files),
    })),
  }
}
