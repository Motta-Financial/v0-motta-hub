/**
 * Account-wide Zoom cloud-recording + transcript sync (Option A).
 *
 * Uses Server-to-Server OAuth (`lib/zoom/s2s-auth.ts`) to enumerate EVERY
 * user in the Motta Zoom account and pull each one's cloud recordings —
 * including team members who never personally connected the Hub via
 * per-user OAuth. This is the account-wide counterpart to
 * `backfill-recordings.ts` (which only covers connected users).
 *
 * For each recording it:
 *   - upserts the `zoom_recordings` row (unique on zoom_uuid),
 *   - attributes it to a `team_members` row when the Zoom user maps to one
 *     (via zoom_connections.zoom_user_id, then by email → team_members),
 *   - runs the shared `ingestRecordingFiles` worker to download + parse
 *     transcripts and (optionally) copy media to Blob, using the account
 *     S2S token as the download bearer.
 *
 * Idempotent and safe to re-run: recordings upsert on zoom_uuid and the
 * ingest worker skips already-parsed transcripts / already-copied media.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getS2SAccessToken, listAllZoomUsers, s2sFetch, isS2SConfigured } from "./s2s-auth"
import { ingestRecordingFiles, type ZoomRecordingFile } from "./ingest-recording-files"

export interface AccountSyncOptions {
  supabase: SupabaseClient
  /** How many 1-month windows back to scan. Zoom caps each query at 1 month. */
  months?: number
  /** Also copy MP4/M4A media to Blob (slower/heavier). Default false for sweeps. */
  includeMedia?: boolean
  /** Limit to a single Zoom user id / email (debugging). */
  onlyUser?: string
}

export interface AccountSyncResult {
  usersScanned: number
  usersWithRecordings: number
  recordingsUpserted: number
  transcriptsParsed: number
  transcriptsFailed: number
  mediaCopied: number
  errors: string[]
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Resolve every Zoom-user → team_member attribution up front. */
async function buildAttributionMaps(admin: SupabaseClient) {
  const byZoomUserId = new Map<string, { teamMemberId: string | null; connectionId: string | null }>()
  const byEmail = new Map<string, { teamMemberId: string | null; connectionId: string | null }>()

  const { data: conns } = await admin
    .from("zoom_connections")
    .select("id, team_member_id, zoom_user_id, zoom_email")
  for (const c of conns ?? []) {
    const entry = { teamMemberId: c.team_member_id ?? null, connectionId: c.id ?? null }
    if (c.zoom_user_id) byZoomUserId.set(c.zoom_user_id, entry)
    if (c.zoom_email) byEmail.set(c.zoom_email.toLowerCase(), entry)
  }

  // Fall back to matching team members by email for non-connected users.
  const { data: members } = await admin.from("team_members").select("id, email")
  for (const m of members ?? []) {
    if (!m.email) continue
    const key = m.email.toLowerCase()
    if (!byEmail.has(key)) byEmail.set(key, { teamMemberId: m.id ?? null, connectionId: null })
  }

  return { byZoomUserId, byEmail }
}

export async function syncAccountWideRecordings(opts: AccountSyncOptions): Promise<AccountSyncResult> {
  const { supabase } = opts
  const months = Math.max(1, Math.min(opts.months ?? 6, 24))
  const includeMedia = opts.includeMedia === true

  const result: AccountSyncResult = {
    usersScanned: 0,
    usersWithRecordings: 0,
    recordingsUpserted: 0,
    transcriptsParsed: 0,
    transcriptsFailed: 0,
    mediaCopied: 0,
    errors: [],
  }

  if (!isS2SConfigured()) {
    result.errors.push("zoom_s2s_not_configured")
    return result
  }

  const maps = await buildAttributionMaps(supabase)

  let users
  try {
    users = await listAllZoomUsers("active")
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : "list_users_failed")
    return result
  }

  if (opts.onlyUser) {
    const needle = opts.onlyUser.toLowerCase()
    users = users.filter((u) => u.id === opts.onlyUser || u.email?.toLowerCase() === needle)
  }
  result.usersScanned = users.length

  for (const user of users) {
    const attribution =
      maps.byZoomUserId.get(user.id) ??
      (user.email ? maps.byEmail.get(user.email.toLowerCase()) : undefined) ??
      { teamMemberId: null, connectionId: null }

    let userHadRecordings = false

    try {
      // Walk month windows backward; Zoom caps each query at ~1 month.
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
          const url = `https://api.zoom.us/v2/users/${encodeURIComponent(user.id)}/recordings?${params.toString()}`

          const res = await s2sFetch(url)
          if (!res.ok) {
            // 404 = user has no recordings entitlement; skip quietly.
            if (res.status === 404) break
            const body = await res.text().catch(() => "")
            throw new Error(`recordings ${res.status}: ${body.slice(0, 160)}`)
          }

          const data = (await res.json()) as {
            meetings?: Array<Record<string, any>>
            next_page_token?: string
          }
          const recs = data.meetings ?? []
          if (recs.length > 0) userHadRecordings = true

          for (const rec of recs) {
            const files = (rec.recording_files ?? []) as ZoomRecordingFile[]

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
                  team_member_id: attribution.teamMemberId,
                  zoom_connection_id: attribution.connectionId,
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

            // Also upsert a parent `zoom_meetings` row so the transcript is
            // resolvable (the summarizer requires a zoom_meetings row) and so
            // the client-link layers + Hub Meetings dashboard can see this
            // account-wide meeting. Mirrors the recording→meeting upsert in
            // sync-recent-meetings.ts. onConflict zoom_meeting_id; we only set
            // the columns we know so a richer prior row isn't clobbered.
            const { error: zmErr } = await supabase.from("zoom_meetings").upsert(
              {
                zoom_meeting_id: rec.id,
                zoom_uuid: rec.uuid,
                topic: rec.topic ?? "(untitled meeting)",
                start_time: rec.start_time ?? null,
                duration: rec.duration ?? null,
                host_email: user.email ?? null,
                zoom_host_id: user.id ?? null,
                team_member_id: attribution.teamMemberId,
                zoom_connection_id: attribution.connectionId,
                status: "ended",
                raw_data: rec,
                synced_at: new Date().toISOString(),
              },
              { onConflict: "zoom_meeting_id" },
            )
            if (zmErr) {
              result.errors.push(`meeting upsert ${rec.id}: ${zmErr.message}`)
            }

            const filesToIngest = includeMedia
              ? files
              : files.filter((f) => {
                  const t = (f.file_type || "").toUpperCase()
                  return t === "TRANSCRIPT" || t === "CC" || t === "CLOSED_CAPTION"
                })

            // Fresh account token as the download bearer (cached helper
            // re-mints near expiry, so long runs stay valid).
            const bearer = await getS2SAccessToken()

            const ingest = await ingestRecordingFiles(
              {
                admin: supabase,
                meetingUuid: rec.uuid,
                meetingIdNumeric: typeof rec.id === "number" ? rec.id : Number(rec.id) || null,
                recordingRowId: upserted?.id ?? null,
                zoomConnectionId: attribution.connectionId,
                teamMemberId: attribution.teamMemberId,
                bearerToken: bearer,
              },
              filesToIngest,
            )

            result.transcriptsParsed += ingest.transcriptsParsed
            result.transcriptsFailed += ingest.transcriptsFailed
            result.mediaCopied += ingest.mediaCopied

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
      result.errors.push(`${user.email ?? user.id}: ${err instanceof Error ? err.message : "unknown"}`)
    }

    if (userHadRecordings) result.usersWithRecordings++
  }

  return result
}
