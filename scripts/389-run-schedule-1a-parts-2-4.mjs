// Apply scripts/389_form_1040_ty2025_schedule_1a_parts_2_4.sql to the live DB.
//
// Run with:
//   node --env-file=.env.local scripts/389-run-schedule-1a-parts-2-4.mjs           # DRY RUN (rollback)
//   node --env-file=.env.local scripts/389-run-schedule-1a-parts-2-4.mjs --apply   # commit
//
// Constants only — no DDL. Default is a DRY RUN inside a rolled-back
// transaction, which still proves every statement executes and prints the
// resulting rows. Re-running with --apply is idempotent.
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

const raw = await readFile(
  new URL("./389_form_1040_ty2025_schedule_1a_parts_2_4.sql", import.meta.url),
  "utf8",
)
const sql = raw.replace(/^\s*begin\s*;\s*$/im, "").replace(/^\s*commit\s*;\s*$/im, "")

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
  await client.query(sql)

  const { rows } = await client.query(`
    select key, value, left(coalesce(notes,''), 58) as notes
      from form_1040_constants
     where tax_year = 2025
       and (key like 'tips%' or key like 'overtime%' or key like 'qpvli%'
            or key like 'senior_deduction%')
     order by key`)
  console.log("\nSchedule 1-A constants (Parts II-V):")
  console.table(rows)

  // Part V (scripts/386) must already be here; Parts II-IV are new.
  const expected = [
    "overtime_deduction_cap", "overtime_deduction_cap_mfj",
    "qpvli_deduction_cap", "qpvli_phaseout_per_1000", "qpvli_phaseout_start",
    "qpvli_phaseout_start_mfj", "senior_deduction_max",
    "senior_deduction_phaseout_rate", "senior_deduction_phaseout_start",
    "senior_deduction_phaseout_start_mfj", "tips_deduction_cap",
    "tips_overtime_phaseout_per_1000", "tips_overtime_phaseout_start",
    "tips_overtime_phaseout_start_mfj",
  ]
  const got = rows.map((r) => r.key).sort()
  const missing = expected.filter((k) => !got.includes(k))
  if (missing.length) throw new Error(`missing constants: ${missing.join(", ")}`)
  console.log(`\nAll ${expected.length} Schedule 1-A constants present.`)

  if (APPLY) {
    await client.query("commit")
    console.log("\nCOMMITTED.")
    console.log("Next: npx tsx scripts/verify-1040-intake-preview.ts")
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
