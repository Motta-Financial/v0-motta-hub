// Apply scripts/387_form_1040_mapping_key_and_editable.sql to the live DB.
//
// Run with:
//   node --env-file=.env.local scripts/387-run-mapping-key-and-editable.mjs           # DRY RUN (rollback)
//   node --env-file=.env.local scripts/387-run-mapping-key-and-editable.mjs --apply   # commit
//
// Default is a DRY RUN: the migration executes inside a transaction that is
// rolled back. Postgres DDL is transactional, so this validates every
// statement — and the derivation's actual output — against the real schema
// without changing anything. Re-running with --apply is idempotent.
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

const raw = await readFile(
  new URL("./387_form_1040_mapping_key_and_editable.sql", import.meta.url),
  "utf8",
)
// The file carries its own begin/commit; strip them so this script owns the
// transaction and can choose to roll back.
const sql = raw.replace(/^\s*begin\s*;\s*$/im, "").replace(/^\s*commit\s*;\s*$/im, "")

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
  await client.query("begin")
  await client.query(sql)

  // ── What the key now looks like ────────────────────────────────────
  const { rows: key } = await client.query(`
    select a.attname, k.ordinality
      from pg_constraint c
      join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.conname = 'form_1040_proconnect_map_pkey'
     order by k.ordinality`)
  console.log("primary key:", key.map((r) => r.attname).join(", "))

  // ── The editable derivation, line by line ──────────────────────────
  const { rows } = await client.query(`
    select line_code, form, cell_role,
           coalesce(series_id,'-') || '/' || coalesce(prefix_id,'-') || '/' ||
           coalesce(code_id,'-')   || '/' || coalesce(suffix_id,'-') as cell,
           editable, editable_basis
      from form_1040_proconnect_map
     where tax_year = 2025 and return_type = 'IND'
     order by editable desc, line_code`)

  const yes = rows.filter((r) => r.editable)
  const no = rows.filter((r) => !r.editable)
  console.log(`\n${rows.length} mapping rows: ${yes.length} editable, ${no.length} not\n`)

  console.log("── EDITABLE ──")
  for (const r of yes) console.log(`  ${r.line_code.padEnd(20)} ${r.cell.padEnd(28)} ${r.cell_role}`)

  console.log("\n── NOT EDITABLE ──")
  for (const r of no)
    console.log(`  ${r.line_code.padEnd(20)} ${r.cell.padEnd(28)} ${(r.editable_basis ?? "").slice(0, 96)}`)

  // Every row must carry a stated reason — a null basis means the
  // derivation missed a case.
  const unexplained = rows.filter((r) => !r.editable_basis)
  if (unexplained.length) {
    console.error(`\n!! ${unexplained.length} row(s) with no editable_basis:`, unexplained.map((r) => r.line_code))
  }

  if (APPLY) {
    await client.query("commit")
    console.log("\n387 APPLIED (committed).")
  } else {
    await client.query("rollback")
    console.log("\nDRY RUN — rolled back, nothing changed. Re-run with --apply to commit.")
  }
} catch (err) {
  await client.query("rollback").catch(() => {})
  console.error("\nFAILED (rolled back):", err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
