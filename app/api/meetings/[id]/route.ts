import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/**
 * GET /api/meetings/[id] — full detail for one Hub Meeting: the enriched
 * row plus the ALFRED summary note content and the parsed Zoom transcript
 * (segments). Used by the dashboard row expander so it can show the summary
 * + transcript without the caller needing to know which Zoom meeting backs it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: meeting, error } = await admin
    .from("hub_meetings_enriched")
    .select("*")
    .eq("meeting_id", id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // ALFRED summary lives in the notes table referenced by summary_note_id.
  let summary: { content: string | null } | null = null
  if (meeting.summary_note_id) {
    const { data: note } = await admin
      .from("notes")
      .select("content")
      .eq("id", meeting.summary_note_id)
      .maybeSingle()
    if (note) summary = { content: note.content ?? null }
  }

  // Parsed transcript (segments) keyed by transcript_id from the view.
  let transcript:
    | { text_content: string | null; segments: { speaker: string | null; text: string }[] | null }
    | null = null
  if (meeting.transcript_id) {
    const { data: t } = await admin
      .from("zoom_transcripts")
      .select("text_content, segments")
      .eq("id", meeting.transcript_id)
      .maybeSingle()
    if (t) {
      transcript = {
        text_content: t.text_content ?? null,
        segments: Array.isArray(t.segments) ? (t.segments as any) : null,
      }
    }
  }

  return NextResponse.json({ meeting, summary, transcript })
}
