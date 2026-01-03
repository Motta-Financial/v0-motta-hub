import { type NextRequest, NextResponse } from "next/server"

/**
 * GET /api/karbon/sync
 * Comprehensive sync endpoint that syncs all Karbon data to Supabase.
 * Can be triggered manually or via Vercel Cron.
 *
 * Query params:
 * - incremental=true: Only sync records modified since last sync
 * - expand=true: Fetch expanded details (BusinessCards, AccountingDetail) for contacts/orgs
 * - entities=contacts,organizations,work-items,users,client-groups,tasks,timesheets,notes
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const searchParams = request.nextUrl.searchParams
  const incremental = searchParams.get("incremental") !== "false" // Default to true
  const expand = searchParams.get("expand") === "true"
  const entitiesParam = searchParams.get("entities")

  // Default entities to sync
  const defaultEntities = [
    "contacts",
    "organizations",
    "work-items",
    "users",
    "client-groups",
    "tasks",
    "timesheets",
    "notes",
  ]
  const entities = entitiesParam ? entitiesParam.split(",") : defaultEntities

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"

  const results: Record<string, any> = {}
  const errors: string[] = []

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

  // 6. Tasks - depends on work items for linking
  if (entities.includes("tasks")) {
    results.tasks = await syncEntity("tasks", "/api/karbon/tasks")
  }

  // 7. Timesheets - depends on work items for linking
  if (entities.includes("timesheets")) {
    results.timesheets = await syncEntity("timesheets", "/api/karbon/timesheets")
  }

  // 8. Notes - depends on contacts/work items for linking
  if (entities.includes("notes")) {
    results.notes = await syncEntity("notes", "/api/karbon/notes")
  }

  const duration = Date.now() - startTime

  // Calculate totals
  const totalSynced = Object.values(results).reduce((sum: number, r: any) => sum + (r?.synced || 0), 0)
  const totalErrors = Object.values(results).reduce((sum: number, r: any) => sum + (r?.errors || 0), 0)

  return NextResponse.json({
    success: errors.length === 0,
    syncType: incremental ? "incremental" : "full",
    expandedDetails: expand,
    duration: `${(duration / 1000).toFixed(2)}s`,
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
