import fetch from "node-fetch"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function supabaseQuery(path) {
  var res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Accept": "application/json" },
  })
  return res.json()
}

async function supabasePost(table, data) {
  var res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json", "Prefer": "return=representation",
    },
    body: JSON.stringify(data),
  })
  return res.ok
}

async function main() {
  console.log("=== COMPREHENSIVE SYNC SUMMARY ===\n")

  // Count all tables
  var tables = [
    { name: "team_members", label: "Team Members / Users" },
    { name: "contacts", label: "Contacts" },
    { name: "organizations", label: "Organizations" },
    { name: "client_groups", label: "Client Groups" },
    { name: "work_status", label: "Work Statuses" },
    { name: "work_items", label: "Work Items" },
    { name: "karbon_timesheets", label: "Timesheets" },
    { name: "karbon_invoices", label: "Invoices" },
    { name: "karbon_tasks", label: "Tasks" },
    { name: "karbon_notes", label: "Notes" },
  ]

  var totalRecords = 0
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i]
    var data = await supabaseQuery(t.name + "?select=id&limit=1&offset=0")
    // Use HEAD with Prefer: count=exact for accurate counts
    var countRes = await fetch(SUPABASE_URL + "/rest/v1/" + t.name + "?select=id", {
      method: "HEAD",
      headers: {
        "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
        "Prefer": "count=exact",
      },
    })
    var range = countRes.headers.get("content-range") || ""
    var count = range.split("/")[1] || "?"
    console.log("  " + t.label + ": " + count + " records")
    if (count !== "?" && count !== "*") totalRecords += parseInt(count)
  }

  console.log("\n  TOTAL: " + totalRecords + " records across all tables")

  // Log the sync
  await supabasePost("sync_log", {
    sync_type: "comprehensive_manual",
    status: "completed",
    records_fetched: totalRecords,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    details: {
      synced_entities: ["users", "contacts", "organizations", "client_groups", "work_statuses", "work_items", "timesheets", "invoices"],
      skipped_entities: ["tasks (IntegrationTasks requires elevated API permissions)", "notes (no Karbon list endpoint - webhook-only)"],
      timestamp: new Date().toISOString(),
    },
  })

  console.log("\n  Sync log entry created.")

  console.log("\n  NOTE: Tasks and Notes could not be bulk-synced:")
  console.log("    - Tasks: Karbon IntegrationTasks endpoint returns 401 (needs elevated permissions)")
  console.log("    - Notes: Karbon has no list endpoint for Notes (single-fetch by NoteKey only)")
  console.log("    - Both are populated via Karbon webhooks when created/updated in Karbon")

  console.log("\n=== SYNC COMPLETE ===")
}

main()
