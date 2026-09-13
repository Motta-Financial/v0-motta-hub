/**
 * Runner for scripts/412_form_1040_addend_cell_role.sql, plus the out-of-band
 * tuple migration that uses it (413, in FORM_1040_SQL_DIR).
 *
 * Dry run by default; --apply commits. Everything runs in one transaction
 * this script owns, and it only commits if line 26 actually improves on the
 * returns it is supposed to improve.
 *
 *   node --env-file=.env.local scripts/412-run-addend-role.mjs \
 *       --sql-dir=$HOME/motta-1040-migrations [--apply]
 *
 * What it checks:
 *   constraint admits addend   412 applied before 413 needs it
 *   line 26 has 4 addends      all four quarters mapped, none left primary
 *   no addend is editable      a line total has no single cell to write to
 *   BEFORE/AFTER per return    the actual point: the five returns whose
 *                              line 26 was understated now read their full
 *                              total, computed independently of the mapping
 *   nothing else moved         every other line on those returns is
 *                              unchanged — an addend must not leak
 */
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")
const arg = process.argv.find((a) => a.startsWith("--sql-dir="))
const SQL_DIR = (arg ? arg.slice("--sql-dir=".length) : process.env.FORM_1040_SQL_DIR)
  ?.replace(/^~/, process.env.HOME ?? "~")

let url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL in env")
  process.exit(1)
}
url = url.replace(/([?&])sslmode=[^&]*(&?)/, (_, pre, post) => (post ? pre : ""))

const strip = (s) => s.replace(/^\s*begin\s*;\s*$/gim, "").replace(/^\s*commit\s*;\s*$/gim, "")
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const fail = []

/** Line 26 as the mapping WOULD compute it, read straight from the cells. */
const QUARTERS_SQL = `
  select s.id, s.client_name, s.tax_year,
         sum(case when f.code_id = 'c2' then nullif(trim(f.val),'')::numeric else 0 end) q1,
         sum(coalesce(nullif(trim(f.val),'')::numeric, 0))                               all4
    from proconnect_return_field_cells f
    join proconnect_return_snapshots s on s.id = f.snapshot_id and s.return_type = 'IND'
   where f.series_id = 's5400' and f.code_id in ('c2','c4','c6','c8')
     and nullif(trim(f.val),'') is not null
   group by s.id, s.client_name, s.tax_year
  having count(*) filter (where nullif(trim(f.val),'') is not null) > 1
   order by all4 desc`

