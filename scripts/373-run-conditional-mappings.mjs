// Apply scripts/373_form_1040_conditional_mappings.sql to the live DB.
// Run with:
//   node --env-file=.env.local scripts/373-run-conditional-mappings.mjs
// Applied to prod (project mottahub) 2026-08-04. Idempotent — safe to re-run.
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const sql = await readFile(new URL("./373_form_1040_conditional_mappings.sql", import.meta.url), "utf8")

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
    select line_code, series_id, prefix_id, code_id, suffix_id, cell_field, confidence, condition
      from form_1040_proconnect_map
     where tax_year = 2025 and return_type = 'IND'
       and line_code in ('4a','4b','5a','5b','fs_single','fs_mfj','fs_mfs','fs_hoh','fs_qss')
     order by line_code`)
  console.table(rows.map((r) => ({ ...r, condition: JSON.stringify(r.condition) })))
  console.log("373 applied.")
} finally {
  await client.end()
}
