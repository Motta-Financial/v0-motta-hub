var SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function main() {
  // Get all team members
  var r = await fetch(SB_URL + "/rest/v1/team_members?select=id,karbon_user_key,email,full_name&order=email&limit=50", {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
  })
  var data = await r.json()
  console.log("Team members in DB: " + data.length)
  for (var m of data) {
    console.log("  " + (m.karbon_user_key || "NULL_KEY") + " | " + (m.email || "NULL_EMAIL") + " | " + (m.full_name || ""))
  }

  // Get Karbon users
  console.log("\nKarbon Users:")
  var r2 = await fetch("https://api.karbonhq.com/v3/Users", {
    headers: { Authorization: "Bearer " + process.env.KARBON_BEARER_TOKEN, AccessKey: process.env.KARBON_ACCESS_KEY, Accept: "application/json" },
  })
  var d2 = await r2.json()
  var users = d2.value || d2 || []
  for (var u of users) {
    var key = u.UserKey || u.MemberKey || u.Id
    console.log("  " + key + " | " + (u.EmailAddress || u.Email || "none") + " | " + (u.Name || u.FullName || ""))
  }
}
main().catch(function(e) { console.error(e) })
