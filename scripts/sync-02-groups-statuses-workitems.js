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
      console.error("  Supabase error batch " + Math.floor(i/batchSize) + ": " + errText.substring(0, 300))
      errors += batch.length
    } else {
      synced += batch.length
    }
  }
  return { synced: synced, errors: errors }
}

async function syncClientGroups() {
  console.log("\n=== SYNCING CLIENT GROUPS ===")
  var raw = await karbonFetchAll("/ClientGroups")
  console.log("Fetched " + raw.length + " client groups from Karbon")

  var mapped = raw.map(function(g) {
    return {
      karbon_client_group_key: g.ClientGroupKey,
      name: g.FullName || g.Name || ("Group " + g.ClientGroupKey),
      description: g.EntityDescription || g.Description || null,
      group_type: g.ContactType || g.GroupType || null,
      contact_type: g.ContactType || null,
      primary_contact_key: g.PrimaryContactKey || null,
      primary_contact_name: g.PrimaryContactName || null,
      client_owner_key: g.ClientOwner || null,
      client_owner_name: g.ClientOwnerName || null,
      client_manager_key: g.ClientManager || null,
      client_manager_name: g.ClientManagerName || null,
      members: g.Members || [],
      restriction_level: g.RestrictionLevel || "Public",
      user_defined_identifier: g.UserDefinedIdentifier || null,
      entity_description: g.EntityDescription || null,
      karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/client-groups/" + g.ClientGroupKey,
      karbon_created_at: g.CreatedDate || null,
      karbon_modified_at: g.LastModifiedDateTime || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  return await sbUpsert("client_groups", mapped, "karbon_client_group_key")
}

async function syncWorkStatuses() {
  console.log("\n=== SYNCING WORK STATUSES ===")
  var res = await fetch(KARBON_BASE + "/TenantSettings", { headers: KARBON_HEADERS })
  if (!res.ok) { console.error("Failed to fetch TenantSettings: " + res.status); return { synced: 0, errors: 0 } }
  var data = await res.json()

  // TenantSettings returns WorkStatuses nested in the response
  var statuses = data.WorkStatuses || data.value || []
  if (!Array.isArray(statuses)) statuses = []
  console.log("Fetched " + statuses.length + " work statuses")

  // Filter to only items with a valid key
  var valid = statuses.filter(function(s) { return s.WorkStatusKey })
  console.log("Valid statuses with keys: " + valid.length)

  var mapped = valid.map(function(s, idx) {
    var name = (s.PrimaryStatusName || "Unknown")
    if (s.SecondaryStatusName) name = name + " - " + s.SecondaryStatusName
    var isInactive = name.toLowerCase().indexOf("complet") >= 0 || name.toLowerCase().indexOf("cancel") >= 0

    return {
      karbon_status_key: s.WorkStatusKey,
      name: name,
      description: s.SecondaryStatusName || null,
      status_type: s.PrimaryStatusName || null,
      primary_status_name: s.PrimaryStatusName || null,
      secondary_status_name: s.SecondaryStatusName || null,
      work_type_keys: s.WorkTypeKeys || null,
      display_order: idx,
      is_active: !isInactive,
      is_default_filter: !isInactive,
      updated_at: new Date().toISOString(),
    }
  })

  return await sbUpsert("work_status", mapped, "karbon_status_key")
}

function parseTaxYear(item) {
  if (item.TaxYear) return item.TaxYear
  if (item.YearEnd) {
    var yr = new Date(item.YearEnd).getFullYear()
    if (yr > 2000 && yr < 2100) return yr
  }
  if (item.Title) {
    var m = item.Title.match(/\b(20\d{2})\b/)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

async function syncWorkItems() {
  console.log("\n=== SYNCING WORK ITEMS ===")
  var raw = await karbonFetchAll("/WorkItems")
  console.log("Fetched " + raw.length + " work items from Karbon")

  var mapped = raw.map(function(w) {
    var fee = w.FeeSettings || {}
    return {
      karbon_work_item_key: w.WorkItemKey,
      karbon_client_key: w.ClientKey || null,
      client_type: w.ClientType || null,
      client_name: w.ClientName || null,
      client_owner_key: w.ClientOwnerKey || null,
      client_owner_name: w.ClientOwnerName || null,
      client_group_key: w.RelatedClientGroupKey || w.ClientGroupKey || null,
      client_group_name: w.RelatedClientGroupName || null,
      assignee_key: w.AssigneeKey || null,
      assignee_name: w.AssigneeName || null,
      client_manager_key: w.ClientManagerKey || null,
      client_manager_name: w.ClientManagerName || null,
      client_partner_key: w.ClientPartnerKey || null,
      client_partner_name: w.ClientPartnerName || null,
      title: w.Title || null,
      description: w.Description || null,
      work_type: w.WorkType || null,
      workflow_status: w.WorkStatus || null,
      status: w.PrimaryStatus || null,
      status_code: w.SecondaryStatus || null,
      primary_status: w.PrimaryStatus || null,
      secondary_status: w.SecondaryStatus || null,
      work_status_key: w.WorkStatusKey || null,
      user_defined_identifier: w.UserDefinedIdentifier || null,
      start_date: w.StartDate ? w.StartDate.split("T")[0] : null,
      due_date: w.DueDate ? w.DueDate.split("T")[0] : null,
      completed_date: w.CompletedDate ? w.CompletedDate.split("T")[0] : null,
      year_end: w.YearEnd ? w.YearEnd.split("T")[0] : null,
      tax_year: parseTaxYear(w),
      period_start: w.PeriodStart ? w.PeriodStart.split("T")[0] : null,
      period_end: w.PeriodEnd ? w.PeriodEnd.split("T")[0] : null,
      internal_due_date: w.InternalDueDate ? w.InternalDueDate.split("T")[0] : null,
      regulatory_deadline: w.RegulatoryDeadline ? w.RegulatoryDeadline.split("T")[0] : null,
      client_deadline: w.ClientDeadline ? w.ClientDeadline.split("T")[0] : null,
      extension_date: w.ExtensionDate ? w.ExtensionDate.split("T")[0] : null,
      work_template_key: w.WorkTemplateKey || null,
      work_template_name: w.WorkTemplateTitle || w.WorkTemplateTile || null,
      fee_type: fee.FeeType || null,
      estimated_fee: fee.FeeValue || null,
      fixed_fee_amount: fee.FeeType === "Fixed" ? fee.FeeValue : null,
      hourly_rate: fee.FeeType === "Hourly" ? fee.FeeValue : null,
      estimated_minutes: w.EstimatedBudgetMinutes || null,
      actual_minutes: w.ActualBudget || null,
      billable_minutes: w.BillableTime || null,
      todo_count: w.TodoCount || 0,
      completed_todo_count: w.CompletedTodoCount || 0,
      has_blocking_todos: w.HasBlockingTodos || false,
      priority: w.Priority || "Normal",
      tags: w.Tags || [],
      is_recurring: w.IsRecurring || false,
      is_billable: w.IsBillable !== false,
      is_internal: w.IsInternal || false,
      custom_fields: w.CustomFields || {},
      related_work_keys: w.RelatedWorkKeys || [],
      karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/work/" + w.WorkItemKey,
      karbon_created_at: w.CreatedDate || w.CreatedDateTime || null,
      karbon_modified_at: w.LastModifiedDateTime || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  return await sbUpsert("work_items", mapped, "karbon_work_item_key")
}

async function main() {
  console.log("========================================")
  console.log("KARBON SYNC Part 2: Groups, Statuses, Work Items")
  console.log("========================================")
  var g = await syncClientGroups()
  console.log("Client Groups: " + g.synced + " synced, " + g.errors + " errors")
  var s = await syncWorkStatuses()
  console.log("Work Statuses: " + s.synced + " synced, " + s.errors + " errors")
  var w = await syncWorkItems()
  console.log("Work Items: " + w.synced + " synced, " + w.errors + " errors")
  console.log("\n========================================")
  console.log("PART 2 COMPLETE")
  console.log("========================================")
}

main().catch(function(e) { console.error("FATAL:", e); process.exit(1) })
