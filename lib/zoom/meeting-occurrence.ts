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

// ─────────────────────────────────────────────────────────────────────────
// Per-session zoom_meetings rows (migrations 432/433)
//
// zoom_meetings holds one row per SESSION (unique zoom_uuid). Client links,
// participants, work-item tags, debriefs and "tag this meeting" todos all
// hang off that row, so they are per session too. A scheduled recurring/PMI
// series keeps its own row under the series uuid (that's what the calendar
// shows before the meeting happens); each session that actually ran gets its
// own row next to it.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Zoom meeting types whose number is reused by design: 3 = recurring (no
 * fixed time), 4 = Personal Meeting Room, 8 = recurring (fixed time). A
 * number of these types is treated as shared even before a second session
 * has been seen.
 */
export const REUSABLE_MEETING_TYPES: ReadonlySet<number> = new Set([3, 4, 8])

/**
 * Encode a meeting UUID for a Zoom API path segment. Zoom requires DOUBLE
 * encoding only when the uuid starts with `/` or contains `//`; every other
 * uuid is encoded once. Double-encoding a plain uuid (one with `+` or `=`)
 * sends Zoom a different id and it answers 404 — which the participant sweep
 * reads as "no participants" and stamps done.
 */
export function encodeZoomUuid(uuid: string): string {
  return uuid.startsWith("/") || uuid.includes("//")
    ? encodeURIComponent(encodeURIComponent(uuid))
    : encodeURIComponent(uuid)
}

export interface MeetingRow {
  id: string
  zoom_uuid: string | null
  zoom_meeting_id: number
  start_time: string | null
  duration: number | null
  meeting_type: number | null
  status: string | null
}

const MEETING_ROW_COLUMNS = "id, zoom_uuid, zoom_meeting_id, start_time, duration, meeting_type, status"

async function meetingRowsForNumber(admin: SupabaseClient, numericId: number): Promise<MeetingRow[]> {
  const { data } = await admin
    .from("zoom_meetings")
    .select(MEETING_ROW_COLUMNS)
    .eq("zoom_meeting_id", numericId)
    .order("start_time", { ascending: false, nullsFirst: false })
  return (data ?? []) as MeetingRow[]
}

function closestByStart<T extends { start_time: string | null; duration?: number | null }>(
  rows: T[],
  start: string | null | undefined,
): T | null {
  const target = start ? Date.parse(start) : NaN
  if (!Number.isFinite(target)) return null
  let best: T | null = null
  let bestDelta = Infinity
  for (const r of rows) {
    const t = r.start_time ? Date.parse(r.start_time) : NaN
    if (!Number.isFinite(t)) continue
    const delta = Math.abs(t - target)
    if (delta < bestDelta) {
      best = r
      bestDelta = delta
    }
  }
  if (!best || bestDelta > START_MATCH_WINDOW_MS) return null
  // Restarted within minutes → the longest one, as resolveOccurrence does.
  const anchor = Date.parse(best.start_time!)
  return rows
    .filter((r) => r.start_time && Math.abs(Date.parse(r.start_time) - anchor) <= RESTART_WINDOW_MS)
    .reduce((a, b) => ((b.duration ?? 0) > (a.duration ?? 0) ? b : a), best)
}

/**
 * The zoom_meetings row (one session) a request about meeting `numericId`
 * refers to. Same rules as resolveOccurrence: an exact uuid wins; a number
 * that has only ever held one session resolves to its row; otherwise the
 * caller's start time must pick the session. Never guesses — a guess attaches
 * another client's meeting.
 */
