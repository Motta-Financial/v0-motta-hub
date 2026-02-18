const KARBON_BASE_URL = "https://api.karbonhq.com/v3"
const KARBON_ACCESS_KEY = process.env.KARBON_ACCESS_KEY
const KARBON_BEARER_TOKEN = process.env.KARBON_BEARER_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log("Env check:")
console.log("  KARBON_ACCESS_KEY:", KARBON_ACCESS_KEY ? "SET" : "MISSING")
console.log("  KARBON_BEARER_TOKEN:", KARBON_BEARER_TOKEN ? "SET" : "MISSING")
console.log("  SUPABASE_URL:", SUPABASE_URL ? "SET" : "MISSING")
console.log("  SUPABASE_KEY:", SUPABASE_KEY ? "SET" : "MISSING")

async function main() {
  // Test 1: Karbon Users
  console.log("\n--- Test 1: Fetch Karbon Users ---")
  try {
    const res = await fetch(`${KARBON_BASE_URL}/Users`, {
      headers: {
        Authorization: `Bearer ${KARBON_BEARER_TOKEN}`,
        AccessKey: KARBON_ACCESS_KEY,
        Accept: "application/json",
      },
    })
    console.log("Status:", res.status)
    if (res.ok) {
      const data = await res.json()
      const items = data.value || data || []
      console.log("Users count:", items.length)
      if (items.length > 0) {
        console.log("First user keys:", Object.keys(items[0]).join(", "))
        console.log("Sample:", JSON.stringify(items[0]).substring(0, 300))
      }
    } else {
      console.log("Error:", await res.text())
    }
  } catch (e) {
    console.log("Fetch error:", e.message)
  }

  // Test 2: Supabase team_members count
  console.log("\n--- Test 2: Supabase team_members count ---")
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/team_members?select=id&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "count=exact" },
    })
    console.log("Status:", res.status)
    console.log("Count header:", res.headers.get("content-range"))
  } catch (e) {
    console.log("Error:", e.message)
  }

  // Test 3: Upsert one user
  console.log("\n--- Test 3: Upsert test ---")
  try {
    const res = await fetch(`${KARBON_BASE_URL}/Users`, {
      headers: { Authorization: `Bearer ${KARBON_BEARER_TOKEN}`, AccessKey: KARBON_ACCESS_KEY, Accept: "application/json" },
    })
    const data = await res.json()
    const users = data.value || data || []
    if (users.length > 0) {
      const u = users[0]
      const mapped = {
        karbon_user_key: u.UserKey || u.MemberKey,
        first_name: u.FirstName || null,
        last_name: u.LastName || null,
        full_name: u.FullName || `${u.FirstName || ""} ${u.LastName || ""}`.trim() || null,
        email: u.EmailAddress || u.Email || null,
        is_active: u.IsActive !== false,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      console.log("Upserting:", JSON.stringify(mapped))
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([mapped]),
      })
      console.log("Upsert status:", upsertRes.status)
      if (!upsertRes.ok) {
        console.log("Upsert error:", await upsertRes.text())
      } else {
        console.log("Upsert SUCCESS")
      }
    }
  } catch (e) {
    console.log("Error:", e.message)
  }

  console.log("\n--- Done ---")
}

main().catch(e => console.error("FATAL:", e))
