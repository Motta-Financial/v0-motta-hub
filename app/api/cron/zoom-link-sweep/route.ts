/**
 * Hourly Zoom account-wide LINKING sweep.
 *
 * Decoupled from the daily recordings/transcripts sync so neither job
 * times out the other (see lib/zoom/sweep-account-linking.ts for the
 * full rationale). Two bounded passes per invocation:
 *
 *   1. sweepAccountLinking — participant resolution → Calendly bridge →
 *      ALFRED triage (incl. topic-based client matching) for meetings
 *      that have never been linked. Drains the backlog a batch at a time.
 *
 *   2. ingestPendingZoomAiSummaries — for meetings that just got
 *      client-linked but have NO transcript, write Zoom AI Companion's
 *      own summary as a fallback note.
 *
 * Auth: `CRON_SECRET` bearer (Vercel cron / curl) OR an admin session
 * (UI button). POST accepts overrides + the one-time `retryParticipantless`
 * backfill to run after granting the past-participants scope.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { isS2SConfigured, s2sFetch } from "@/lib/zoom/s2s-auth"
import { sweepAccountLinking } from "@/lib/zoom/sweep-account-linking"
import { ingestPendingZoomAiSummaries } from "@/lib/zoom/ingest-ai-summary"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${secret}`
}

async function runSweep(params: {
  maxMeetings: number
  sinceDays: number
  retryParticipantless: boolean
  aiSummaryLimit: number
}) {
  const supabase = createAdminClient()
  const startedAt = Date.now()

  const linking = await sweepAccountLinking({
    supabase,
    maxMeetings: params.maxMeetings,
    sinceDays: params.sinceDays,
    retryParticipantless: params.retryParticipantless,
  })

  // Fallback summaries for client-linked, transcript-less meetings.
  const aiSummaries = await ingestPendingZoomAiSummaries(
    supabase,
    (url) => s2sFetch(url),
    { limit: params.aiSummaryLimit, sinceDays: params.sinceDays },
  )

  const ms = Date.now() - startedAt
  console.log(
    `[v0] [Zoom Link Sweep]${linking.retryPass ? ":retry" : ""} ` +
      `scanned=${linking.meetingsScanned} links=${linking.linksWritten} ` +
      `bridged=${linking.bridgedFromCalendly} alfred=${linking.alfredTagged} ` +
      `aiSummaries=${aiSummaries.ingested}/${aiSummaries.updated} ` +
      `linkErrors=${linking.errors.length} (${ms}ms)`,
  )

  return { ok: true, linking, aiSummaries, ms }
}

export async function GET(req: NextRequest) {
  if (!hasCronSecret(req)) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response
  }
  if (!isS2SConfigured()) {
    return NextResponse.json({ ok: false, error: "Zoom S2S is not configured." }, { status: 400 })
  }
  try {
    const out = await runSweep({
      maxMeetings: 20,
      sinceDays: 365,
      retryParticipantless: false,
      aiSummaryLimit: 10,
    })
    return NextResponse.json(out)
  } catch (err) {
    console.error("[v0] [Zoom Link Sweep:cron] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
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

  let maxMeetings = 25
  let sinceDays = 365
  let retryParticipantless = false
  let aiSummaryLimit = 15
  try {
    const body = (await req.json()) as {
      maxMeetings?: number
      sinceDays?: number
      retryParticipantless?: boolean
      aiSummaryLimit?: number
    }
    if (typeof body.maxMeetings === "number") maxMeetings = body.maxMeetings
    if (typeof body.sinceDays === "number") sinceDays = body.sinceDays
    if (typeof body.retryParticipantless === "boolean") retryParticipantless = body.retryParticipantless
    if (typeof body.aiSummaryLimit === "number") aiSummaryLimit = body.aiSummaryLimit
  } catch {
    // empty body → defaults
  }

  try {
    const out = await runSweep({ maxMeetings, sinceDays, retryParticipantless, aiSummaryLimit })
    return NextResponse.json(out)
  } catch (err) {
    console.error("[v0] [Zoom Link Sweep] failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
