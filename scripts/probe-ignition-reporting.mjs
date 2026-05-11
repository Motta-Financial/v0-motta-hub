/**
 * Hits every Ignition reporting endpoint, grabs the first page, prints:
 *   - HTTP status
 *   - the top-level shape (which key holds the array, pagination shape)
 *   - the field names of the first row
 *   - the first row's stringified content (first ~800 chars)
 *
 * This lets us fix mappers without guessing what Ignition actually returns.
 */
import pg from "pg"

const ENDPOINTS = [
  "/reporting/clients",
  "/reporting/contacts",
  "/reporting/deal_stages",
  "/reporting/deals",
  "/reporting/services",
  "/reporting/proposals",
  "/reporting/invoices",
  "/reporting/payments",
  "/reporting/collections",
]

const API_BASE = "https://developers.ignitionapp.com/external/api/v1"

async function main() {
  const client = new pg.Client({
    connectionString: process.env.POSTGRES_URL_NON_POOLING,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  const { rows } = await client.query(
    `select access_token, refresh_token, expires_at, token_type, scope from public.ignition_connections where singleton = true limit 1`,
  )
  await client.end()
  if (rows.length === 0) {
    console.error("No ignition connection row")
    process.exit(1)
  }
  const accessToken = rows[0].access_token
  const tokenType = rows[0].token_type || "Bearer"
  console.log(`Using ${tokenType} token, expires ${rows[0].expires_at}, scope=${rows[0].scope}`)
  console.log("")

  for (const path of ENDPOINTS) {
    const url = `${API_BASE}${path}?page_size=2`
    process.stdout.write(`${path.padEnd(32)} `)
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `${tokenType} ${accessToken}`,
          Accept: "application/json",
        },
      })
      console.log(`HTTP ${res.status}`)
      const text = await res.text()
      if (!res.ok) {
        console.log("  body:", text.slice(0, 400))
        console.log("")
        continue
      }
      let json
      try {
        json = JSON.parse(text)
      } catch {
        console.log("  not JSON, body:", text.slice(0, 400))
        console.log("")
        continue
      }
      // Identify the array key
      const topKeys = Object.keys(json)
      console.log("  top-level keys:", topKeys.join(", "))
      let arr = null
      let arrKey = null
      if (Array.isArray(json)) {
        arr = json
        arrKey = "(root)"
      } else {
        for (const k of topKeys) {
          if (Array.isArray(json[k])) {
            arr = json[k]
            arrKey = k
            break
          }
        }
      }
      if (!arr) {
        console.log("  no array found, full body:", text.slice(0, 800))
        console.log("")
        continue
      }
      console.log(`  array key: ${arrKey}, length: ${arr.length}`)
      if (arr.length > 0) {
        const first = arr[0]
        console.log("  first row keys:", Object.keys(first).sort().join(", "))
        console.log("  first row sample:", JSON.stringify(first, null, 2).slice(0, 1200))
      }
      console.log("")
    } catch (err) {
      console.log(`  ERROR: ${err.message}`)
      console.log("")
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
