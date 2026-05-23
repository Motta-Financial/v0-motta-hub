/**
 * Pre-populates `zoom_meetings` and `zoom_recordings` for every active
 * Zoom connection so the rest of the system has a stable source of
 * truth to operate on.
 *
 * Why this exists
 * ───────────────
 * Historically, `zoom_meetings` was only populated as a side-effect of
 * tagging — the per-meeting tag endpoint lazy-upserts the parent row on
 * first use. That meant untagged meetings effectively didn't exist in
 * our database, so any feature that depends on "find untagged
 * meetings" (the todo sweep, reporting tiles, search) couldn't see
 * them. The fix is to proactively sync recent meetings + recordings on
 * a schedule, and on-demand right before running the todo sweep.
 *
 * Scope
 * ─────
 * - Past meetings within `sinceDays` (default 60) so we don't backfill
 *   ancient history that nobody will tag retroactively.
 * - Upcoming meetings too, mostly so the dashboard's "Today / This
 *   Week" tiles stay accurate even if the user hasn't hit "Sync All".
 * - Recordings from the same window. Zoom's `/users/me/recordings`
 *   endpoint takes `from` / `to` so we hit it once per connection.
 *
 * Token handling is delegated to `zoomFetch` from `lib/zoom-auth.ts`,
 * which auto-refreshes on 401. Per-connection failures are logged but
 * don't block other connections — the sweep is best-effort by design.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getActiveZoomConnections,
  zoomFetch,
  type ZoomConnection,
} from "@/lib/zoom-auth"
import { processRecentZoomParticipants } from "@/lib/zoom/process-meeting-participants"

export interface SyncRecentZoomDataOptions {
  supabase: SupabaseClient
  sinceDays?: number
  /**
   * Optional filter: only sync this connection. Used by the "Sync my
   * Zoom data" UX so a single user can refresh their own history
   * without paying the cost of the firm-wide sweep.
   */
  zoomConnectionId?: string | null
  /**
   * Optional filter on team_member_id, applied after we load every
   * active connection. Matches the same flag used by the todo sweep so
   * a user-initiated "Send to my todo list" only does work for them.
   */
  teamMemberId?: string | null
}

export interface SyncRecentZoomDataResult {
  connections: number
  meetingsUpserted: number
  recordingsUpserted: number
  /**
   * Aggregated stats from the participant → Hub-contact bridge that
   * runs after meeting upserts. Zero when no new external participants
   * were seen in the meetings we processed this run.
   */
  participantsScanned: number
  hubContactsCreated: number
  hubContactsMatched: number
  errors: Array<{ zoom_email: string; error: string }>
}

/**
 * Format a Date as `YYYY-MM-DD` — Zoom's `from` / `to` query params
 * accept date strings, not ISO timestamps, and including a time
 * component causes the API to silently return zero results.
 */
