import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import type { IgnitionConnectionRow } from "@/lib/ignition/oauth"
import {
  RESOURCE_ORDER,
  type ResourceName,
  runFullBackfill,
} from "@/lib/ignition/sync"

/**
 * Allow up to 5 minutes for a backfill request. Even on a large Ignition
 * practice 9 resources × ~100 records per page × a handful of pages should
 * comfortably finish inside this window. If a single practice ever grows
 * beyond that, callers should pass `resources: ["clients"]` etc. to sync
 * one endpoint at a time, or move the orchestration into a background
 * worker (Inngest, QStash, etc.).
 */
export const maxDuration = 300

/**
 * POST /api/ignition/sync
 *
 * Body (all fields optional):
 *   {
 *     resources?: ResourceName[]   // default: all 9 resources in dependency order
 *   }
 *
 * Returns:
 *   {
 *     ok: true,
 *     summary: {
 *       startedAt, finishedAt,
 *       totalFetched, totalUpserted, totalErrors,
 *       results: [{ resource, fetched, upserted, pages, durationMs, errors }]
 *     }
 *   }
 *
 * Auth: requires an authenticated Supabase session. We don't gate on a
 * specific role here because the entire /admin route tree is already gated
 * higher up — anyone reaching this endpoint via the UI is by definition
 * an authenticated admin user.
 *
 * The actual database writes happen through the service-role client because
 * the new tables (ignition_contacts, ignition_deals, ignition_deal_stages)
 * intentionally only grant write access to service_role, and we want to
 * keep the existing ignition_* tables behind the same admin write surface.
 */
export async function POST(request: Request) {
  try {
    // 1. Auth check via the user's cookie session.
    //
    // CRITICAL: this endpoint is polled every 60 seconds by both
    // `components/sales/ignition-live-badge.tsx` and
    // `components/ignition/backfill-card.tsx`. With multiple users on
    // a shared office NAT IP, calling `auth.getUser()` here was the
    // single biggest contributor to saturating Supabase's per-IP
    // GoTrue rate limit (~30 requests / 5 min on Cloud), which then
    // caused legitimate sign-ins to fail with "Request rate limit
    // reached". We use the local JWT-signature check from
    // `lib/supabase/auth-helpers.ts` instead — same trust model as
    // the middleware, zero GoTrue calls.
    const sessionClient = await createClient()
    const {
      data: { user },
      error: authError,
    } = await getAuthenticatedUser(sessionClient)
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 2. Parse + validate the request body.
    let body: { resources?: unknown } = {}
    try {
      body = await request.json()
    } catch {
      // Empty body is fine — treat as "sync everything".
    }

    let resources: ResourceName[] | undefined
    if (Array.isArray(body.resources)) {
      const allowed = new Set(RESOURCE_ORDER as string[])
      resources = body.resources
        .filter((r): r is string => typeof r === "string")
        .filter((r) => allowed.has(r)) as ResourceName[]
      if (resources.length === 0) {
        return NextResponse.json(
          { error: "No valid resources requested", allowed: RESOURCE_ORDER },
          { status: 400 },
        )
      }
    }

    // 3. Load the active connection (also via the user's session so RLS is
    //    enforced and we never run a backfill against a connection the
    //    caller has no read access to).
    const { data: connectionRow, error: connError } = await sessionClient
      .from("ignition_connections")
      .select(
        "id, team_member_id, access_token, refresh_token, token_type, expires_at, scope, ignition_practice_id, ignition_practice_name, ignition_user_email, ignition_user_name, is_active, sync_enabled, last_synced_at, last_sync_error",
      )
      .eq("singleton", true)
      .maybeSingle()

    if (connError) {
      console.error("[ignition/sync] failed to load connection:", connError)
      return NextResponse.json(
        { error: "Failed to load Ignition connection" },
        { status: 500 },
      )
    }
    if (!connectionRow) {
      return NextResponse.json(
        { error: "Ignition is not connected. Connect it on /admin/ignition first." },
        { status: 409 },
      )
    }
    if (!connectionRow.is_active) {
      return NextResponse.json(
        { error: "Ignition connection is disabled. Reconnect on /admin/ignition." },
        { status: 409 },
      )
    }

    const connection = connectionRow as unknown as IgnitionConnectionRow

    // 4. Look up the calling team member so we can attribute the sync_log
    //    entry. Best-effort — a missing team_member just means the row
    //    will record triggered_by_id = null.
    const { data: teamMember } = await sessionClient
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle()

    // 5. Run the backfill using the service-role client. The service-role
    //    client bypasses RLS, which is what we want for the new tables
    //    (which only grant service_role write) and matches how every other
    //    inbound integration writes its sync data.
    const admin = createAdminClient()
    const summary = await runFullBackfill(connection, admin, {
      resources,
      triggeredByTeamMemberId: teamMember?.id ?? null,
      isManual: true,
    })

    return NextResponse.json({ ok: true, summary })
  } catch (err: any) {
    console.error("[ignition/sync] unexpected error:", err)
    return NextResponse.json(
      { error: "sync_failed", message: err?.message || String(err) },
      { status: 500 },
    )
  }
}

/**
 * GET /api/ignition/sync
 *
 * Lightweight status endpoint: returns the most recent backfill summary
 * (if any) plus the current connection's last_synced_at / last_sync_error.
 * The admin UI polls this to know whether a backfill is in-flight and to
 * render per-resource stats from the last run.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: connection } = await supabase
      .from("ignition_connections")
      .select("id, last_synced_at, last_sync_started_at, last_sync_error")
      .eq("singleton", true)
      .maybeSingle()

    // Both manual backfills and cron-driven incremental ticks land in
    // sync_log. The UI cares about "most recent run, whatever it was", so
    // include both sync_type values.
    const { data: lastRun } = await supabase
      .from("sync_log")
      .select(
        "id, sync_type, status, started_at, completed_at, records_fetched, records_updated, records_failed, error_details, is_manual",
      )
      .in("sync_type", ["ignition_backfill", "ignition_incremental"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      connection: connection
        ? {
            lastSyncedAt: connection.last_synced_at,
            lastSyncStartedAt: connection.last_sync_started_at,
            lastSyncError: connection.last_sync_error,
            isRunning:
              !!connection.last_sync_started_at &&
              (!connection.last_synced_at ||
                new Date(connection.last_sync_started_at).getTime() >
                  new Date(connection.last_synced_at).getTime()),
          }
        : null,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            syncType: lastRun.sync_type,
            isManual: lastRun.is_manual,
            status: lastRun.status,
            startedAt: lastRun.started_at,
            completedAt: lastRun.completed_at,
            recordsFetched: lastRun.records_fetched,
            recordsUpserted: lastRun.records_updated,
            recordsFailed: lastRun.records_failed,
            // error_details is now { results: [...] } on every run, but older
            // rows stored the array directly. Tolerate both shapes so legacy
            // sync_log entries still render in the UI.
            results: Array.isArray(lastRun.error_details)
              ? lastRun.error_details
              : (lastRun.error_details as any)?.results ?? null,
          }
        : null,
    })
  } catch (err: any) {
    console.error("[ignition/sync] status error:", err)
    return NextResponse.json(
      { error: "status_failed", message: err?.message || String(err) },
      { status: 500 },
    )
  }
}
