/**
 * Karbon Timesheets sync cron — runs every 30 min.
 *
 * Karbon does NOT emit webhooks for TimeEntries / Timesheets, so the
 * generic webhook-driven karbon-sync cron can't keep them fresh. This
 * dedicated job pulls incremental changes from the Karbon /Timesheets
 * endpoint (with $expand=TimeEntries) and upserts them into
 * `karbon_timesheets`.
 *
 * It defers the actual fetch logic to the existing
 *   GET /api/karbon/timesheets?import=true&incremental=true
 * route, which already implements the OData filter, expand, batch
 * upsert, and last-modified bookkeeping.
 *
 * Auth: same pattern as /api/cron/karbon-sync — accepts CRON_SECRET
 * bearer or x-vercel-cron header.
 */
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorizeRequest(request: Request): boolean {
  const auth = request.headers.get("authorization")
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true
  if (request.headers.get("x-vercel-cron")) return true
  if (!process.env.CRON_SECRET || process.env.NODE_ENV !== "production") return true
  return false
}

function resolveBaseUrl(request: Request): string {
  // Calls /api/karbon/timesheets on THIS deployment (internal server-to-server).
  // Use our own origin — never NEXT_PUBLIC_APP_URL, which on the Hub points at
  // the marketing domain (motta.cpa) and has none of these routes, so the
  // timesheet import would silently 404.
  try {
    const origin = new URL(request.url).origin
    if (origin && !origin.includes("localhost:0")) return origin
  } catch {
    // fall through
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (process.env.NEXT_PUBLIC_APP_URL) {
    const url = process.env.NEXT_PUBLIC_APP_URL
    return url.startsWith("http") ? url : `https://${url}`
  }
  return "http://localhost:3000"
}

export async function GET(request: Request) {
  if (!authorizeRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const baseUrl = resolveBaseUrl(request)

  try {
    const url = new URL(request.url)
    // First-time backfill / manual full sync support: ?full=true
    const incremental = url.searchParams.get("full") === "true" ? "false" : "true"

    const res = await fetch(
      `${baseUrl}/api/karbon/timesheets?import=true&incremental=${incremental}`,
      {
        headers: {
          "Content-Type": "application/json",
          ...(process.env.CRON_SECRET ? { "x-internal-secret": process.env.CRON_SECRET } : {}),
        },
      },
    )
    const json = await res.json().catch(() => ({ error: res.statusText }))

    return NextResponse.json({
      ok: res.ok,
      startedAt,
      durationMs: Date.now() - t0,
      mode: incremental === "true" ? "incremental" : "full",
      result: {
        status: res.status,
        count: json.count,
        totalCount: json.totalCount,
        importResult: json.importResult,
        summary: json.summary,
      },
    })
  } catch (error) {
    console.error("[karbon-timesheets-cron] failed:", (error as Error).message)
    return NextResponse.json(
      {
        ok: false,
        startedAt,
        durationMs: Date.now() - t0,
        error: (error as Error).message,
      },
      { status: 500 },
    )
  }
}
