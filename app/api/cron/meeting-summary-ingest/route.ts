import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { summarizePendingTranscripts } from "@/lib/zoom/summarize-transcript"

/**
 * Hourly Vercel Cron that turns newly-imported Zoom transcripts into client
 * profile notes via ALFRED. Distinct from the older `meeting-summary` cron,
 * which only emails an upcoming-meeting digest — this one reads transcript
 * TEXT and writes `note_type='meeting_summary'` rows to the client record.
 *
 * Picks up `zoom_transcripts` rows where:
 *   • summary_status = 'pending'
 *   • text_content IS NOT NULL  (the transcript actually imported)
 *   • summary_attempts < MAX     (don't loop on a poisoned row)
 *
 * Each transcript ends in a terminal status (done | skipped | failed) so the
 * batch always makes forward progress. Configured in vercel.json.
 */

export const maxDuration = 300

const BATCH_LIMIT = 15

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()
    const result = await summarizePendingTranscripts(admin, BATCH_LIMIT)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[v0] [meeting-summary-ingest] failed:", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
