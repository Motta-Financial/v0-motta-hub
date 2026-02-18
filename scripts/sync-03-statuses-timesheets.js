import fetch from "node-fetch"

const KARBON_BASE = "https://api.karbonhq.com/v3"
const KARBON_HEADERS = {
  "Authorization": "Bearer " + process.env.KARBON_BEARER_TOKEN,
  "AccessKey": process.env.KARBON_ACCESS_KEY,
  "Accept": "application/json",
}
const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function karbonFetchAll(endpoint) {
  var all = []
  var url = KARBON_BASE + endpoint
  var page = 0
  while (url) {
    page++
    console.log("  Fetching page " + page + "...")
    var res = await fetch(url, { headers: KARBON_HEADERS })
    if (!res.ok) { console.error("Karbon error: " + res.status + " " + (await res.text()).substring(0, 200)); break }
    var data = await res.json()
    var items = data.value || data
    if (Array.isArray(items)) all.push(...items)
    else if (items) all.push(items)
    url = data["@odata.nextLink"] || null
  }
  return all
}

async function sbUpsert(table, data, conflictCol) {
  var batchSize = 100
  var synced = 0, errors = 0
  for (var i = 0; i < data.length; i += batchSize) {
    var batch = data.slice(i, i + batchSize)
    var url = SB_URL + "/rest/v1/" + table + "?on_conflict=" + conflictCol
    var res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify(batch)
    })
    if (!res.ok) {
      var errText = await res.text()
      console.error("  Supabase error: " + errText.substring(0, 300))
      errors += batch.length
    } else {
      synced += batch.length
    }
  }
  return { synced: synced, errors: errors }
}

async function syncWorkStatuses() {
  console.log("\n=== SYNCING WORK STATUSES ===")
  var res = await fetch(KARBON_BASE + "/TenantSettings", { headers: KARBON_HEADERS })
  if (!res.ok) { console.error("Failed: " + res.status); return { synced: 0, errors: 0 } }
  var data = await res.json()

  // Flatten nested structure: Primary -> Children (Secondary with WorkStatusKey)
  var primaryStatuses = data.WorkStatuses || []
  var mapped = []
  var displayOrder = 0

  for (var p = 0; p < primaryStatuses.length; p++) {
    var primary = primaryStatuses[p]
    var children = primary.Children || []
    for (var c = 0; c < children.length; c++) {
      var child = children[c]
      if (!child.WorkStatusKey) continue
      var statusName = primary.Name + " - " + child.Name
      var isInactive = primary.Name.toLowerCase().indexOf("complet") >= 0 || primary.Name.toLowerCase().indexOf("cancel") >= 0

      mapped.push({
        karbon_status_key: child.WorkStatusKey,
        name: statusName,
        description: child.Name,
        status_type: primary.Name,
        primary_status_name: primary.Name,
        secondary_status_name: child.Name,
        work_type_keys: child.WorkTypeKeys || null,
        display_order: displayOrder,
        is_active: !isInactive,
        is_default_filter: !isInactive,
        updated_at: new Date().toISOString(),
      })
      displayOrder++
    }
  }

  console.log("Flattened " + mapped.length + " work statuses from " + primaryStatuses.length + " primary groups")
  return await sbUpsert("work_status", mapped, "karbon_status_key")
}

async function syncTimesheets() {
  console.log("\n=== SYNCING TIMESHEETS ===")
  var raw = await karbonFetchAll("/Timesheets")
  console.log("Fetched " + raw.length + " weekly timesheets from Karbon")

  // Each Timesheet is a weekly container. TimeEntries are nested if expanded,
  // otherwise we get the weekly summary. Try to get time entries.
  var mapped = []
  for (var t = 0; t < raw.length; t++) {
    var ts = raw[t]
    var entries = ts.TimeEntries || []
    if (entries.length > 0) {
      // Expanded - map each entry
      for (var e = 0; e < entries.length; e++) {
        var entry = entries[e]
        var entryDate = entry.Date ? entry.Date.split("T")[0] : "nodate"
        var key = entry.TimeEntryKey || (ts.TimesheetKey + "-" + entryDate + "-" + (entry.WorkItemKey || "nowi") + "-" + e)
        mapped.push({
          karbon_timesheet_key: key,
          date: entry.Date ? entry.Date.split("T")[0] : (ts.StartDate ? ts.StartDate.split("T")[0] : null),
          minutes: entry.Minutes || 0,
          description: entry.TaskTypeName || entry.Description || null,
          is_billable: entry.IsBillable !== false,
          billing_status: entry.BillingStatus || ts.Status || null,
          hourly_rate: entry.HourlyRate || null,
          billed_amount: entry.HourlyRate && entry.Minutes ? ((entry.HourlyRate * entry.Minutes) / 60) : null,
          user_key: entry.UserKey || ts.UserKey || null,
          user_name: entry.UserName || ts.UserName || null,
          karbon_work_item_key: entry.WorkItemKey || null,
          work_item_title: entry.WorkItemTitle || null,
          client_key: entry.ClientKey || null,
          client_name: entry.ClientName || null,
          task_key: entry.TaskTypeKey || entry.TaskKey || null,
          role_name: entry.RoleName || null,
          task_type_name: entry.TaskTypeName || null,
          timesheet_status: ts.Status || entry.Status || null,
          karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/timesheets/" + ts.TimesheetKey,
          karbon_created_at: ts.StartDate || entry.CreatedDate || null,
          karbon_modified_at: ts.EndDate || entry.LastModifiedDateTime || null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    } else {
      // No expanded entries - use the weekly timesheet itself as a single record
      mapped.push({
        karbon_timesheet_key: ts.TimesheetKey,
        date: ts.StartDate ? ts.StartDate.split("T")[0] : null,
        minutes: ts.TotalMinutes || 0,
        description: "Weekly timesheet",
        is_billable: true,
        billing_status: ts.Status || null,
        hourly_rate: null,
        billed_amount: null,
        user_key: ts.UserKey || null,
        user_name: ts.UserName || null,
        karbon_work_item_key: null,
        work_item_title: null,
        client_key: null,
        client_name: null,
        task_key: null,
        role_name: null,
        task_type_name: null,
        timesheet_status: ts.Status || null,
        karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/timesheets/" + ts.TimesheetKey,
        karbon_created_at: ts.StartDate || null,
        karbon_modified_at: ts.EndDate || null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  console.log("Mapped " + mapped.length + " timesheet entries")
  return await sbUpsert("karbon_timesheets", mapped, "karbon_timesheet_key")
}

async function main() {
  console.log("========================================")
  console.log("KARBON SYNC Part 3: Statuses & Timesheets")
  console.log("========================================")
  var s = await syncWorkStatuses()
  console.log("Work Statuses: " + s.synced + " synced, " + s.errors + " errors")
  var t = await syncTimesheets()
  console.log("Timesheets: " + t.synced + " synced, " + t.errors + " errors")
  console.log("\n========================================")
  console.log("PART 3 COMPLETE")
  console.log("========================================")
}

main().catch(function(e) { console.error("FATAL:", e); process.exit(1) })
