/**
 * ProConnect Manual Sync Trigger
 *
 * POST /api/proconnect/sync - Trigger a manual full sync (runs in Vercel)
 * GET /api/proconnect/sync - Get sync status and stats
 *
 * The sync work runs inline via lib/proconnect/sync.runFullSync(). It is
 * resumable — if the 40s self-timeout fires before all clients are
 * processed, the run is marked "partial" with a last_client_index, and
 * the next POST resumes from that point. Repeat until status === "success".
 */

import { NextRequest, NextResponse } from "next/server"
import { getSyncStats, runFullSync } from "@/lib/proconnect/sync"
import { getTokenStatus } from "@/lib/proconnect/oauth"
import { requireLeadership } from "@/lib/auth/require-leadership"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

export async function GET() {
  try {
    const [stats, tokenStatus] = await Promise.all([
      getSyncStats(),
      getTokenStatus(),
    ])

    return NextResponse.json({
      ok: true,
      sync: {
        lastSync: stats.lastSync
          ? {
              id: stats.lastSync.id,
              status: stats.lastSync.status,
              startedAt: stats.lastSync.started_at,
              completedAt: stats.lastSync.completed_at,
              clientsSynced: stats.lastSync.clients_synced,
              engagementsSynced: stats.lastSync.engagements_synced,
              customStatusesSynced: stats.lastSync.custom_statuses_synced,
              errorMessage: stats.lastSync.error_message,
            }
          : null,
        consecutiveFailures: stats.consecutiveFailures,
        totals: {
          clients: stats.totalClients,
          engagements: stats.totalEngagements,
        },
      },
      oauth: {
        hasToken: tokenStatus.hasToken,
        expiresAt: tokenStatus.expiresAt,
        isExpired: tokenStatus.isExpired,
        needsRefresh: tokenStatus.needsRefresh,
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Authorise via either:
  //   1) CRON_SECRET bearer header (used by Vercel cron + scripts)
  //   2) A leadership-role Supabase session (used by /tax/settings UI)
  // This lets ops trigger a manual import from the Hub without exposing
  // the service-role secret to the browser.
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  const cronOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!cronOk) {
    const auth = await requireLeadership()
    if (!auth.ok) {
      return auth.response
    }
  }

  console.log("[ProConnect API] Manual sync triggered - running inline")

  try {
    const result = await runFullSync("manual")

    return NextResponse.json({
      ok: result.success,
      syncLogId: result.syncLogId,
      clientsSynced: result.clientsSynced,
      engagementsSynced: result.engagementsSynced,
      customStatusesSynced: result.customStatusesSynced,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 20),
      duration: `${result.duration}ms`,
      partial: result.partial,
      timedOut: result.timedOut,
      lastClientIndex: result.lastClientIndex,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
