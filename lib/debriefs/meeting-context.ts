/**
 * Everything the debrief needs to know about the meeting it covers.
 *
 * One resolver, three consumers:
 *
 *   1. the debrief-reminder cron — to decide whether the Zoom artifacts
 *      have landed yet (so the email arrives when the debrief can
 *      actually be pre-filled, not merely when the meeting ended), and
 *      to build the Hub / Zoom / transcript links in that email;
 *   2. `GET /api/debriefs/meeting-context` — which the form calls on
 *      mount to seed notes + action items from the AI summary;
 *   3. the prefill-link builder, for the deal id.
 *
 * Why one module: the cron and the form must agree on what "this
 * meeting" means. A Calendly booking and the Zoom meeting it spawned are
 * two rows describing one event, and the recording only ever hangs off
 * the Zoom side. Resolving that in two places would guarantee they drift.
 *
 * ── The Calendly ↔ Zoom hop ──────────────────────────────────────────
 * `lib/zoom/bridge-to-calendly.ts` sets `zoom_meetings.calendly_event_id`
 * by matching the numeric meeting id in both join URLs. So from a
 * Calendly event we find the Zoom row (and therefore the recording,
 * transcript and summary) by that FK. From a Zoom row we walk it
 * backwards. Either entry point lands on the same context.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { MeetingSource, DebriefMeetingType } from "./meeting-link"
import { resolveMeetingType } from "./meeting-link"

export interface MeetingArtifacts {
  /** Zoom's own playback page for the recording. */
  recordingUrl: string | null
  /** Our archived transcript (Vercel Blob), when parsed. */
  transcriptUrl: string | null
  /** True once a transcript row exists with parsed text. */
  hasTranscript: boolean
  /** Zoom AI Companion summary, when Zoom has produced one. */
  summary: {
    title: string | null
    overview: string | null
    /** `[{ label, summary }]` — Zoom's structured sections. */
    details: Array<{ label?: string; summary?: string }>
    /** Zoom's own extracted next steps — the action-item seed. */
    nextSteps: string[]
  } | null
}

export interface DebriefMeetingContext {
  source: MeetingSource
  /** Row id in `calendly_events` or `zoom_meetings` (matches `source`). */
  meetingRowId: string
  title: string
  startTime: string | null
  meetingType: DebriefMeetingType
  /** The counterpart row id when the two are bridged. */
  calendlyEventId: string | null
  zoomMeetingId: string | null
  /** Unified `meetings` row, when one exists. */
  hubMeetingId: string | null
  dealId: string | null
  client: {
    contactId: string | null
    organizationId: string | null
    name: string | null
    type: "contact" | "organization" | null
  }
  artifacts: MeetingArtifacts
}

/** First client tag on a meeting, normalized. */
function pickClient(rows: any[] | null | undefined): DebriefMeetingContext["client"] {
  for (const r of rows ?? []) {
    if (r?.contact_id) {
      return {
        contactId: r.contact_id,
        organizationId: r.organization_id ?? null,
        name: r.contact?.full_name ?? null,
        type: "contact",
      }
    }
    if (r?.organization_id) {
      return {
        contactId: null,
        organizationId: r.organization_id,
        name: r.organization?.name ?? null,
        type: "organization",
      }
    }
  }
  return { contactId: null, organizationId: null, name: null, type: null }
}

/**
 * Load recording / transcript / summary for a Zoom meeting.
 *
 * `zoom_meetings.id` is a uuid but `zoom_transcripts.zoom_meeting_id` and
 * `zoom_recordings.zoom_meeting_id` are the BIGINT Zoom meeting number —
 * two different key spaces sharing a column name. Getting this backwards
 * produces `operator does not exist: bigint = uuid`, so both lookups here
 * deliberately take the numeric id while the summary lookup takes the uuid.
 */
