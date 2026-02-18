const BASE = "https://api.karbonhq.com/v3"
const AK = process.env.KARBON_ACCESS_KEY
const BT = process.env.KARBON_BEARER_TOKEN
const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function main() {
  console.log("=== Syncing Users ===")

  // Fetch users from Karbon
  const res = await fetch(BASE + "/Users", {
    headers: { Authorization: "Bearer " + BT, AccessKey: AK, Accept: "application/json" },
  })
  const data = await res.json()
  const users = data.value || data || []
  console.log("Fetched " + users.length + " users")

  // Dedupe by Id AND email
  const seenKeys = new Set()
  const seenEmails = new Set()
  const deduped = []
  for (const u of users) {
    const key = u.UserKey || u.MemberKey || u.Id
    const email = (u.EmailAddress || u.Email || "").toLowerCase()
    if (!key) continue
    if (seenKeys.has(key)) continue
    if (email && seenEmails.has(email)) continue
    seenKeys.add(key)
    if (email) seenEmails.add(email)
    deduped.push(u)
  }
  console.log("Deduped to " + deduped.length + " users")

  // Map
  const mapped = deduped.map(function(u) {
    var key = u.UserKey || u.MemberKey || u.Id
    var parts = (u.Name || "").split(" ")
    var fn = u.FirstName || parts[0] || ""
    var ln = u.LastName || parts.slice(1).join(" ") || ""
    return {
      karbon_user_key: key,
      first_name: fn || null,
      last_name: ln || null,
      full_name: u.FullName || u.Name || [fn, ln].filter(Boolean).join(" ") || null,
      email: u.EmailAddress || u.Email || null,
      is_active: u.IsActive !== false,
      karbon_url: key ? "https://app2.karbonhq.com/4mTyp9lLRWTC#/team/" + key : null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  console.log("Upserting " + mapped.length + " users...")
  for (var i = 0; i < mapped.length; i += 50) {
    var batch = mapped.slice(i, i + 50)
    var r = await fetch(SB_URL + "/rest/v1/team_members", {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: "Bearer " + SB_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    })
    if (r.ok) {
      console.log("  Batch " + (Math.floor(i/50)+1) + ": " + batch.length + " OK")
    } else {
      var errText = await r.text()
      console.log("  Batch " + (Math.floor(i/50)+1) + " ERROR: " + r.status + " " + errText.substring(0, 300))
    }
  }

  console.log("\n=== Done ===")
}

main().catch(function(e) { console.error("FATAL: " + e.message) })
