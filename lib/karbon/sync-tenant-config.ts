/**
 * Live sync for the three Karbon tenant-config entities Motta cares about:
 *
 *   1. WorkStatuses  — the firm's primary/secondary status taxonomy
 *                      (Karbon /v3/TenantSettings.WorkStatuses, ~115 rows)
 *   2. WorkTypes     — the firm's defined work types (e.g. "TAX | Individual
 *                      (1040)", "ACCT | Bookkeeping"). 41 rows.
 *                      (Karbon /v3/TenantSettings.WorkTypes)
 *   3. WorkTemplates — published work templates used to spin up new
 *                      work items. ~58 rows. (Karbon /v3/WorkTemplates)
 *
 * These rarely change, so the cron only invokes this every ~4 hours
 * (see app/api/cron/karbon-sync/route.ts). A manual sync can also be
 * triggered via /api/karbon/sync-tenant-config or via the existing
 * /api/karbon/work-statuses?sync=true endpoint (statuses only).
 *
 * ─────────────────────────────────────────────────────────────────────
 * IMPORTANT: Karbon's TenantSettings response shape changed
 * ─────────────────────────────────────────────────────────────────────
 * The previous parser (scripts/sync-work-statuses.ts and the old
 * /api/karbon/work-statuses route) expected a flat shape:
 *
 *   WorkStatuses: [{ WorkStatusKey, PrimaryStatusName, SecondaryStatusName, WorkTypeKeys[] }]
 *
 * Karbon now returns a nested tree:
 *
 *   WorkStatuses: [{
 *     Name: "Planned",        // primary
 *     Type: "Primary",
 *     Children: [{
 *       Name: "Lead | Calendly Sent",  // secondary
 *       Type: "Secondary",
 *       WorkStatusKey: "86xRxNnnvch"
 *     }, ...]
 *   }, ...]
 *
 * And the per-status WorkTypeKeys field is gone — now each WorkType
 * carries an inverse `AvailableStatuses.Secondary[]` list that we walk
 * to rebuild the mapping.
 */

import { karbonFetch, karbonFetchAll, type KarbonApiConfig } from "@/lib/karbon-api"
import type { SupabaseClient } from "@supabase/supabase-js"

// ─────────────────────────────────────────────────────────────────────
// Karbon API types
// ─────────────────────────────────────────────────────────────────────

interface KarbonChildStatus {
  Name: string
  Type: "Secondary"
  WorkStatusKey: string
}

interface KarbonPrimaryStatusGroup {
  Name: string
  Type: "Primary"
  Children: KarbonChildStatus[]
}

interface KarbonWorkType {
  Name: string
  WorkTypeKey: string
  AvailableStatuses?: {
    Primary?: string[]
    Secondary?: string[] // <- list of WorkStatusKeys (the secondary ones)
  }
}

interface KarbonTenantSettings {
  TenantKey?: string
  WorkStatuses?: KarbonPrimaryStatusGroup[]
  WorkTypes?: KarbonWorkType[]
  ContactTypes?: unknown[]
  FilingDeadlines?: unknown[]
}

interface KarbonWorkTemplate {
  WorkTemplateKey: string
  Title: string
  Description?: string | null
  WorkTypeKey?: string | null
  HasScheduledClientTaskGroups?: boolean
  EstimatedBudget?: number | null
  EstimatedTime?: number | null
  DraftHasChanges?: boolean
  PublishedDate?: string | null
  NumberOfWorkItemsCreated?: number | null
  DateLastWorkItemCreated?: string | null
  DateModified?: string | null
  ActorRoles?: Array<{ ActorKey: string; ActorName: string }>
}

// ─────────────────────────────────────────────────────────────────────
// Common result shape — every sync function returns this
// ─────────────────────────────────────────────────────────────────────

export interface SyncResult {
  ok: boolean
  fetched: number
  created: number
  updated: number
  deleted: number // soft-deletes only
  durationMs: number
  error?: string
}

const emptyResult = (): SyncResult => ({
  ok: true,
  fetched: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  durationMs: 0,
})

// ─────────────────────────────────────────────────────────────────────
// 1. Work Statuses + WorkType→Status mapping (single API call powers both)
// ─────────────────────────────────────────────────────────────────────

/**
 * Heuristic for whether a brand-new (never-seen) status should default
 * to being part of the "active work" filter on /admin/work-statuses.
 * Existing rows keep whatever the admin set — see preserveDefaultFilter
 * logic below.
 */
