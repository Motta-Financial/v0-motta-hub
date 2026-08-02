/**
 * Verification for lib/tax/intake/direct-lines.ts
 *
 *   npx tsx scripts/verify-1040-direct-entry.ts
 *
 * Runs with no credentials: the line definitions below mirror the TY2025
 * seed in form_1040_lines (verified against the live table on 2026-07-28).
 * If that seed's `computation` column changes, this file must be updated —
 * the point is to pin the arithmetic, so a silent divergence is exactly the
 * failure it should catch.
 */

import {
  checkLines,
  evaluateLines,
  standardDeductionAssist,
  taxAssist,
  taxOnOrdinaryIncome,
  toNumber,
  type EntryConstants,
  type LineDef,
} from "../lib/tax/intake/direct-lines"

let passed = 0
let failed = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
  } else {
    failed++
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function checkTrue(label: string, actual: boolean) {
  check(label, actual, true)
}

// ---------------------------------------------------------------------------
// The TY2025 line schema (computed lines carry the DSL; inputs do not)
// ---------------------------------------------------------------------------

const line = (
  lineCode: string,
  ordinal: number,
  section: string,
  dataType: LineDef["dataType"] = "currency",
  computation: LineDef["computation"] = null,
): LineDef => ({
  lineCode,
  ordinal,
  section,
  label: lineCode,
  shortLabel: null,
  dataType,
  enumOptions: null,
  isComputed: computation !== null,
  computation,
  scheduleRef: null,
  notes: null,
})

const DEFS: LineDef[] = [
  line("1a", 100, "income"),
  line("1b", 101, "income"),
  line("1c", 102, "income"),
  line("1d", 103, "income"),
  line("1e", 104, "income"),
  line("1f", 105, "income"),
  line("1g", 106, "income"),
  line("1h", 107, "income"),
  line("1z", 109, "income", "currency", {
    kind: "sum",
    operands: ["1a", "1b", "1c", "1d", "1e", "1f", "1g", "1h"],
  }),
  line("2a", 110, "income"),
  line("2b", 111, "income"),
  line("3a", 112, "income"),
  line("3b", 113, "income"),
  line("4a", 114, "income"),
  line("4b", 115, "income"),
  line("5a", 116, "income"),
  line("5b", 117, "income"),
  line("6a", 118, "income"),
  line("6b", 119, "income"),
  line("7", 121, "income"),
  line("8", 122, "income"),
  line("9", 123, "income", "currency", {
    kind: "sum",
    operands: ["1z", "2b", "3b", "4b", "5b", "6b", "7", "8"],
  }),
  line("10", 124, "income"),
  line("11", 125, "income", "currency", { kind: "diff", operands: ["9", "10"] }),
  line("12a", 200, "tax_credits"),
  line("12b", 201, "tax_credits"),
  line("12c", 202, "tax_credits", "currency", { kind: "sum", operands: ["12a", "12b"] }),
  line("13", 203, "tax_credits"),
  line("14", 204, "tax_credits", "currency", { kind: "sum", operands: ["12c", "13"] }),
  line("15", 205, "tax_credits", "currency", { kind: "subtract_floor_zero", operands: ["11", "14"] }),
  line("16", 206, "tax_credits"),
  line("17", 207, "tax_credits"),
  line("18", 208, "tax_credits", "currency", { kind: "sum", operands: ["16", "17"] }),
  line("19", 209, "tax_credits"),
  line("20", 210, "tax_credits"),
  line("21", 211, "tax_credits", "currency", { kind: "sum", operands: ["19", "20"] }),
  line("22", 212, "tax_credits", "currency", { kind: "subtract_floor_zero", operands: ["18", "21"] }),
  line("23", 213, "tax_credits"),
  line("24", 214, "tax_credits", "currency", { kind: "sum", operands: ["22", "23"] }),
  line("25a", 300, "payments"),
  line("25b", 301, "payments"),
  line("25c", 302, "payments"),
  line("25d", 303, "payments", "currency", { kind: "sum", operands: ["25a", "25b", "25c"] }),
  line("26", 304, "payments"),
  line("27", 305, "payments"),
  line("28", 306, "payments"),
  line("29", 307, "payments"),
  line("30", 308, "payments"),
  line("31", 309, "payments"),
  line("32", 310, "payments", "currency", { kind: "sum", operands: ["27", "28", "29", "30", "31"] }),
  line("33", 311, "payments", "currency", { kind: "sum", operands: ["25d", "26", "32"] }),
  line("34", 400, "refund", "currency", { kind: "subtract_floor_zero", operands: ["33", "24"] }),
  line("35a", 401, "refund"),
  line("35b", 402, "refund", "routing"),
  line("35c", 403, "refund", "enum"),
  line("35d", 404, "refund", "account"),
  line("36", 405, "refund"),
  line("37", 500, "amount_owed", "currency", { kind: "subtract_floor_zero", operands: ["24", "33"] }),
]

const MFJ_BRACKETS = [
  { rate: 0.1, upTo: 23850 },
  { rate: 0.12, upTo: 96950 },
  { rate: 0.22, upTo: 206700 },
  { rate: 0.24, upTo: 394600 },
  { rate: 0.32, upTo: 501050 },
  { rate: 0.35, upTo: 751600 },
  { rate: 0.37, upTo: null },
]

const CONSTANTS_UNVERIFIED: EntryConstants = {
  bracketsVerified: false,
  itemizedVerified: false,
  brackets: { single: [], mfj: MFJ_BRACKETS, mfs: [], hoh: [], qss: MFJ_BRACKETS },
  standardDeduction: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625, qss: 31500 },
  additionalStd65BlindSingle: 2000,
  additionalStd65BlindMfj: 1600,
}

