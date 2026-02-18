import fetch from "node-fetch"

const KARBON_BASE = "https://api.karbonhq.com/v3"
const KARBON_HEADERS = {
  "Authorization": "Bearer " + process.env.KARBON_BEARER_TOKEN,
  "AccessKey": process.env.KARBON_ACCESS_KEY,
  "Accept": "application/json",
}

async function main() {
  console.log("=== Debugging Work Statuses ===")
  var res = await fetch(KARBON_BASE + "/TenantSettings", { headers: KARBON_HEADERS })
  console.log("Status: " + res.status)
  var data = await res.json()
  console.log("\nTop-level keys:", Object.keys(data))
  
  // Check different nesting patterns
  if (data.WorkStatuses) {
    console.log("\ndata.WorkStatuses type:", typeof data.WorkStatuses, "isArray:", Array.isArray(data.WorkStatuses))
    if (Array.isArray(data.WorkStatuses) && data.WorkStatuses.length > 0) {
      console.log("First status keys:", Object.keys(data.WorkStatuses[0]))
      console.log("First status:", JSON.stringify(data.WorkStatuses[0], null, 2))
    }
  }
  if (data.value) {
    console.log("\ndata.value type:", typeof data.value, "isArray:", Array.isArray(data.value))
  }
  
  // Print full structure truncated
  var str = JSON.stringify(data, null, 2)
  console.log("\nFull response (first 3000 chars):")
  console.log(str.substring(0, 3000))
}

main().catch(function(e) { console.error("FATAL:", e) })
