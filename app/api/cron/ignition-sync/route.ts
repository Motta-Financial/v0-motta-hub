/**
 * Ignition sync cron — runs every 15 min (see vercel.json).
 *
 * The Ignition Reporting API is poll-only (no webhook subscriptions), so we
 * maintain freshness by running an INCREMENTAL backfill on a schedule. Each
 * resource is queried with `?updated_from=<cutoff>` so only records modified
 * since the last successful run are fetched. The cutoff is the connection's
 * `last_synced_at` minus a 5-minute safety overlap, so we tolerate clock
 * skew between Ignition and Vercel and any briefly-pending records that
 * weren't visible to the previous tick.
 *
 * Manual override: pass `?full=true` to force a full backfill (useful when
 * we suspect drift after a long outage). The manual UI button on
 * /admin/ignition still hits /api/ignition/sync which runs a full backfill.
 *
 * Rate limit math: Ignition allows 1000 req/hour per practice. A worst-case
 * incremental tick is ~9 endpoints × 1 page each = 9 req/run × 4 runs/hour
 * = 36 req/hour. Plenty of headroom for the manual backfill button.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { runFullBackfill } from "@/lib/ignition/sync"
import type { IgnitionConnectionRow } from "@/lib/ignition/oauth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// 5 minutes is plenty for an incremental tick. The manual backfill route
// (/api/ignition/sync) already has its own 5-minute budget for full runs.
export const maxDuration = 300

// 5-minute overlap on the `updated_from` cutoff. This handles the gap
// between an Ignition record being "updated" and the timestamp becoming
// queryable on the reporting endpoints, plus any clock skew.
const OVERLAP_MS = 5 * 60 * 1000

function authorizeRequest(request: Request): boolean {
  // Vercel Cron always sets x-vercel-cron in production.
  if (request.headers.get("x-vercel-cron")) return true
  const auth = request.headers.get("authorization")
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  // In dev / when CRON_SECRET unset, allow so we can curl the route locally.
  if (!process.env.CRON_SECRET || process.env.NODE_ENV !== "production") return true
  return false
}

export async function GET(request: Request) {
  if (!authorizeRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const forceFull = url.searchParams.get("full") === "true"

  const supabase = createAdminClient()
  const startedAt = new Date().toISOString()

  // 1. Load the singleton connection. There's only ever one row.
  const { data: connectionRow, error: connErr } = await supabase
    .from("ignition_connections")
    .select(
      "id, team_member_id, access_token, refresh_token, token_type, expires_at, scope, ignition_practice_id, ignition_practice_name, ignition_user_email, ignition_user_name, is_active, sync_enabled, last_synced_at, last_sync_error",
    )
    .eq("singleton", true)
    .maybeSingle()

  if (connErr) {
    console.error("[ignition-cron] failed to load connection:", connErr.message)
    return NextResponse.json(
      { ok: false, error: "load_connection_failed", message: connErr.message, startedAt },
      { status: 500 },
    )
  }

  if (!connectionRow) {
    // Not an error — practice just hasn't connected yet.
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no_connection",
      startedAt,
    })
  }

  if (!connectionRow.is_active) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "connection_inactive",
      startedAt,
    })
  }

  if (connectionRow.sync_enabled === false) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "sync_disabled",
      startedAt,
    })
  }

  const connection = connectionRow as unknown as IgnitionConnectionRow

  // 2. Decide the cutoff. On the first run after a fresh connection (no
  //    last_synced_at), fall back to a full backfill — incremental with no
  //    cutoff would still fetch every record and a full backfill is the
  //    correct semantic. The runFullBackfill function logs it as
  //    "ignition_backfill" in that case.
  let updatedSince: string | null = null
  if (!forceFull && connection.last_synced_at) {
    const cutoffMs = new Date(connection.last_synced_at).getTime() - OVERLAP_MS
    updatedSince = new Date(cutoffMs).toISOString()
  }

  // 3. Run the sync. runFullBackfill handles every detail — writing to
  //    sync_log, updating ignition_connections.last_synced_at, and
  //    aggregating per-resource errors.
  try {
    const summary = await runFullBackfill(connection, supabase, {
      isManual: false,
      updatedSince,
    })

    return NextResponse.json({
      ok: true,
      mode: updatedSince ? "incremental" : "full",
      cutoff: updatedSince,
      durationMs: new Date(summary.finishedAt).getTime() - new Date(summary.startedAt).getTime(),
      totalFetched: summary.totalFetched,
      totalUpserted: summary.totalUpserted,
      totalErrors: summary.totalErrors,
      results: summary.results.map((r) => ({
        resource: r.resource,
        fetched: r.fetched,
        upserted: r.upserted,
        errors: r.errors,
      })),
    })
  } catch (err: any) {
    console.error("[ignition-cron] sync failed:", err?.message || err)
    return NextResponse.json(
      {
        ok: false,
        error: "sync_failed",
        message: err?.message || String(err),
        startedAt,
      },
      { status: 500 },
    )
  }
}
