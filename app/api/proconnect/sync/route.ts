/**
 * ProConnect Manual Sync Trigger
 *
 * POST /api/proconnect/sync - Trigger a manual full sync via Edge Function
 * GET /api/proconnect/sync - Get sync status and stats
 *
 * The actual sync work is delegated to the Supabase Edge Function at
 * supabase/functions/proconnect-sync/index.ts. This route is a thin
 * proxy that handles auth and stat lookups.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSyncStats } from "@/lib/proconnect/sync"
import { getTokenStatus } from "@/lib/proconnect/oauth"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getEdgeFunctionUrl(): string {
  return `${SUPABASE_URL}/functions/v1/proconnect-sync`
}

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

  console.log("[ProConnect API] Manual sync triggered - delegating to Edge Function")

  try {
    const url = getEdgeFunctionUrl()

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ syncType: "manual" }),
    })

    const result = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Edge Function returned ${response.status}`,
          details: result,
        },
        { status: response.status }
      )
    }

    return NextResponse.json({
      ok: result.success,
      syncLogId: result.syncLogId,
      clientsSynced: result.clientsSynced,
      engagementsSynced: result.engagementsSynced,
      customStatusesSynced: result.customStatusesSynced,
      totalClients: result.totalClients,
      errorCount: result.errorCount,
      errors: (result.errors || []).slice(0, 20),
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