function inferDefaultActiveFilter(primaryName: string, secondaryName: string | null): boolean {
  const haystack = `${primaryName} ${secondaryName || ""}`.toLowerCase()
  const inactiveMarkers = [
    "completed",
    "cancelled",
    "canceled",
    "on hold",
    "archived",
    "closed",
    "deferred",
    "not applicable",
    "n/a",
    "deleted",
  ]
  return !inactiveMarkers.some((marker) => haystack.includes(marker))
}

/**
 * Fetch tenant settings once and sync both work_status and work_types.
 * Doing both from a single fetch keeps the inverse-mapping consistent
 * (work_status.work_type_keys is derived from work_types.AvailableStatuses).
 */
export async function syncWorkStatusesAndTypes(
  creds: KarbonApiConfig,
  db: SupabaseClient,
): Promise<{ workStatuses: SyncResult; workTypes: SyncResult }> {
  const t0 = Date.now()

  // Single fetch — TenantSettings is small (~50KB) so no need to parallelize
  const { data: tenant, error } = await karbonFetch<KarbonTenantSettings>("/TenantSettings", creds)
  if (error || !tenant) {
    const errResult: SyncResult = {
      ...emptyResult(),
      ok: false,
      error: error || "TenantSettings response was empty",
      durationMs: Date.now() - t0,
    }
    return { workStatuses: errResult, workTypes: { ...errResult } }
  }

  // Build inverse map: secondaryStatusKey -> [workTypeKey, …]
  const statusKeyToWorkTypeKeys = new Map<string, string[]>()
  for (const wt of tenant.WorkTypes || []) {
    for (const statusKey of wt.AvailableStatuses?.Secondary || []) {
      const arr = statusKeyToWorkTypeKeys.get(statusKey) || []
      arr.push(wt.WorkTypeKey)
      statusKeyToWorkTypeKeys.set(statusKey, arr)
    }
  }

  return {
    workStatuses: await upsertWorkStatuses(tenant.WorkStatuses || [], statusKeyToWorkTypeKeys, db, t0),
    workTypes: await upsertWorkTypes(tenant.WorkTypes || [], db, t0),
  }
}

async function upsertWorkStatuses(
  groups: KarbonPrimaryStatusGroup[],
  inverseMap: Map<string, string[]>,
  db: SupabaseClient,
  t0: number,
): Promise<SyncResult> {
  const result = emptyResult()

  // Flatten the nested tree to one row per Secondary status
  const flat: Array<{
    karbon_status_key: string
    primary_name: string
    secondary_name: string
  }> = []
  for (const group of groups) {
    for (const child of group.Children || []) {
      flat.push({
        karbon_status_key: child.WorkStatusKey,
        primary_name: group.Name,
        secondary_name: child.Name,
      })
    }
  }
  result.fetched = flat.length

  if (flat.length === 0) {
    result.durationMs = Date.now() - t0
    return result
  }

  // Pull existing rows so we can:
  //   (a) preserve `is_default_filter` on existing rows (admin-curated)
  //   (b) preserve `display_order` on existing rows (admin may have re-sorted)
  //   (c) detect new vs updated
  const { data: existing, error: existingErr } = await db
    .from("work_status")
    .select("karbon_status_key, is_default_filter, display_order")

  if (existingErr) {
    return { ...result, ok: false, error: existingErr.message, durationMs: Date.now() - t0 }
  }

  const existingByKey = new Map(
    (existing || []).map((row: any) => [
      row.karbon_status_key as string,
      { isDefaultFilter: row.is_default_filter as boolean, displayOrder: row.display_order as number | null },
    ]),
  )

  const nowIso = new Date().toISOString()
  const records = flat.map((row, idx) => {
    const prior = existingByKey.get(row.karbon_status_key)
    const isInferredActive = inferDefaultActiveFilter(row.primary_name, row.secondary_name)

    return {
      karbon_status_key: row.karbon_status_key,
      name: row.secondary_name
        ? `${row.primary_name} - ${row.secondary_name}`
        : row.primary_name,
      description: row.secondary_name || null,
      status_type: row.primary_name,
      primary_status_name: row.primary_name,
      secondary_status_name: row.secondary_name,
      work_type_keys: inverseMap.get(row.karbon_status_key) || [],
      // Preserve admin-curated display_order if present; otherwise use index.
      display_order: prior?.displayOrder ?? idx,
      is_active: isInferredActive,
      // Preserve admin-curated default filter on existing rows; new rows
      // get the heuristic-inferred default.
      is_default_filter: prior ? prior.isDefaultFilter : isInferredActive,
      updated_at: nowIso,
    }
  })

  result.created = records.filter((r) => !existingByKey.has(r.karbon_status_key)).length
  result.updated = records.length - result.created

  const { error: upsertErr } = await db
    .from("work_status")
    .upsert(records, { onConflict: "karbon_status_key", ignoreDuplicates: false })

  if (upsertErr) {
    return { ...result, ok: false, error: upsertErr.message, durationMs: Date.now() - t0 }
  }

  result.durationMs = Date.now() - t0
  return result
}

