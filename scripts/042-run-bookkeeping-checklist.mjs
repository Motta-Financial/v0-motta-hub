// Apply migration 042-bookkeeping-checklist-progress.sql.
// Run with:
//   node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/042-run-bookkeeping-checklist.mjs
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const sql = await readFile(
  new URL("./042-bookkeeping-checklist-progress.sql", import.meta.url),
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

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

try {
  await client.query(sql)
  console.log("[v0] Migration 042 applied successfully")
} catch (err) {
  console.error("[v0] Migration 042 failed:", err)
  process.exitCode = 1
} finally {
  await client.end()
}