const CONSTANTS_VERIFIED: EntryConstants = { ...CONSTANTS_UNVERIFIED, bracketsVerified: true }

// ---------------------------------------------------------------------------

console.log("\n1. Value coercion")
check("plain number", toNumber(1234.5), 1234.5)
check("currency string", toNumber("$1,234.56"), 1234.56)
check("parenthesised negative", toNumber("(500)"), -500)
check("parenthesised negative with formatting", toNumber("($1,500.25)"), -1500.25)
check("empty string", toNumber(""), 0)
check("null", toNumber(null), 0)
check("undefined", toNumber(undefined), 0)
check("non-numeric text", toNumber("n/a"), 0)
check("boolean true", toNumber(true), 1)

console.log("\n2. The computation chain (MFJ, wages + interest + dividends + IRA)")
const entries = {
  "1a": 120000,
  "2b": 1500,
  "3b": 4000,
  "4a": 20000,
  "4b": 15000,
  "10": 3000,
  "12a": 31500,
  "25a": 18000,
  "26": 2000,
}
const ev = evaluateLines(DEFS, entries)

check("1z total wages", ev["1z"].value, 120000)
check("9  total income", ev["9"].value, 140500)
check("11 AGI", ev["11"].value, 137500)
check("12c total deduction", ev["12c"].value, 31500)
check("14 total deductions", ev["14"].value, 31500)
check("15 taxable income", ev["15"].value, 106000)
check("24 total tax (line 16 still blank)", ev["24"].value, 0)
check("25d total withholding", ev["25d"].value, 18000)
check("33 total payments", ev["33"].value, 20000)
check("34 refund", ev["34"].value, 20000)
check("37 amount owed", ev["37"].value, 0)
check("computed lines are marked computed", ev["9"].source, "computed")
check("entered lines are marked entry", ev["1a"].source, "entry")

console.log("\n3. subtract_floor_zero never goes negative")
const owed = evaluateLines(DEFS, { "1a": 200000, "12a": 31500, "16": 30000, "25a": 5000 })
check("15 taxable income", owed["15"].value, 168500)
check("24 total tax", owed["24"].value, 30000)
check("33 total payments", owed["33"].value, 5000)
check("34 refund floors at zero", owed["34"].value, 0)
check("37 amount owed", owed["37"].value, 25000)

console.log("\n4. Bracket arithmetic")
// 23850 @ 10% = 2385; (96950-23850) @ 12% = 8772; (106000-96950) @ 22% = 1991
check("MFJ tax on 106,000", taxOnOrdinaryIncome(106000, MFJ_BRACKETS), 13148)
check("zero taxable income", taxOnOrdinaryIncome(0, MFJ_BRACKETS), 0)
check("negative taxable income", taxOnOrdinaryIncome(-5000, MFJ_BRACKETS), 0)
check("first band only", taxOnOrdinaryIncome(10000, MFJ_BRACKETS), 1000)
check("exactly the first ceiling", taxOnOrdinaryIncome(23850, MFJ_BRACKETS), 2385)
// 2385 + 8772 + 24145 + 45096 + 34064 + 87692.50 + 17908 across the seven bands
check("into the top open-ended band", taxOnOrdinaryIncome(800000, MFJ_BRACKETS), 220062.5)

console.log("\n5. Tax assist gates (fail-closed)")
const unverified = taxAssist(ev, "mfj", CONSTANTS_UNVERIFIED)
check("refuses while brackets unverified", unverified.ok, false)
checkTrue(
  "refusal names the gate",
  !unverified.ok && unverified.reason.includes("tax_brackets_verified"),
)

const verified = taxAssist(ev, "mfj", CONSTANTS_VERIFIED)
check("computes once verified", verified.ok, true)
check("and matches the bracket math", verified.ok && verified.value, 13148)

const withQualifiedDivs = evaluateLines(DEFS, { ...entries, "3a": 500 })
const preferential = taxAssist(withQualifiedDivs, "mfj", CONSTANTS_VERIFIED)
check("refuses when qualified dividends are present", preferential.ok, false)
checkTrue(
  "refusal names the worksheet",
  !preferential.ok && preferential.reason.includes("Capital Gain Tax Worksheet"),
)