async function upsertWorkTypes(
  workTypes: KarbonWorkType[],
  db: SupabaseClient,
  t0: number,
): Promise<SyncResult> {
  const result = emptyResult()
  result.fetched = workTypes.length

  if (workTypes.length === 0) {
    result.durationMs = Date.now() - t0
    return result
  }

  // Pull existing rows so we can preserve admin-curated columns:
  // service_line_id, default_assignee_id, default_budget_minutes,
  // is_recurring, form_type, description, code.
  // We only ever overwrite from Karbon: name, karbon_work_type_key, is_active.
  const { data: existing, error: existingErr } = await db
    .from("work_types")
    .select("id, karbon_work_type_key")

  if (existingErr) {
    return { ...result, ok: false, error: existingErr.message, durationMs: Date.now() - t0 }
  }

  const existingByKey = new Map(
    (existing || []).map((row: any) => [row.karbon_work_type_key as string, row.id as string]),
  )

  const nowIso = new Date().toISOString()
  const records = workTypes.map((wt) => ({
    karbon_work_type_key: wt.WorkTypeKey,
    name: wt.Name,
    is_active: true,
    updated_at: nowIso,
  }))

  result.created = records.filter((r) => !existingByKey.has(r.karbon_work_type_key)).length
  result.updated = records.length - result.created

  // Two-step: insert new rows (full insert), update existing (only Karbon-owned cols).
  // This is the only reliable way in PostgREST to avoid clobbering null-able admin
  // columns like service_line_id with NULL on every sync.
  const newRows = records.filter((r) => !existingByKey.has(r.karbon_work_type_key))
  const updateRows = records.filter((r) => existingByKey.has(r.karbon_work_type_key))

  if (newRows.length > 0) {
    const { error: insertErr } = await db.from("work_types").insert(newRows)
    if (insertErr) {
      return { ...result, ok: false, error: `insert: ${insertErr.message}`, durationMs: Date.now() - t0 }
    }
  }

  for (const row of updateRows) {
    const { error: updateErr } = await db
      .from("work_types")
      .update({
        name: row.name,
        is_active: row.is_active,
        updated_at: row.updated_at,
      })
      .eq("karbon_work_type_key", row.karbon_work_type_key)
    if (updateErr) {
      return { ...result, ok: false, error: `update ${row.karbon_work_type_key}: ${updateErr.message}`, durationMs: Date.now() - t0 }
    }
  }

  result.durationMs = Date.now() - t0
  return result
}

// ─────────────────────────────────────────────────────────────────────
// 2. Work Templates (paginated /v3/WorkTemplates, ~58 rows)
// ─────────────────────────────────────────────────────────────────────

