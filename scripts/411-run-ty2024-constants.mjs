/**
 * Runner for scripts/411_form_1040_ty2024_constants.sql.
 *
 * Dry run by default; --apply commits. The migration runs inside one
 * transaction this script owns, and it only commits if every assertion below
 * holds. A failed run leaves prod untouched.
 *
 * What it checks, and why each one:
 *   TY2025 untouched        44 live returns depend on the year that works
 *   53 keys seeded          the full TY2024 set, no silent partial load
 *   19 keys ABSENT          Schedule 1-A + SALT phase-down are OBBBA, and a
 *                           2024 return must not see them
 *   gates still false       seeding is not verifying; lines 12 and 16 must
 *                           keep reporting unavailable until a human signs off
 *   brackets well-formed    7 tiers, ascending edges, open top — a
 *                           transposed digit usually breaks one of these
 *   2024 < 2025 amounts     inflation only goes one way; catches a row that
 *                           was copied from 2025 instead of transcribed
 *   SALT flat at 10,000     the single most consequential 2024-vs-2025 delta
 *
 * Usage: node --env-file=.env.local scripts/411-run-ty2024-constants.mjs [--apply]
 */
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

const raw = await readFile(
  new URL("./411_form_1040_ty2024_constants.sql", import.meta.url),
  "utf8",
)
const sql = raw.replace(/^\s*begin\s*;\s*$/gim, "").replace(/^\s*commit\s*;\s*$/gim, "")

let url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL in env")
  process.exit(1)
}
url = url.replace(/([?&])sslmode=[^&]*(&?)/, (_, pre, post) => (post ? pre : ""))

const FORBIDDEN = [
  "tips_deduction_cap", "tips_overtime_phaseout_per_1000",
  "tips_overtime_phaseout_start", "tips_overtime_phaseout_start_mfj",
  "overtime_deduction_cap", "overtime_deduction_cap_mfj",
  "qpvli_deduction_cap", "qpvli_phaseout_per_1000",
  "qpvli_phaseout_start", "qpvli_phaseout_start_mfj",
  "senior_deduction_max", "senior_deduction_phaseout_rate",
  "senior_deduction_phaseout_start", "senior_deduction_phaseout_start_mfj",
  "salt_phaseout_start", "salt_phaseout_start_mfs", "salt_phaseout_rate",
  "salt_phaseout_floor", "salt_phaseout_floor_mfs",
]

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const fail = []

