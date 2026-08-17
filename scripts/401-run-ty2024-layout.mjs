/**
 * Runner for scripts/401_form_1040_ty2024_inherited_layout.sql.
 *
 * Dry run by default; --apply commits. Everything happens in one transaction
 * this script owns, and it only commits if the outcome is what the migration
 * claims. A failed run leaves prod untouched.
 *
 * What it checks, and why each one:
 *   TY2025 untouched          the migration must not disturb the year that
 *                             actually works — 44 live returns depend on it
 *   TY2024 resolution UP      the whole point: mapped lines that find a cell
 *                             on real 2024 returns should go from 0 to ~38
 *   13b inert for 2024        Schedule 1-A is TY2025-only
 *   line 14 drops 13b         its operands must be 12c + 13 for 2024
 *   no TY2024 cell editable   inherited mapping + no 2024 catalog = no writes
 *   estimator stays shut      tax_brackets_verified absent for 2024, so the
 *                             Hub reports line 16 unavailable rather than
 *                             computing it from 2025 brackets
 *
 * Usage: node scripts/401-run-ty2024-layout.mjs [--apply]
 */

import pg from "pg"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes("--apply")

const env = {}
try {
  for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
} catch {}
Object.assign(env, process.env)

const conn = (env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || "").split("?")[0]
if (!conn) {
  console.error("POSTGRES_URL_NON_POOLING or POSTGRES_URL required")
  process.exit(1)
}

const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await c.connect()

/**
 * How many mapped lines actually find a cell on real returns of a given year.
 * This is the number that matters — it is what a preparer sees populated.
 */
const RESOLUTION = `
  with m as (
    select distinct line_code, lower(series_id) s, lower(code_id) cd, prefix_id
    from form_1040_proconnect_map
    where tax_year = $1 and return_type = 'IND' and form = '1040' and series_id is not null
  )
  select count(distinct m.line_code)::int n
  from proconnect_return_snapshots sn
  join proconnect_return_field_cells f on f.return_id = sn.return_id
  join m on lower(f.series_id) = m.s and lower(f.code_id) = m.cd
        and (m.prefix_id = '*' or m.prefix_id = f.prefix_id)
  where sn.return_type = 'IND' and sn.deleted_at is null and sn.tax_year = $2`

async function snapshot(label) {
  const o = {}
  o.lines25 = (await c.query(`select count(*)::int n from form_1040_lines where tax_year=2025 and form='1040'`)).rows[0].n
  o.lines24 = (await c.query(`select count(*)::int n from form_1040_lines where tax_year=2024 and form='1040'`)).rows[0].n
  o.map25 = (await c.query(`select count(*)::int n from form_1040_proconnect_map where tax_year=2025 and form='1040' and return_type='IND'`)).rows[0].n
  o.map24 = (await c.query(`select count(*)::int n from form_1040_proconnect_map where tax_year=2024 and form='1040' and return_type='IND'`)).rows[0].n
  // Mapped lines resolving on that year's own returns, using that year's own map.
  o.res25 = (await c.query(RESOLUTION, [2025, 2025])).rows[0].n
  o.res24 = (await c.query(RESOLUTION, [2024, 2024])).rows[0].n
  o.editable24 = (await c.query(`select count(*)::int n from form_1040_proconnect_map where tax_year=2024 and editable`)).rows[0].n
  o.editable25 = (await c.query(`select count(*)::int n from form_1040_proconnect_map where tax_year=2025 and editable`)).rows[0].n
  console.log(`\n--- ${label} ---`)
  console.log(`  TY2025  lines=${o.lines25} map=${o.map25} editable=${o.editable25} resolving=${o.res25}`)
  console.log(`  TY2024  lines=${o.lines24} map=${o.map24} editable=${o.editable24} resolving=${o.res24}`)
  return o
}

const sql = readFileSync(join(__dirname, "401_form_1040_ty2024_inherited_layout.sql"), "utf8")
const body = sql.slice(sql.indexOf("begin;") + "begin;".length, sql.indexOf("commit;"))

let committed = false
await c.query("begin")
try {
  const before = await snapshot("BEFORE")
  await c.query(body)
  const after = await snapshot("AFTER")

  const l14 = (await c.query(
    `select computation::text comp, not_applicable from form_1040_lines
     where tax_year=2024 and form='1040' and line_code='14'`)).rows[0]
  const l13b = (await c.query(
    `select not_applicable from form_1040_lines
     where tax_year=2024 and form='1040' and line_code='13b'`)).rows[0]
  const brackets24 = (await c.query(
    `select count(*)::int n from form_1040_constants
     where tax_year=2024 and key='tax_brackets_verified' and value::text='true'`)).rows[0].n
  const layoutGate = (await c.query(
    `select value::text v from form_1040_constants where tax_year=2024 and key='layout_verified'`)).rows[0]

  console.log(`\n  line 13b not_applicable : ${l13b?.not_applicable}`)
  console.log(`  line 14 computation     : ${l14?.comp}`)
  console.log(`  layout_verified         : ${layoutGate?.v}`)
  console.log(`  tax_brackets_verified=true for 2024: ${brackets24} (must be 0 — keeps line 16 unavailable)`)

  const fail = []
  if (after.lines25 !== before.lines25 || after.map25 !== before.map25 || after.editable25 !== before.editable25)
    fail.push("TY2025 was modified — it must be untouched")
  if (after.res25 !== before.res25) fail.push(`TY2025 resolution changed: ${before.res25} → ${after.res25}`)
  if (!(after.lines24 > 0)) fail.push("no TY2024 lines were created")
  if (!(after.map24 > 0)) fail.push("no TY2024 mappings were created")
  if (!(after.res24 > before.res24)) fail.push(`TY2024 resolution did not improve: ${before.res24} → ${after.res24}`)
  if (after.editable24 !== 0) fail.push(`${after.editable24} TY2024 mappings are editable — must be 0`)
  if (l13b?.not_applicable !== true) fail.push("13b is not marked not_applicable for 2024")
  if (!l14?.comp?.includes('"12c"') || l14.comp.includes('"13b"'))
    fail.push(`line 14 operands wrong for 2024: ${l14?.comp}`)
  if (brackets24 !== 0) fail.push("tax_brackets_verified is true for 2024 — the estimator would use unverified brackets")
  if (layoutGate?.v !== "false") fail.push(`layout_verified should be false, got ${layoutGate?.v}`)

  if (!APPLY) {
    await c.query("rollback")
    console.log("\nDRY RUN — rolled back, nothing changed.")
    console.log(fail.length ? `WOULD FAIL:\n  - ${fail.join("\n  - ")}` : "checks pass; re-run with --apply")
  } else if (fail.length) {
    await c.query("rollback")
    console.error(`\nROLLED BACK — prod unchanged:\n  - ${fail.join("\n  - ")}`)
  } else {
    await c.query("commit")
    committed = true
    console.log(`\nCOMMITTED — TY2024 resolving ${before.res24} → ${after.res24} mapped lines, TY2025 untouched.`)
  }
} catch (err) {
  await c.query("rollback").catch(() => {})
  console.error("\nROLLED BACK on error — prod unchanged.")
  console.error(err instanceof Error ? err.message : err)
}

await c.end()
process.exit(APPLY && !committed ? 1 : 0)
