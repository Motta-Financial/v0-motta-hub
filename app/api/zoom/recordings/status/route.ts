/**
 * GET /api/zoom/recordings/status
 *
 * Admin-only, read-only summary of the account-wide Zoom recording
 * pipeline: how many recordings + transcripts we hold, how many parsed
 * vs. failed, how many have media archived to Blob, plus a small recent
 * list. Powers the "Zoom Recordings" admin page and is the same data the
 * ALFRED `getZoomRecordingStatus` tool returns.
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { getZoomRecordingStats } from "@/lib/zoom/recording-stats"
import { isS2SConfigured } from "@/lib/zoom/s2s-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response

  try {
    const supabase = createAdminClient()
    const stats = await getZoomRecordingStats(supabase)
    return NextResponse.json({ ok: true, s2sConfigured: isS2SConfigured(), ...stats })
  } catch (err) {
    console.error("[v0] [Zoom Recording Status] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
