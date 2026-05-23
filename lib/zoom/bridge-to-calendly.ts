/**
 * Calendly → Zoom bridge
 * ──────────────────────
 *
 * Carries client / work-item tags from a Calendly event onto the Zoom
 * meeting it created. The intake flow Motta uses is:
 *
 *     Jotform / Intake form  ─►  Calendly (booking)  ─►  Zoom (meeting)
 *
 * On the Calendly webhook (`invitee.created`) we already:
 *
 *   1. Hub-resolve the invitee (email → name+phone → name) into a
 *      `contacts` row, with auto-create.
 *   2. Write that contact into `calendly_event_clients` with
 *      `link_source='auto'`.
 *   3. Run `runAlfredCalendlyTriage` async to add organization /
 *      work_item / service tags when ALFRED is confident.
 *
 * That work is wasted today if the user has to retag the SAME meeting
 * on the Zoom side. This module closes the loop:
 *
 *   • Match a `zoom_meetings` row to its source `calendly_events` row
 *     by the numeric Zoom meeting ID embedded in both `join_url`
 *     fields. Calendly URL: `https://us02web.zoom.us/j/87654321?pwd=…`
 *     Zoom URL:             `https://us02web.zoom.us/j/87654321?pwd=…`
 *     The `<id>` is `zoom_meetings.zoom_meeting_id` (BIGINT, unique).
 *
 *   • Persist the bridge on `zoom_meetings.calendly_event_id` so the
 *     UI can show "From Calendly booking" and so subsequent
 *     re-tagging of the Calendly side propagates without searching
 *     again.
 *
 *   • Copy every client + work-item tag from the Calendly event to the
 *     Zoom meeting with `link_source='calendly_bridge'`. Existing tags
 *     are preserved — we only insert when the (zoom_meeting_id,
 *     contact_id|organization_id|work_item_id) tuple isn't already
 *     present.
 *
 * Determinism: this module never calls a model. It is the high-trust
 * carryover path. ALFRED is the next layer on top, for meetings the
 * bridge can't resolve (instant meetings, ad-hoc invites, etc).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

// ─── Public surface ──────────────────────────────────────────────────

export interface BridgeResult {
  meetingsScanned: number
  bridged: number
  alreadyBridged: number
  noMatch: number
  clientsCopied: number
  workItemsCopied: number
  errors: Array<{ zoom_meeting_id: string; error: string }>
}

export interface BridgeOptions {
  /** Optional: bridge a single zoom_meetings row by id. Used by the
   *  Zoom webhook when a new meeting comes in. */
  zoomMeetingId?: string
  /** Sweep window when no specific id is given. */
  sinceDays?: number
  /** Cap on rows processed in one sweep. */
  maxMeetings?: number
  /** When true, re-bridge meetings that already have a calendly_event_id
   *  set — useful for backfill if the carryover logic ever changes. */
  forceRebridge?: boolean
}

/**
 * Sweep recent Zoom meetings and bridge each to its Calendly source.
 * Idempotent — re-running only inserts missing tag rows.
 */
export async function bridgeZoomToCalendly(
  supabase: SupabaseClient,
  opts: BridgeOptions = {},
): Promise<BridgeResult> {
  const { sinceDays = 60, maxMeetings = 200, forceRebridge = false } = opts
  const result: BridgeResult = {
    meetingsScanned: 0,
    bridged: 0,
    alreadyBridged: 0,
    noMatch: 0,
    clientsCopied: 0,
    workItemsCopied: 0,
    errors: [],
  }

  const sinceIso = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  // 1. Pick the candidate meetings.
  let query = supabase
    .from("zoom_meetings")
    .select("id, zoom_meeting_id, join_url, calendly_event_id, start_time")
    .not("zoom_meeting_id", "is", null)
    .gte("start_time", sinceIso)
    .order("start_time", { ascending: false })
    .limit(maxMeetings)

  if (opts.zoomMeetingId) {
    query = supabase
      .from("zoom_meetings")
      .select("id, zoom_meeting_id, join_url, calendly_event_id, start_time")
      .eq("id", opts.zoomMeetingId)
  } else if (!forceRebridge) {
    query = query.is("calendly_event_id", null)
  }

  const { data: meetings, error } = await query
  if (error) {
    result.errors.push({ zoom_meeting_id: "select", error: error.message })
    return result
  }

  for (const m of meetings ?? []) {
    result.meetingsScanned += 1
    try {
      const out = await bridgeOne(supabase, m as any)
      if (out.alreadyBridged) result.alreadyBridged += 1
      else if (out.bridged) result.bridged += 1
      else result.noMatch += 1
      result.clientsCopied += out.clientsCopied
      result.workItemsCopied += out.workItemsCopied
    } catch (err) {
      result.errors.push({
        zoom_meeting_id: (m as any).id,
        error: err instanceof Error ? err.message : "unknown",
      })
    }
  }

  return result
}

interface BridgeOneResult {
  bridged: boolean
  alreadyBridged: boolean
  clientsCopied: number
  workItemsCopied: number
}

