/**
 * GET /api/debriefs/meeting-context?calendly_event_id=… | ?zoom_meeting_id=…
 *
 * Feeds the debrief form everything known about the meeting it's being
 * filed against — most importantly the Zoom AI summary, which becomes the
 * starting draft for the notes and action items.
 *
 * This is the payoff of the whole chain. 685 transcripts sit in Supabase
 * and, until now, not one character reached the debrief: the partner typed
 * from memory next to a verbatim record of the conversation. The debrief
 * is meant to be the single manual step, so the goal here is to shrink it
 * from "write up the meeting" to "check what ALFRED wrote".
 *
 * Auth-gated (staff only) — this returns meeting content.
 *
 * Response:
 *   {
 *     context: {
 *       deal_id, hub_meeting_id, client: {...},
 *       artifacts: { recordingUrl, transcriptUrl, summary },
 *       draft: { notes, action_items: [{ description }] } | null
 *     }
 *   }
 *
 * `draft` is null when Zoom produced no summary — the form then behaves
 * exactly as it always has, with empty fields.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { loadDebriefMeetingContext } from "@/lib/debriefs/meeting-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/**
 * Turn Zoom's summary into debrief-shaped prose.
 *
 * Zoom gives an overview plus `summary_details` — `[{ label, summary }]`
 * sections like "Pricing discussion" / "Next year's filings". We render
 * them as labelled paragraphs because that's how partners write debriefs
 * anyway, and a wall of undifferentiated text is harder to edit than
 * headed chunks.
 *
 * The attribution line matters: everything below it is a machine's read of
 * the call, and the partner needs to know that at a glance so they correct
 * rather than rubber-stamp.
 */
function buildNotesDraft(summary: {
  overview: string | null
  details: Array<{ label?: string; summary?: string }>
}): string {
  const parts: string[] = []
  if (summary.overview) parts.push(summary.overview.trim())

  for (const d of summary.details ?? []) {
    const label = d.label?.trim()
    const text = d.summary?.trim()
    if (!text) continue
    parts.push(label ? `${label}\n${text}` : text)
  }

  if (parts.length === 0) return ""
  return (
    "— ALFRED's draft from the Zoom recording. Please correct anything it got wrong. —\n\n" +
    parts.join("\n\n")
  )
}

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const {
    data: { user },
  } = await getAuthenticatedUser(authClient)
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const calendlyEventId = req.nextUrl.searchParams.get("calendly_event_id")
  const zoomMeetingId = req.nextUrl.searchParams.get("zoom_meeting_id")

  const source = zoomMeetingId ? "zoom" : calendlyEventId ? "calendly" : null
  const rowId = zoomMeetingId || calendlyEventId
  if (!source || !rowId || !isUuid(rowId)) {
    return NextResponse.json(
      { error: "Pass exactly one of calendly_event_id or zoom_meeting_id (uuid)" },
      { status: 400 },
    )
  }

  try {
    // Admin client: the resolver reads across zoom_recordings /
    // zoom_transcripts / zoom_meeting_summaries, which are service-role
    // tables. The user has already been authenticated above.
    const supabase = createAdminClient()
    const ctx = await loadDebriefMeetingContext(supabase, source, rowId)
    if (!ctx) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 })
    }

    const summary = ctx.artifacts.summary
    const draft = summary
      ? {
          notes: buildNotesDraft(summary),
          // Zoom's own extracted next steps become the starting action
          // items. Deliberately description-only: assignee, due date and
          // priority are judgment calls the partner must make, and
          // guessing them would produce confidently wrong tasks.
          action_items: (summary.nextSteps ?? []).map((description) => ({ description })),
        }
      : null

    return NextResponse.json({
      context: {
        source: ctx.source,
        meeting_row_id: ctx.meetingRowId,
        title: ctx.title,
        start_time: ctx.startTime,
        meeting_type: ctx.meetingType,
        calendly_event_id: ctx.calendlyEventId,
        zoom_meeting_id: ctx.zoomMeetingId,
        hub_meeting_id: ctx.hubMeetingId,
        deal_id: ctx.dealId,
        client: ctx.client,
        artifacts: {
          recording_url: ctx.artifacts.recordingUrl,
          transcript_url: ctx.artifacts.transcriptUrl,
          has_transcript: ctx.artifacts.hasTranscript,
          summary_title: summary?.title ?? null,
        },
        draft,
      },
    })
  } catch (err) {
    console.error("[debriefs/meeting-context] failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    )
  }
}
