/**
 * One-off backfill for the new tenant-config tables.
 *
 * Mirrors the logic in lib/karbon/sync-tenant-config.ts but as a standalone
 * .mjs so it can run via `node scripts/...` without the project's @/ alias
 * resolver.
 *
 * Run once after migration 038 is applied; thereafter the karbon-sync cron
 * runs the same logic every 4 hours.
 */
import { createClient } from "@supabase/supabase-js"

const KARBON_BASE = "https://api.karbonhq.com/v3"

function inferDefaultActiveFilter(primary, secondary) {
  const haystack = `${primary} ${secondary || ""}`.toLowerCase()
  const inactive = [
    "completed", "cancelled", "canceled", "on hold", "archived",
    "closed", "deferred", "not applicable", "n/a", "deleted",
  ]
  return !inactive.some((m) => haystack.includes(m))
}

async function karbonGet(path) {
  const url = `${KARBON_BASE}${path}`
  const res = await fetch(url, {
    headers: {
      AccessKey: process.env.KARBON_ACCESS_KEY,
      Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) throw new Error(`Karbon ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function karbonGetAll(path) {
  const all = []
  let next = `${KARBON_BASE}${path}`
  while (next) {
    const res = await fetch(next, {
      headers: {
        AccessKey: process.env.KARBON_ACCESS_KEY,
        Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
    })
    if (!res.ok) throw new Error(`Karbon ${path}: ${res.status} ${await res.text()}`)
    const json = await res.json()
    all.push(...(json.value || []))
    next = json["@odata.nextLink"] || null
  }
  return all
}

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  )

  console.log("[backfill] fetching /TenantSettings...")
  const tenant = await karbonGet("/TenantSettings")
  const groups = tenant.WorkStatuses || []
  const workTypes = tenant.WorkTypes || []
  console.log(`[backfill] got ${groups.length} primary status groups, ${workTypes.length} work types`)

  // Inverse map: secondaryStatusKey -> [workTypeKey]
  const inverse = new Map()
  for (const wt of workTypes) {
    for (const k of wt.AvailableStatuses?.Secondary || []) {
      const arr = inverse.get(k) || []
      arr.push(wt.WorkTypeKey)
      inverse.set(k, arr)
    }
  }

  // Flatten
  const flat = []
  for (const g of groups) {
    for (const c of g.Children || []) {
      flat.push({ key: c.WorkStatusKey, primary: g.Name, secondary: c.Name })
    }
  }

  // Existing rows to preserve admin overrides
  const { data: existingStatuses } = await sb
    .from("work_status")
    .select("karbon_status_key, is_default_filter, display_order")
  const existingMap = new Map(
    (existingStatuses || []).map((r) => [r.karbon_status_key, r]),
  )

  const nowIso = new Date().toISOString()
  const statusRecords = flat.map((row, idx) => {
    const prior = existingMap.get(row.key)
    const inferred = inferDefaultActiveFilter(row.primary, row.secondary)
    return {
      karbon_status_key: row.key,
      name: `${row.primary} - ${row.secondary}`,
      description: row.secondary,
      status_type: row.primary,
      primary_status_name: row.primary,
      secondary_status_name: row.secondary,
      work_type_keys: inverse.get(row.key) || [],
      display_order: prior?.display_order ?? idx,
      is_active: inferred,
      is_default_filter: prior ? prior.is_default_filter : inferred,
      updated_at: nowIso,
    }
  })

  console.log(`[backfill] upserting ${statusRecords.length} work_status rows...`)
  const { error: wsErr } = await sb
    .from("work_status")
    .upsert(statusRecords, { onConflict: "karbon_status_key", ignoreDuplicates: false })
  if (wsErr) throw new Error(`work_status upsert: ${wsErr.message}`)

  // Work types
  const { data: existingWT } = await sb
    .from("work_types")
    .select("karbon_work_type_key")
  const existingWTKeys = new Set((existingWT || []).map((r) => r.karbon_work_type_key))

  const wtNew = []
  const wtUpdate = []
  for (const wt of workTypes) {
    const row = {
      karbon_work_type_key: wt.WorkTypeKey,
      name: wt.Name,
      is_active: true,
      updated_at: nowIso,
    }
    if (existingWTKeys.has(wt.WorkTypeKey)) wtUpdate.push(row)
    else wtNew.push(row)
  }

  if (wtNew.length > 0) {
    console.log(`[backfill] inserting ${wtNew.length} new work_types...`)
    const { error } = await sb.from("work_types").insert(wtNew)
    if (error) throw new Error(`work_types insert: ${error.message}`)
  }
  for (const row of wtUpdate) {
    const { error } = await sb
      .from("work_types")
      .update({ name: row.name, is_active: row.is_active, updated_at: row.updated_at })
      .eq("karbon_work_type_key", row.karbon_work_type_key)
    if (error) throw new Error(`work_types update ${row.karbon_work_type_key}: ${error.message}`)
  }
  console.log(`[backfill] work_types: ${wtNew.length} new, ${wtUpdate.length} updated`)

  // Work templates
  console.log("[backfill] fetching /WorkTemplates...")
  const templates = await karbonGetAll("/WorkTemplates")
  console.log(`[backfill] got ${templates.length} templates`)

  const { data: existingT } = await sb
    .from("work_templates")
    .select("karbon_work_template_key, is_active")
  const existingTMap = new Map(
    (existingT || []).map((r) => [r.karbon_work_template_key, r.is_active]),
  )

  const liveKeys = new Set()
  const tplRecords = templates.map((tpl) => {
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
      raw_payload: tpl,
      updated_at: nowIso,
    }
  })

  if (tplRecords.length > 0) {
    const { error } = await sb
      .from("work_templates")
      .upsert(tplRecords, { onConflict: "karbon_work_template_key", ignoreDuplicates: false })
    if (error) throw new Error(`work_templates upsert: ${error.message}`)
  }

  // Soft-delete missing templates
  const stale = []
  for (const [key, isActive] of existingTMap) {
    if (!liveKeys.has(key) && isActive) stale.push(key)
  }
  if (stale.length > 0) {
    console.log(`[backfill] soft-deleting ${stale.length} stale templates`)
    const { error } = await sb
      .from("work_templates")
      .update({ is_active: false, updated_at: nowIso })
      .in("karbon_work_template_key", stale)
    if (error) throw new Error(`work_templates soft-delete: ${error.message}`)
  }

  // Log to sync_log
  await sb.from("sync_log").insert({
    sync_type: "tenant-config",
    sync_direction: "karbon_to_supabase",
    status: "success",
    records_fetched: flat.length + workTypes.length + templates.length,
    records_created: wtNew.length, // approximate
    records_updated: statusRecords.length + wtUpdate.length + tplRecords.length,
    records_failed: 0,
    error_details: { source: "manual-backfill" },
    started_at: nowIso,
    completed_at: new Date().toISOString(),
    is_manual: true,
  })

  console.log("\n[backfill] DONE")
  console.log(`  work_status:    ${statusRecords.length} synced`)
  console.log(`  work_types:     ${wtNew.length} new + ${wtUpdate.length} updated`)
  console.log(`  work_templates: ${tplRecords.length} synced (${stale.length} soft-deleted)`)
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})