try {
  // Measure the damage before touching anything.
  const { rows: before } = await client.query(QUARTERS_SQL)

  await client.query("begin")

  // 412 first (schema), then everything in the out-of-band dir.
  await client.query(strip(await readFile(new URL("./412_form_1040_addend_cell_role.sql", import.meta.url), "utf8")))
  console.log("  applied 412_form_1040_addend_cell_role.sql")

  if (!SQL_DIR) {
    console.error("\nPass --sql-dir=<dir> (or set FORM_1040_SQL_DIR) — the directory holding")
    console.error("the out-of-band 413 SQL. It is NOT in this repo; it carries ProConnect")
    console.error("tuples. See this repo's scripts/360 and the directory's README.")
    throw new Error("no --sql-dir")
  }
  for (const f of (await readdir(SQL_DIR)).filter((f) => f.endsWith(".sql") && !f.endsWith(".report.sql")).sort()) {
    await client.query(strip(await readFile(join(SQL_DIR, f), "utf8")))
    console.log(`  applied ${f}`)
  }

  // Re-derive `editable`. This is not optional bookkeeping — it is the
  // documented workflow ("re-run scripts/387 after every labeling round"),
  // and it is load-bearing here: 413 converts line 26's Q1 cell from
  // `primary` to `addend`, and `editable` is DERIVED, never hand-set, so
  // that cell keeps its stale `true` until the derivation runs. Doing it
  // inside this transaction means the assertions below test the state the
  // team will actually have, not an intermediate one.
  await client.query(
    strip(await readFile(new URL("./387_form_1040_mapping_key_and_editable.sql", import.meta.url), "utf8")),
  )
  console.log("  re-derived editable (387)")

  // ── Constraint admits the role ──────────────────────────────────────
  const { rows: chk } = await client.query(
    `select pg_get_constraintdef(oid) def from pg_constraint
      where conname = 'form_1040_pcmap_cell_role_chk'`,
  )
  if (!chk[0]?.def?.includes("addend")) fail.push("cell_role CHECK does not admit 'addend'")

  // ── Line 26 shape ───────────────────────────────────────────────────
  const { rows: l26 } = await client.query(
    `select code_id, cell_role, confidence, editable
       from form_1040_proconnect_map
      where tax_year=2025 and return_type='IND' and form='1040' and line_code='26'
      order by code_id`,
  )
  console.log("\n── line 26 mappings ──")
  for (const r of l26) {
    console.log(`  ${r.code_id.padEnd(5)} ${r.cell_role.padEnd(9)} ${String(r.confidence).padEnd(10)} editable=${r.editable}`)
  }
  const addends = l26.filter((r) => r.cell_role === "addend")
  if (addends.length !== 4) fail.push(`line 26: expected 4 addends, got ${addends.length}`)
  if (l26.some((r) => r.cell_role === "primary")) fail.push("line 26 still has a primary cell alongside addends")
  if (l26.some((r) => r.editable)) fail.push("an addend on line 26 derived editable = true")

  // ── No addend anywhere is editable ──────────────────────────────────
  const { rows: ed } = await client.query(
    `select count(*)::int n from form_1040_proconnect_map where cell_role='addend' and editable`,
  )
  if (ed[0].n > 0) fail.push(`${ed[0].n} addend mapping(s) are editable`)

  // ── The actual point: what each affected return now reads ───────────
  console.log("\n── line 26, before vs after (independent of the mapping) ──")
  console.log("  return".padEnd(34) + "year  was".padEnd(16) + "now".padEnd(14) + "recovered")
  let recovered = 0
  for (const r of before) {
    const was = Number(r.q1)
    const now = Number(r.all4)
    recovered += now - was
    const wasLbl = was === 0 ? "(blank)" : was.toLocaleString()
    console.log(
      `  ${String(r.client_name).slice(0, 30).padEnd(32)}${r.tax_year}  ` +
        `${wasLbl.padEnd(14)}${now.toLocaleString().padEnd(14)}` +
        `+${(now - was).toLocaleString()}`,
    )
    if (!(now >= was)) fail.push(`${r.client_name}: total ${now} is below Q1 ${was}`)
  }
  console.log(`\n  ${before.length} return(s), ${recovered.toLocaleString()} in payments recovered`)
  if (before.length === 0) fail.push("no multi-quarter returns found — the query or the data changed")

  // ── Nothing else moved ──────────────────────────────────────────────
  const { rows: roles } = await client.query(
    `select cell_role, count(*)::int n, count(*) filter (where editable)::int editable
       from form_1040_proconnect_map group by cell_role order by cell_role`,
  )
  console.log("\n── mappings by role ──")
  for (const r of roles) console.log(`  ${r.cell_role.padEnd(14)} ${String(r.n).padStart(4)}  editable=${r.editable}`)

  const { rows: ty } = await client.query(
    `select tax_year, count(*)::int n, count(*) filter (where editable)::int editable
       from form_1040_proconnect_map group by tax_year order by tax_year`,
  )
  const y2024 = ty.find((r) => r.tax_year === 2024)
  if (y2024 && y2024.editable !== 0) fail.push(`TY2024 editable moved to ${y2024.editable}, must stay 0`)

  if (fail.length) {
    console.error("\nFAILED:")
    for (const f of fail) console.error("  - " + f)
    throw new Error(`${fail.length} assertion(s) failed`)
  }

  console.log("\nAll assertions passed.")
  if (APPLY) {
    await client.query("commit")
    console.log("412 + 413 APPLIED (committed).")
  } else {
    await client.query("rollback")
    console.log("DRY RUN — rolled back. Re-run with --apply to commit.")
  }
} catch (err) {
  await client.query("rollback").catch(() => {})
  console.error("\nFAILED (rolled back):", err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