export async function syncWorkTemplates(
  creds: KarbonApiConfig,
  db: SupabaseClient,
): Promise<SyncResult> {
  const t0 = Date.now()
  const result = emptyResult()

  const { data: templates, error } = await karbonFetchAll<KarbonWorkTemplate>("/WorkTemplates", creds)
  if (error) {
    return { ...result, ok: false, error, durationMs: Date.now() - t0 }
  }

  result.fetched = templates.length

  // Pull existing keys so we can soft-delete templates that vanished from Karbon.
  const { data: existing, error: existingErr } = await db
    .from("work_templates")
    .select("karbon_work_template_key, is_active")

  if (existingErr) {
    return { ...result, ok: false, error: existingErr.message, durationMs: Date.now() - t0 }
  }

  const existingByKey = new Map(
    (existing || []).map((row: any) => [row.karbon_work_template_key as string, row.is_active as boolean]),
  )

  const nowIso = new Date().toISOString()
  const liveKeys = new Set<string>()

  const records = templates.map((tpl) => {
    liveKeys.add(tpl.WorkTemplateKey)
    return {
      karbon_work_template_key: tpl.WorkTemplateKey,
      title: tpl.Title,
      description: tpl.Description || null,
      karbon_work_type_key: tpl.WorkTypeKey || null,
      estimated_budget_minutes: tpl.EstimatedBudget ?? null,
      estimated_time_minutes: tpl.EstimatedTime ?? null,
      has_scheduled_client_task_groups: tpl.HasScheduledClientTaskGroups ?? null,
      draft_has_changes: tpl.DraftHasChanges ?? null,
      published_date: tpl.PublishedDate || null,
      date_modified: tpl.DateModified || null,
      number_of_work_items_created: tpl.NumberOfWorkItemsCreated ?? 0,
      date_last_work_item_created: tpl.DateLastWorkItemCreated || null,
      actor_roles: tpl.ActorRoles || [],
      is_active: true,
      last_synced_at: nowIso,
      raw_payload: tpl as unknown as Record<string, unknown>,
      updated_at: nowIso,
    }
  })

  result.created = records.filter((r) => !existingByKey.has(r.karbon_work_template_key)).length
  result.updated = records.length - result.created

  if (records.length > 0) {
    const { error: upsertErr } = await db
      .from("work_templates")
      .upsert(records, { onConflict: "karbon_work_template_key", ignoreDuplicates: false })

    if (upsertErr) {
      return { ...result, ok: false, error: upsertErr.message, durationMs: Date.now() - t0 }
    }
  }

  // Soft-delete templates that exist in our DB but not in Karbon's response.
  const staleKeys: string[] = []
  for (const [key, isActive] of existingByKey) {
    if (!liveKeys.has(key) && isActive) staleKeys.push(key)
  }
  if (staleKeys.length > 0) {
    const { error: softDeleteErr } = await db
      .from("work_templates")
      .update({ is_active: false, updated_at: nowIso })
      .in("karbon_work_template_key", staleKeys)
    if (softDeleteErr) {
      return { ...result, ok: false, error: `soft-delete: ${softDeleteErr.message}`, durationMs: Date.now() - t0 }
    }
    result.deleted = staleKeys.length
  }

  result.durationMs = Date.now() - t0
  return result
}

// ─────────────────────────────────────────────────────────────────────
// Top-level orchestrator + sync_log writer
// ─────────────────────────────────────────────────────────────────────

export interface TenantConfigSyncReport {
  ok: boolean
  startedAt: string
  durationMs: number
  workStatuses: SyncResult
  workTypes: SyncResult
  workTemplates: SyncResult
}

export async function syncKarbonTenantConfig(
  creds: KarbonApiConfig,
  db: SupabaseClient,
  options: { isManual?: boolean; triggeredById?: string | null; source?: string } = {},
): Promise<TenantConfigSyncReport> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  // Run statuses+types first (single fetch) then templates (separate fetch).
  // These don't depend on each other — could parallelize, but the rate limit
  // is generous and serial keeps the sync_log row clean.
  const { workStatuses, workTypes } = await syncWorkStatusesAndTypes(creds, db)
  const workTemplates = await syncWorkTemplates(creds, db)

  const report: TenantConfigSyncReport = {
    ok: workStatuses.ok && workTypes.ok && workTemplates.ok,
    startedAt,
    durationMs: Date.now() - t0,
    workStatuses,
    workTypes,
    workTemplates,
  }

  // Write to sync_log (best-effort — never throw if logging fails)
  try {
    await db.from("sync_log").insert({
      sync_type: "tenant-config",
      sync_direction: "karbon_to_supabase",
      status: report.ok ? "success" : "partial_failure",
      records_fetched:
        workStatuses.fetched + workTypes.fetched + workTemplates.fetched,
      records_created:
        workStatuses.created + workTypes.created + workTemplates.created,
      records_updated:
        workStatuses.updated + workTypes.updated + workTemplates.updated,
      records_failed: 0,
      error_message: report.ok
        ? null
        : [workStatuses.error, workTypes.error, workTemplates.error]
            .filter(Boolean)
            .join("; ") || null,
      error_details: {
        source: options.source || "manual",
        workStatuses,
        workTypes,
        workTemplates,
      },
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      is_manual: options.isManual ?? false,
      triggered_by_id: options.triggeredById ?? null,
    })
  } catch (e) {
    console.error("[tenant-config-sync] failed to write sync_log:", (e as Error).message)
  }

  return report
}
