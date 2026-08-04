// Apply scripts/374_form_1040_na_lines_and_35a.sql to the live DB.
// Run with:
//   node --env-file=.env.local scripts/374-run-na-lines.mjs
// Idempotent — safe to re-run.
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const sql = await readFile(new URL("./374_form_1040_na_lines_and_35a.sql", import.meta.url), "utf8")

let url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL in env")
  process.exit(1)
}
// Strip sslmode from the URL so the explicit ssl option below wins
// (sslmode=require now maps to verify-full and rejects Supabase's cert).
url = url.replace(/([?&])sslmode=[^&]*(&?)/, (_, pre, post) => (post ? pre : ""))

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(sql)
  const { rows } = await client.query(`
    select line_code, not_applicable, is_computed, computation
      from form_1040_lines
     where tax_year = 2025 and line_code in ('30','12b','35a')
     order by line_code`)
  console.table(rows.map((r) => ({ ...r, computation: JSON.stringify(r.computation) })))
  console.log("374 applied.")
} finally {
  await client.end()
}
