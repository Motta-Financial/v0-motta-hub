/**
 * ProConnect Manual Sync Trigger
 *
 * POST /api/proconnect/sync - Trigger a manual full sync
 * GET /api/proconnect/sync - Get sync status and stats
 */

import { NextRequest, NextResponse } from "next/server"
import { runFullSync, getSyncStats } from "@/lib/proconnect/sync"
import { getTokenStatus } from "@/lib/proconnect/oauth"

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
  console.log("[ProConnect API] Manual sync triggered")

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
