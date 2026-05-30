/**
 * GET /api/zoom/recordings/library?q=<search>&limit=<n>&offset=<n>
 *
 * DB-backed list of cloud recordings for the in-Hub Recordings library.
 * Available to ANY signed-in team member (not just admins) — recordings are a
 * shared firm asset. We verify a session with the SSR client, then read the
 * service-role tables (zoom_recordings / zoom_meetings / zoom_meeting_clients)
 * with the admin client, exactly like the per-meeting recordings endpoint.
 *
 * Each recording is returned with:
 *   • sanitized `recording_files` (NO raw Zoom download_url — only id /
 *     file_type / blob_pathname / a `playable` flag so the UI can stream the
 *     file in-Hub via /api/zoom/recordings/stream)
 *   • `clients` — the client/org names tagged to the parent meeting
 *   • `has_transcript` — whether a parsed transcript exists (lazy-loaded on
 *     expand via the per-meeting endpoint)
 *
 * Raw download URLs are deliberately stripped; playback + download always go
 * through the authenticated in-Hub proxies.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface ZoomFile {
  id?: string
  file_type?: string
  file_extension?: string
  recording_type?: string
  file_size?: number
  blob_pathname?: string | null
  download_url?: string
}

export async function GET(req: NextRequest) {
  // ── Auth: any signed-in team member ───────────────────────────────────
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const q = (req.nextUrl.searchParams.get("q") || "").trim()
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 30, 1), 100)
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0)

  const admin = createAdminClient()

  // ── 1. Recordings page (newest first) ─────────────────────────────────
  let recQuery = admin
    .from("zoom_recordings")
    .select(
      "id, zoom_uuid, zoom_meeting_id, topic, start_time, duration, total_size, recording_count, recording_files",
      { count: "exact" },
    )
    .order("start_time", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (q) recQuery = recQuery.ilike("topic", `%${q}%`)

  const { data: recRows, error: recErr, count } = await recQuery
  if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 })

  const rows = recRows ?? []
  if (rows.length === 0) {
    return NextResponse.json({ recordings: [], total: count ?? 0, limit, offset })
  }

  // ── 2. Map the bigint Zoom meeting ids → meeting uuids for tag joins ───
  const numericIds = Array.from(
    new Set(rows.map((r) => r.zoom_meeting_id).filter((v): v is number => v != null)),
  )

  const meetingUuidByNumeric = new Map<number, string>()
  const transcriptByNumeric = new Map<number, boolean>()

  if (numericIds.length > 0) {
    const [meetingsRes, transcriptsRes] = await Promise.all([
      admin.from("zoom_meetings").select("id, zoom_meeting_id").in("zoom_meeting_id", numericIds),
      admin
        .from("zoom_transcripts")
        .select("zoom_meeting_id, status, text_content")
        .in("zoom_meeting_id", numericIds),
    ])

    for (const m of meetingsRes.data ?? []) {
      if (m.zoom_meeting_id != null && m.id) meetingUuidByNumeric.set(m.zoom_meeting_id, m.id)
    }
    for (const t of transcriptsRes.data ?? []) {
      if (t.zoom_meeting_id != null && t.status === "parsed" && t.text_content) {
        transcriptByNumeric.set(t.zoom_meeting_id, true)
      }
    }
  }

  // ── 3. Client / org names tagged to those meetings ─────────────────────
  const clientsByMeetingUuid = new Map<string, string[]>()
  const meetingUuids = Array.from(meetingUuidByNumeric.values())

  if (meetingUuids.length > 0) {
    const { data: links } = await admin
      .from("zoom_meeting_clients")
      .select(
        "zoom_meeting_id, contacts:contact_id(full_name), organizations:organization_id(name)",
      )
      .in("zoom_meeting_id", meetingUuids)

    for (const link of links ?? []) {
      const mid = (link as { zoom_meeting_id?: string }).zoom_meeting_id
      if (!mid) continue
      const contact = (link as { contacts?: { full_name?: string } | null }).contacts
      const org = (link as { organizations?: { name?: string } | null }).organizations
      const name = contact?.full_name || org?.name
      if (!name) continue
      const list = clientsByMeetingUuid.get(mid) ?? []
      if (!list.includes(name)) list.push(name)
      clientsByMeetingUuid.set(mid, list)
    }
  }

  // ── 4. Shape the response (strip raw download URLs) ────────────────────
  const recordings = rows.map((r) => {
    const meetingUuid = r.zoom_meeting_id != null ? meetingUuidByNumeric.get(r.zoom_meeting_id) : undefined
    const files = Array.isArray(r.recording_files) ? (r.recording_files as ZoomFile[]) : []
    return {
      id: r.id,
      zoom_uuid: r.zoom_uuid,
      zoom_meeting_id: r.zoom_meeting_id,
      topic: r.topic,
      start_time: r.start_time,
      duration: r.duration,
      total_size: r.total_size,
      recording_count: r.recording_count,
      recording_files: files.map((f) => ({
        id: f.id,
        file_type: f.file_type,
        file_extension: f.file_extension,
        recording_type: f.recording_type,
        file_size: f.file_size,
        blob_pathname: f.blob_pathname ?? null,
        playable: Boolean(f.blob_pathname || f.download_url),
      })),
      clients: meetingUuid ? clientsByMeetingUuid.get(meetingUuid) ?? [] : [],
      has_transcript: r.zoom_meeting_id != null ? transcriptByNumeric.get(r.zoom_meeting_id) === true : false,
    }
  })

  return NextResponse.json({ recordings, total: count ?? recordings.length, limit, offset })
}
