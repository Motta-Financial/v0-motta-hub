/**
 * Verification for lib/forms/form-1040-estimates.ts
 *
 *   npx tsx scripts/verify-1040-estimates.ts
 *
 * Runs with no credentials. The line schema and constants below mirror the
 * TY2025 seeds (scripts/141 + 352 + 372 + 377 + 386) so the arithmetic can be
 * pinned without a database or a real ProConnect export. If those seeds change,
 * this file must change with them — a silent divergence is exactly the failure
 * it exists to catch.
 *
 * Every expected figure traces to a published source:
 *   - Rev. Proc. 2024-40: bracket tables, QD/LTCG breakpoints, EIC table
 *   - OBBBA (P.L. 119-21) 70102/70104: standard deduction, CTC
 *   - Schedule 1-A (Form 1040) 2025 Part V: senior deduction
 *   - Form 1040 Social Security Benefits Worksheet / Pub. 915
 *   - Schedule 8812 (Form 1040) 2025: CTC / ODC / ACTC
 *
 * Cases tagged REGRESSION pin a bug fixed on 2026-08-11 and should fail
 * against the previous implementation.
 */

import {
  evaluateComputedLines,
  type FieldCell,
  type Form1040Constant,
  type Form1040Data,
  type Form1040Line,
} from "../lib/forms/form-1040"
import { estimateDeterministicLines, type LineInputRow } from "../lib/forms/form-1040-estimates"

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

// ---------------------------------------------------------------------------
// TY2025 line schema (only the lines the estimator reads or writes, plus the
// computed chain that carries values between them). Ordinals follow the
// post-386 scale so 13b sorts between 13 and 14.
// ---------------------------------------------------------------------------

type Comp = Form1040Line["computation"]

let nextId = 1
const mk = (
  lineCode: string,
  ordinal: number,
  section: string,
  dataType = "currency",
  computation: Comp = null,
): Form1040Line => ({
  id: nextId++,
  taxYear: 2025,
  lineCode,
  parentCode: null,
  ordinal,
  section,
  label: lineCode,
  shortLabel: null,
  dataType,
  enumOptions: null,
  isComputed: computation !== null,
  computation,
  scheduleRef: null,
  worksheetRef: null,
  attachesForm: null,
  isRefundPath: false,
  notApplicable: false,
  notes: null,
})

const LINES: Form1040Line[] = [
  mk("1z", 1100, "income"),
  mk("2a", 1120, "income"),
  mk("2b", 1130, "income"),
  mk("3a", 1140, "income"),
  mk("3b", 1150, "income"),
  mk("4b", 1160, "income"),
  mk("5b", 1170, "income"),
  mk("6a", 1180, "income"),
  mk("6b", 1190, "income"),
  mk("6c", 1200, "income", "boolean"),
  mk("7", 1210, "income"),
  mk("8", 1220, "income"),
  mk("9", 1230, "income", "currency", {
    kind: "sum",
    operands: ["1z", "2b", "3b", "4b", "5b", "6b", "7", "8"],
  }),
  mk("10", 1240, "income"),
  mk("11", 1250, "income", "currency", { kind: "diff", operands: ["9", "10"] }),
  mk("12a", 2000, "tax_credits"),
  mk("12b", 2010, "tax_credits"),
  mk("12c", 2020, "tax_credits", "currency", { kind: "sum", operands: ["12a", "12b"] }),
  mk("13", 2030, "tax_credits"),
  mk("13b", 2035, "tax_credits"),
  mk("14", 2040, "tax_credits", "currency", { kind: "sum", operands: ["12c", "13", "13b"] }),
  mk("15", 2050, "tax_credits", "currency", { kind: "subtract_floor_zero", operands: ["11", "14"] }),
  mk("16", 2060, "tax_credits"),
  mk("17", 2070, "tax_credits"),
  mk("18", 2080, "tax_credits", "currency", { kind: "sum", operands: ["16", "17"] }),
  mk("19", 2090, "tax_credits"),
  mk("23", 2130, "tax_credits"),
  mk("27", 2270, "payments"),
  mk("28", 2280, "payments"),
]

// ---------------------------------------------------------------------------
// TY2025 constants, as the JSONB driver hands them back: numbers as numbers,
// arrays as arrays, and age_65_cutoff_birthdate as a PLAIN STRING (it is
// seeded as the JSON string '"1961-01-02"', which jsonb round-trips to a JS
// string that is not itself valid JSON). That shape is load-bearing.
// ---------------------------------------------------------------------------

