// Apply migration 366_proconnect_engagement_efile.sql.
// Run with:
//   node --env-file=.env.local scripts/366-run-proconnect-engagement-efile.mjs
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const sql = await readFile(
  new URL("./366_proconnect_engagement_efile.sql", import.meta.url),
  "utf8",
)

const url =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL

if (!url) {
  console.error("[v0] No POSTGRES_URL_NON_POOLING / POSTGRES_URL env var present")
  process.exit(1)
}

// Supabase's pooler presents a cert our local chain doesn't trust. pg >= 8.16
// lets the connection string's `sslmode=require` override the ssl option, so
// strip it and configure TLS explicitly instead of half-specifying both.
const client = new Client({
  connectionString: url.replace(/([?&])sslmode=[^&]*/, "$1").replace(/[?&]$/, ""),
  ssl: { rejectUnauthorized: false },
})
await client.connect()

try {
  await client.query(sql)
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(efile_status)::int AS with_status,
            COUNT(efile_synced_at)::int AS hydrated
     FROM proconnect_engagements`,
  )
  console.log("[v0] Migration 366 (engagement e-file columns) applied successfully")
  console.log("[v0] Engagement e-file coverage:", rows[0])
} catch (err) {
  console.error("[v0] Migration 366 failed:", err)
  process.exitCode = 1
} finally {
  await client.end()
}
