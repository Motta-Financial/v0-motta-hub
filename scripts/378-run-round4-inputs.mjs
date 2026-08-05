// Apply scripts/378_form_1040_round4_inputs_and_decodes.sql to the live DB.
// Run with:
//   node --env-file=.env.local scripts/378-run-round4-inputs.mjs
// Idempotent — safe to re-run.
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const sql = await readFile(new URL("./378_form_1040_round4_inputs_and_decodes.sql", import.meta.url), "utf8")

let url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL in env")
  process.exit(1)
}
// Strip sslmode so the explicit ssl option below wins (pg v8+ maps
// sslmode=require to verify-full, which rejects Supabase's cert).
url = url.replace(/([?&])sslmode=[^&]*(&?)/, (_, pre, post) => (post ? pre : ""))

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(sql)
  const { rows: decode } = await client.query(
    "select line_code, confidence, value_decode from form_1040_proconnect_map where tax_year = 2025 and return_type = 'IND' and line_code = '35c'",
  )
  console.log("35c decode:", JSON.stringify(decode))
  const { rows: inputs } = await client.query(`
    select line_code, series_id, code_id, source_ref
      from form_1040_line_inputs
     where tax_year = 2025 and verified_at is not null
     order by line_code, series_id, code_id`)
  console.table(inputs)
  console.log("378 applied.")
} finally {
  await client.end()
}