const K = (key: string, value: unknown): Form1040Constant => ({ taxYear: 2025, key, value, notes: null })

const CONSTANTS: Form1040Constant[] = [
  // OBBBA standard deduction (scripts/352)
  K("std_deduction_single", 15750),
  K("std_deduction_mfj", 31500),
  K("std_deduction_hoh", 23625),
  K("std_deduction_mfs", 15750),
  // Rev. Proc. 2024-40 3.15(3)
  K("additional_std_65_blind_single", 2000),
  K("additional_std_65_blind_mfj", 1600),
  K("age_65_cutoff_birthdate", "1961-01-02"),
  // Schedule 1-A Part V (scripts/386)
  K("senior_deduction_max", 6000),
  K("senior_deduction_phaseout_start", 75000),
  K("senior_deduction_phaseout_start_mfj", 150000),
  K("senior_deduction_phaseout_rate", 0.06),
  // Social Security worksheet
  K("ss_base_single", 25000),
  K("ss_adj_single", 34000),
  K("ss_base_mfj", 32000),
  K("ss_adj_mfj", 44000),
  // Rev. Proc. 2024-40 Tables 1-4
  K("tax_brackets_single", [[0.1, 11925], [0.12, 48475], [0.22, 103350], [0.24, 197300], [0.32, 250525], [0.35, 626350], [0.37, null]]),
  K("tax_brackets_mfj", [[0.1, 23850], [0.12, 96950], [0.22, 206700], [0.24, 394600], [0.32, 501050], [0.35, 751600], [0.37, null]]),
  K("tax_brackets_mfs", [[0.1, 11925], [0.12, 48475], [0.22, 103350], [0.24, 197300], [0.32, 250525], [0.35, 375800], [0.37, null]]),
  K("tax_brackets_hoh", [[0.1, 17000], [0.12, 64850], [0.22, 103350], [0.24, 197300], [0.32, 250525], [0.35, 626350], [0.37, null]]),
  K("qdcg_zero_top_single", 48350),
  K("qdcg_zero_top_mfj", 96700),
  K("qdcg_zero_top_mfs", 48350),
  K("qdcg_zero_top_hoh", 64750),
  K("qdcg_fifteen_top_single", 533400),
  K("qdcg_fifteen_top_mfj", 600050),
  K("qdcg_fifteen_top_mfs", 300000),
  K("qdcg_fifteen_top_hoh", 566700),
  // Schedule 8812
  K("dependent_credit_ctc", 2200),
  K("dependent_credit_odc", 500),
  K("ctc_refundable_limit", 1700),
  K("earned_income_threshold_ctc", 2500),
  K("mfj_ctc_phaseout_start", 400000),
  K("other_ctc_phaseout_start", 200000),
  // NIIT / Additional Medicare (scripts/376) — present so stage 23 can run
  K("niit_threshold_single", 200000),
  K("niit_threshold_mfj", 250000),
  K("niit_threshold_mfs", 125000),
  K("addl_medicare_threshold_single", 200000),
  K("addl_medicare_threshold_mfj", 250000),
  K("addl_medicare_threshold_mfs", 125000),
]

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FS_CODE = { single: "1", mfj: "2", mfs: "3", hoh: "4", qss: "5" } as const
type StatusName = keyof typeof FS_CODE

interface Dependent {
  /** Type enum: 1/2 = child, 3/6 = other dependent, 4/5 = not a dependent. */
  type: number
  dob: string
  ctcFlag?: number
  eicFlag?: number
}

interface Scenario {
  status: StatusName
  /** Taxpayer date of birth; omit for a filer comfortably under 65. */
  dob?: string
  /** Spouse date of birth (s1/c1000100012, scripts/379). */
  spouseDob?: string
  /** Taxpayer "Blind?" flag (s1/c1000100011). */
  blind?: boolean
  /** Spouse "Blind?" flag (s1/c1000100013). */
  spouseBlind?: boolean
  deps?: Dependent[]
  /** Line values as the renderer would have produced them. */
  lines?: Record<string, number | boolean>
  /** form_1040_line_inputs rows; omit to leave the Schedule A gate inert. */
  lineInputs?: LineInputRow[]
  /** Extra raw cells, e.g. Schedule A amounts for the 12a gate. */
  cells?: FieldCell[]
}

const cell = (seriesId: string, prefixId: string, codeId: string, val: string): FieldCell => ({
  seriesId,
  prefixId,
  codeId,
  suffixId: "x1000",
  val,
})

