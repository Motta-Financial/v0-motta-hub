/**
 * Account-wide Zoom meeting LINKING sweep (decoupled from ingest).
 * ───────────────────────────────────────────────────────────────
 *
 * Why this is separate from `sync-account-recordings.ts`
 * ──────────────────────────────────────────────────────
 * The daily account sync's job is to pull recordings + transcripts for
 * EVERY user in the Zoom account. That part is fast and I/O-bound.
 *
 * Client *linking* (participant resolution → Calendly bridge → ALFRED
 * triage) is slow and CPU/token-bound: each meeting can take a few
 * seconds (contact upserts + a model call). Inlining it into the daily
 * recordings sweep meant a single 300s invocation could only get through
 * a handful of meetings before timing out — leaving the rest of the
 * account un-linked, and their transcripts stranded at
 * `summary_status='skipped_no_client'`.
 *
 * This module is the fix: a BOUNDED, idempotent linking pass that the
 * daily sync no longer has to carry. An hourly cron drains the backlog a
 * batch at a time, so each invocation finishes well within budget and a
 * large backfill simply takes a few hours to fully drain.
 *
 * It reuses the exact connection-sweep code path (`processOneMeeting`),
 * just bound to the account-wide S2S token. `processOneMeeting` already:
 *   • resolves participants → Hub contacts (when the participant scope
 *     is present),
 *   • runs the deterministic Calendly→Zoom bridge,
 *   • runs ALFRED triage (which now also mines the meeting TOPIC for a
 *     client when there are no participants — see lib/alfred/zoom-triage.ts),
 *   • and leaves `participants_processed_at` unset when the participant
 *     fetch itself failed (missing scope) so we can retry later.
 *
 * Watermarks drive selection:
 *   • Fresh pass (default): meetings never linked at all
 *     (`participants_processed_at IS NULL AND alfred_triage_at IS NULL`).
 *     Each such meeting gets exactly ONE pass — even if the participant
 *     fetch 4711s on a missing scope, ALFRED still runs (topic/bridge)
 *     and stamps `alfred_triage_at`, so we don't re-spend tokens on it
 *     every hour.
 *   • Retry pass (`retryParticipantless: true`): meetings that were
 *     ALFRED-triaged but whose participant fetch never succeeded
 *     (`participants_processed_at IS NULL AND alfred_triage_at IS NOT
 *     NULL`). Run this ONCE after granting
 *     `meeting:read:list_past_participants:admin` to backfill real
 *     attendee links on top of the topic-based guesses.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { isS2SConfigured, s2sFetch } from "./s2s-auth"
import { processOneMeeting, type ProcessResult } from "./process-meeting-participants"

export interface LinkSweepOptions {
  supabase: SupabaseClient
  /** Cap on meetings processed in one invocation. Default 20. */
  maxMeetings?: number
  /** Only consider meetings whose start_time is within this many days. Default 365. */
  sinceDays?: number
  /**
   * Re-attempt meetings that were already ALFRED-triaged but never had a
   * successful participant fetch (i.e. the scope was missing at the
   * time). Use after granting the past-participants scope.
   */
  retryParticipantless?: boolean
}

export interface LinkSweepResult extends ProcessResult {
  /** Whether this was a retry-participantless pass. */
  retryPass: boolean
}

export async function sweepAccountLinking(opts: LinkSweepOptions): Promise<LinkSweepResult> {
  const { supabase } = opts
  const maxMeetings = Math.max(1, Math.min(opts.maxMeetings ?? 20, 100))
  const sinceDays = Math.max(1, Math.min(opts.sinceDays ?? 365, 1000))
  const retryPass = opts.retryParticipantless === true

  const result: LinkSweepResult = {
    meetingsScanned: 0,
    participantsSeen: 0,
    contactsCreated: 0,
    contactsMatched: 0,
    linksWritten: 0,
    bridgedFromCalendly: 0,
    alfredTagged: 0,
    errors: [],
    retryPass,
  }

  if (!isS2SConfigured()) {
    result.errors.push({ meeting_uuid: "config", error: "zoom_s2s_not_configured" })
    return result
  }

  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from("zoom_meetings")
    .select("id, zoom_uuid, zoom_meeting_id, start_time, topic, agenda, host_email, team_member_id")
    .is("participants_processed_at", null)
    .not("zoom_uuid", "is", null)
    .gte("start_time", sinceIso)
    // Oldest unprocessed first so a backlog drains in order.
    .order("start_time", { ascending: true })
    .limit(maxMeetings)

  query = retryPass
    ? query.not("alfred_triage_at", "is", null)
    : query.is("alfred_triage_at", null)

  const { data: meetings, error } = await query
  if (error) {
    result.errors.push({ meeting_uuid: "select", error: error.message })
    return result
  }

  for (const m of meetings ?? []) {
    result.meetingsScanned += 1
    try {
      await processOneMeeting(supabase, (url) => s2sFetch(url), m as never, result)
    } catch (err) {
      result.errors.push({
        meeting_uuid: (m as { zoom_uuid?: string; zoom_meeting_id?: string }).zoom_uuid ??
          (m as { zoom_meeting_id?: string }).zoom_meeting_id ??
          "unknown",
        error: err instanceof Error ? err.message : "unknown",
      })
    }
  }

  return result
}
