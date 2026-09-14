// Apply the out-of-band Form 1040 parity migrations (407, 408).
//
//   node --env-file=.env.local scripts/apply-1040-parity.mjs --sql-dir=<dir>
//   node --env-file=.env.local scripts/apply-1040-parity.mjs --sql-dir=<dir> --apply
//
// Default is a DRY RUN. --sql-dir points at the directory holding 407/408
// (or set FORM_1040_SQL_DIR). This runner contains NO field tuples, so it is
// safe to commit; the SQL files it reads are not.
//
// Default is a DRY RUN: both files execute inside one transaction that is
// rolled back, then the resulting mapping state is printed. Mirrors the
// runner pattern in scripts/387-run-mapping-key-and-editable.mjs.
//
// These SQL files live OUTSIDE the repo on purpose (partner-confidential
// tuples; see the header in 407 and scripts/360). Keep them there.
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "pg"
import { classify, plan, record, stripTx } from "./lib/oob-migrations.mjs"

const APPLY = process.argv.includes("--apply")
// This directory is SHARED between workstreams. The runner applies every *.sql
// in it as ONE transaction, so a file whose preflight fails — e.g. one waiting
// on an in-repo schema migration that has not merged yet — rolls back
// everyone else's work too. --only=<substring> narrows the batch.
const onlyArg = process.argv.find((a) => a.startsWith("--only="))
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null
const arg = process.argv.find((a) => a.startsWith("--sql-dir="))
const SQL_DIR = arg ? arg.slice("--sql-dir=".length) : process.env.FORM_1040_SQL_DIR
if (!SQL_DIR) {
  console.error("Pass --sql-dir=<dir> (or set FORM_1040_SQL_DIR) — the directory")
  console.error("holding the out-of-band 407/408 SQL. Those files are NOT in this repo;")
  console.error("they carry partner-confidential ProConnect tuples. See scripts/360.")
  process.exit(1)
}

// Every *.sql in SQL_DIR except the *.report.sql diagnostics, in filename order.
const FILES = null // resolved after SQL_DIR is known

let url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL in env")
  process.exit(1)
}
url = url.replace(/([?&])sslmode=[^&]*(&?)/, (_, pre, post) => (post ? pre : ""))

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query("begin")

  // ── Ledger-gated selection (scripts/416) ──────────────────────────────
  // This runner used to apply EVERY *.sql in SQL_DIR on every invocation, so
  // dropping a file in the directory was indistinguishable from deploying it.
  // On 2026-09-14 that put an unreviewed migration (415) into production: the
  // runner was invoked for the Schedule C work and swept up a file staged for
  // review. Now only files ABSENT FROM THE LEDGER run, and only with --apply.
  const classified = await classify(client, SQL_DIR)
  if (ONLY) {
    const before = classified.pending.length
    classified.pending = classified.pending.filter((p) => p.name.includes(ONLY))
    console.log(`  --only=${ONLY} -> ${classified.pending.length} of ${before} pending file(s)`)
  }
  const toRun = plan(classified, { apply: APPLY })

  // Backfill hashes for rows applied before the ledger existed, so drift is
  // detectable from here on.
  for (const a of classified.applied.filter((x) => x.backfill)) {
    await record(client, a, "backfill", null)
  }

  for (const f of toRun) {
    // Each file carries its own begin/commit; strip them so this script owns
    // the transaction and can choose to roll back.
    await client.query(stripTx(f.raw))
    await record(client, f, "apply-1040-parity.mjs")
    console.log(`  applied ${f.name}`)
  }

  console.log("\n── form_1040_proconnect_map: lines 6a / 25b ──")
  const { rows: map } = await client.query(`
    select line_code, series_id, prefix_id, code_id, suffix_id,
           cell_field, cell_role, confidence, editable
      from form_1040_proconnect_map
     where tax_year = 2025 and return_type = 'IND' and form = '1040'
       and line_code in ('6a','25b')
     order by line_code, code_id`)
  for (const r of map) {
    console.log(`  ${r.line_code.padEnd(4)} ${r.series_id}/${r.prefix_id}/${r.code_id}/${r.suffix_id}`
      + `  ${r.cell_field}/${r.cell_role}  ${r.confidence}  editable=${r.editable}`)
  }

  console.log("\n── form_1040_line_inputs: lines 6a / 6b / 6c / 25b ──")
  const { rows: li } = await client.query(`
    select line_code, source_kind, source_ref, series_id, code_id, role, confidence
      from form_1040_line_inputs
     where tax_year = 2025 and return_type = 'IND'
       and line_code in ('6a','6b','6c','25b')
     order by line_code, code_id nulls first`)
  for (const r of li) {
    console.log(`  ${r.line_code.padEnd(4)} ${(r.series_id ?? '-')}/${(r.code_id ?? '-')}`
      + `  ${r.role ?? '-'}  ${r.confidence}  ${r.source_ref ?? ''}`)
  }

  // Out-of-band diagnostics: any *.report.sql in the SQL dir is executed and
  // printed generically. They live outside the repo because their WHERE
  // clauses name ProConnect series/codes.
  const reports = (await readdir(SQL_DIR))
    .filter((f) => f.endsWith(".report.sql"))
    .filter((f) => !ONLY || f.includes(ONLY))
    .sort()
  for (const f of reports) {
    const { rows } = await client.query(await readFile(join(SQL_DIR, f), "utf8"))
    console.log(`\n── ${f} ──`)
    if (!rows.length) { console.log("  (no rows)"); continue }
    const cols = Object.keys(rows[0])
    const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)))
    console.log("  " + cols.map((c, i) => c.padEnd(w[i])).join("  "))
    for (const r of rows) console.log("  " + cols.map((c, i) => String(r[c] ?? "").padEnd(w[i])).join("  "))
  }

  if (APPLY) {
    await client.query("commit")
    console.log("\nCOMMITTED")
  } else {
    await client.query("rollback")
    console.log("\nDRY RUN — rolled back. Re-run with --apply to commit.")
  }
} catch (e) {
  await client.query("rollback").catch(() => {})
  console.error("\nFAILED (rolled back):", e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
