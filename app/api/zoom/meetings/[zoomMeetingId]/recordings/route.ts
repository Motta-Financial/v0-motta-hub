/**
 * GET /api/zoom/meetings/[zoomMeetingId]/recordings
 *
 * Returns the cloud recordings + parsed transcript + participants + Zoom AI
 * Companion summary for a single Zoom meeting, keyed by the numeric Zoom
 * meeting id. Used by the meeting detail dialog's "Recording & Transcript"
 * section and the Recordings library's expanded card.
 *
 * Auth: any signed-in team member (the calendar already shows them the
 * meeting). We verify a session, then read with the admin client because
 * zoom_recordings/zoom_transcripts are service-role tables.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ zoomMeetingId: string }> },
) {
  const { zoomMeetingId } = await params

  // Require a session (no anonymous reads of meeting transcripts).
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const numericId = Number(zoomMeetingId)
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "invalid_meeting_id" }, { status: 400 })
  }

  const admin = createAdminClient()

  const [recordingsRes, transcriptsRes, meetingRes, summaryRes] = await Promise.all([
    admin
      .from("zoom_recordings")
      .select("id, zoom_uuid, topic, start_time, duration, total_size, recording_count, share_url, recording_files")
      .eq("zoom_meeting_id", numericId)
      .order("start_time", { ascending: false }),
    admin
      .from("zoom_transcripts")
      .select("id, zoom_meeting_uuid, file_type, status, text_content, segments, blob_pathname, parsed_at, error")
      .eq("zoom_meeting_id", numericId)
      .order("updated_at", { ascending: false }),
    admin
      .from("zoom_meetings")
      .select("id, host_name, host_email, participants_count, total_minutes, timezone")
      .eq("zoom_meeting_id", numericId)
      .maybeSingle(),
    admin
      .from("zoom_meeting_summaries")
      .select(
        "id, summary_title, summary_overview, summary_details, next_steps, summary_start_time, summary_last_modified_time",
      )
      .eq("zoom_meeting_numeric_id", numericId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (recordingsRes.error) {
    return NextResponse.json({ error: recordingsRes.error.message }, { status: 500 })
  }

  // Participants (full-fidelity rows) — deduped per person for display:
  // keep the row with the longest duration per email/name key.
  let participants: Array<{
    name: string | null
    email: string | null
    duration: number | null
    join_time: string | null
    leave_time: string | null
    internal_user: boolean | null
    contact_id: string | null
    contact_name: string | null
  }> = []
  if (meetingRes.data?.id) {
    const { data: partRows } = await admin
      .from("zoom_meeting_participants")
      .select("name, email, duration, join_time, leave_time, internal_user, contact_id, contacts:contact_id(full_name)")
      .eq("zoom_meeting_id", meetingRes.data.id)
      .order("join_time", { ascending: true })

    const byPerson = new Map<string, (typeof participants)[number]>()
    for (const p of partRows ?? []) {
      const key = (p.email || p.name || "").toLowerCase()
      if (!key) continue
      const shaped = {
        name: p.name,
        email: p.email,
        duration: p.duration,
        join_time: p.join_time,
        leave_time: p.leave_time,
        internal_user: p.internal_user,
        contact_id: p.contact_id,
        contact_name:
          (p as { contacts?: { full_name?: string } | null }).contacts?.full_name ?? null,
      }
      const prior = byPerson.get(key)
      if (!prior || (shaped.duration ?? 0) > (prior.duration ?? 0)) byPerson.set(key, shaped)
    }
    participants = Array.from(byPerson.values())
  }

  // Prefer a parsed transcript; fall back to the most recent row so the UI can
  // show "processing"/"failed" states honestly.
  const transcripts = transcriptsRes.data ?? []
  const transcript =
    transcripts.find((t) => t.status === "parsed" && t.text_content) ?? transcripts[0] ?? null

  // Strip raw download URLs from recording_files before returning — the client
  // should use the in-Hub stream proxy or the Blob proxy, never the
  // short-lived Zoom token. We surface a `playable` flag so the UI knows it can
  // stream the file in-Hub (either from a Blob copy or via the Zoom proxy).
  const recordings = (recordingsRes.data ?? []).map((r) => ({
    ...r,
    recording_files: Array.isArray(r.recording_files)
      ? (r.recording_files as Array<Record<string, unknown>>).map((f) => ({
          id: f.id,
          file_type: f.file_type,
          file_extension: f.file_extension,
          recording_type: f.recording_type,
          file_size: f.file_size,
          blob_pathname: f.blob_pathname ?? null,
          playable: Boolean(f.blob_pathname || f.download_url),
        }))
      : [],
  }))

  return NextResponse.json({
    recordings,
    transcript,
    participants,
    summary: summaryRes.data ?? null,
    meeting: meetingRes.data
      ? {
          host_name: meetingRes.data.host_name,
          host_email: meetingRes.data.host_email,
          participants_count: meetingRes.data.participants_count,
          total_minutes: meetingRes.data.total_minutes,
          timezone: meetingRes.data.timezone,
        }
      : null,
  })
}
