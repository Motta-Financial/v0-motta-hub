/**
 * Account-wide Zoom recording + transcript sync (Option A).
 *
 * Uses Server-to-Server OAuth to enumerate EVERY user in the Motta Zoom
 * account and pull each one's cloud recordings — not just users who
 * personally connected the Hub. Upserts recordings, parses transcripts,
 * and (optionally) copies media to Blob.
 *
 * Auth: either an admin session (UI button) or a `CRON_SECRET` bearer
 * (scheduled / curl). Long-running — Node runtime + extended maxDuration.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { syncAccountWideRecordings } from "@/lib/zoom/sync-account-recordings"
import { isS2SConfigured } from "@/lib/zoom/s2s-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

/**
 * GET = scheduled sweep. Vercel cron invokes routes with GET and an
 * automatic `Authorization: Bearer <CRON_SECRET>` header. We run a light
 * recent-window, transcripts-only sweep so each daily run is cheap; full
 * historical backfills go through POST with explicit options.
 */
export async function GET(req: NextRequest) {
  if (!hasCronSecret(req)) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response
  }

  if (!isS2SConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Zoom S2S is not configured." },
      { status: 400 },
    )
  }

  const startedAt = Date.now()
  try {
    const supabase = createAdminClient()
    const result = await syncAccountWideRecordings({ supabase, months: 1, includeMedia: false })
    console.log(
      `[v0] [Zoom Account Sync:cron] users=${result.usersScanned} withRecs=${result.usersWithRecordings} recs=${result.recordingsUpserted} parsed=${result.transcriptsParsed} failed=${result.transcriptsFailed} errors=${result.errors.length} (${Date.now() - startedAt}ms)`,
    )
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - startedAt })
  } catch (err) {
    console.error("[v0] [Zoom Account Sync:cron] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  // Allow either a CRON_SECRET bearer (automation) or an admin session (UI).
  if (!hasCronSecret(req)) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response
  }

  if (!isS2SConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Zoom S2S is not configured. Set ZOOM_S2S_CLIENT_ID, ZOOM_S2S_CLIENT_SECRET, and ZOOM_S2S_ACCOUNT_ID.",
      },
      { status: 400 },
    )
  }

  let months = 6
  let includeMedia = false
  let onlyUser: string | undefined
  try {
    const body = (await req.json()) as {
      months?: number
      includeMedia?: boolean
      onlyUser?: string
    }
    if (typeof body.months === "number") months = body.months
    if (typeof body.includeMedia === "boolean") includeMedia = body.includeMedia
    if (typeof body.onlyUser === "string") onlyUser = body.onlyUser
  } catch {
    // empty body is fine — use defaults
  }

  const startedAt = Date.now()
  try {
    const supabase = createAdminClient()
    const result = await syncAccountWideRecordings({ supabase, months, includeMedia, onlyUser })
    console.log(
      `[v0] [Zoom Account Sync] users=${result.usersScanned} withRecs=${result.usersWithRecordings} recs=${result.recordingsUpserted} parsed=${result.transcriptsParsed} failed=${result.transcriptsFailed} media=${result.mediaCopied} errors=${result.errors.length} (${Date.now() - startedAt}ms)`,
    )
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - startedAt })
  } catch (err) {
    console.error("[v0] [Zoom Account Sync] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
