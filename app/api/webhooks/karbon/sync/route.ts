/**
 * Karbon Work Items Full Sync API
 * Manually trigger a full sync of all work items from Karbon to Supabase
 *
 * Usage:
 * POST /api/webhooks/karbon/sync
 * Optional query params:
 * - modifiedAfter: ISO date string to only sync recently modified items
 * - status: Filter by status (e.g., "In Progress")
 * - workType: Filter by work type (e.g., "TAX | Individual (1040)")
 */
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getKarbonCredentials, karbonFetchAll, type ODataQueryOptions } from "@/lib/karbon-api"
import { mapKarbonWorkItemToSupabase } from "@/lib/karbon-webhook"

const BATCH_SIZE = 100 // Number of records to upsert at a time

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const credentials = getKarbonCredentials()
    if (!credentials) {
      return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
    }

    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams

    // Build filter options from query params
    const queryOptions: ODataQueryOptions = {
      expand: ["UserRoleAssignments", "CustomFields"],
    }

    const filters: string[] = []

    const modifiedAfter = searchParams.get("modifiedAfter")
    if (modifiedAfter) {
      filters.push(`LastModifiedDateTime ge ${modifiedAfter}`)
    }

    const status = searchParams.get("status")
    if (status) {
      filters.push(`PrimaryStatus eq '${status}'`)
    }

    const workType = searchParams.get("workType")
    if (workType) {
      filters.push(`WorkType eq '${workType}'`)
    }

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    console.log("[Karbon Sync] Starting full sync with options:", queryOptions)

    // Fetch all work items from Karbon
    const {
      data: workItems,
      error: fetchError,
      totalCount,
    } = await karbonFetchAll<any>(
      "/WorkItems",
      credentials,
      queryOptions,
      100, // Max pages
    )

    if (fetchError) {
      console.error("[Karbon Sync] Failed to fetch work items:", fetchError)
      return NextResponse.json({ error: `Failed to fetch from Karbon: ${fetchError}` }, { status: 500 })
    }

    console.log(`[Karbon Sync] Fetched ${workItems.length} work items from Karbon`)

    // Process in batches
    let successCount = 0
    let errorCount = 0
    const errors: Array<{ key: string; error: string }> = []

    for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
      const batch = workItems.slice(i, i + BATCH_SIZE)
      const mappedBatch = batch.map(mapKarbonWorkItemToSupabase)

      const { error: upsertError } = await supabase.from("work_items").upsert(mappedBatch, {
        onConflict: "karbon_work_item_key",
        ignoreDuplicates: false,
      })

      if (upsertError) {
        console.error(`[Karbon Sync] Batch ${i / BATCH_SIZE + 1} failed:`, upsertError)
        errorCount += batch.length
        errors.push({
          key: `batch-${i / BATCH_SIZE + 1}`,
          error: upsertError.message,
        })
      } else {
        successCount += batch.length
        console.log(
          `[Karbon Sync] Processed batch ${i / BATCH_SIZE + 1} of ${Math.ceil(workItems.length / BATCH_SIZE)}`,
        )
      }
    }

    // Log the sync operation
    await supabase.from("sync_log").insert({
      sync_type: "karbon_work_items",
      sync_direction: "inbound",
      status: errorCount === 0 ? "completed" : "partial",
      records_fetched: workItems.length,
      records_created: successCount,
      records_failed: errorCount,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      error_details: errors.length > 0 ? { errors } : null,
      is_manual: true,
    })

    const durationMs = Date.now() - startTime

    console.log(`[Karbon Sync] Completed in ${durationMs}ms - Success: ${successCount}, Errors: ${errorCount}`)

    return NextResponse.json({
      success: true,
      summary: {
        totalFetched: workItems.length,
        successCount,
        errorCount,
        durationMs,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
      },
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error("[Karbon Sync] Unexpected error:", error)
    return NextResponse.json(
      {
        error: "Sync failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// GET endpoint to check sync status
export async function GET() {
  try {
    const supabase = await createClient()

    // Get last sync info
    const { data: lastSync } = await supabase
      .from("sync_log")
      .select("*")
      .eq("sync_type", "karbon_work_items")
      .order("started_at", { ascending: false })
      .limit(1)
      .single()

    // Get work items count
    const { count: workItemsCount } = await supabase
      .from("work_items")
      .select("*", { count: "exact", head: true })
      .not("karbon_work_item_key", "is", null)

    return NextResponse.json({
      status: "ready",
      lastSync: lastSync || null,
      syncedWorkItems: workItemsCount || 0,
    })
  } catch (error) {
    return NextResponse.json({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
