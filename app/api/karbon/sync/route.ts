import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/**
 * GET /api/karbon/sync
 * Comprehensive sync endpoint that syncs all Karbon data to Supabase.
 * Now with sync_log audit trail for tracking all sync operations.
 *
 * Query params:
 * - incremental=true: Only sync records modified since last sync (default: true)
 * - expand=true: Fetch expanded details (BusinessCards, AccountingDetail) for contacts/orgs
 * - entities=contacts,organizations,work-items,users,client-groups,tasks,timesheets
 * - manual=true: Mark this sync as manually triggered (vs cron)
 * 
 * NOTE: "notes" removed from default sync - Karbon API does NOT have a list endpoint
 * for notes. Notes are synced via webhooks or individual fetches.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const searchParams = request.nextUrl.searchParams
  const incremental = searchParams.get("incremental") !== "false" // Default to true
  const expand = searchParams.get("expand") === "true"
  const isManual = searchParams.get("manual") === "true"
  const entitiesParam = searchParams.get("entities")

  // Default entities to sync (notes removed - no list endpoint in Karbon API)
  const defaultEntities = [
    "contacts",
    "organizations",
    "work-items",
    "users",
    "client-groups",
    "tasks",
    "timesheets",
    "invoices",
  ]
  const entities = entitiesParam ? entitiesParam.split(",") : defaultEntities

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")

  const results: Record<string, any> = {}
  const errors: string[] = []

  // Create sync_log entry to track this sync operation
  const supabase = getSupabaseAdmin()
  let syncLogId: string | null = null

  if (supabase) {
    const { data: logEntry } = await supabase
      .from("sync_log")
      .insert({
        sync_type: incremental ? "incremental" : "full",
        sync_direction: "karbon_to_supabase",
        status: "running",
        is_manual: isManual,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    syncLogId = logEntry?.id || null
  }

  // Helper function to call sync endpoints
  async function syncEntity(entity: string, endpoint: string, extraParams = "") {
    try {
      const url = `${baseUrl}${endpoint}?import=true&incremental=${incremental}${extraParams}`
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        errors.push(`${entity}: ${errorData.error || response.statusText}`)
        return { error: errorData.error || response.statusText }
      }

      const data = await response.json()
      return data.importResult || { synced: data.count || 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      errors.push(`${entity}: ${message}`)
      return { error: message }
    }
  }

  // Sync entities in optimal order (users/contacts/orgs first, then dependent entities)

  // 1. Users (team members) - no dependencies
  if (entities.includes("users")) {
    results.users = await syncEntity("users", "/api/karbon/users")
  }

  // 2. Contacts - no dependencies (but expand optional)
  if (entities.includes("contacts")) {
    const expandParam = expand ? "&expand=true" : ""
    results.contacts = await syncEntity("contacts", "/api/karbon/contacts", expandParam)
  }

  // 3. Organizations - no dependencies (but expand optional)
  if (entities.includes("organizations")) {
    const expandParam = expand ? "&expand=true" : ""
    results.organizations = await syncEntity("organizations", "/api/karbon/organizations", expandParam)
  }

  // 4. Client Groups - depends on contacts/orgs for linking
  if (entities.includes("client-groups")) {
    results.clientGroups = await syncEntity("client-groups", "/api/karbon/client-groups")
  }

  // 5. Work Items - depends on contacts/orgs for client linking
  if (entities.includes("work-items")) {
    results.workItems = await syncEntity("work-items", "/api/karbon/work-items")
  }

  // 6. Tasks (IntegrationTasks) - depends on work items for linking
  if (entities.includes("tasks")) {
    results.tasks = await syncEntity("tasks", "/api/karbon/tasks")
  }

  // 7. Timesheets - depends on work items for linking
  if (entities.includes("timesheets")) {
    results.timesheets = await syncEntity("timesheets", "/api/karbon/timesheets")
  }

  // 8. Invoices - depends on work items/clients for linking
  if (entities.includes("invoices")) {
    results.invoices = await syncEntity("invoices", "/api/karbon/invoices")
  }

  // Work statuses from TenantSettings (always sync)
  if (entities.includes("work-statuses") || !entitiesParam) {
    results.workStatuses = await syncEntity("work-statuses", "/api/karbon/work-statuses", "&sync=true")
  }

  const duration = Date.now() - startTime

  // Calculate totals
  const totalSynced = Object.values(results).reduce((sum: number, r: any) => sum + (r?.synced || 0), 0)
  const totalErrors = Object.values(results).reduce((sum: number, r: any) => sum + (r?.errors || 0), 0)

  // Update sync_log with results
  if (supabase && syncLogId) {
    await supabase
      .from("sync_log")
      .update({
        status: errors.length === 0 ? "completed" : "completed_with_errors",
        records_fetched: totalSynced + totalErrors,
        records_created: totalSynced,
        records_updated: 0,
        records_failed: totalErrors,
        completed_at: new Date().toISOString(),
        error_message: errors.length > 0 ? errors.join("; ") : null,
        error_details: errors.length > 0 ? { errors, results } : null,
      })
      .eq("id", syncLogId)
  }

  return NextResponse.json({
    success: errors.length === 0,
    syncType: incremental ? "incremental" : "full",
    expandedDetails: expand,
    duration: `${(duration / 1000).toFixed(2)}s`,
    syncLogId,
    summary: {
      totalSynced,
      totalErrors,
      entitiesSynced: entities.length,
    },
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  })
}
