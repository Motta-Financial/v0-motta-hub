import { NextResponse } from "next/server"
import { getAppBaseUrl } from "@/lib/calendly-api"

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
 * Vercel cron config example (vercel.json):
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

  // Forward to the canonical sync route. We always include the past 7d
  // so cancellations or reschedules that happened during a webhook
  // outage get reconciled even though they're now in the past.
  const base = getAppBaseUrl() || url.origin
  const res = await fetch(`${base}/api/calendly/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      syncPast: true,
      daysBack: 7,
      daysForward: 60,
      syncEventTypes: true,
    }),
  })
  const json = await res.json().catch(() => ({}))
  return NextResponse.json(
    {
      success: res.ok,
      forwarded: json,
    },
    { status: res.ok ? 200 : 502 },
  )
}

export const POST = GET
