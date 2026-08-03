/**
 * Manual / cron trigger to backfill Zoom recordings + transcripts for every
 * connected user. Re-pulls recordings with fresh OAuth tokens, upserts the
 * recording rows, downloads + parses transcripts, and copies media to Blob.
 *
 * Auth: either an admin session (UI button) or a `CRON_SECRET` bearer
 * (scheduled / curl). Long-running — uses the Node runtime with an extended
 * maxDuration so a multi-month scan can finish.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { backfillZoomRecordings } from "@/lib/zoom/backfill-recordings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  // Allow either a CRON_SECRET bearer (automation) or an admin session (UI).
  if (!hasCronSecret(req)) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response
  }

  let months = 6
  let includeMedia = true
  try {
    const body = (await req.json()) as { months?: number; includeMedia?: boolean }
    if (typeof body.months === "number") months = body.months
    if (typeof body.includeMedia === "boolean") includeMedia = body.includeMedia
  } catch {
    // empty body is fine — use defaults
  }

  const startedAt = Date.now()
  try {
    const supabase = createAdminClient()
    const result = await backfillZoomRecordings({ supabase, months, includeMedia })
    console.log(
      `[v0] [Zoom Backfill] conns=${result.connections} recs=${result.recordingsUpserted} parsed=${result.transcriptsParsed} failed=${result.transcriptsFailed} media=${result.mediaCopied} errors=${result.errors.length} (${Date.now() - startedAt}ms)`,
    )
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - startedAt })
  } catch (err) {
    console.error("[v0] [Zoom Backfill] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
