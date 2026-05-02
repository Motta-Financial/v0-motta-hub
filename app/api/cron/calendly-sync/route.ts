import { NextResponse } from "next/server"
import { runCalendlySync } from "@/lib/calendly-sync"

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
  // now in the past.
  try {
    const result = await runCalendlySync({
      syncPast: true,
      daysBack: 7,
      daysForward: 60,
      syncEventTypes: true,
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

export const POST = GET
