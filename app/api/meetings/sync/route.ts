import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { syncHubMeetings } from "@/lib/meetings/sync-hub-meetings"

export const dynamic = "force-dynamic"
export const maxDuration = 300

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

/**
 * POST /api/meetings/sync — (re)build the Hub Meetings table from Calendly +
 * Zoom records. Auth: a logged-in admin OR a CRON_SECRET bearer token. No
 * dedicated cron is registered — this rides on demand / existing sync flows.
 */
export async function POST(req: NextRequest) {
  if (!hasCronSecret(req)) {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response
  }

  const admin = createAdminClient()
  try {
    const result = await syncHubMeetings(admin)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[v0] [meetings/sync] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    )
  }
}
