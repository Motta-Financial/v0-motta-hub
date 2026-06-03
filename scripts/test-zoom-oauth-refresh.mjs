// Live canary test of per-user Zoom OAuth refresh under the (updated)
// Zoom OAuth app. Refreshes ONE connection, then immediately persists
// the rotated refresh_token + new access_token + expires_at + scope.
//
// Safety:
//   - Mirrors the app's persist logic (and ALSO fixes expires_at, which
//     lib/zoom-auth.ts currently forgets to update).
//   - On HTTP failure it DOES NOT mark the connection inactive — it just
//     reports, so a transient/test failure can't disable a teammate.
//   - Never prints token values.
//
// Usage: node test-zoom-oauth-refresh.mjs [zoom_email]   (default: first active)
import pg from "pg"

const EMAIL = process.argv[2] || null
const clientId = process.env.ZOOM_CLIENT_ID
const clientSecret = process.env.ZOOM_CLIENT_SECRET

function db() {
  let url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL).replace(/[?&]sslmode=[^&]+/, "")
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

async function main() {
  if (!clientId || !clientSecret) throw new Error("ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET not set")
  console.log(`[test] OAuth app client_id=${clientId}`)

  const c = db()
  await c.connect()

  const sel = EMAIL
    ? await c.query(
        "select id, zoom_email, refresh_token, expires_at from public.zoom_connections where zoom_email=$1 and is_active=true limit 1",
        [EMAIL],
      )
    : await c.query(
        "select id, zoom_email, refresh_token, expires_at from public.zoom_connections where is_active=true and refresh_token is not null order by updated_at asc limit 1",
      )

  if (!sel.rows.length) {
    console.log("[test] No active connection found to test.")
    await c.end()
    return
  }

  const conn = sel.rows[0]
  console.log(`[test] Canary connection: ${conn.zoom_email} (id=${conn.id}), stored expires_at=${conn.expires_at}`)

  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.log(`[test] ❌ REFRESH FAILED: HTTP ${res.status} ${body}`)
    console.log("[test] (connection left untouched — NOT marked inactive)")
    await c.end()
    return
  }

  const tokens = await res.json()
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await c.query(
    "update public.zoom_connections set access_token=$1, refresh_token=$2, expires_at=$3, scope=$4, updated_at=now() where id=$5",
    [tokens.access_token, tokens.refresh_token || conn.refresh_token, newExpiresAt, tokens.scope, conn.id],
  )

  console.log(`[test] ✅ REFRESH OK — new token expires ${newExpiresAt}`)
  console.log(`[test]    rotated refresh_token: ${tokens.refresh_token ? "yes (persisted)" : "no (reused prior)"}`)
  console.log(`[test]    scope head: ${String(tokens.scope).slice(0, 80)}`)

  // Prove the new access token actually works against Zoom.
  const me = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const meBody = me.ok ? await me.json() : await me.text()
  console.log(`[test]    GET /users/me -> HTTP ${me.status}` + (me.ok ? ` (${meBody.email})` : ` ${meBody}`))

  await c.end()
}

main().catch((e) => {
  console.error("[test] ERR", e.message)
  process.exit(1)
})
