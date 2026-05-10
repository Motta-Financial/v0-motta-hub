// Apply migration 049_jotform_intake_enrichment.sql.
//
// Adds the columns required for the intake auto-assignment + firm-wide
// notification + AI enrichment pipeline:
//   - preferred_team_member  (text)
//   - enrichment             (jsonb)
//   - question_research      (jsonb)
//   - notified_at            (timestamptz)
//
// Run with:
//   node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/049-run-jotform-intake-enrichment.mjs
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const sql = await readFile(
  new URL("./049_jotform_intake_enrichment.sql", import.meta.url),
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
  console.log("[v0] Migration 049 (Jotform intake enrichment) applied successfully")
} catch (err) {
  console.error("[v0] Migration 049 failed:", err)
  process.exitCode = 1
} finally {
  await client.end()
}
