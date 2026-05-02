import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { runCalendlySync, type SyncBody } from "@/lib/calendly-sync"

/**
 * Master Calendly sync route.
 *
 * - GET  → returns the most recent sync_log row plus a hint about
 *           whether the most recent successful sync is stale (>6h).
 * - POST → runs a sync via the shared `runCalendlySync` engine. Body
 *           parameters control time window:
 *      • syncPast?: boolean (default false)
 *      • daysBack?: number (default 30 — only used when syncPast=true)
 *      • daysForward?: number (default 90)
 *      • syncEventTypes?: boolean (default true)
 *      • teamMemberId?: string (limit to a single connection)
 *
 * The actual sync logic lives in `lib/calendly-sync.ts` so cron handlers
 * can call it directly without round-tripping HTTP.
 */
export async function POST(request: Request) {
  let body: SyncBody = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const result = await runCalendlySync(body)
  return NextResponse.json(result, { status: result.success ? 200 : 500 })
}

export async function GET() {
  const supabase = createAdminClient()
  const [{ data: lastSync }, { count: connectionCount }] = await Promise.all([
    supabase
      .from("calendly_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("calendly_connections")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("sync_enabled", true),
  ])

  const stale =
    lastSync?.completed_at &&
    Date.now() - new Date(lastSync.completed_at).getTime() > 6 * 60 * 60 * 1000

  return NextResponse.json({ lastSync, connectionCount: connectionCount ?? 0, stale: !!stale })
}