/** Build cells + data the way the GET route does, then run the estimator. */
function run(s: Scenario): Form1040Data {
  const cells: FieldCell[] = [cell("s1", "p0", "c1000100036", FS_CODE[s.status])]
  if (s.dob) cells.push(cell("s1", "p0", "c1000100010", s.dob))
  if (s.spouseDob) cells.push(cell("s1", "p0", "c1000100012", s.spouseDob))
  // ProConnect writes '0' when the box is clear, so mirror that rather than
  // omitting the cell — the clear case is what every real export shows.
  if (s.blind !== undefined) cells.push(cell("s1", "p0", "c1000100011", s.blind ? "1" : "0"))
  if (s.spouseBlind !== undefined) cells.push(cell("s1", "p0", "c1000100013", s.spouseBlind ? "1" : "0"))
  s.deps?.forEach((dep, i) => {
    const prefix = `p${i + 1}`
    cells.push(cell("s2", prefix, "c1000200006", String(dep.type)))
    cells.push(cell("s2", prefix, "c1000200002", dep.dob))
    if (dep.ctcFlag !== undefined) cells.push(cell("s2", prefix, "c1000200014", String(dep.ctcFlag)))
    if (dep.eicFlag !== undefined) cells.push(cell("s2", prefix, "c1000200007", String(dep.eicFlag)))
  })
  if (s.cells) cells.push(...s.cells)

  const data: Form1040Data = {}
  for (const line of LINES) {
    const v = s.lines?.[line.lineCode]
    data[line.lineCode] = {
      value: v === undefined ? null : v,
      line,
      source: v === undefined ? "proconnect" : "input",
    }
  }
  // renderForm1040 ends with evaluateComputedLines; mirror that.
  const rendered = evaluateComputedLines(data, LINES, CONSTANTS)
  return estimateDeterministicLines(rendered, cells, LINES, CONSTANTS, s.lineInputs ?? [])
}

const val = (d: Form1040Data, lineCode: string) => d[lineCode]?.value ?? null
const src = (d: Form1040Data, lineCode: string) => d[lineCode]?.source ?? null

