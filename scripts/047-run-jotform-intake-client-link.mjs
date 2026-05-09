// Apply migration 047 — adds link_method + linked_at metadata
// columns to jotform_intake_submissions. Idempotent.
import { readFileSync } from "node:fs"
import { Client } from "pg"

const sql = readFileSync(new URL("./047_jotform_intake_client_link.sql", import.meta.url), "utf-8")

const client = new Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
console.log("[v0] Applying 047_jotform_intake_client_link.sql…")
await client.query(sql)
const { rows } = await client.query(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'jotform_intake_submissions'
    AND column_name IN ('link_method', 'linked_at')
  ORDER BY column_name
`)
console.log("[v0] New columns:")
for (const r of rows) console.log("  -", r.column_name, "::", r.data_type)
await client.end()
console.log("[v0] Done.")
