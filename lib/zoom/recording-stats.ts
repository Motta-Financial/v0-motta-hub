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
import { get, head } from "@vercel/blob"

/**
 * Live reachability of the private `zoom-recordings` Blob store.
 *
 * Worth probing both halves separately: uploads go through the Blob API
 * (`head`/`put`) while playback fetches the store URL directly (`get`), and
 * they authorize independently. A rotated ZOOM_BLOB_READ_WRITE_TOKEN once
 * stopped the nightly archive AND every archived recording for four days
 * while every dashboard still looked green — `api: false, read: false` here
 * says that in one line.
 */
export interface ZoomBlobStoreHealth {
  /** Store id from the token in use (public — it's in every blob URL). */
  store: string
  /** False when ZOOM_BLOB_READ_WRITE_TOKEN is unset and we fell back to the default store's token. */
  dedicatedToken: boolean
  /** Blob API (what uploads use). null = not probed. */
  api: boolean | null
  /** Direct store read (what playback uses). null = not probed. */
  read: boolean | null
  /** The archived file we probed, if any. */
  checkedPathname: string | null
  /** First failure message, verbatim. */
  error: string | null
}

export interface ZoomRecordingStats {
  recordingsTotal: number
  transcriptsTotal: number
  transcriptsParsed: number
  transcriptsFailed: number
  transcriptsExpired: number
  /** Recordings that have at least one media file copied to Vercel Blob. */
  mediaArchived: number
  /** Live reachability of the private store the archive lives in. */
  blobStore: ZoomBlobStoreHealth
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

/** First archived pathname in a `recording_files` array, if any. */
function firstBlobPathname(files: unknown): string | null {
  if (!Array.isArray(files)) return null
  for (const f of files) {
    const p = f && typeof f === "object" ? (f as { blob_pathname?: unknown }).blob_pathname : null
    if (typeof p === "string" && p) return p
  }
  return null
}

/**
 * Probe the store with one archived file. Never throws — a broken store must
 * not take down the stats page that reports it's broken.
 */
async function probeBlobStore(pathname: string | null): Promise<ZoomBlobStoreHealth> {
  const dedicated = process.env.ZOOM_BLOB_READ_WRITE_TOKEN
  const token = dedicated || process.env.BLOB_READ_WRITE_TOKEN || ""
  const health: ZoomBlobStoreHealth = {
    store: token.split("_")[3] || "unknown",
    dedicatedToken: Boolean(dedicated),
    api: null,
    read: null,
    checkedPathname: pathname,
    error: null,
  }
  if (!pathname || !token) return health

  try {
    await head(pathname, { token })
    health.api = true
  } catch (err) {
    health.api = false
    health.error = err instanceof Error ? err.message : String(err)
  }

  try {
    // One byte is enough to prove the read path — this is the same call the
    // stream route makes for playback.
    const r = await get(pathname, {
      access: "private",
      token,
      headers: { range: "bytes=0-0" },
    })
    health.read = Boolean(r && r.statusCode === 200)
  } catch (err) {
    health.read = false
    health.error = health.error || (err instanceof Error ? err.message : String(err))
  }

  return health
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
  let probePathname: string | null = null
  for (const r of rows) {
    if (fileHasBlob(r.recording_files)) mediaArchived++
    if (!probePathname) probePathname = firstBlobPathname(r.recording_files)
    if (r.synced_at && (!lastSyncedAt || r.synced_at > lastSyncedAt)) lastSyncedAt = r.synced_at
    if (r.start_time && (!newestRecordingStart || r.start_time > newestRecordingStart)) {
      newestRecordingStart = r.start_time
    }
  }

  const blobStore = await probeBlobStore(probePathname)

  return {
    recordingsTotal,
    transcriptsTotal,
    transcriptsParsed,
    transcriptsFailed,
    transcriptsExpired,
    mediaArchived,
    blobStore,
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