// ===========================================================================
// 1. Standard deduction (line 12a)
// ===========================================================================
console.log("\nStandard deduction (12a)")
{
  check("Single, under 65", val(run({ status: "single", lines: { "1z": 60000 } }), "12a"), 15750)
  check("MFJ, both under 65", val(run({ status: "mfj", lines: { "1z": 60000 } }), "12a"), 31500)
  check("HOH, under 65", val(run({ status: "hoh", lines: { "1z": 60000 } }), "12a"), 23625)
  check("MFS, under 65", val(run({ status: "mfs", lines: { "1z": 60000 } }), "12a"), 15750)

  // REGRESSION: constJson returned null for the jsonb *string* cutoff, so the
  // 65+ increment silently never applied. Pub. 17 Table 1-1: Single 65+ is
  // 17,750; HOH 65+ is 25,625; MFJ with one spouse 65+ is 33,100.
  check(
    "REGRESSION Single 65+ gets the 2,000 increment",
    val(run({ status: "single", dob: "1955-06-01", lines: { "1z": 60000 } }), "12a"),
    17750,
  )
  check(
    "REGRESSION HOH 65+ gets 2,000 (unmarried)",
    val(run({ status: "hoh", dob: "1955-06-01", lines: { "1z": 60000 } }), "12a"),
    25625,
  )
  check(
    "REGRESSION MFJ taxpayer 65+ gets 1,600",
    val(run({ status: "mfj", dob: "1955-06-01", lines: { "1z": 60000 } }), "12a"),
    33100,
  )
  // A surviving spouse is not "unmarried and not a surviving spouse", so QSS
  // takes 1,600, not 2,000 (Rev. Proc. 2024-40 3.15(3)).
  check(
    "QSS 65+ takes the 1,600 increment, not 2,000",
    val(run({ status: "qss", dob: "1955-06-01", lines: { "1z": 60000 } }), "12a"),
    33100,
  )
  // §63(f) counts one box per condition per person. Before scripts/379
  // mapped the spouse cells, only the taxpayer's boxes were ever counted,
  // so every one of these MFJ cases came back 1,600 or 3,200 light.
  check(
    "REGRESSION MFJ both spouses 65+ gets 3,200",
    val(
      run({ status: "mfj", dob: "1955-06-01", spouseDob: "1954-02-01", lines: { "1z": 60000 } }),
      "12a",
    ),
    34700,
  )
  check(
    "REGRESSION MFJ spouse 65+, taxpayer under 65, gets 1,600",
    val(
      run({ status: "mfj", dob: "1975-06-01", spouseDob: "1954-02-01", lines: { "1z": 60000 } }),
      "12a",
    ),
    33100,
  )
  check(
    "REGRESSION MFJ all four boxes (both 65+, both blind) gets 6,400",
    val(
      run({
        status: "mfj",
        dob: "1955-06-01",
        spouseDob: "1954-02-01",
        blind: true,
        spouseBlind: true,
        lines: { "1z": 60000 },
      }),
      "12a",
    ),
    37900,
  )
  check(
    "REGRESSION single 65+ and blind gets 2 × 2,000",
    val(run({ status: "single", dob: "1955-06-01", blind: true, lines: { "1z": 60000 } }), "12a"),
    19750,
  )
  // The overwhelmingly common real case: PTO writes '0' into both Blind?
  // cells on every joint return. A present-but-clear flag must count zero.
  check(
    "Blind? = 0 adds nothing",
    val(
      run({
        status: "mfj",
        dob: "1975-06-01",
        spouseDob: "1975-06-01",
        blind: false,
        spouseBlind: false,
        lines: { "1z": 60000 },
      }),
      "12a",
    ),
    31500,
  )
  // statusKey folds QSS into "mfj" for the rate schedule and basic deduction,
  // so a spouse test written against `fs` would give a surviving spouse a
  // phantom second person off a leftover DOB cell. Must read isMfj.
  check(
    "REGRESSION QSS ignores a stray spouse DOB cell (12a)",
    val(
      run({
        status: "qss",
        dob: "1955-06-01",
        spouseDob: "1954-02-01",
        spouseBlind: true,
        lines: { "1z": 60000 },
      }),
      "12a",
    ),
    33100,
  )
  // On MFS the spouse's boxes need the spouse to have no gross income and to
  // not be another taxpayer's dependent — neither is in the export, so they
  // are deliberately not claimed.
  check(
    "MFS does not claim spouse age/blindness boxes",
    val(
      run({
        status: "mfs",
        dob: "1975-06-01",
        spouseDob: "1954-02-01",
        spouseBlind: true,
        lines: { "1z": 60000 },
      }),
      "12a",
    ),
    15750,
  )
  // Born 1961-01-02 exactly is NOT 65 by 2025-12-31 (cutoff is "before").
  check(
    "Born on the cutoff date is not 65+",
    val(run({ status: "single", dob: "1961-01-02", lines: { "1z": 60000 } }), "12a"),
    15750,
  )
  // A pre-filled 12a (mapped or user-entered) must not be overwritten.
  check(
    "Existing 12a is left alone",
    val(run({ status: "single", lines: { "1z": 60000, "12a": 41000 } }), "12a"),
    41000,
  )
}