async function bridgeOne(
  supabase: SupabaseClient,
  meeting: {
    id: string
    zoom_meeting_id: string | number
    join_url: string | null
    calendly_event_id: string | null
  },
): Promise<BridgeOneResult> {
  const out: BridgeOneResult = {
    bridged: false,
    alreadyBridged: false,
    clientsCopied: 0,
    workItemsCopied: 0,
  }

  if (meeting.calendly_event_id) {
    out.alreadyBridged = true
    // Even when already bridged, re-run the tag copy — Calendly may
    // have gained new tags (ALFRED ran later, user manually tagged)
    // since the last bridge pass.
    const copied = await copyTags(supabase, meeting.id, meeting.calendly_event_id)
    out.clientsCopied = copied.clientsCopied
    out.workItemsCopied = copied.workItemsCopied
    return out
  }

  // 1. Find a Calendly event whose join_url references this meeting ID.
  //    `zoom_meetings.zoom_meeting_id` is the canonical 9–11 digit
  //    Zoom meeting number that appears as `/j/<id>` in both URLs.
  const zid = String(meeting.zoom_meeting_id ?? "").trim()
  if (!zid) return out

  // Fast index-friendly match: ilike on the substring `/j/<id>`. The
  // Zoom URL family (`us02web`, `zoom.us`, `us05web`, etc.) varies so
  // we don't try to match the host — only the slug is reliable.
  const pattern = `%/j/${zid}%`
  const { data: candidates, error: candErr } = await supabase
    .from("calendly_events")
    .select("id, join_url, status, start_time")
    .ilike("join_url", pattern)
    .order("start_time", { ascending: false })
    .limit(5)

  if (candErr) throw new Error(`calendly_events lookup: ${candErr.message}`)
  if (!candidates || candidates.length === 0) return out

  // If multiple candidates (e.g. a recurring meeting reused across
  // bookings), prefer the one whose start_time is closest to the Zoom
  // meeting's. We don't have meeting.start_time in the picked columns
  // here, but the descending order above already biases toward most
  // recent — good enough for the carryover use case.
  const calendlyEvent = candidates[0]

  // 2. Persist the bridge.
  await supabase
    .from("zoom_meetings")
    .update({
      calendly_event_id: calendlyEvent.id,
      calendly_bridge_at: new Date().toISOString(),
    })
    .eq("id", meeting.id)

  out.bridged = true

  // 3. Copy tags.
  const copied = await copyTags(supabase, meeting.id, calendlyEvent.id)
  out.clientsCopied = copied.clientsCopied
  out.workItemsCopied = copied.workItemsCopied
  return out
}

/**
 * Copy every client + work-item tag from a Calendly event to a Zoom
 * meeting with `link_source='calendly_bridge'`. Skips rows that
 * already exist (uniqueness violations on the partial unique indexes
 * are absorbed silently).
 */
async function copyTags(
  supabase: SupabaseClient,
  zoomMeetingId: string,
  calendlyEventId: string,
): Promise<{ clientsCopied: number; workItemsCopied: number }> {
  let clientsCopied = 0
  let workItemsCopied = 0

  // ── Clients ─────────────────────────────────────────────────────
  const { data: srcClients } = await supabase
    .from("calendly_event_clients")
    .select("contact_id, organization_id, link_source, match_method, confidence, alfred_reason, needs_review")
    .eq("calendly_event_id", calendlyEventId)

  for (const row of srcClients ?? []) {
    if (!row.contact_id && !row.organization_id) continue
    // Existing-row probe — partial unique indexes split contact vs
    // organization, so query the right one.
    const probe = supabase
      .from("zoom_meeting_clients")
      .select("id")
      .eq("zoom_meeting_id", zoomMeetingId)
    const { data: existing } = row.contact_id
      ? await probe.eq("contact_id", row.contact_id).maybeSingle()
      : await probe.eq("organization_id", row.organization_id!).maybeSingle()
    if (existing) continue

    const { error } = await supabase.from("zoom_meeting_clients").insert({
      zoom_meeting_id: zoomMeetingId,
      contact_id: row.contact_id,
      organization_id: row.organization_id,
      link_source: "calendly_bridge",
      // Preserve the original Calendly match strategy for diagnostics.
      match_method: row.match_method ?? row.link_source ?? "calendly_bridge",
      confidence: row.confidence,
      alfred_reason: row.alfred_reason,
      // If the Calendly side flagged it as needs_review, propagate.
      needs_review: row.needs_review === true,
    })
    if (!error) clientsCopied += 1
    else if ((error as { code?: string }).code !== "23505") {
      console.warn("[v0] [calendly-bridge] client copy warning:", error.message)
    }
  }

  // ── Work items ───────────────────────────────────────────────────
  const { data: srcWorkItems } = await supabase
    .from("calendly_event_work_items")
    .select("work_item_id, link_source, confidence, alfred_reason, needs_review")
    .eq("calendly_event_id", calendlyEventId)

  for (const row of srcWorkItems ?? []) {
    if (!row.work_item_id) continue
    const { data: existing } = await supabase
      .from("zoom_meeting_work_items")
      .select("id")
      .eq("zoom_meeting_id", zoomMeetingId)
      .eq("work_item_id", row.work_item_id)
      .maybeSingle()
    if (existing) continue

    const { error } = await supabase.from("zoom_meeting_work_items").insert({
      zoom_meeting_id: zoomMeetingId,
      work_item_id: row.work_item_id,
      link_source: "calendly_bridge",
      match_method: row.link_source ?? "calendly_bridge",
      confidence: row.confidence,
      alfred_reason: row.alfred_reason,
      needs_review: row.needs_review === true,
    })
    if (!error) workItemsCopied += 1
    else if ((error as { code?: string }).code !== "23505") {
      console.warn("[v0] [calendly-bridge] work_item copy warning:", error.message)
    }
  }

  return { clientsCopied, workItemsCopied }
}
