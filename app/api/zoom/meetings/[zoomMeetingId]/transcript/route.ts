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

  // Transcript + meeting metadata + tagged clients + participants, in one
  // round of parallel reads. Prefer the parsed transcript row.
  const [transcriptsRes, meetingRes] = await Promise.all([
    admin
      .from("zoom_transcripts")
      .select("id, status, text_content, segments, file_type")
      .eq("zoom_meeting_id", numericId)
      .order("updated_at", { ascending: false }),
    admin
      .from("zoom_meetings")
      .select("id, topic, start_time, timezone, duration, host_email, host_name")
      .eq("zoom_meeting_id", numericId)
      .maybeSingle(),
  ])

  const transcripts = transcriptsRes.data ?? []
  const transcript =
    transcripts.find((t) => t.status === "parsed" && t.text_content) ?? transcripts[0] ?? null

  if (!transcript || (!transcript.text_content && !transcript.segments)) {
    return NextResponse.json({ error: "transcript_not_found" }, { status: 404 })
  }

  const meeting = meetingRes.data ?? null

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
