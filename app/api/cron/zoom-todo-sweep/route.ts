/**
 * Cron — generate "tag this meeting" todos for every Zoom host.
 *
 * Schedule: hourly (see vercel.json). The work is idempotent (partial
 * unique index does the dedup) so running it often is safe — we'd
 * rather a user see the task within an hour of the meeting wrapping
 * than wait for the next day.
 *
 * Auth: Vercel's cron header `x-vercel-cron` is present on real runs;
 * outside of that we accept a `CRON_SECRET` bearer for manual debug
 * triggers from `curl`. Both checks are belt-and-suspenders so an
 * accidental public hit can't spam the todo list.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { generateZoomMeetingTodos } from "@/lib/zoom/generate-meeting-todos"
import { syncRecentZoomData } from "@/lib/zoom/sync-recent-meetings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAuthorized(req: NextRequest) {
  // Vercel always injects this header for cron invocations.
  if (req.headers.get("x-vercel-cron")) return true
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  try {
    const supabase = createAdminClient()
    // Order matters: persistence first, sweep second. We swallow
    // partial sync errors via the `errors[]` array on the response
    // and continue to the sweep so a single user's expired token
    // can't block todos for the rest of the firm.
    const sync = await syncRecentZoomData({ supabase })
    const result = await generateZoomMeetingTodos({ supabase })
    console.log(
      `[v0] [Cron Zoom Todo Sweep] sync.conns=${sync.connections} sync.meetings=${sync.meetingsUpserted} sync.recs=${sync.recordingsUpserted} sweep.candidates=${result.candidates} sweep.created=${result.created} (${Date.now() - startedAt}ms)`,
    )
    return NextResponse.json({ ok: true, sync, ...result })
  } catch (err) {
    console.error("[v0] [Cron Zoom Todo Sweep] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
