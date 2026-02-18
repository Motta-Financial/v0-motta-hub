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
    var res = await fetch(url, { headers: KARBON_HEADERS })
    if (!res.ok) break
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

// Get work item keys from Supabase
async function getWorkItemKeys() {
  var url = SB_URL + "/rest/v1/work_items?select=karbon_work_item_key&karbon_work_item_key=not.is.null&limit=5000"
  var res = await fetch(url, {
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }
  })
  if (!res.ok) { console.error("Failed to get work items"); return [] }
  var data = await res.json()
  return data.map(function(w) { return w.karbon_work_item_key })
}

async function syncTasks() {
  console.log("\n=== SYNCING TASKS (per work item) ===")
  var wiKeys = await getWorkItemKeys()
  console.log("Processing tasks for " + wiKeys.length + " work items...")
  
  var allTasks = []
  var processed = 0
  var taskless = 0
  
  for (var i = 0; i < wiKeys.length; i++) {
    var wk = wiKeys[i]
    try {
      var res = await fetch(KARBON_BASE + "/WorkItems(" + wk + ")/WorkItemTodos", { headers: KARBON_HEADERS })
      if (!res.ok) { taskless++; continue }
      var data = await res.json()
      var todos = data.value || data
      if (!Array.isArray(todos) || todos.length === 0) { taskless++; continue }
      
      for (var t = 0; t < todos.length; t++) {
        var task = todos[t]
        var taskKey = task.TodoKey || task.TaskKey || (wk + "-task-" + t)
        allTasks.push({
          karbon_task_key: taskKey,
          task_definition_key: task.TaskDefinitionKey || null,
          title: task.Title || task.Name || null,
          description: task.Description || null,
          status: task.Status || (task.IsComplete ? "Completed" : "Open"),
          priority: task.Priority || "Normal",
          due_date: task.DueDate ? task.DueDate.split("T")[0] : null,
          completed_date: task.CompletedDate ? task.CompletedDate.split("T")[0] : null,
          assignee_key: task.AssigneeKey || task.AssignedToUserKey || null,
          assignee_name: task.AssigneeName || null,
          assignee_email: task.AssigneeEmailAddress || null,
          karbon_work_item_key: wk,
          karbon_contact_key: task.ContactKey || null,
          is_blocking: task.IsBlocking || false,
          estimated_minutes: task.EstimatedMinutes || null,
          actual_minutes: task.ActualMinutes || null,
          task_data: task || null,
          karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/tasks/" + taskKey,
          karbon_created_at: task.CreatedAt || task.CreatedDate || null,
          karbon_modified_at: task.UpdatedAt || task.LastModifiedDateTime || null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    } catch (e) {
      // Skip errors for individual work items
    }
    processed++
    if (processed % 200 === 0) console.log("  Processed " + processed + "/" + wiKeys.length + " work items, " + allTasks.length + " tasks found...")
  }
  
  console.log("Found " + allTasks.length + " tasks across " + wiKeys.length + " work items (" + taskless + " had no tasks)")
  if (allTasks.length === 0) return { synced: 0, errors: 0 }
  return await sbUpsert("karbon_tasks", allTasks, "karbon_task_key")
}

async function syncNotes() {
  console.log("\n=== SYNCING NOTES (per work item) ===")
  var wiKeys = await getWorkItemKeys()
  console.log("Processing notes for " + wiKeys.length + " work items...")
  
  var allNotes = []
  var processed = 0
  
  for (var i = 0; i < wiKeys.length; i++) {
    var wk = wiKeys[i]
    try {
      var res = await fetch(KARBON_BASE + "/WorkItems(" + wk + ")/Notes", { headers: KARBON_HEADERS })
      if (!res.ok) continue
      var data = await res.json()
      var notes = data.value || data
      if (!Array.isArray(notes) || notes.length === 0) continue
      
      for (var n = 0; n < notes.length; n++) {
        var note = notes[n]
        if (!note.NoteKey) continue
        allNotes.push({
          karbon_note_key: note.NoteKey,
          subject: note.Subject || null,
          body: note.Body || null,
          note_type: note.NoteType || null,
          is_pinned: note.IsPinned || false,
          author_key: note.AuthorKey || null,
          author_name: note.AuthorName || null,
          assignee_email: note.AssigneeEmailAddress || null,
          due_date: note.DueDate ? note.DueDate.split("T")[0] : null,
          todo_date: note.TodoDate ? note.TodoDate.split("T")[0] : null,
          timelines: note.Timelines || null,
          comments: note.Comments || null,
          karbon_work_item_key: wk,
          work_item_title: note.WorkItemTitle || null,
          karbon_contact_key: note.ContactKey || null,
          contact_name: note.ContactName || null,
          karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/notes/" + note.NoteKey,
          karbon_created_at: note.CreatedDate || null,
          karbon_modified_at: note.LastModifiedDateTime || null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    } catch (e) {
      // Skip errors for individual work items  
    }
    processed++
    if (processed % 200 === 0) console.log("  Processed " + processed + "/" + wiKeys.length + " work items, " + allNotes.length + " notes found...")
  }
  
  console.log("Found " + allNotes.length + " notes across " + wiKeys.length + " work items")
  if (allNotes.length === 0) return { synced: 0, errors: 0 }
  return await sbUpsert("karbon_notes", allNotes, "karbon_note_key")
}

async function syncInvoices() {
  console.log("\n=== SYNCING INVOICES ===")
  var raw = await karbonFetchAll("/Invoices")
  console.log("Fetched " + raw.length + " invoices from Karbon")

  var mapped = raw.map(function(inv) {
    return {
      karbon_invoice_key: inv.InvoiceKey,
      invoice_number: inv.InvoiceNumber || null,
      status: inv.Status || null,
      issued_date: inv.InvoiceDate ? inv.InvoiceDate.split("T")[0] : (inv.IssuedDate ? inv.IssuedDate.split("T")[0] : null),
      due_date: inv.DueDate ? inv.DueDate.split("T")[0] : null,
      total_amount: inv.TotalAmount || inv.Amount || 0,
      amount_paid: inv.AmountPaid || 0,
      currency: inv.Currency || "USD",
      karbon_work_item_key: inv.WorkItemKey || null,
      karbon_client_key: inv.ClientKey || null,
      client_name: inv.ClientName || null,
      line_items: inv.LineItems || null,
      karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/invoices/" + inv.InvoiceKey,
      karbon_created_at: inv.CreatedDate || null,
      karbon_modified_at: inv.LastModifiedDateTime || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  return await sbUpsert("karbon_invoices", mapped, "karbon_invoice_key")
}

async function main() {
  console.log("========================================")
  console.log("KARBON SYNC Part 4: Tasks, Notes, Invoices")
  console.log("========================================")
  
  // Invoices first (fast, bulk endpoint)
  var inv = await syncInvoices()
  console.log("Invoices: " + inv.synced + " synced, " + inv.errors + " errors")
  
  // Tasks per work item (slower)
  var t = await syncTasks()
  console.log("Tasks: " + t.synced + " synced, " + t.errors + " errors")
  
  // Notes per work item (slower)
  var n = await syncNotes()
  console.log("Notes: " + n.synced + " synced, " + n.errors + " errors")
  
  console.log("\n========================================")
  console.log("PART 4 COMPLETE")
  console.log("========================================")
}

main().catch(function(e) { console.error("FATAL:", e); process.exit(1) })