// ===========================================================================
// 1b. The Schedule A gate on line 12a
//
// Addresses in these rows are invented for the test. The real ones are
// partner-confidential and live only in form_1040_line_inputs.
// ===========================================================================
console.log("\nSchedule A gate (12a)")
{
  const schARow = (codeId: string): LineInputRow => ({
    lineCode: "12a",
    sourceKind: "schedule",
    sourceRef: "Schedule A, line 17",
    seriesId: "sA",
    codeId,
    role: "input",
  })
  const forceRow: LineInputRow = {
    lineCode: "12a",
    sourceKind: "statutory",
    sourceRef: null,
    seriesId: "sA",
    codeId: "cFORCE",
    role: "control",
  }
  const schACell = (codeId: string, amount: number) => cell("sA", "p0", codeId, String(amount))
  const base = { status: "single" as StatusName, lines: { "1z": 90000 } }

  // No rows at all: the gate must not change existing behaviour.
  check("Inert with no derivation rows", val(run(base), "12a"), 15750)

  // Rows present but the client entered no Schedule A amounts.
  check(
    "Rows present, no Schedule A cells in the export",
    val(run({ ...base, lineInputs: [schARow("c1"), schARow("c2")] }), "12a"),
    15750,
  )

  // Upper bound 9,000 < 15,750: itemizing provably cannot win, so the
  // statutory figure is safe even though Schedule A data exists.
  check(
    "Schedule A below the standard deduction still asserts it",
    val(
      run({
        ...base,
        lineInputs: [schARow("c1"), schARow("c2")],
        cells: [schACell("c1", 6000), schACell("c2", 3000)],
      }),
      "12a",
    ),
    15750,
  )

  // Upper bound 26,000 > 15,750: indeterminate, so write nothing rather than
  // a plausible wrong number. Everything downstream goes quiet with it.
  {
    const d = run({
      ...base,
      lineInputs: [schARow("c1"), schARow("c2")],
      cells: [schACell("c1", 20000), schACell("c2", 6000)],
    })
    check("Schedule A above the standard deduction suppresses 12a", val(d, "12a"), null)
    // The cascade matters as much as the gate: subtract_floor_zero reads a
    // null deduction as zero, so without this line 15 would render the full
    // 90,000 AGI as taxable income and line 16 would tax it.
    check("...and taxable income (15) is blank, not the full AGI", val(d, "15"), null)
    check("...and line 14 is blank", val(d, "14"), null)
    check("...and line 16 is not estimated off a wrong deduction", val(d, "16"), null)
  }
  // Credits limited against tax must go quiet too, rather than being limited
  // against a tax computed on an unknown deduction.
  {
    const d = run({
      status: "single",
      deps: [{ type: 1, dob: "2015-03-01", ctcFlag: 1 }],
      lines: { "1z": 90000 },
      lineInputs: [
        { lineCode: "12a", sourceKind: "schedule", sourceRef: "Schedule A, line 17", seriesId: "sA", codeId: "c1", role: "input" },
      ],
      cells: [cell("sA", "p0", "c1", "26000")],
    })
    check("...and 19 is not estimated", val(d, "19"), null)
    check("...and 28 is not estimated", val(d, "28"), null)
  }

  // A set force-itemized control field wins regardless of the bound.
  check(
    "A set control field suppresses 12a",
    val(
      run({
        ...base,
        lineInputs: [schARow("c1"), forceRow],
        cells: [schACell("c1", 100), schACell("cFORCE", 1)],
      }),
      "12a",
    ),
    null,
  )
  check(
    "An unset control field does not suppress 12a",
    val(
      run({
        ...base,
        lineInputs: [schARow("c1"), forceRow],
        cells: [schACell("c1", 100)],
      }),
      "12a",
    ),
    15750,
  )
  // Rows for other lines must not leak into the 12a decision.
  check(
    "Rows for other lines are ignored",
    val(
      run({
        ...base,
        lineInputs: [{ ...schARow("c1"), lineCode: "10" }],
        cells: [schACell("c1", 99000)],
      }),
      "12a",
    ),
    15750,
  )
}