try {
  const before2025 = (
    await client.query("select count(*)::int n from form_1040_constants where tax_year = 2025")
  ).rows[0].n

  await client.query("begin")
  await client.query(sql)

  const get = async (year, key) =>
    (
      await client.query(
        "select value from form_1040_constants where tax_year = $1 and key = $2",
        [year, key],
      )
    ).rows[0]?.value

  // ── TY2025 untouched ────────────────────────────────────────────────
  const after2025 = (
    await client.query("select count(*)::int n from form_1040_constants where tax_year = 2025")
  ).rows[0].n
  if (after2025 !== before2025) fail.push(`TY2025 count moved: ${before2025} -> ${after2025}`)

  // ── Key inventory ───────────────────────────────────────────────────
  const { rows: keys } = await client.query(
    "select key from form_1040_constants where tax_year = 2024 order by key",
  )
  const have = new Set(keys.map((r) => r.key))
  console.log(`TY2024 keys after migration : ${have.size}`)

  // layout_verified pre-exists from scripts/401; this migration adds 53.
  if (!have.has("layout_verified")) fail.push("layout_verified disappeared — scripts/401 gate lost")
  if (have.size !== 54) fail.push(`expected 54 TY2024 keys (53 + layout_verified), got ${have.size}`)

  const present = FORBIDDEN.filter((k) => have.has(k))
  if (present.length) fail.push(`OBBBA-only keys present for 2024: ${present.join(", ")}`)
  console.log(`OBBBA-only keys absent      : ${FORBIDDEN.length - present.length}/${FORBIDDEN.length}`)

  // ── Gates must stay shut ────────────────────────────────────────────
  for (const gate of ["tax_brackets_verified", "itemized_constants_verified", "layout_verified"]) {
    const v = await get(2024, gate)
    console.log(`${gate.padEnd(28)}: ${v}`)
    if (v !== false) fail.push(`${gate} must be false after seeding, got ${JSON.stringify(v)}`)
  }

  // ── Bracket tables well-formed ──────────────────────────────────────
  for (const fs of ["single", "mfj", "hoh", "mfs"]) {
    const b = await get(2024, `tax_brackets_${fs}`)
    if (!Array.isArray(b) || b.length !== 7) {
      fail.push(`tax_brackets_${fs}: expected 7 tiers, got ${b?.length}`)
      continue
    }
    if (b[6][1] !== null) fail.push(`tax_brackets_${fs}: top tier must have a null ceiling`)
    const edges = b.slice(0, 6).map((t) => t[1])
    for (let i = 1; i < edges.length; i++) {
      if (!(edges[i] > edges[i - 1])) {
        fail.push(`tax_brackets_${fs}: edges not ascending at ${edges[i - 1]} -> ${edges[i]}`)
      }
    }
    const rates = b.map((t) => t[0])
    const want = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]
    if (rates.join(",") !== want.join(",")) fail.push(`tax_brackets_${fs}: rate ladder is ${rates}`)
  }
  console.log("bracket tables              : 4 × 7 tiers, ascending, open top")

  // ── Inflation sanity: 2024 must be below 2025 ───────────────────────
  // Not true of statutory amounts, so only the indexed ones are compared.
  const indexed = [
    "std_deduction_single", "std_deduction_mfj", "std_deduction_hoh",
    "qdcg_zero_top_single", "qdcg_zero_top_mfj",
    "qdcg_fifteen_top_single", "qdcg_fifteen_top_mfj",
  ]
  for (const k of indexed) {
    const a = await get(2024, k)
    const b = await get(2025, k)
    if (typeof a === "number" && typeof b === "number" && !(a < b)) {
      fail.push(`${k}: TY2024 ${a} should be below TY2025 ${b} — looks copied, not transcribed`)
    }
  }
  // Aged/blind went UP from 2024 to 2025 too, but the pair is inverted
  // between statuses, so check the relationship rather than the direction.
  const blindSingle = await get(2024, "additional_std_65_blind_single")
  const blindMfj = await get(2024, "additional_std_65_blind_mfj")
  if (!(blindSingle > blindMfj)) {
    fail.push(`§63(f): unmarried amount ${blindSingle} must exceed the married amount ${blindMfj}`)
  }
  console.log(`indexed amounts             : all ${indexed.length} below TY2025`)

  // ── The delta that matters most ─────────────────────────────────────
  const salt = await get(2024, "salt_cap")
  const saltMfs = await get(2024, "salt_cap_mfs")
  if (salt !== 10000) fail.push(`salt_cap must be 10000 for TY2024, got ${salt}`)
  if (saltMfs !== 5000) fail.push(`salt_cap_mfs must be 5000 for TY2024, got ${saltMfs}`)
  console.log(`SALT cap                    : ${salt} / ${saltMfs} MFS, no phase-down`)

  // ── EIC shape matches what the estimator reads ──────────────────────
  const eic = await get(2024, "eic_params")
  for (const k of ["rate", "earnedAmount", "maxCredit", "phaseoutRate", "phaseoutStart", "phaseoutStartMfj"]) {
    if (!Array.isArray(eic?.[k]) || eic[k].length !== 4) {
      fail.push(`eic_params.${k}: expected a 4-element array [none,1,2,3+]`)
    }
  }
  if (typeof eic?.investmentIncomeLimit !== "number") {
    fail.push("eic_params.investmentIncomeLimit missing")
  }
  console.log(`eic_params                  : max credit ${eic?.maxCredit?.join(" / ")}`)

  if (fail.length) {
    console.error("\nFAILED:")
    for (const f of fail) console.error("  - " + f)
    throw new Error(`${fail.length} assertion(s) failed`)
  }

  console.log("\nAll assertions passed.")
  if (APPLY) {
    await client.query("commit")
    console.log("411 APPLIED (committed).")
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
