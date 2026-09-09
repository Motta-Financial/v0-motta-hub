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

/**
 * Media files the scheduled sweep will copy in one invocation. See the call
 * site — this is an OOM guard, not a throughput knob. If the log starts
 * reporting `stoppedEarly=true` every night, the archive is falling behind:
 * drain it with the POST driver rather than raising this.
 */
const CRON_MAX_MEDIA_COPIES = 8

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

/**
 * GET = scheduled sweep. Vercel cron invokes routes with GET and an
 * automatic `Authorization: Bearer <CRON_SECRET>` header. We sweep a
 * recent window for recordings, transcripts, AND media (media copies are
 * incremental — files already in Blob are skipped, so only the last day's
 * videos actually transfer); full historical backfills go through POST
 * with explicit options.
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
    // Recordings + transcripts ONLY on the daily sweep. Client linking
    // (participant resolution → Calendly bridge → ALFRED triage) is the
    // slow, token-heavy part and would time out this 300s job before it
    // finished the account — it now runs in its own bounded hourly cron
    // (`/api/cron/zoom-link-sweep`). See lib/zoom/sweep-account-linking.ts.
    const result = await syncAccountWideRecordings({
      supabase,
      months: 1,
      includeMedia: true,
      tagParticipants: false,
      // Bound the per-invocation media transfer. Memory builds across
      // sequential copies inside one invocation, so an uncapped run that hits
      // a backlog (a stalled token, a busy week) gets OOM-killed at 3009 MB
      // instead of finishing. 8 is the value the backfill driver proved safe.
      maxMediaCopies: CRON_MAX_MEDIA_COPIES,
    })
    console.log(
      `[v0] [Zoom Account Sync:cron] users=${result.usersScanned} withRecs=${result.usersWithRecordings} recs=${result.recordingsUpserted} parsed=${result.transcriptsParsed} failed=${result.transcriptsFailed} media=${result.mediaCopied} mediaFailed=${result.mediaFailed}${
        result.stoppedEarly ? " stoppedEarly=true" : ""
      } tagged=${result.meetingsTagged} links=${result.clientLinksWritten} errors=${result.errors.length} (${Date.now() - startedAt}ms)`,
    )
    // Media failures used to be invisible here: they only console.warn deep in
    // the ingest worker, and this line reported `errors=0 failed=0` (that
    // `failed` is transcript PARSE failures) — so a dead
    // ZOOM_BLOB_READ_WRITE_TOKEN silently stopped the archive for days while
    // the cron kept returning 200. Log at error level so it lands in the
    // runtime-errors dashboard, where a human actually looks.
    if (result.mediaFailed > 0) {
      console.error(
        `[v0] [Zoom Account Sync:cron] ARCHIVE DEGRADED — ${result.mediaFailed} media file(s) failed to copy to Blob (${result.mediaCopied} succeeded). Check ZOOM_BLOB_READ_WRITE_TOKEN against the zoom-recordings store.`,
      )
    }
    // A capped run that stopped early leaves a backlog no later run is
    // guaranteed to reach, so make the leftover loud rather than silent.
    if (result.stoppedEarly) {
      console.error(
        `[v0] [Zoom Account Sync:cron] BACKLOG — hit the ${CRON_MAX_MEDIA_COPIES}-copy cap with media left to archive. Drain it with POST /api/zoom/recordings/sync-account {"includeMedia":true,"maxMediaCopies":8} until mediaCopied=0.`,
      )
    }
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
  let tagParticipants = true
  let onlyUser: string | undefined
  let from: string | undefined
  let to: string | undefined
  let maxMediaCopies: number | undefined
  try {
    const body = (await req.json()) as {
      months?: number
      includeMedia?: boolean
      tagParticipants?: boolean
      onlyUser?: string
      from?: string
      to?: string
      maxMediaCopies?: number
    }
    if (typeof body.months === "number") months = body.months
    if (typeof body.includeMedia === "boolean") includeMedia = body.includeMedia
    if (typeof body.tagParticipants === "boolean") tagParticipants = body.tagParticipants
    if (typeof body.onlyUser === "string") onlyUser = body.onlyUser
    if (typeof body.from === "string") from = body.from
    if (typeof body.to === "string") to = body.to
    if (typeof body.maxMediaCopies === "number" && body.maxMediaCopies > 0) {
      maxMediaCopies = body.maxMediaCopies
    }
  } catch {
    // empty body is fine — use defaults
  }

  const startedAt = Date.now()
  try {
    const supabase = createAdminClient()
    const result = await syncAccountWideRecordings({
      supabase,
      months,
      from,
      to,
      includeMedia,
      tagParticipants,
      onlyUser,
      maxMediaCopies,
    })
    console.log(
      `[v0] [Zoom Account Sync] users=${result.usersScanned} withRecs=${result.usersWithRecordings} recs=${result.recordingsUpserted} parsed=${result.transcriptsParsed} failed=${result.transcriptsFailed} media=${result.mediaCopied} mediaFailed=${result.mediaFailed}${
        result.stoppedEarly ? " stoppedEarly=true" : ""
      } tagged=${result.meetingsTagged} links=${result.clientLinksWritten} errors=${result.errors.length} (${Date.now() - startedAt}ms)`,
    )
    if (result.mediaFailed > 0) {
      console.error(
        `[v0] [Zoom Account Sync] ARCHIVE DEGRADED — ${result.mediaFailed} media file(s) failed to copy to Blob (${result.mediaCopied} succeeded). Check ZOOM_BLOB_READ_WRITE_TOKEN against the zoom-recordings store.`,
      )
    }
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - startedAt })
  } catch (err) {
    console.error("[v0] [Zoom Account Sync] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
