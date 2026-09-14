/**
 * Shared ledger logic for out-of-band 1040 migrations (scripts/416).
 *
 * Every runner that executes SQL from the out-of-band directory MUST go
 * through here. The rule it enforces, in one line: a file is applied because
 * someone decided to apply it, never because it exists in a folder.
 *
 * See scripts/416_oob_migration_ledger.sql for why.
 */
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

/** Strip a file's own begin/commit so the caller owns the transaction. */
export const stripTx = (sql) =>
  sql.replace(/^\s*begin\s*;\s*$/gim, "").replace(/^\s*commit\s*;\s*$/gim, "")

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

/**
 * Classify every *.sql in `dir` against the ledger.
 *
 * Returns { pending, applied, drifted }:
 *   pending  never applied — the runner offers these, and only these
 *   applied  in the ledger with a matching (or not-yet-recorded) hash
 *   drifted  in the ledger but the file's bytes have CHANGED since. Production
 *            no longer matches what is on disk. Never auto-applied: re-running
 *            an edited migration is how you get a surprise, and skipping it
 *            silently is how you get a lie.
 */
export async function classify(client, dir, extraFiles = []) {
  const { rows } = await client.query(
    "select filename, sha256 from form_1040_oob_migrations",
  )
  const ledger = new Map(rows.map((r) => [r.filename, r.sha256]))

  const names = (await readdir(dir))
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".report.sql"))
    .sort()

  const entries = [
    ...names.map((name) => ({ name, path: join(dir, name) })),
    ...extraFiles,
  ]

  const pending = []
  const applied = []
  const drifted = []

  for (const e of entries) {
    const raw = await readFile(e.path, "utf8")
    const hash = sha256(raw)
    const item = { ...e, raw, hash }
    if (!ledger.has(e.name)) {
      pending.push(item)
    } else {
      const recorded = ledger.get(e.name)
      // NULL hash = applied before the ledger existed. Trust it as applied
      // and backfill the hash so drift is detectable from here on.
      if (recorded === null) {
        applied.push({ ...item, backfill: true })
      } else if (recorded === hash) {
        applied.push(item)
      } else {
        drifted.push({ ...item, recorded })
      }
    }
  }
  return { pending, applied, drifted }
}

/** Record a file as applied, or backfill a hash for a pre-ledger row. */
export async function record(client, { name, hash }, appliedBy, notes = null) {
  await client.query(
    `insert into form_1040_oob_migrations (filename, sha256, applied_by, notes)
     values ($1, $2, $3, $4)
     on conflict (filename) do update
       set sha256 = coalesce(form_1040_oob_migrations.sha256, excluded.sha256)`,
    [name, hash, appliedBy, notes],
  )
}

/**
 * Print the plan and return the files to execute.
 *
 * Throws on drift — that is a human decision, not something a runner should
 * resolve. Either the file was edited and needs a NEW migration number, or
 * production is wrong and someone has to say which.
 */
export function plan({ pending, applied, drifted }, { apply }) {
  if (applied.length) {
    console.log(`  ${applied.length} already applied, skipping`)
    const backfills = applied.filter((a) => a.backfill)
    if (backfills.length) {
      console.log(`    (${backfills.length} pre-ledger, hash backfilled on this run)`)
    }
  }

  if (drifted.length) {
    console.error("\n  DRIFT — these files changed after they were applied:")
    for (const d of drifted) {
      console.error(`    ${d.name}`)
      console.error(`      applied ${String(d.recorded).slice(0, 12)}…  on disk ${d.hash.slice(0, 12)}…`)
    }
    throw new Error(
      `${drifted.length} migration(s) differ from what was applied. Production and ` +
        "the file have diverged. Do not re-run an edited migration — write a new " +
        "one, or reconcile deliberately and update the ledger by hand.",
    )
  }

  if (!pending.length) {
    console.log("\n  Nothing pending. Every migration in this directory is already applied.")
    return []
  }

  console.log(`\n  ${pending.length} PENDING:`)
  for (const p of pending) console.log(`    ${p.name}`)
  if (!apply) {
    console.log("\n  Dry run — these would be applied. Re-run with --apply to commit.")
  }
  return pending
}
