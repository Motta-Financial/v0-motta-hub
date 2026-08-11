// Apply scripts/386_form_1040_ty2025_schedule_1a_senior_deduction.sql to the live DB.
//
// Run with:
//   node --env-file=.env.local scripts/386-run-schedule-1a-senior-deduction.mjs           # DRY RUN (rollback)
//   node --env-file=.env.local scripts/386-run-schedule-1a-senior-deduction.mjs --apply   # commit
//
// Default is a DRY RUN: the migration executes inside a transaction that is
// rolled back. Postgres DDL is transactional, so this validates every
// statement against the real schema — and prints the resulting rows — without
// changing anything. Re-running with --apply is idempotent.
//
// ORDERING NOTE: this migration must run AFTER scripts/387 (which repointed
// form_1040_lines' unique key to (tax_year, form, line_code) and the map's
// primary key to (tax_year, return_type, form, line_code, cell_key)). Its
// ON CONFLICT targets assume the post-387 shape. The preflight below refuses
// to run if 387 has not been applied, rather than failing mid-statement.
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

const raw = await readFile(
  new URL("./386_form_1040_ty2025_schedule_1a_senior_deduction.sql", import.meta.url),
  "utf8",
)
// The file carries no begin/commit of its own, but strip them if that changes
// so this script always owns the transaction and can choose to roll back.
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
  // ── preflight: is the post-387 schema in place? ─────────────────────
  const { rows: pre } = await client.query(`
    select
      exists (select 1 from pg_constraint
               where conname = 'form_1040_lines_uniq_form') as lines_key_ok,
      exists (select 1 from pg_constraint
               where conname = 'form_1040_proconnect_map_pkey'
                 and pg_get_constraintdef(oid) like '%cell_key%') as map_key_ok`)
  if (!pre[0].lines_key_ok || !pre[0].map_key_ok) {
    console.error(
      "Preflight failed: scripts/387 has not been applied.\n" +
        `  form_1040_lines_uniq_form present: ${pre[0].lines_key_ok}\n` +
        `  map pkey includes cell_key:        ${pre[0].map_key_ok}\n` +
        "Apply 387 first — this migration's ON CONFLICT targets depend on it.",
    )
    process.exit(1)
  }

  await client.query("begin")
  await client.query(sql)

  // ── the deduction block, in form order ─────────────────────────────
  const { rows: lines } = await client.query(`
    select line_code, ordinal, short_label,
           coalesce(computation->>'kind', '-') as kind,
           coalesce((select string_agg(v, '+') from jsonb_array_elements_text(computation->'operands') v), '-') as operands
      from form_1040_lines
     where tax_year = 2025 and form = '1040'
       and line_code in ('6c','6d','12a','12c','13','13b','14','15')
     order by ordinal`)
  console.log("\nDeduction block:")
  console.table(lines)

  // ── Schedule 1-A Part V constants ──────────────────────────────────
  const { rows: consts } = await client.query(`
    select key, value from form_1040_constants
     where tax_year = 2025
       and (key like 'senior_deduction%' or key = 'age_65_cutoff_birthdate')
     order by key`)
  console.log("\nSchedule 1-A Part V constants:")
  console.table(consts)

  // ── the two new placeholder map rows ───────────────────────────────
  const { rows: map } = await client.query(`
    select line_code, cell_role, cell_key, confidence
      from form_1040_proconnect_map
     where tax_year = 2025 and return_type = 'IND' and form = '1040'
       and line_code in ('6d','13b')
     order by line_code`)
  console.log("\nNew map rows (cell_key '///' = unmapped, as intended):")
  console.table(map)

  // ── ordinal sanity: nothing collided, order preserved ──────────────
  const { rows: ord } = await client.query(`
    select count(*) as lines,
           count(distinct ordinal) as distinct_ordinals,
           min(ordinal) as min_ord, max(ordinal) as max_ord
      from form_1040_lines where tax_year = 2025 and form = '1040'`)
  console.log("\nOrdinals:")
  console.table(ord)
  if (ord[0].lines !== ord[0].distinct_ordinals) {
    throw new Error(
      `ordinal collision: ${ord[0].lines} lines but ${ord[0].distinct_ordinals} distinct ordinals`,
    )
  }

  // ── the whole point: 13b sits between 13 and 14, and 14 sums it ────
  const codes = lines.map((r) => r.line_code)
  const i13 = codes.indexOf("13")
  const i13b = codes.indexOf("13b")
  const i14 = codes.indexOf("14")
  if (!(i13 < i13b && i13b < i14)) {
    throw new Error(`13b is out of form order: ${codes.join(" < ")}`)
  }
  const line14 = lines.find((r) => r.line_code === "14")
  if (!line14?.operands?.includes("13b")) {
    throw new Error(`line 14 does not sum 13b: operands = ${line14?.operands}`)
  }
  console.log("\nChecks: 13b ordered between 13 and 14, and line 14 sums it.")

  if (APPLY) {
    await client.query("commit")
    console.log("\nCOMMITTED.")
    console.log("Next: run `npx tsx scripts/verify-1040-estimates.ts` and re-render a return.")
  } else {
    await client.query("rollback")
    console.log("\nDRY RUN — rolled back. Re-run with --apply to commit.")
  }
} catch (err) {
  await client.query("rollback").catch(() => {})
  console.error("\nFAILED, rolled back:", err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
