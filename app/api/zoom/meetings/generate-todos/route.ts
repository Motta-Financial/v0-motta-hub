/**
 * POST /api/zoom/meetings/generate-todos
 *
 * Manual trigger for the Zoom-meeting → todo sweep. Called by the
 * "Send untagged to my To-Do list" button on the Zoom dashboard.
 *
 * Body (all optional):
 *   - teamMemberId?: string   — limit the sweep to a single user. The
 *                                dashboard always passes the currently
 *                                signed-in user so each person only
 *                                generates their own queue rather than
 *                                triggering it for the whole firm by
 *                                accident.
 *   - sinceDays?:   number    — override the default 60-day window.
 *
 * The heavy lifting lives in `lib/zoom/generate-meeting-todos.ts` so
 * the same logic powers both this route and the nightly cron sweep.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { generateZoomMeetingTodos } from "@/lib/zoom/generate-meeting-todos"
import { syncRecentZoomData } from "@/lib/zoom/sync-recent-meetings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      teamMemberId?: string | null
      sinceDays?: number
    }

    const supabase = createAdminClient()

    // Sync first, then sweep. Without the sync step the sweep finds
    // nothing because untagged meetings only land in `zoom_meetings`
    // when someone tags them. We restrict the sync to the requesting
    // user when teamMemberId is set so a single click doesn't pay
    // for an org-wide Zoom poll.
    const sync = await syncRecentZoomData({
      supabase,
      teamMemberId: body.teamMemberId ?? null,
      sinceDays: typeof body.sinceDays === "number" ? body.sinceDays : undefined,
    })

    const result = await generateZoomMeetingTodos({
      supabase,
      teamMemberId: body.teamMemberId ?? null,
      sinceDays: typeof body.sinceDays === "number" ? body.sinceDays : undefined,
    })

    return NextResponse.json({ ...result, sync })
  } catch (err) {
    console.error("[v0] [Zoom Todo Sweep]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
