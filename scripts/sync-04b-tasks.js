import fetch from "node-fetch"

const KARBON_BASE = "https://api.karbonhq.com/v3"
const KARBON_ACCESS_KEY = process.env.KARBON_ACCESS_KEY
const KARBON_BEARER_TOKEN = process.env.KARBON_BEARER_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function karbonFetch(url) {
  const res = await fetch(url, {
    headers: { "Authorization": "Bearer " + KARBON_BEARER_TOKEN, "AccessKey": KARBON_ACCESS_KEY, "Accept": "application/json" },
  })
  if (!res.ok) return null
  return res.json()
}

async function supabaseUpsert(table, records, conflictCol) {
  if (!records.length) return { ok: 0, err: 0 }
  let ok = 0, err = 0
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100)
    const url = SUPABASE_URL + "/rest/v1/" + table + "?on_conflict=" + conflictCol
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    })
    if (res.ok) { ok += batch.length }
    else {
      const t = await res.text()
      console.log("  Upsert err: " + t.substring(0, 200))
      err += batch.length
    }
  }
  return { ok, err }
}

async function main() {
  console.log("=== SYNC TASKS (per work item) ===")

  // Get all work item keys from Supabase
  const wiRes = await fetch(SUPABASE_URL + "/rest/v1/work_items?select=karbon_work_item_key&karbon_work_item_key=not.is.null&limit=5000", {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Accept": "application/json" },
  })
  const workItems = await wiRes.json()
  const wiKeys = workItems.map(function(w) { return w.karbon_work_item_key }).filter(Boolean)
  console.log("Found " + wiKeys.length + " work items to fetch tasks for")

  var allTasks = []
  var processed = 0
  var errors = 0

  // Process in batches of 10 concurrently
  for (let i = 0; i < wiKeys.length; i += 10) {
    const batch = wiKeys.slice(i, i + 10)
    const promises = batch.map(function(wiKey) {
      return karbonFetch(KARBON_BASE + "/WorkItems('" + wiKey + "')/Tasks")
        .then(function(data) {
          if (!data) return []
          var items = data.value || data || []
          if (!Array.isArray(items)) return []
          return items.map(function(t) {
            var taskKey = t.TaskKey || t.Key || (wiKey + "-" + (t.TaskIndex || t.Index || Math.random()))
            return {
              karbon_task_key: String(taskKey),
              task_definition_key: t.TaskDefinitionKey || null,
              title: (t.Data && t.Data.Title) || t.Title || null,
              description: (t.Data && t.Data.Description) || t.Description || null,
              status: t.Status || null,
              priority: (t.Data && t.Data.Priority) || t.Priority || "Normal",
              due_date: (t.Data && t.Data.DueDate) ? t.Data.DueDate.split("T")[0] : (t.DueDate ? t.DueDate.split("T")[0] : null),
              completed_date: (t.Data && t.Data.CompletedDate) ? t.Data.CompletedDate.split("T")[0] : (t.CompletedDate ? t.CompletedDate.split("T")[0] : null),
              assignee_key: (t.Data && t.Data.AssigneeKey) || t.AssigneeKey || null,
              assignee_name: (t.Data && t.Data.AssigneeName) || t.AssigneeName || null,
              assignee_email: (t.Data && t.Data.AssigneeEmailAddress) || t.AssigneeEmailAddress || null,
              karbon_work_item_key: wiKey,
              karbon_contact_key: t.WorkItemClientKey || t.ContactKey || null,
              is_blocking: (t.Data && t.Data.IsBlocking) || false,
              estimated_minutes: (t.Data && t.Data.EstimatedMinutes) || null,
              actual_minutes: (t.Data && t.Data.ActualMinutes) || null,
              task_data: t.Data || null,
              karbon_url: taskKey ? "https://app2.karbonhq.com/4mTyp9lLRWTC#/tasks/" + taskKey : null,
              karbon_created_at: t.CreatedAt || t.CreatedDate || null,
              karbon_modified_at: t.UpdatedAt || t.LastModifiedDateTime || null,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          })
        })
        .catch(function() { errors++; return [] })
    })
    const results = await Promise.all(promises)
    results.forEach(function(tasks) { allTasks = allTasks.concat(tasks) })
    processed += batch.length
    if (processed % 100 === 0 || processed === wiKeys.length) {
      console.log("  Processed " + processed + "/" + wiKeys.length + " work items, " + allTasks.length + " tasks so far")
    }
  }

  console.log("Total tasks fetched: " + allTasks.length + " (API errors on " + errors + " work items)")

  if (allTasks.length > 0) {
    var result = await supabaseUpsert("karbon_tasks", allTasks, "karbon_task_key")
    console.log("Tasks: " + result.ok + " synced, " + result.err + " errors")
  }

  console.log("=== DONE ===")
}

main()