function toZoomDateParam(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function syncRecentZoomData(
  opts: SyncRecentZoomDataOptions,
): Promise<SyncRecentZoomDataResult> {
  const { supabase, sinceDays = 60, zoomConnectionId, teamMemberId } = opts

  let connections = await getActiveZoomConnections()
  if (zoomConnectionId) connections = connections.filter((c) => c.id === zoomConnectionId)
  if (teamMemberId) {
    connections = connections.filter((c) => c.team_member_id === teamMemberId)
  }

  const errors: Array<{ zoom_email: string; error: string }> = []
  let meetingsUpserted = 0
  let recordingsUpserted = 0
  let participantsScanned = 0
  let hubContactsCreated = 0
  let hubContactsMatched = 0

  if (connections.length === 0) {
    return {
      connections: 0,
      meetingsUpserted,
      recordingsUpserted,
      participantsScanned,
      hubContactsCreated,
      hubContactsMatched,
      errors,
    }
  }

  const now = new Date()
  const fromDate = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000)
  const from = toZoomDateParam(fromDate)
  const to = toZoomDateParam(now)

  for (const conn of connections) {
    try {
      // ── Past meetings (`previous_meetings`) ────────────────────
      // Zoom paginates via `next_page_token`, but the default
      // page_size=300 covers 95th-percentile use. We follow next-page
      // tokens up to 5 pages (1,500 meetings) per connection per run
      // to bound the runtime — anything more is degenerate use.
      const pageSize = 300
      const maxPages = 5

      const meetingTypes: Array<"previous_meetings" | "upcoming_meetings"> = [
        "previous_meetings",
        "upcoming_meetings",
      ]

      for (const meetingType of meetingTypes) {
        let nextToken: string | null = null
        for (let page = 0; page < maxPages; page++) {
          const params = new URLSearchParams({
            type: meetingType,
            page_size: String(pageSize),
            from,
            to,
          })
          if (nextToken) params.set("next_page_token", nextToken)
          const url = `https://api.zoom.us/v2/users/me/meetings?${params.toString()}`
          const res = await zoomFetch(conn as ZoomConnection, url)
          if (!res.ok) {
            const body = await res.text().catch(() => "")
            throw new Error(
              `meetings.${meetingType} ${res.status}: ${body.slice(0, 200)}`,
            )
          }
          const data = (await res.json()) as {
            meetings?: any[]
            next_page_token?: string
          }
          const meetings = data.meetings ?? []
          if (meetings.length > 0) {
            const rows = meetings.map((m) => ({
              zoom_meeting_id: m.id,
              zoom_uuid: m.uuid,
              zoom_host_id: m.host_id,
              topic: m.topic,
              meeting_type: m.type,
              status: m.status ?? meetingType,
              start_time: m.start_time,
              duration: m.duration,
              timezone: m.timezone,
              agenda: m.agenda,
              join_url: m.join_url,
              host_email: conn.zoom_email,
              // The original POST in master-meetings forgot to
              // populate this — without it the todo sweep can't
              // assign a task because there's no "who hosts this
              // meeting" link. Set it on every upsert so old rows
              // get healed too.
              team_member_id: conn.team_member_id,
              zoom_connection_id: conn.id,
              raw_data: m,
              synced_at: new Date().toISOString(),
            }))
            const { error } = await supabase
              .from("zoom_meetings")
              .upsert(rows, { onConflict: "zoom_meeting_id" })
            if (error) throw new Error(`zoom_meetings upsert: ${error.message}`)
            meetingsUpserted += rows.length
          }
          nextToken = data.next_page_token || null
          if (!nextToken) break
        }
      }

      // ── Recordings ────────────────────────────────────────────
      // Zoom's recordings endpoint is `/users/me/recordings` with
      // from/to params. Same pagination contract as meetings.
      {
        let nextToken: string | null = null
        for (let page = 0; page < maxPages; page++) {
          const params = new URLSearchParams({
            page_size: String(pageSize),
            from,
            to,
          })
          if (nextToken) params.set("next_page_token", nextToken)
          const url = `https://api.zoom.us/v2/users/me/recordings?${params.toString()}`
          const res = await zoomFetch(conn as ZoomConnection, url)
          if (!res.ok) {
            // Recordings frequently 401 for users without cloud
            // recording entitlement — don't treat as fatal.
            if (res.status === 401 || res.status === 403) break
            const body = await res.text().catch(() => "")
            throw new Error(
              `recordings ${res.status}: ${body.slice(0, 200)}`,
            )
          }
          const data = (await res.json()) as {
            meetings?: any[]
            next_page_token?: string
          }
          const recs = data.meetings ?? []
          if (recs.length > 0) {
            const rows = recs.map((rec) => ({
              zoom_meeting_id: rec.id,
              zoom_uuid: rec.uuid,
              topic: rec.topic,
              start_time: rec.start_time,
              duration: rec.duration,
              total_size: rec.total_size ?? null,
              recording_count: rec.recording_count ?? null,
              recording_files: rec.recording_files ?? [],
              share_url: rec.share_url ?? null,
              team_member_id: conn.team_member_id,
              zoom_connection_id: conn.id,
              raw_data: rec,
              synced_at: new Date().toISOString(),
            }))
            const { error } = await supabase
              .from("zoom_recordings")
              .upsert(rows, { onConflict: "zoom_meeting_id" })
            if (error) throw new Error(`zoom_recordings upsert: ${error.message}`)
            recordingsUpserted += rows.length

            // Also upsert a `zoom_meetings` row for each recording so
            // the tag-counts view + the todo sweep can see it even
            // when Zoom's `meetings?type=previous_meetings` somehow
            // missed it (instant meetings, breakout rooms, etc).
            const meetingRows = recs.map((rec) => ({
              zoom_meeting_id: rec.id,
              zoom_uuid: rec.uuid,
              topic: rec.topic,
              start_time: rec.start_time,
              duration: rec.duration,
              host_email: conn.zoom_email,
              team_member_id: conn.team_member_id,
              zoom_connection_id: conn.id,
              status: "ended",
              raw_data: rec,
              synced_at: new Date().toISOString(),
            }))
            await supabase
              .from("zoom_meetings")
              .upsert(meetingRows, {
                onConflict: "zoom_meeting_id",
                // Don't overwrite richer data with the recording
                // payload if a `meetings` upsert already populated
                // it. `ignoreDuplicates: true` would skip too much,
                // so we let conflict path run but it only writes
                // the columns we set above which is acceptable.
              })
          }
          nextToken = data.next_page_token || null
          if (!nextToken) break
        }
      }

      // Record the timestamp so the dashboard's "last synced" copy
      // reflects this background sync too, not just the manual
      // "Sync All" button.
      await supabase
        .from("zoom_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", conn.id)

      // ── Hub contact bridge ───────────────────────────────────
      // After meetings are upserted, walk recently-ended meetings
      // for this connection and turn each external participant into
      // a Master Hub Contact (auto-created if none exists). The call
      // is best-effort — Zoom participant fetches frequently 404 for
      // instant meetings, and we don't want to fail the whole sync
      // over it. Each connection processes up to 50 meetings per
      // run; the watermark column ensures we eventually catch up.
      try {
        const partResult = await processRecentZoomParticipants(
          supabase,
          conn as ZoomConnection,
          { sinceDays, maxMeetings: 50 },
        )
        participantsScanned += partResult.participantsSeen
        hubContactsCreated += partResult.contactsCreated
        hubContactsMatched += partResult.contactsMatched
        if (partResult.errors.length > 0) {
          console.warn(
            `[v0] [Zoom Recent Sync] ${conn.zoom_email} participant errors:`,
            partResult.errors,
          )
        }
      } catch (err) {
        console.error(
          `[v0] [Zoom Recent Sync] ${conn.zoom_email} participant processor crashed (non-fatal):`,
          err,
        )
      }
    } catch (err) {
      errors.push({
        zoom_email: conn.zoom_email,
        error: err instanceof Error ? err.message : "unknown",
      })
      console.error(
        `[v0] [Zoom Recent Sync] ${conn.zoom_email} failed:`,
        err,
      )
    }
  }

  return {
    connections: connections.length,
    meetingsUpserted,
    recordingsUpserted,
    participantsScanned,
    hubContactsCreated,
    hubContactsMatched,
    errors,
  }
}