async function loadZoomArtifacts(
  supabase: SupabaseClient,
  zoomRowId: string,
  numericMeetingId: number | string | null,
  meetingStart: string | null,
): Promise<MeetingArtifacts> {
  const empty: MeetingArtifacts = {
    recordingUrl: null,
    transcriptUrl: null,
    hasTranscript: false,
    summary: null,
  }

  // ── Summary ───────────────────────────────────────────────────────
  // Keyed on the uuid, so it is already per-occurrence. `.limit(1)` is
  // still load-bearing rather than defensive: nothing enforces one
  // summary row per meeting and production holds two meetings with
  // duplicates, on which a bare `.maybeSingle()` raises PGRST116.
  const summaryPromise = supabase
    .from("zoom_meeting_summaries")
    .select("summary_title, summary_overview, summary_details, next_steps, summary_last_modified_time")
    .eq("zoom_meeting_id", zoomRowId)
    .order("summary_last_modified_time", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  // ── Recording ─────────────────────────────────────────────────────
  // `zoom_recordings.zoom_meeting_id` is the BIGINT Zoom meeting NUMBER,
  // not our uuid — and for a recurring meeting (shared PMI) that number
  // is identical across every occurrence. One production example carries
  // 13 recordings and 10 transcripts under a single number.
  //
  // So "most recent recording for this number" is wrong: it would staple
  // last Thursday's huddle onto today's debrief. We pick the recording
  // whose own start_time sits closest to this meeting's, which is the
  // only signal that distinguishes occurrences.
  const recordingsPromise = numericMeetingId
    ? supabase
        .from("zoom_recordings")
        .select("id, share_url, start_time")
        .eq("zoom_meeting_id", numericMeetingId)
        .not("share_url", "is", null)
        .order("start_time", { ascending: false })
        .limit(25)
    : Promise.resolve({ data: [], error: null } as any)

  const [summaryRes, recordingsRes] = await Promise.all([summaryPromise, recordingsPromise])

  const recordings: Array<{ id: string; share_url: string; start_time: string | null }> =
    recordingsRes.data ?? []

  let recording = recordings[0] ?? null
  if (meetingStart && recordings.length > 1) {
    const target = new Date(meetingStart).getTime()
    recording = recordings.reduce((best, r) => {
      if (!r.start_time) return best
      if (!best?.start_time) return r
      const dr = Math.abs(new Date(r.start_time).getTime() - target)
      const db = Math.abs(new Date(best.start_time).getTime() - target)
      return dr < db ? r : best
    }, recordings[0])
  }

  // Transcript is resolved through the chosen recording, so it can never
  // belong to a different occurrence than the recording we linked.
  const transcriptRes = recording
    ? await supabase
        .from("zoom_transcripts")
        .select("blob_url, parsed_at")
        .eq("zoom_recording_id", recording.id)
        .not("parsed_at", "is", null)
        .order("parsed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : ({ data: null } as any)

  const s = summaryRes.data
  const summary = s
    ? {
        title: (s.summary_title as string) ?? null,
        overview: (s.summary_overview as string) ?? null,
        details: Array.isArray(s.summary_details)
          ? (s.summary_details as Array<{ label?: string; summary?: string }>)
          : [],
        nextSteps: Array.isArray(s.next_steps)
          ? (s.next_steps as unknown[]).map((n) => String(n)).filter(Boolean)
          : [],
      }
    : null

  return {
    ...empty,
    recordingUrl: recording?.share_url ?? null,
    transcriptUrl: (transcriptRes.data?.blob_url as string) ?? null,
    hasTranscript: !!transcriptRes.data,
    summary,
  }
}

/** Resolve the deal for a client, preferring the single open one. */
async function resolveDealId(
  supabase: SupabaseClient,
  client: DebriefMeetingContext["client"],
  hubMeetingDealId: string | null,
): Promise<string | null> {
  // The unified `meetings` row already carries a deal when the hub-meetings
  // sync attached one — trust that first, it's the same resolution the
  // Deal page performed.
  if (hubMeetingDealId) return hubMeetingDealId
  if (!client.contactId && !client.organizationId) return null

  const q = supabase
    .from("deals")
    .select("id")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(1)
  if (client.contactId) q.eq("contact_id", client.contactId)
  else q.eq("organization_id", client.organizationId as string)

  const { data } = await q.maybeSingle()
  return data?.id ?? null
}

/**
 * Build the full context for a meeting, entering from either side.
 *
 * Returns null when the row doesn't exist. Never throws on a missing
 * artifact — absent recording/transcript/summary is the normal state for
 * a phone or in-person meeting and simply yields empty `artifacts`.
 */
export async function loadDebriefMeetingContext(
  supabase: SupabaseClient,
  source: MeetingSource,
  meetingRowId: string,
): Promise<DebriefMeetingContext | null> {
  if (source === "zoom") {
    const { data: zm } = await supabase
      .from("zoom_meetings")
      .select(
        `id, zoom_meeting_id, topic, start_time, calendly_event_id, meeting_id,
         zoom_meeting_clients ( contact_id, organization_id, contact:contacts ( full_name ), organization:organizations ( name ) )`,
      )
      .eq("id", meetingRowId)
      .maybeSingle()
    if (!zm) return null

    const client = pickClient(zm.zoom_meeting_clients as any[])
    const artifacts = await loadZoomArtifacts(
      supabase,
      zm.id,
      zm.zoom_meeting_id,
      (zm.start_time as string) ?? null,
    )
    const hubMeetingDealId = await hubMeetingDeal(supabase, zm.meeting_id)

    return {
      source: "zoom",
      meetingRowId: zm.id,
      title: (zm.topic as string) || "Zoom meeting",
      startTime: (zm.start_time as string) ?? null,
      meetingType: "zoom",
      calendlyEventId: (zm.calendly_event_id as string) ?? null,
      zoomMeetingId: zm.id,
      hubMeetingId: (zm.meeting_id as string) ?? null,
      dealId: await resolveDealId(supabase, client, hubMeetingDealId),
      client,
      artifacts,
    }
  }

  const { data: ce } = await supabase
    .from("calendly_events")
    .select(
      `id, name, start_time, location_type,
       calendly_event_clients ( contact_id, organization_id, contact:contacts ( full_name ), organization:organizations ( name ) )`,
    )
    .eq("id", meetingRowId)
    .maybeSingle()
  if (!ce) return null

  const client = pickClient(ce.calendly_event_clients as any[])

  // Walk the bridge to the Zoom side — that's where the recording lives.
  const { data: zm } = await supabase
    .from("zoom_meetings")
    .select("id, zoom_meeting_id, meeting_id, start_time")
    .eq("calendly_event_id", ce.id)
    .limit(1)
    .maybeSingle()

  // Anchor on the Calendly start time — the bridged Zoom row describes the
  // same occurrence, so either timestamp disambiguates a recurring series.
  const artifacts = zm
    ? await loadZoomArtifacts(
        supabase,
        zm.id,
        zm.zoom_meeting_id,
        (zm.start_time as string) ?? (ce.start_time as string) ?? null,
      )
    : { recordingUrl: null, transcriptUrl: null, hasTranscript: false, summary: null }

  const hubMeetingDealId = await hubMeetingDeal(supabase, zm?.meeting_id ?? null)

  return {
    source: "calendly",
    meetingRowId: ce.id,
    title: (ce.name as string) || "Calendly meeting",
    startTime: (ce.start_time as string) ?? null,
    meetingType: resolveMeetingType("calendly", ce.location_type as string | null),
    calendlyEventId: ce.id,
    zoomMeetingId: zm?.id ?? null,
    hubMeetingId: (zm?.meeting_id as string) ?? null,
    dealId: await resolveDealId(supabase, client, hubMeetingDealId),
    client,
    artifacts,
  }
}

async function hubMeetingDeal(
  supabase: SupabaseClient,
  hubMeetingId: string | null | undefined,
): Promise<string | null> {
  if (!hubMeetingId) return null
  const { data } = await supabase
    .from("meetings")
    .select("deal_id")
    .eq("id", hubMeetingId)
    .maybeSingle()
  return data?.deal_id ?? null
}

/**
 * Is this meeting ready to be debriefed *well*?
 *
 * For a Zoom meeting the answer is "once the artifacts land". Firing the
 * reminder at meeting-end means the partner opens an empty form while the
 * transcript is still processing; firing it when the summary arrives means
 * the form can hand them a draft. Zoom typically produces both within
 * ~30 minutes of the meeting ending.
 *
 * `graceHours` is the escape hatch: a meeting that was never recorded (host
 * forgot, cloud recording off, phone call) would otherwise wait forever, so
 * past that age we send the plain reminder rather than none at all.
 */
export function isReadyForDebriefReminder(
  ctx: DebriefMeetingContext,
  args: { endedAt: Date; now: Date; graceHours: number },
): { ready: boolean; reason: "artifacts" | "grace_expired" | "waiting" } {
  const nonZoom = ctx.meetingType !== "zoom"
  // Phone / in-person will never produce a recording — no reason to wait.
  if (nonZoom) return { ready: true, reason: "artifacts" }

  if (ctx.artifacts.summary || ctx.artifacts.hasTranscript) {
    return { ready: true, reason: "artifacts" }
  }

  const ageHours = (args.now.getTime() - args.endedAt.getTime()) / 3_600_000
  if (ageHours >= args.graceHours) return { ready: true, reason: "grace_expired" }

  return { ready: false, reason: "waiting" }
}
