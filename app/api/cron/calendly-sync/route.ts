import { NextResponse } from "next/server"
import { runCalendlySync } from "@/lib/calendly-sync"

export const runtime = "nodejs"
// The sync itself takes ~20s; the rest of the budget covers the booking
// backstop at the end of each run (a research pass + team email for any
// booking the webhook didn't announce, capped per run).
export const maxDuration = 300

// How far ahead the scheduled sync looks. Bookings are usually made days
// out, but nothing stops a client booking months ahead — and a meeting
// the sync never lists never reaches the Team Calendar unless the
// webhook delivered it. Unchanged events cost one list row each, so a
// wide window is cheap.
const SYNC_DAYS_FORWARD = 180

/**
 * Periodic Calendly sync.
 *
 * Designed to be invoked by Vercel Cron (or any other scheduler) on a
 * regular cadence — typically every 30 minutes — so we have a safety
 * net for any webhook events that were dropped, retried unsuccessfully,
 * or arrived before our service was reachable.
 *
 * Authenticated by `CRON_SECRET` either via the `Authorization: Bearer`
 * header (Vercel Cron's default) or a `?token=` query param.
 *
 * We invoke `runCalendlySync` directly rather than fetching the sync
 * route, which avoids re-tripping the Supabase middleware that protects
 * the user-facing API.
 *
 * Vercel cron config (vercel.json):
 *   { "crons": [{ "path": "/api/cron/calendly-sync", "schedule": "*\/30 * * * *" }] }
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const auth = request.headers.get("authorization") || ""
  const url = new URL(request.url)
  const token = url.searchParams.get("token")
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : token
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Always include the past 7d so cancellations or reschedules that
  // happened during a webhook outage get reconciled even though they're
  // now in the past. POST callers can override the window for one-time
  // backfills (e.g. immediately after enabling webhooks).
  try {
    const result = await runCalendlySync({
      syncPast: true,
      daysBack: 7,
      daysForward: SYNC_DAYS_FORWARD,
      syncEventTypes: true,
      // The scheduled run is the webhook's safety net: announce any
      // recent booking the team hasn't been emailed about.
      announceBookings: true,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[cron/calendly-sync] failed:", err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }
  const auth = request.headers.get("authorization") || ""
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // POST allows callers (operators, one-off backfill scripts) to widen
  // the date range. Falls back to the same defaults as GET.
  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  try {
    const result = await runCalendlySync({
      syncPast: body.syncPast ?? true,
      daysBack: typeof body.daysBack === "number" ? body.daysBack : 7,
      daysForward: typeof body.daysForward === "number" ? body.daysForward : SYNC_DAYS_FORWARD,
      syncEventTypes: body.syncEventTypes ?? true,
      teamMemberId: body.teamMemberId,
      // Operator backfills (wide date ranges) default to NOT emailing
      // the firm; pass `announceBookings: true` to opt in.
      announceBookings: body.announceBookings === true,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error("[cron/calendly-sync] POST failed:", err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
