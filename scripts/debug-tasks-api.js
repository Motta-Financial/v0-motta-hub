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
  console.log("  " + url.replace(KARBON_BASE, "") + " => " + res.status)
  if (!res.ok) { console.log("    " + (await res.text()).substring(0, 200)); return null }
  return res.json()
}

async function main() {
  // Get 3 work item keys
  const wiRes = await fetch(SUPABASE_URL + "/rest/v1/work_items?select=karbon_work_item_key&karbon_work_item_key=not.is.null&limit=3", {
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Accept": "application/json" },
  })
  const wis = await wiRes.json()
  console.log("Sample work items:", JSON.stringify(wis))

  for (var i = 0; i < wis.length; i++) {
    var key = wis[i].karbon_work_item_key
    console.log("\n--- Work Item: " + key + " ---")

    // Try different task endpoint patterns
    var endpoints = [
      "/WorkItems('" + key + "')/Tasks",
      "/WorkItems('" + key + "')/TodoItems",
      "/WorkItems/" + key + "/Tasks",
      "/Tasks?$filter=WorkItemKey eq '" + key + "'",
      "/TodoItems?$filter=WorkItemKey eq '" + key + "'",
    ]

    for (var j = 0; j < endpoints.length; j++) {
      var data = await karbonFetch(KARBON_BASE + endpoints[j])
      if (data) {
        var items = data.value || data
        var count = Array.isArray(items) ? items.length : "not array"
        console.log("    Items: " + count)
        if (Array.isArray(items) && items.length > 0) {
          console.log("    Sample keys: " + JSON.stringify(Object.keys(items[0])))
          console.log("    Sample: " + JSON.stringify(items[0]).substring(0, 500))
        }
      }
    }
  }

  // Also try global endpoints
  console.log("\n--- Global endpoints ---")
  var globals = ["/Tasks?$top=3", "/TodoItems?$top=3", "/IntegrationTasks?$top=3"]
  for (var k = 0; k < globals.length; k++) {
    var data2 = await karbonFetch(KARBON_BASE + globals[k])
    if (data2) {
      var items2 = data2.value || data2
      var cnt = Array.isArray(items2) ? items2.length : "not array"
      console.log("  Items: " + cnt)
      if (Array.isArray(items2) && items2.length > 0) {
        console.log("  Sample keys: " + JSON.stringify(Object.keys(items2[0])))
        console.log("  Sample: " + JSON.stringify(items2[0]).substring(0, 500))
      }
    }
  }

  // Try notes too
  console.log("\n--- Notes endpoints ---")
  var noteEndpoints = ["/Notes?$top=3", "/WorkItems('" + wis[0].karbon_work_item_key + "')/Notes", "/Timelines?$top=3"]
  for (var m = 0; m < noteEndpoints.length; m++) {
    var data3 = await karbonFetch(KARBON_BASE + noteEndpoints[m])
    if (data3) {
      var items3 = data3.value || data3
      var cnt3 = Array.isArray(items3) ? items3.length : "not array"
      console.log("  Items: " + cnt3)
      if (Array.isArray(items3) && items3.length > 0) {
        console.log("  Sample keys: " + JSON.stringify(Object.keys(items3[0])))
      }
    }
  }
}

main()
