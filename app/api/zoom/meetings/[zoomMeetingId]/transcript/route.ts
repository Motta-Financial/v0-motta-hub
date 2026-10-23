/**
 * GET /api/zoom/meetings/[zoomMeetingId]/transcript
 *
 * Download the meeting transcript as a file. Default (and currently only)
 * format is Markdown: `?format=md`. The response carries a
 * Content-Disposition attachment so the browser saves it as
 * `<date>-<topic>-transcript.md`.
 *
 * Auth: any signed-in team member — same policy as the per-meeting
 * recordings endpoint (the library already shows them the transcript
 * inline; this is just a saveable rendering of the same rows).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildTranscriptMarkdown, transcriptFilename } from "@/lib/zoom/transcript-markdown"
import type { TranscriptSegment } from "@/lib/zoom/parse-vtt"
import { resolveOccurrence } from "@/lib/zoom/meeting-occurrence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ zoomMeetingId: string }> },
) {
  const { zoomMeetingId } = await params

  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const numericId = Number(zoomMeetingId)
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "invalid_meeting_id" }, { status: 400 })
  }

  const format = (req.nextUrl.searchParams.get("format") || "md").toLowerCase()
  if (format !== "md" && format !== "markdown") {
    return NextResponse.json({ error: "unsupported_format" }, { status: 400 })
  }

  const admin = createAdminClient()

  // One meeting NUMBER can hold many sessions; download only the session the
  // caller means (see lib/zoom/meeting-occurrence.ts). Never guess.
  const occurrence = await resolveOccurrence(admin, numericId, {
    uuid: req.nextUrl.searchParams.get("uuid"),
    start: req.nextUrl.searchParams.get("start"),
  })
  if (occurrence.ambiguous) {
    return NextResponse.json({ error: "ambiguous_meeting_session" }, { status: 409 })
  }
  const uuid = occurrence.uuid

  let transcriptsQuery = admin
    .from("zoom_transcripts")
    .select("id, status, text_content, segments, file_type")
    .eq("zoom_meeting_id", numericId)
  if (uuid) transcriptsQuery = transcriptsQuery.eq("zoom_meeting_uuid", uuid)

  // Transcript + meeting metadata + tagged clients + participants, in one
  // round of parallel reads. Prefer the parsed transcript row.
  const [transcriptsRes, meetingRes, recordingRes] = await Promise.all([
    transcriptsQuery.order("updated_at", { ascending: false }),
    admin
      .from("zoom_meetings")
      .select("id, zoom_uuid, topic, start_time, timezone, duration, host_email, host_name")
      .eq("zoom_meeting_id", numericId)
      .maybeSingle(),
    uuid
      ? admin
          .from("zoom_recordings")
          .select("topic, start_time, duration")
          .eq("zoom_uuid", uuid)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const transcripts = transcriptsRes.data ?? []
  const transcript =
    transcripts.find((t) => t.status === "parsed" && t.text_content) ?? transcripts[0] ?? null

  if (!transcript || (!transcript.text_content && !transcript.segments)) {
    return NextResponse.json({ error: "transcript_not_found" }, { status: 404 })
  }

  // zoom_meetings holds ONE row per number (whichever session synced last), so
  // on a shared number its topic/date/clients/participants describe another
  // session. Take topic/date from this session's recording and leave the
  // per-meeting client + participant lists off rather than mislabel the file.
  const meetingRow = meetingRes.data ?? null
  const meetingIsThisSession =
    !occurrence.shared || (meetingRow?.zoom_uuid != null && meetingRow.zoom_uuid === uuid)
  const rec = recordingRes.data as { topic: string | null; start_time: string | null; duration: number | null } | null
  const meeting = meetingRow
    ? meetingIsThisSession
      ? meetingRow
      : {
          ...meetingRow,
          id: null,
          topic: rec?.topic ?? meetingRow.topic,
          start_time: rec?.start_time ?? null,
          duration: rec?.duration ?? null,
        }
    : null

  let clients: string[] = []
  let participants: string[] = []
  if (meeting?.id) {
    const [linksRes, participantsRes] = await Promise.all([
      admin
        .from("zoom_meeting_clients")
        .select("contacts:contact_id(full_name), organizations:organization_id(name)")
        .eq("zoom_meeting_id", meeting.id),
      admin
        .from("zoom_meeting_participants")
        .select("name, email")
        .eq("zoom_meeting_id", meeting.id),
    ])
    clients = Array.from(
      new Set(
        (linksRes.data ?? [])
          .map(
            (l) =>
              (l as { contacts?: { full_name?: string } | null }).contacts?.full_name ||
              (l as { organizations?: { name?: string } | null }).organizations?.name ||
              "",
          )
          .filter(Boolean),
      ),
    )
    participants = Array.from(
      new Set(
        (participantsRes.data ?? [])
          .map((p) => (p.name || p.email || "").trim())
          .filter(Boolean),
      ),
    )
  }

  const markdown = buildTranscriptMarkdown({
    meta: {
      topic: meeting?.topic,
      startTime: meeting?.start_time,
      timezone: meeting?.timezone,
      durationMinutes: meeting?.duration,
      hostName: meeting?.host_name,
      hostEmail: meeting?.host_email,
      clients,
      participants,
    },
    segments: (transcript.segments as TranscriptSegment[] | null) ?? null,
    textContent: transcript.text_content,
  })

  const filename = transcriptFilename(meeting?.topic, meeting?.start_time)

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