export async function resolveMeetingRow(
  admin: SupabaseClient,
  numericId: number,
  opts: { uuid?: string | null; start?: string | null } = {},
): Promise<{ row: MeetingRow | null; shared: boolean; ambiguous: boolean }> {
  if (opts.uuid) {
    const { data } = await admin
      .from("zoom_meetings")
      .select(MEETING_ROW_COLUMNS)
      .eq("zoom_uuid", opts.uuid)
      .maybeSingle()
    if (data) {
      const shared = await isSharedMeetingNumber(admin, numericId)
      return { row: data as MeetingRow, shared, ambiguous: false }
    }
  }

  const rows = await meetingRowsForNumber(admin, numericId)
  const occurrence = await resolveOccurrence(admin, numericId, opts)
  const shared = occurrence.shared || rows.length > 1
  if (rows.length === 0) return { row: null, shared, ambiguous: false }

  if (occurrence.uuid) {
    const hit = rows.find((r) => r.zoom_uuid === occurrence.uuid)
    if (hit) return { row: hit, shared, ambiguous: false }
  }
  if (!occurrence.shared && rows.length === 1) return { row: rows[0], shared, ambiguous: false }

  const byStart = closestByStart(rows, opts.start)
  if (byStart) return { row: byStart, shared, ambiguous: false }
  return { row: null, shared, ambiguous: true }
}

export interface SessionInput {
  numericId: number
  uuid: string
  startTime?: string | null
  duration?: number | null
  topic?: string | null
  hostEmail?: string | null
  zoomHostId?: string | null
  teamMemberId?: string | null
  connectionId?: string | null
  meetingType?: number | null
  timezone?: string | null
  accountId?: string | null
  status?: string | null
}

/**
 * Return the zoom_meetings row for one session, creating it if needed.
 *
 *   • A row with this uuid already exists → it.
 *   • The number has one SCHEDULED placeholder (a one-off meeting synced
 *     under its scheduled uuid, never seen as a session) near this start →
 *     re-key that row; it is this session.
 *   • Otherwise insert a new row, copying the series-level fields (host,
 *     connection, join url, passcode) from the number's newest row. raw_data
 *     is never copied — it carries the other session's AI-summary note id.
 *
 * `requireExisting` (webhooks): only create a row when the number is already
 * known, so ad-hoc meetings we never synced keep being skipped as before.
 */
