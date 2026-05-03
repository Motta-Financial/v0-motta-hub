/**
 * GET /api/karbon/sync
 *
 * Bulk reconciliation orchestrator. Fans out to the per-entity import routes
 * (which still own the Karbon → Supabase mapping for list-based syncs) and
 * records a sync_log row for the run.
 *
 * In the new architecture, the **webhook receiver** is the primary path for
 * keeping Supabase fresh. This endpoint exists for:
 *   - Initial backfill (`?source=backfill`)
 *   - Watchdog-triggered drift reconciliation from the cron (`?source=cron`)
 *   - Manual full re-sync from the admin UI (`?source=manual`)
 *
 * Query params:
 *   - incremental=true (default)         only modified-since-last-sync
 *   - expand=true                        fetch BusinessCards/AccountingDetail for contacts/orgs
 *   - entities=contacts,organizations,…  comma-separated; default = all
 *   - source=manual|cron|backfill|webhook-replay  recorded in sync_log
 *   - manual=true                        legacy alias for source=manual
 *
 * Notes:
 *   - "notes" is intentionally excluded — Karbon has no list endpoint for it.
 *     Notes are only synced via webhooks (Note / NoteComment events).
 *   - The response includes `webhookBacklog` so callers can spot a stalled
 *     webhook pipeline that the cron should drain before re-running this.
 */
import { type NextRequest, NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"

const DEFAULT_ENTITIES = [
  "users",
  "contacts",
  "organizations",
  "client-groups",
  "work-items",
  "tasks",
  "timesheets",
  "invoices",
] as const

type SyncSource = "manual" | "cron" | "backfill" | "webhook-replay"

function resolveBaseUrl(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    const url = process.env.NEXT_PUBLIC_APP_URL
    // Ensure https:// protocol is present
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return `https://${url}`
    }
    return url
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  // Last resort: use the request's own origin so dev still works
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const sp = request.nextUrl.searchParams

  const incremental = sp.get("incremental") !== "false"
  const expand = sp.get("expand") === "true"
  const entitiesParam = sp.get("entities")
  const entities = entitiesParam ? entitiesParam.split(",").map((s) => s.trim()) : [...DEFAULT_ENTITIES]

  // Source attribution
  let source: SyncSource = "manual"
  const explicit = sp.get("source") as SyncSource | null
  if (explicit && ["manual", "cron", "backfill", "webhook-replay"].includes(explicit)) {
    source = explicit
  } else if (sp.get("manual") === "true") {
    source = "manual"
  } else if (request.headers.get("x-vercel-cron")) {
    source = "cron"
  }

  const baseUrl = resolveBaseUrl(request)
  const results: Record<string, any> = {}
  const errors: string[] = []
  const supabase = tryCreateAdminClient()

  // ---- Sync log: open ------------------------------------------------------
  let syncLogId: string | null = null
  if (supabase) {
    const { data: row } = await supabase
      .from("sync_log")
      .insert({
        sync_type: incremental ? "incremental" : "full",
        sync_direction: "karbon_to_supabase",
        status: "running",
        is_manual: source === "manual",
        started_at: new Date().toISOString(),
        error_details: { source, entities, expand },
      })
      .select("id")
      .single()
    syncLogId = row?.id || null
  }

  // ---- Webhook backlog snapshot (pre) -------------------------------------
  // If there are many unprocessed events, the sync may overwrite stale rows
  // before the events are replayed. We surface this so callers can decide.
  let webhookBacklog: { pending: number; failed: number } | null = null
  if (supabase) {
    const [{ count: pending }, { count: failed }] = await Promise.all([
      supabase
        .from("karbon_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("processing_status", "pending"),
      supabase
        .from("karbon_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("processing_status", "failed"),
    ])
    webhookBacklog = { pending: pending || 0, failed: failed || 0 }
  }

  // ---- Fan-out helper ------------------------------------------------------
  async function syncEntity(name: string, path: string, extraQs = "") {
    try {
      const url = `${baseUrl}${path}?import=true&incremental=${incremental}${extraQs}`
      const res = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...(process.env.CRON_SECRET ? { "x-internal-secret": process.env.CRON_SECRET } : {}),
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }))
        const msg = data.error || res.statusText
        errors.push(`${name}: ${msg}`)
        return { error: msg }
      }
      const data = await res.json()
      return data.importResult || { synced: data.count || 0 }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${name}: ${msg}`)
      return { error: msg }
    }
  }

  // ---- Execute in dependency order ----------------------------------------
  // users → contacts/organizations → client-groups → work-items → tasks/timesheets/invoices
  const expandQs = expand ? "&expand=true" : ""

  if (entities.includes("users")) results.users = await syncEntity("users", "/api/karbon/users")
  if (entities.includes("contacts")) results.contacts = await syncEntity("contacts", "/api/karbon/contacts", expandQs)
  if (entities.includes("organizations"))
    results.organizations = await syncEntity("organizations", "/api/karbon/organizations", expandQs)
  if (entities.includes("client-groups"))
    results.clientGroups = await syncEntity("client-groups", "/api/karbon/client-groups")
  if (entities.includes("work-items")) results.workItems = await syncEntity("work-items", "/api/karbon/work-items")
  if (entities.includes("tasks")) results.tasks = await syncEntity("tasks", "/api/karbon/tasks")
  if (entities.includes("timesheets")) results.timesheets = await syncEntity("timesheets", "/api/karbon/timesheets")
  if (entities.includes("invoices")) results.invoices = await syncEntity("invoices", "/api/karbon/invoices")
  if (entities.includes("work-statuses") || !entitiesParam)
    results.workStatuses = await syncEntity("work-statuses", "/api/karbon/work-statuses", "&sync=true")

  const duration = Date.now() - startTime
  const totalSynced = Object.values(results).reduce((s: number, r: any) => s + (r?.synced || 0), 0)
  const totalErrors = Object.values(results).reduce((s: number, r: any) => s + (r?.errors || 0), 0)

  // ---- Sync log: close -----------------------------------------------------
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
        error_message: errors.length > 0 ? errors.slice(0, 5).join("; ").slice(0, 1000) : null,
        error_details: { source, entities, expand, errors, results, webhookBacklog },
      })
      .eq("id", syncLogId)
  }

  return NextResponse.json({
    success: errors.length === 0,
    source,
    syncType: incremental ? "incremental" : "full",
    expandedDetails: expand,
    duration: `${(duration / 1000).toFixed(2)}s`,
    syncLogId,
    summary: { totalSynced, totalErrors, entitiesSynced: entities.length },
    webhookBacklog,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  })
}
