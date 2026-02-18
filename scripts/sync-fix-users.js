var SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
var BT = process.env.KARBON_BEARER_TOKEN
var AK = process.env.KARBON_ACCESS_KEY

async function main() {
  console.log("=== Step 1: Update existing team_members with karbon_user_key ===")

  // Get Karbon users
  var r = await fetch("https://api.karbonhq.com/v3/Users", {
    headers: { Authorization: "Bearer " + BT, AccessKey: AK, Accept: "application/json" },
  })
  var d = await r.json()
  var users = d.value || d || []
  console.log("Karbon users: " + users.length)

  // For each user, update the existing team_member by email
  var updated = 0
  var inserted = 0
  for (var u of users) {
    var key = u.UserKey || u.MemberKey || u.Id
    var email = u.EmailAddress || u.Email
    if (!key || !email) continue

    var parts = (u.Name || "").split(" ")
    var fn = u.FirstName || parts[0] || ""
    var ln = u.LastName || parts.slice(1).join(" ") || ""

    // Try to PATCH existing record by email
    var patchRes = await fetch(SB_URL + "/rest/v1/team_members?email=ilike." + encodeURIComponent(email), {
      method: "PATCH",
      headers: {
        apikey: SB_KEY, Authorization: "Bearer " + SB_KEY,
        "Content-Type": "application/json", Prefer: "return=minimal",
      },
      body: JSON.stringify({
        karbon_user_key: key,
        first_name: fn || null,
        last_name: ln || null,
        full_name: u.FullName || u.Name || [fn, ln].filter(Boolean).join(" ") || null,
        is_active: u.IsActive !== false,
        karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/team/" + key,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    })

    if (patchRes.ok) {
      // Check if anything was actually patched (content-range header)
      var range = patchRes.headers.get("content-range")
      if (range && range !== "*/0" && range !== "0-0/0") {
        updated++
        console.log("  UPDATED: " + email + " -> key=" + key)
      } else {
        // No matching record found, INSERT new one
        var insRes = await fetch(SB_URL + "/rest/v1/team_members", {
          method: "POST",
          headers: {
            apikey: SB_KEY, Authorization: "Bearer " + SB_KEY,
            "Content-Type": "application/json", Prefer: "return=minimal",
          },
          body: JSON.stringify({
            karbon_user_key: key,
            first_name: fn || null,
            last_name: ln || null,
            full_name: u.FullName || u.Name || [fn, ln].filter(Boolean).join(" ") || null,
            email: email,
            is_active: u.IsActive !== false,
            karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/team/" + key,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        })
        if (insRes.ok) {
          inserted++
          console.log("  INSERTED: " + email + " -> key=" + key)
        } else {
          var errT = await insRes.text()
          console.log("  INSERT ERR: " + email + " " + insRes.status + " " + errT.substring(0, 200))
        }
      }
    } else {
      var errT = await patchRes.text()
      console.log("  PATCH ERR: " + email + " " + patchRes.status + " " + errT.substring(0, 200))
    }
  }

  console.log("\nDone: " + updated + " updated, " + inserted + " inserted")

  // Handle remaining members without karbon keys
  console.log("\n=== Step 2: Check remaining records ===")
  var r2 = await fetch(SB_URL + "/rest/v1/team_members?karbon_user_key=is.null&select=id,email,full_name", {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
  })
  var orphans = await r2.json()
  console.log("Records still without karbon_user_key: " + orphans.length)
  for (var o of orphans) {
    console.log("  " + (o.email || "no-email") + " | " + (o.full_name || ""))
  }
}

main().catch(function(e) { console.error("FATAL: " + e.message) })