const withCapGain = evaluateLines(DEFS, { ...entries, "7": 2500 })
check("refuses on net capital gain", taxAssist(withCapGain, "mfj", CONSTANTS_VERIFIED).ok, false)

const capLoss = evaluateLines(DEFS, { ...entries, "7": -3000 })
check("a capital LOSS does not trip the preferential gate", taxAssist(capLoss, "mfj", CONSTANTS_VERIFIED).ok, true)

const noIncome = evaluateLines(DEFS, { "12a": 31500 })
check("refuses when taxable income is zero", taxAssist(noIncome, "mfj", CONSTANTS_VERIFIED).ok, false)

console.log("\n6. Standard deduction assist")
const std = standardDeductionAssist("mfj", CONSTANTS_VERIFIED)
check("MFJ base", std.ok && std.value, 31500)
const std65 = standardDeductionAssist("mfj", CONSTANTS_VERIFIED, 2)
check("MFJ with two 65+/blind boxes", std65.ok && std65.value, 34700)
const stdSingle65 = standardDeductionAssist("single", CONSTANTS_VERIFIED, 1)
check("Single with one box", stdSingle65.ok && stdSingle65.value, 17750)
check("QSS tracks MFJ", standardDeductionAssist("qss", CONSTANTS_VERIFIED).ok && standardDeductionAssist("qss", CONSTANTS_VERIFIED).value, 31500)
const stdClamped = standardDeductionAssist("mfj", CONSTANTS_VERIFIED, 99)
check("box count clamps at 4", stdClamped.ok && stdClamped.value, 31500 + 4 * 1600)

console.log("\n7. Cross-line checks")
const badIra = evaluateLines(DEFS, { "4a": 20000, "4b": 25000 })
const iraWarnings = checkLines(badIra, "mfj")
checkTrue(
  "taxable IRA above gross is blocking",
  iraWarnings.some((w) => w.lineCode === "4b" && w.severity === "blocking"),
)

const badDivs = evaluateLines(DEFS, { "3a": 5000, "3b": 4000 })
checkTrue(
  "qualified above ordinary dividends is blocking",
  checkLines(badDivs, "mfj").some((w) => w.lineCode === "3a" && w.severity === "blocking"),
)

const badSS = evaluateLines(DEFS, { "6a": 10000, "6b": 9500 })
checkTrue(
  "social security above 85% warns",
  checkLines(badSS, "mfj").some((w) => w.lineCode === "6b" && w.severity === "warning"),
)

const bigLoss = evaluateLines(DEFS, { "7": -8000 })
checkTrue(
  "capital loss beyond the cap warns",
  checkLines(bigLoss, "mfj").some((w) => w.lineCode === "7" && w.severity === "warning"),
)
const mfsLoss = evaluateLines(DEFS, { "7": -2000 })
checkTrue(
  "the MFS capital-loss cap is 1,500",
  checkLines(mfsLoss, "mfs").some((w) => w.lineCode === "7"),
)
checkTrue(
  "and 2,000 is fine for MFJ",
  !checkLines(mfsLoss, "mfj").some((w) => w.lineCode === "7"),
)

const overRefund = evaluateLines(DEFS, { "1a": 50000, "12a": 31500, "25a": 5000, "35a": 9000 })
checkTrue(
  "refund above the overpayment is blocking",
  checkLines(overRefund, "mfj").some((w) => w.lineCode === "35a" && w.severity === "blocking"),
)

const splitOverRefund = evaluateLines(DEFS, {
  "1a": 50000,
  "12a": 31500,
  "25a": 5000,
  "35a": 3000,
  "36": 3000,
})
checkTrue(
  "refunded plus applied-forward above the overpayment is blocking",
  checkLines(splitOverRefund, "mfj").some((w) => w.lineCode === "36" && w.severity === "blocking"),
)

const partialDeposit = evaluateLines(DEFS, { "35b": "123456789" })
checkTrue(
  "a partial direct deposit is blocking",
  checkLines(partialDeposit, "mfj").some((w) => w.lineCode === "35b" && w.severity === "blocking"),
)

const badRouting = evaluateLines(DEFS, { "35b": "12345", "35c": "checking", "35d": "999" })
checkTrue(
  "a short routing number is blocking",
  checkLines(badRouting, "mfj").some((w) => w.lineCode === "35b" && w.severity === "blocking"),
)

const goodDeposit = evaluateLines(DEFS, { "35b": "123456789", "35c": "checking", "35d": "999" })
checkTrue("a complete direct deposit is clean", checkLines(goodDeposit, "mfj").length === 0)

const clean = checkLines(ev, "mfj")
check("the realistic return raises nothing", clean.length, 0)

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
