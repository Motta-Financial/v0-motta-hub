/**
 * Runner for scripts/416_oob_migration_ledger.sql — creates the out-of-band
 * migration ledger and seeds it with what is already in production.
 *
 *   node --env-file=.env.local scripts/416-run-oob-ledger.mjs [--apply]
 *
 * Run this ONCE, before the next out-of-band migration. After it, both
 * runners (apply-1040-parity.mjs and 412-run-addend-role.mjs) apply only
 * files absent from the ledger — so staging a file for review stops meaning
 * deploying it.
 *
 * Asserts, before committing:
 *   ledger exists           the table and its unique key
 *   seeds present           407-410, 412-415 recorded as applied
 *   NOTHING pending         every file in the out-of-band directory is
 *                           accounted for. A pending file here would mean
 *                           something is in that folder that production has
 *                           never seen — which is exactly the state this
 *                           ledger exists to make visible, so it is reported
 *                           loudly rather than silently seeded as "applied".
 */
import { readFile } from "node:fs/promises"
import { Client } from "pg"
import { classify, stripTx } from "./lib/oob-migrations.mjs"

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

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const fail = []

try {
  await client.query("begin")
  await client.query(
    stripTx(await readFile(new URL("./416_oob_migration_ledger.sql", import.meta.url), "utf8")),
  )
  console.log("  applied 416_oob_migration_ledger.sql")

  const { rows: seeded } = await client.query(
    "select filename, applied_by, notes from form_1040_oob_migrations order by filename",
  )
  console.log(`\n── ledger seeded with ${seeded.length} migration(s) ──`)
  for (const r of seeded) {
    const flag = r.applied_by === "UNINTENDED" ? "  ⚠ applied without review" : ""
    console.log(`  ${r.filename.padEnd(52)} ${r.applied_by ?? ""}${flag}`)
  }

  for (const want of ["407", "408", "409", "410", "412", "413", "414", "415"]) {
    if (!seeded.some((r) => r.filename.startsWith(want))) {
      fail.push(`ledger missing a seed row for migration ${want}`)
    }
  }

  if (SQL_DIR) {
    const { pending, applied, drifted } = await classify(client, SQL_DIR)
    console.log(
      `\n── against ${SQL_DIR}: ${applied.length} applied, ${pending.length} pending, ${drifted.length} drifted ──`,
    )
    if (pending.length) {
      console.log("  PENDING (in the folder, never applied):")
      for (const p of pending) console.log(`    ${p.name}`)
      fail.push(
        `${pending.length} file(s) in the out-of-band directory are not in the ledger. ` +
          "Either they were never applied — in which case apply them deliberately via " +
          "apply-1040-parity.mjs — or they were, and the seed list in 416 is incomplete. " +
          "Do not guess.",
      )
    }
  } else {
    console.log("\n  (no --sql-dir given; skipped the directory cross-check)")
  }

  if (fail.length) {
    console.error("\nFAILED:")
    for (const f of fail) console.error("  - " + f)
    throw new Error(`${fail.length} assertion(s) failed`)
  }

  console.log("\nAll assertions passed.")
  if (APPLY) {
    await client.query("commit")
    console.log("416 APPLIED (committed). Runners are now ledger-gated.")
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
