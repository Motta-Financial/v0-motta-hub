/**
 * Backfill Zoom cloud recordings + transcripts for every connected user.
 *
 * Why this exists: historical transcripts that arrived via webhook were stored
 * as bare pointers, and their signed download URLs have since expired. Rather
 * than try to reuse stale URLs, this re-pulls each connected user's recordings
 * with a FRESH OAuth token (via zoomFetch, which auto-refreshes), upserts the
 * recording rows (now that migration 333 added the unique index), and runs the
 * shared ingestion worker to download + parse transcripts and copy media to
 * Blob.
 *
 * Scope note: this covers the CONNECTED users only (per-user OAuth). Account-
 * wide coverage requires the Server-to-Server credentials (separate task).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getActiveZoomConnections, zoomFetch, type ZoomConnection } from "@/lib/zoom-auth"
import { ingestRecordingFiles, type ZoomRecordingFile } from "./ingest-recording-files"

export interface BackfillOptions {
  supabase: SupabaseClient
  /** How many 1-month windows back to scan. Zoom caps each query at 1 month. */
  months?: number
  /** Also copy MP4/M4A media to Blob (slower/heavier). Default true. */
  includeMedia?: boolean
}

export interface BackfillResult {
  connections: number
  recordingsUpserted: number
  transcriptsParsed: number
  transcriptsFailed: number
  mediaCopied: number
  errors: string[]
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function backfillZoomRecordings(opts: BackfillOptions): Promise<BackfillResult> {
  const { supabase } = opts
  const months = Math.max(1, Math.min(opts.months ?? 6, 24))
  const includeMedia = opts.includeMedia !== false

  const result: BackfillResult = {
    connections: 0,
    recordingsUpserted: 0,
    transcriptsParsed: 0,
    transcriptsFailed: 0,
    mediaCopied: 0,
    errors: [],
  }

  let connections: ZoomConnection[] = []
  try {
    connections = await getActiveZoomConnections()
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : "load_connections_failed")
    return result
  }
  result.connections = connections.length

  for (const conn of connections) {
    try {
      // Walk month windows backward. Zoom's recordings endpoint caps the
      // from/to range at ~1 month, so we issue one request per window.
      for (let m = 0; m < months; m++) {
        const to = new Date()
        to.setMonth(to.getMonth() - m)
        const from = new Date(to)
        from.setMonth(from.getMonth() - 1)

        let nextToken: string | null = null
        for (let page = 0; page < 20; page++) {
          const params = new URLSearchParams({
            page_size: "300",
            from: ymd(from),
            to: ymd(to),
          })
          if (nextToken) params.set("next_page_token", nextToken)
          const url = `https://api.zoom.us/v2/users/me/recordings?${params.toString()}`

          // zoomFetch refreshes the token on 401 and updates conn.access_token
          // in place, so subsequent file downloads use a valid bearer.
          const res = await zoomFetch(conn, url)
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) break // no recording entitlement
            const body = await res.text().catch(() => "")
            throw new Error(`recordings ${res.status}: ${body.slice(0, 160)}`)
          }

          const data = (await res.json()) as {
            meetings?: Array<Record<string, any>>
            next_page_token?: string
          }
          const recs = data.meetings ?? []

          for (const rec of recs) {
            const files = (rec.recording_files ?? []) as ZoomRecordingFile[]

            // Upsert the recording row (unique on zoom_uuid now).
            const { data: upserted, error: recErr } = await supabase
              .from("zoom_recordings")
              .upsert(
                {
                  zoom_uuid: rec.uuid,
                  zoom_meeting_id: rec.id,
                  topic: rec.topic ?? null,
                  start_time: rec.start_time ?? null,
                  duration: rec.duration ?? null,
                  total_size: rec.total_size ?? null,
                  recording_count: rec.recording_count ?? files.length,
                  recording_files: files,
                  share_url: rec.share_url ?? null,
                  team_member_id: conn.team_member_id,
                  zoom_connection_id: conn.id,
                  raw_data: rec,
                  synced_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "zoom_uuid" },
              )
              .select("id")
              .maybeSingle()

            if (recErr) {
              result.errors.push(`rec upsert ${rec.uuid}: ${recErr.message}`)
              continue
            }
            result.recordingsUpserted++

            // Ingest transcript + (optionally) media using the fresh token.
            const filesToIngest = includeMedia
              ? files
              : files.filter((f) => {
                  const t = (f.file_type || "").toUpperCase()
                  return t === "TRANSCRIPT" || t === "CC" || t === "CLOSED_CAPTION"
                })

            const ingest = await ingestRecordingFiles(
              {
                admin: supabase,
                meetingUuid: rec.uuid,
                meetingIdNumeric: typeof rec.id === "number" ? rec.id : Number(rec.id) || null,
                recordingRowId: upserted?.id ?? null,
                zoomConnectionId: conn.id,
                teamMemberId: conn.team_member_id,
                bearerToken: conn.access_token,
              },
              filesToIngest,
            )

            result.transcriptsParsed += ingest.transcriptsParsed
            result.transcriptsFailed += ingest.transcriptsFailed
            result.mediaCopied += ingest.mediaCopied

            // Persist any per-file Blob links back into recording_files.
            if (ingest.mediaCopied > 0) {
              await supabase
                .from("zoom_recordings")
                .update({ recording_files: ingest.updatedFiles, updated_at: new Date().toISOString() })
                .eq("zoom_uuid", rec.uuid)
            }
          }

          nextToken = data.next_page_token || null
          if (!nextToken) break
        }
      }
    } catch (err) {
      result.errors.push(`${conn.zoom_email}: ${err instanceof Error ? err.message : "unknown"}`)
    }
  }

  return result
}