// ===========================================================================
// 2. Enhanced deduction for seniors (line 13b) — Schedule 1-A Part V
// ===========================================================================
console.log("\nSenior deduction (13b)")
{
  // No phase-down below the threshold: full 6,000.
  check(
    "Single 65+, MAGI under 75,000",
    val(run({ status: "single", dob: "1955-06-01", lines: { "1z": 50000 } }), "13b"),
    6000,
  )
  // 6,000 - 6% x (100,000 - 75,000) = 4,500
  check(
    "Single 65+, MAGI 100,000 phases down to 4,500",
    val(run({ status: "single", dob: "1955-06-01", lines: { "1z": 100000 } }), "13b"),
    4500,
  )
  // Fully phased out at 75,000 + 6,000/0.06 = 175,000.
  check(
    "Single 65+, MAGI 175,000 is fully phased out",
    val(run({ status: "single", dob: "1955-06-01", lines: { "1z": 175000 } }), "13b"),
    null,
  )
  // 6,000 - 6% x (160,000 - 150,000) = 5,400, one eligible person.
  check(
    "MFJ 65+, MAGI 160,000 phases down to 5,400",
    val(run({ status: "mfj", dob: "1955-06-01", lines: { "1z": 160000 } }), "13b"),
    5400,
  )
  // The deduction is PER PERSON. Before scripts/379 mapped the spouse date
  // of birth only the taxpayer could ever be counted, so a retired couple —
  // precisely the households drawing Social Security — lost up to 6,000.
  check(
    "REGRESSION MFJ both 65+, MAGI under 150,000 claims 12,000",
    val(
      run({ status: "mfj", dob: "1955-06-01", spouseDob: "1954-02-01", lines: { "1z": 120000 } }),
      "13b",
    ),
    12000,
  )
  check(
    "REGRESSION MFJ both 65+, MAGI 160,000 claims 2 × 5,400",
    val(
      run({ status: "mfj", dob: "1955-06-01", spouseDob: "1954-02-01", lines: { "1z": 160000 } }),
      "13b",
    ),
    10800,
  )
  check(
    "REGRESSION MFJ spouse 65+ alone still claims one share",
    val(
      run({ status: "mfj", dob: "1975-06-01", spouseDob: "1954-02-01", lines: { "1z": 120000 } }),
      "13b",
    ),
    6000,
  )
  // Phase-out is computed per person, then multiplied — two people at a fully
  // phased-out MAGI still claim nothing.
  check(
    "MFJ both 65+ fully phased out at MAGI 250,000",
    val(
      run({ status: "mfj", dob: "1955-06-01", spouseDob: "1954-02-01", lines: { "1z": 250000 } }),
      "13b",
    ),
    null,
  )
  // QSS has no living spouse, so a spouse DOB cell must never add a share.
  check(
    "QSS ignores a stray spouse DOB cell",
    val(
      run({ status: "qss", dob: "1955-06-01", spouseDob: "1954-02-01", lines: { "1z": 50000 } }),
      "13b",
    ),
    6000,
  )
  // REGRESSION: QSS is not "married filing jointly" on Schedule 1-A line 32,
  // so it takes the 75,000 threshold. Collapsing QSS to MFJ would give 6,000.
  check(
    "REGRESSION QSS 65+ uses the 75,000 threshold",
    val(run({ status: "qss", dob: "1955-06-01", lines: { "1z": 100000 } }), "13b"),
    4500,
  )
  // Part V: "If married, you must file jointly to claim this deduction."
  check(
    "MFS 65+ gets no senior deduction",
    val(run({ status: "mfs", dob: "1955-06-01", lines: { "1z": 50000 } }), "13b"),
    null,
  )
  check(
    "Under 65 gets no senior deduction",
    val(run({ status: "single", dob: "1975-06-01", lines: { "1z": 50000 } }), "13b"),
    null,
  )
  // The whole point of the line: it has to reach taxable income.
  // 60,000 - (15,750 + 2,000) - 6,000 = 36,250
  {
    const d = run({ status: "single", dob: "1955-06-01", lines: { "1z": 60000 } })
    check("13b flows into line 14", val(d, "14"), 23750)
    check("13b reduces taxable income (15)", val(d, "15"), 36250)
    check("13b is badged estimated", src(d, "13b"), "estimated")
  }

  // Deploy-order safety: if this code ships before scripts/386 is applied,
  // line 13b does not exist in form_1040_lines. setEstimate must no-op rather
  // than throw, leaving the pre-386 line 14 (12c + 13) intact.
  {
    const pre386 = LINES.filter((l) => l.lineCode !== "13b").map((l) =>
      l.lineCode === "14" ? { ...l, computation: { kind: "sum" as const, operands: ["12c", "13"] } } : l,
    )
    const data: Form1040Data = {}
    for (const line of pre386) {
      data[line.lineCode] = { value: line.lineCode === "1z" ? 60000 : null, line, source: "proconnect" }
    }
    const d = estimateDeterministicLines(
      evaluateComputedLines(data, pre386, CONSTANTS),
      [
        cell("s1", "p0", "c1000100036", FS_CODE.single),
        cell("s1", "p0", "c1000100010", "1955-06-01"),
      ],
      pre386,
      CONSTANTS,
    )
    check("Without line 13b seeded, 12a still estimates", val(d, "12a"), 17750)
    check("Without line 13b seeded, nothing is written for it", val(d, "13b"), null)
    check("Without line 13b seeded, taxable income ignores it", val(d, "15"), 42250)
  }
}

