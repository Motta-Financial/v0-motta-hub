console.log("Step 1: env check")
var AK = process.env.KARBON_ACCESS_KEY
var BT = process.env.KARBON_BEARER_TOKEN
var SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
console.log("AK:", AK ? "set" : "missing")
console.log("BT:", BT ? "set" : "missing")
console.log("SB:", SB_URL ? "set" : "missing")
console.log("KEY:", SB_KEY ? "set" : "missing")

console.log("\nStep 2: fetch test")
async function main() {
  var r = await fetch("https://api.karbonhq.com/v3/Users", {
    headers: { Authorization: "Bearer " + BT, AccessKey: AK, Accept: "application/json" }
  })
  console.log("Status:", r.status)
  var d = await r.json()
  var items = d.value || d || []
  console.log("Users count:", items.length)
  if (items.length > 0) console.log("First user keys:", Object.keys(items[0]).join(", "))

  console.log("\nStep 3: supabase test")
  var r2 = await fetch(SB_URL + "/rest/v1/team_members?select=id,karbon_user_key,email&limit=3", {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
  })
  console.log("SB Status:", r2.status)
  var d2 = await r2.json()
  console.log("SB records:", JSON.stringify(d2).substring(0, 300))

  console.log("\nDone!")
}
main().catch(function(e) { console.error("ERROR:", e.message) })