export async function ensureSessionRow(
  admin: SupabaseClient,
  s: SessionInput,
  opts: { requireExisting?: boolean } = {},
): Promise<{ id: string; created: boolean } | null> {
  const { data: existing } = await admin
    .from("zoom_meetings")
    .select("id")
    .eq("zoom_uuid", s.uuid)
    .maybeSingle()
  if (existing?.id) return { id: existing.id as string, created: false }

  const rows = await meetingRowsForNumber(admin, s.numericId)
  if (rows.length === 0 && opts.requireExisting) return null

  if (rows.length > 0) {
    const known = new Set((await listOccurrences(admin, s.numericId)).map((o) => o.uuid))
    known.delete(s.uuid)
    const placeholders = rows.filter(
      (r) =>
        !(r.zoom_uuid && known.has(r.zoom_uuid)) &&
        !(r.meeting_type != null && REUSABLE_MEETING_TYPES.has(r.meeting_type)) &&
        !(s.meetingType != null && REUSABLE_MEETING_TYPES.has(s.meetingType)),
    )
    const near =
      s.startTime == null
        ? rows.length === 1
          ? placeholders
          : []
        : placeholders.filter(
            (r) => r.start_time && Math.abs(Date.parse(r.start_time) - Date.parse(s.startTime!)) <= START_MATCH_WINDOW_MS,
          )
    if (near.length === 1 && rows.every((r) => r === near[0] || !(r.zoom_uuid && known.has(r.zoom_uuid)))) {
      const target = near[0]
      const { error } = await admin
        .from("zoom_meetings")
        .update({ zoom_uuid: s.uuid, updated_at: new Date().toISOString() })
        .eq("id", target.id)
      if (!error) {
        if (target.zoom_uuid) {
          await admin.from("tasks").update({ zoom_meeting_uuid: s.uuid }).eq("zoom_meeting_uuid", target.zoom_uuid)
        }
        return { id: target.id, created: false }
      }
    }
  }

  let template: Record<string, unknown> | null = null
  if (rows.length > 0) {
    const { data } = await admin
      .from("zoom_meetings")
      .select(
        "zoom_host_id, topic, meeting_type, timezone, agenda, join_url, password, host_email, zoom_connection_id, team_member_id, pmi, zoom_account_id, zoom_created_at, host_name, dept",
      )
      .eq("id", rows[0].id)
      .maybeSingle()
    template = (data as Record<string, unknown> | null) ?? null
  }
  const t = template ?? {}
  const nowIso = new Date().toISOString()
  const { error: insErr } = await admin.from("zoom_meetings").upsert(
    {
      ...t,
      zoom_meeting_id: s.numericId,
      zoom_uuid: s.uuid,
      topic: s.topic ?? t.topic ?? "(untitled meeting)",
      meeting_type: s.meetingType ?? t.meeting_type ?? null,
      status: s.status ?? "ended",
      start_time: s.startTime ?? null,
      duration: s.duration ?? null,
      timezone: s.timezone ?? t.timezone ?? null,
      host_email: s.hostEmail ?? t.host_email ?? null,
      zoom_host_id: s.zoomHostId ?? t.zoom_host_id ?? null,
      team_member_id: s.teamMemberId ?? t.team_member_id ?? null,
      zoom_connection_id: s.connectionId ?? t.zoom_connection_id ?? null,
      zoom_account_id: s.accountId ?? t.zoom_account_id ?? null,
      raw_data: {},
      synced_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "zoom_uuid", ignoreDuplicates: true },
  )
  if (insErr) throw new Error(`zoom_meetings session insert: ${insErr.message}`)

  const { data: row } = await admin.from("zoom_meetings").select("id").eq("zoom_uuid", s.uuid).maybeSingle()
  return row?.id ? { id: row.id as string, created: true } : null
}

/**
 * Whether a session row's client can be trusted to receive this session's
 * notes automatically. On a number that is shared (or reusable by type),
 * only evidence from THIS session counts: its own participants ('auto'), the
 * Calendly booking at its start ('calendly_bridge'), or a teammate's tag on
 * this session ('manual') — never ALFRED's guess (a PMI's topic names the
 * host, not the client), and never a link flagged needs_review (433 flags
 * every link that predates per-session linking and that the session itself
 * doesn't corroborate).
 */
export function pickSessionContact(
  links: Array<{ contact_id: string | null; confidence: number | null; needs_review: boolean | null; link_source: string | null }>,
  shared: boolean,
): string | null {
  const usable = links.filter(
    (l) =>
      l.contact_id &&
      (!shared || (l.needs_review !== true && ["auto", "calendly_bridge", "manual"].includes(l.link_source ?? ""))),
  )
  // Prefer confirmed links (not needs_review), then highest confidence.
  usable.sort((a, b) => {
    if (!!a.needs_review !== !!b.needs_review) return a.needs_review ? 1 : -1
    return (b.confidence ?? 0) - (a.confidence ?? 0)
  })
  return usable[0]?.contact_id ?? null
}

/** Shared by count of sessions seen, or reusable by meeting type. */
export async function isSessionOfSharedNumber(
  admin: SupabaseClient,
  row: { zoom_meeting_id: number | string | null; meeting_type?: number | null },
): Promise<boolean> {
  if (row.meeting_type != null && REUSABLE_MEETING_TYPES.has(row.meeting_type)) return true
  if (row.zoom_meeting_id == null) return false
  const n = Number(row.zoom_meeting_id)
  if (!Number.isFinite(n)) return false
  if (await isSharedMeetingNumber(admin, n)) return true
  const { count } = await admin
    .from("zoom_meetings")
    .select("id", { count: "exact", head: true })
    .eq("zoom_meeting_id", n)
  return (count ?? 0) > 1
}