// ===========================================================================
// 3. Taxable Social Security (line 6b)
// ===========================================================================
console.log("\nTaxable Social Security (6b)")
{
  // Provisional 10,000 + 10,000 = 20,000 < 25,000 base: nothing taxable.
  check(
    "Single below the base amount",
    val(run({ status: "single", lines: { "6a": 20000, "1z": 10000 } }), "6b"),
    null,
  )
  // Provisional 40,000. Over base 15,000; band 9,000.
  // tier1 = min(50% x 9,000, 50% x 20,000) = 4,500; tier2 = 85% x 6,000 = 5,100.
  check(
    "Single in the 85% tier",
    val(run({ status: "single", lines: { "6a": 20000, "1z": 30000 } }), "6b"),
    9600,
  )
  // Provisional 55,000. Over base 23,000; band 12,000.
  // tier1 = min(6,000, 15,000) = 6,000; tier2 = 85% x 11,000 = 9,350.
  check(
    "MFJ in the 85% tier",
    val(run({ status: "mfj", lines: { "6a": 30000, "1z": 40000 } }), "6b"),
    15350,
  )
  // Tax-exempt interest counts toward provisional income:
  // 30,000 + 5,000 + 10,000 = 45,000; over base 20,000; tier1 4,500;
  // tier2 = 85% x 11,000 = 9,350.
  check(
    "Tax-exempt interest (2a) raises provisional income",
    val(run({ status: "single", lines: { "6a": 20000, "1z": 30000, "2a": 5000 } }), "6b"),
    13850,
  )
  // REGRESSION: MFS used a flat 85% of benefits. The worksheet uses a $0 base
  // but still caps at 85% of PROVISIONAL income, so with benefits as the only
  // income the answer is 85% x 10,000 = 8,500, not 85% x 20,000 = 17,000.
  check(
    "REGRESSION MFS with only benefits is not flat 85%",
    val(run({ status: "mfs", lines: { "6a": 20000 } }), "6b"),
    8500,
  )
  // MFS with real other income does reach the 85% ceiling.
  check(
    "MFS with other income hits the 85% cap",
    val(run({ status: "mfs", lines: { "6a": 20000, "1z": 50000 } }), "6b"),
    17000,
  )
  // REGRESSION: QSS takes the Single base amounts (25,000/34,000), not MFJ's.
  // Collapsing QSS to MFJ would have produced 4,000 here.
  check(
    "REGRESSION QSS uses the Single SS base amounts",
    val(run({ status: "qss", lines: { "6a": 20000, "1z": 30000 } }), "6b"),
    9600,
  )
  // The lump-sum election method displaces the worksheet entirely.
  check(
    "Lump-sum election (6c) suppresses the estimate",
    val(run({ status: "single", lines: { "6a": 20000, "1z": 30000, "6c": true } }), "6b"),
    null,
  )
  // 85% of benefits is the ceiling no matter how large other income gets.
  check(
    "Capped at 85% of benefits",
    val(run({ status: "single", lines: { "6a": 20000, "1z": 500000 } }), "6b"),
    17000,
  )
}

// ===========================================================================
// 4. Tax (line 16) — QD & LTCG worksheet over the bracket tables
// ===========================================================================
console.log("\nTax (16)")
{
  // 12a is pre-filled at 0 so taxable income equals AGI exactly.
  const taxable = (status: StatusName, lines: Record<string, number>) =>
    val(run({ status, lines: { "12a": 0, ...lines } }), "16")

  // Single, 50,000 all ordinary: 1,192.50 + 4,386 + 335.50 = 5,914.
  check("Single, no preferential income", taxable("single", { "1z": 50000 }), 5914)

  // Single, 50,000 with 10,000 qualified. Ordinary 40,000 -> 4,561.50.
  // 0% band: min(50,000, 48,350) - 40,000 = 8,350. 15% band: 1,650 -> 247.50.
  check("Single, qualified dividends straddling the 0% top", taxable("single", { "1z": 40000, "3a": 10000, "3b": 10000 }), 4809)

  // MFJ, 120,000 with 20,000 qualified. Ordinary 100,000 -> 11,828.
  // Ordinary already exceeds the 96,700 zero top, so all 20,000 sits at 15%.
  check("MFJ, qualified fully above the 0% top", taxable("mfj", { "1z": 100000, "3a": 20000, "3b": 20000 }), 14828)

  // Capital gain distributions (line 7) are preferential too.
  check("Line 7 capital gain distributions are preferential", taxable("single", { "1z": 40000, "7": 10000 }), 4809)

  // Single, 600,000 with 100,000 preferential: ordinary 500,000 -> 144,547.25
  // (Rev. Proc. Table 3: 57,231 + 35% over 250,525). 15% band 33,400 ->
  // 5,010; 20% band 66,600 -> 13,320. Total 162,877.25.
  check("Single, reaching the 20% rate", taxable("single", { "1z": 500000, "3a": 100000, "3b": 100000 }), 162877)

  // Sanity: preferential income must never be taxed at ordinary rates.
  {
    const withQd = taxable("single", { "1z": 40000, "3a": 10000, "3b": 10000 }) as number
    const allOrdinary = taxable("single", { "1z": 50000 }) as number
    check("Qualified income is taxed no worse than ordinary", withQd < allOrdinary, true)
  }
  check("Zero taxable income yields no tax estimate", taxable("single", { "1z": 0 }), null)
}

