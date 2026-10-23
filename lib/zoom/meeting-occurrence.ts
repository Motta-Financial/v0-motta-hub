/**
 * Zoom meeting NUMBER vs meeting OCCURRENCE.
 *
 * The numeric Zoom meeting id (`zoom_meeting_id` / `zoom_meeting_numeric_id`)
 * is NOT unique per meeting. A Personal Meeting Room (PMI) and every recurring
 * meeting reuse one number for every session held in it — one host's PMI holds
 * hundreds of unrelated client meetings. Only the meeting UUID (`zoom_uuid` /
 * `zoom_meeting_uuid`) identifies a single session.
 *
 * Recordings, transcripts and AI summaries are all stored per UUID, so the data
 * is correct; any READ keyed on the number alone returns some other session's
 * transcript/summary. Resolve the occurrence here first, then filter by UUID.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/** How far a calendar start time may sit from the actual Zoom start. */
const START_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000
/**
 * Sessions starting this close together are one meeting restarted (dropped
 * call, host rejoined) — a calendar time can't tell them apart, so take the
 * longest, which is where the conversation happened.
 */
const RESTART_WINDOW_MS = 10 * 60 * 1000

export interface ResolvedOccurrence {
  /** UUID of the single session to show, or null when none/ambiguous. */
  uuid: string | null
  /** True when the number has held more than one session. */
  shared: boolean
  /** Shared number and we could not tell which session was meant. */
  ambiguous: boolean
}

interface Occurrence {
  uuid: string
  start: number | null
  duration: number
}

async function listOccurrences(admin: SupabaseClient, numericId: number): Promise<Occurrence[]> {
  const [recRes, trRes] = await Promise.all([
    admin.from("zoom_recordings").select("zoom_uuid, start_time, duration").eq("zoom_meeting_id", numericId),
    admin.from("zoom_transcripts").select("zoom_meeting_uuid").eq("zoom_meeting_id", numericId),
  ])
  const byUuid = new Map<string, Occurrence>()
  for (const r of recRes.data ?? []) {
    if (!r.zoom_uuid) continue
    const t = r.start_time ? Date.parse(r.start_time) : NaN
    byUuid.set(r.zoom_uuid, {
      uuid: r.zoom_uuid,
      start: Number.isFinite(t) ? t : null,
      duration: r.duration ?? 0,
    })
  }
  for (const t of trRes.data ?? []) {
    if (t.zoom_meeting_uuid && !byUuid.has(t.zoom_meeting_uuid)) {
      byUuid.set(t.zoom_meeting_uuid, { uuid: t.zoom_meeting_uuid, start: null, duration: 0 })
    }
  }
  return Array.from(byUuid.values())
}

/** True when more than one session has been held under this meeting number. */
export async function isSharedMeetingNumber(
  admin: SupabaseClient,
  numericId: number | string,
): Promise<boolean> {
  const n = Number(numericId)
  if (!Number.isFinite(n)) return false
  return (await listOccurrences(admin, n)).length > 1
}

/**
 * Pick the session a request refers to.
 *   • `uuid` given and known under this number → that session.
 *   • number has only ever held one session   → that session.
 *   • `start` given → the session whose actual start is closest, within 2h
 *     (the longest one, if it was restarted within minutes).
 *   • otherwise → ambiguous (never guess: a guess shows another client's
 *     transcript).
 */
export async function resolveOccurrence(
  admin: SupabaseClient,
  numericId: number,
  opts: { uuid?: string | null; start?: string | null } = {},
): Promise<ResolvedOccurrence> {
  const occurrences = await listOccurrences(admin, numericId)
  const shared = occurrences.length > 1

  if (opts.uuid) {
    const hit = occurrences.find((o) => o.uuid === opts.uuid)
    if (hit) return { uuid: hit.uuid, shared, ambiguous: false }
  }
  if (!shared) return { uuid: occurrences[0]?.uuid ?? null, shared, ambiguous: false }

  const target = opts.start ? Date.parse(opts.start) : NaN
  if (Number.isFinite(target)) {
    let best: Occurrence | null = null
    let bestDelta = Infinity
    for (const o of occurrences) {
      if (o.start == null) continue
      const delta = Math.abs(o.start - target)
      if (delta < bestDelta) {
        best = o
        bestDelta = delta
      }
    }
    if (best && best.start != null && bestDelta <= START_MATCH_WINDOW_MS) {
      const anchor = best.start
      const restarts = occurrences.filter(
        (o) => o.start != null && Math.abs(o.start - anchor) <= RESTART_WINDOW_MS,
      )
      const longest = restarts.reduce((a, b) => (b.duration > a.duration ? b : a), best)
      return { uuid: longest.uuid, shared, ambiguous: false }
    }
  }
  return { uuid: null, shared, ambiguous: true }
}
