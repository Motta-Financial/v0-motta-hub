import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/karbon/sync-health
 * Returns sync health metrics from the karbon_sync_health view
 * plus the last sync_log entry for detailed status.
 */
export async function GET() {
  try {
    const supabase = createAdminClient()

    // Query the pre-built sync health view
    const [healthResult, lastSyncResult] = await Promise.all([
      supabase.from("karbon_sync_health").select("*"),
      supabase
        .from("sync_log")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(5),
    ])

    const health = healthResult.data || []
    const recentSyncs = lastSyncResult.data || []

    // Calculate overall health status
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const staleEntities = health.filter((h: any) => {
      if (!h.last_sync) return true
      return new Date(h.last_sync) < oneDayAgo
    })

    const overallStatus =
      staleEntities.length === 0
        ? "healthy"
        : staleEntities.length <= 2
          ? "warning"
          : "critical"

    return NextResponse.json({
      status: overallStatus,
      entities: health,
      staleEntities: staleEntities.map((e: any) => e.entity),
      recentSyncs,
      checkedAt: now.toISOString(),
    })
  } catch (error) {
    console.error("Error fetching sync health:", error)
    return NextResponse.json(
      { error: "Failed to fetch sync health" },
      { status: 500 },
    )
  }
}
