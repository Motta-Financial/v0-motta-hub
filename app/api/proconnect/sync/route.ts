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
  // Verify CRON_SECRET auth
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const fullLoop = url.searchParams.get("full") === "true"

  console.log(`[ProConnect API] Manual sync triggered (fullLoop=${fullLoop})`)

  try {
    if (!fullLoop) {
      // Single sync run (original behavior)
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
        lastClientIndex: result.lastClientIndex,
      })
    }

    // Full loop mode: keep calling sync until all clients are done
    // This chains multiple partial syncs until lastClientIndex resets to 0
    const runs: Array<{
      run: number
      syncLogId: string
      engagementsSynced: number
      lastClientIndex?: number
      status: string
      duration: number
    }> = []

    let totalEngagements = 0
    let totalClients = 0
    let runCount = 0
    const maxRuns = 100 // Safety limit to prevent infinite loops
    const startTime = Date.now()

    while (runCount < maxRuns) {
      runCount++
      console.log(`[ProConnect API] Full sync loop - run ${runCount}`)

      const result = await runFullSync("manual")

      runs.push({
        run: runCount,
        syncLogId: result.syncLogId,
        engagementsSynced: result.engagementsSynced,
        lastClientIndex: result.lastClientIndex,
        status: result.partial ? "partial" : result.success ? "success" : "failed",
        duration: result.duration,
      })

      totalEngagements += result.engagementsSynced
      totalClients += result.clientsSynced

      // Stop conditions:
      // 1. Sync completed successfully (lastClientIndex === 0 means all clients done)
      // 2. Actual failure (not partial)
      // 3. No progress made (safety check)
      if (result.success && result.lastClientIndex === 0) {
        console.log(`[ProConnect API] Full sync complete after ${runCount} runs`)
        break
      }

      if (!result.partial && !result.success) {
        console.log(`[ProConnect API] Sync failed (not partial), stopping loop`)
        break
      }

      // Continue to next run for partial syncs
      console.log(`[ProConnect API] Partial sync completed, continuing... (lastClientIndex=${result.lastClientIndex})`)
    }

    const totalDuration = Date.now() - startTime

    return NextResponse.json({
      ok: runs[runs.length - 1]?.status === "success",
      mode: "full_loop",
      totalRuns: runCount,
      totalEngagementsSynced: totalEngagements,
      totalClientsSynced: totalClients,
      totalDuration: `${totalDuration}ms`,
      runs,
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
