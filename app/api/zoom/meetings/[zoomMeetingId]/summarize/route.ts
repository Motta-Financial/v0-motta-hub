import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { summarizeTranscript } from "@/lib/zoom/summarize-transcript"
import { resolveOccurrence } from "@/lib/zoom/meeting-occurrence"

/**
 * Manual "(re)generate summary" trigger for a single Zoom meeting's
 * transcript. Used by the recording section button in the meeting dialog.
 * Re-runs ALFRED over the transcript and updates the existing client note in
 * place (summary_note_id), so clicking twice doesn't create duplicates.
 *
 * Requires a logged-in admin/team member — this writes to a client record.
 */

export const maxDuration = 120

export async function POST(req: NextRequest, { params }: { params: Promise<{ zoomMeetingId: string }> }) {
  const auth = await requireAdmin()
  if (!auth.ok) {
    return auth.response
  }

  const { zoomMeetingId } = await params
  const numericId = Number(zoomMeetingId)
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "Invalid meeting id" }, { status: 400 })
  }

  const admin = createAdminClient()

  // A meeting number can hold many sessions (Personal Meeting Room, recurring
  // meeting): summarize the one session the caller means (?uuid= or ?start=),
  // never the newest transcript under the number — that's another client's.
  const occurrence = await resolveOccurrence(admin, numericId, {
    uuid: req.nextUrl.searchParams.get("uuid"),
    start: req.nextUrl.searchParams.get("start"),
  })
  if (occurrence.ambiguous) {
    return NextResponse.json(
      { error: "This meeting number holds several sessions; pass ?uuid= or ?start= to pick one" },
      { status: 409 },
    )
  }

  // Find the best transcript for this session (prefer one with text).
  let transcriptQuery = admin
    .from("zoom_transcripts")
    .select("id, zoom_meeting_id, zoom_meeting_uuid, text_content, summary_status, summary_note_id, summary_attempts")
    .eq("zoom_meeting_id", numericId)
  if (occurrence.uuid) transcriptQuery = transcriptQuery.eq("zoom_meeting_uuid", occurrence.uuid)
  const { data: transcript, error } = await transcriptQuery
    .not("text_content", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!transcript) {
    return NextResponse.json({ error: "No transcript with text found for this meeting" }, { status: 404 })
  }

  // Reset attempts so a manual regen always runs even if it had failed.
  const result = await summarizeTranscript(admin, {
    ...transcript,
    summary_attempts: 0,
  })

  if (result.status === "failed") {
    return NextResponse.json({ ok: false, ...result }, { status: 502 })
  }
  return NextResponse.json({ ok: true, ...result })
}