// ===========================================================================
// 5. Child tax credit / other dependents (19) and ACTC (28)
// ===========================================================================
console.log("\nCTC / ODC (19) and ACTC (28)")
{
  const child = (dob: string): Dependent => ({ type: 1, dob, ctcFlag: 1 })
  const other = (dob: string): Dependent => ({ type: 3, dob })

  // Two children under 17, tax well above the credit: 2 x 2,200.
  check(
    "Two qualifying children",
    val(run({ status: "mfj", deps: [child("2015-03-01"), child("2018-07-01")], lines: { "1z": 120000, "12a": 0 } }), "19"),
    4400,
  )
  // Under-17 test: a child who turns 17 during 2025 does not qualify for CTC,
  // but Schedule 8812 line 6 routes them to the 500 ODC instead.
  check(
    "Child turning 17 in the year falls back to ODC",
    val(run({ status: "mfj", deps: [child("2008-05-01")], lines: { "1z": 120000, "12a": 0 } }), "19"),
    500,
  )
  check(
    "Born 2009-01-01 is still under 17 at year end",
    val(run({ status: "mfj", deps: [child("2009-01-01")], lines: { "1z": 120000, "12a": 0 } }), "19"),
    2200,
  )
  // REGRESSION: ODC was ignored entirely. Schedule 8812 lines 6-8 add it to
  // the CTC before the phaseout.
  check(
    "REGRESSION Other dependent adds 500",
    val(run({ status: "mfj", deps: [child("2015-03-01"), other("1950-01-01")], lines: { "1z": 120000, "12a": 0 } }), "19"),
    2700,
  )
  check(
    "REGRESSION ODC alone still produces a credit",
    val(run({ status: "mfj", deps: [other("1950-01-01")], lines: { "1z": 120000, "12a": 0 } }), "19"),
    500,
  )
  // Types 4 and 5 are not dependents (HOH-qualifying person / EIC only).
  check(
    "Type 4/5 are not dependents and earn no credit",
    val(run({ status: "hoh", deps: [{ type: 4, dob: "2015-01-01" }, { type: 5, dob: "2015-01-01" }], lines: { "1z": 120000, "12a": 0 } }), "19"),
    null,
  )
  // Phaseout: 50 per 1,000 or fraction thereof over 400,000 (MFJ).
  // 410,500 -> ceil(10.5) = 11 -> 550. 4,400 - 550 = 3,850.
  check(
    "MFJ phaseout rounds the excess up to the next 1,000",
    val(run({ status: "mfj", deps: [child("2015-03-01"), child("2018-07-01")], lines: { "1z": 410500, "12a": 0 } }), "19"),
    3850,
  )
  // REGRESSION: QSS is "all other filing statuses" -> 200,000 threshold.
  // 250,000 -> 50,000 excess -> 2,500 reduction, wiping out a single 2,200.
  check(
    "REGRESSION QSS phases out from 200,000, not 400,000",
    val(run({ status: "qss", deps: [child("2015-03-01")], lines: { "1z": 250000, "12a": 0 } }), "19"),
    null,
  )
  // Nonrefundable portion is limited to tax. Single, 1 child, earned 20,000:
  // std deduction 15,750 -> taxable 4,250 -> tax 425. Line 19 = 425.
  // ACTC = min(2,200 - 425, 1,700 x 1, 15% x (20,000 - 2,500)) = 1,700.
  {
    const d = run({ status: "single", deps: [child("2015-03-01")], lines: { "1z": 20000 } })
    check("Low-income: 16 is 425", val(d, "16"), 425)
    check("Low-income: 19 is limited to tax", val(d, "19"), 425)
    check("Low-income: 28 is the 1,700 refundable cap", val(d, "28"), 1700)
  }
  // The 15%-of-earned-income floor binds below roughly 13,833 of earnings.
  // 15% x (10,000 - 2,500) = 1,125.
  {
    const d = run({ status: "single", deps: [child("2015-03-01")], lines: { "1z": 10000 } })
    check("Earned-income floor caps the ACTC", val(d, "28"), 1125)
  }
  // ODC is never refundable.
  check(
    "ODC alone produces no ACTC",
    val(run({ status: "single", deps: [other("1950-01-01")], lines: { "1z": 20000 } }), "28"),
    null,
  )
  // No earned income above the floor -> no refundable credit.
  check(
    "No earned income yields no ACTC",
    val(run({ status: "single", deps: [child("2015-03-01")], lines: { "4b": 20000 } }), "28"),
    null,
  )
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
