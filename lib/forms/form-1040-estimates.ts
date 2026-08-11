/**
 * Form 1040 — deterministic estimator tier
 *
 * The ProConnect API exports data-entry fields only; every Intuit-calculated
 * amount (standard deduction, taxable Social Security, the tax itself, CTC)
 * is absent from the export. This module estimates the deterministic subset
 * of those lines from the mapped inputs plus form_1040_constants, using the
 * published IRS worksheets:
 *
 *   6b  — Social Security Benefits Worksheet
 *   12a — standard deduction by filing status (+ §63(f) age/blindness
 *         boxes for both taxpayer and spouse)
 *   13b — Schedule 1-A line 38, senior portion only (Part V)
 *   16  — Qualified Dividends and Capital Gain Tax Worksheet over the
 *         TY bracket tables
 *   19  — Child Tax Credit + credit for other dependents (nonrefundable,
 *         aggregate AGI phaseout, limited to tax)
 *
 * Every line this module writes carries source: "estimated" so the viewer
 * can badge it. Estimates are NEVER composed into ProConnect imports (the
 * composer builds its payload from caller-supplied values, not from this
 * render path).
 *
 * CAVEATS (all conservative, all visible via the "estimated" badge):
 *   - 12a is written only when itemizing provably cannot win (the Schedule A
 *     inputs, whose raw sum bounds the itemized total from above, do not beat
 *     the statutory figure) — otherwise it is left blank rather than assumed.
 *     That test IS live: form_1040_line_inputs carried one schedule/input,
 *     one override and two control rows for 12a as of 2026-08-11. But one
 *     input row makes a loose upper bound, so in practice it almost never
 *     suppresses (0 of 31 TY2025 returns); it tightens as more Schedule A
 *     inputs are recorded. Age and blindness are read for BOTH people from the s1
 *     taxpayer/spouse cell pairs (scripts/379). Spouse boxes count on MFJ
 *     only: on MFS they require the spouse to have no gross income and to
 *     not be another taxpayer's dependent, neither of which the export
 *     shows. No return in the book has ever reported blindness, so the
 *     checked encoding of that flag is inferred rather than observed — see
 *     isBlind(). The dependent-of-another limitation (std deduction capped
 *     at the greater of 1,350 or earned income + 450) is not applied — the
 *     "someone can claim you as a dependent" checkbox is unmapped.
 *   - 13b covers ONLY the Part V senior deduction, counted per eligible
 *     person (both spouses on a joint return). Qualified tips, overtime and
 *     vehicle loan interest (Parts II-IV) are not estimated.
 *   - 6b assumes MFS lived WITH their spouse; line 6d, the checkbox that
 *     says otherwise, is unmapped (scripts/386).
 *   - 16 treats line 7 (capital gain distributions) + 3a as LTCG/qualified,
 *     which matches how those mapped inputs behave on real returns.
 *   - 19 uses Form 1040 line 18 as the credit limit. Schedule 8812's Credit
 *     Limit Worksheet A subtracts Schedule 3 lines 1-4, 5b, 6d, 6f, 6l and
 *     6m first; those credits are invisible to the export, so 19 overstates
 *     whenever the client has any of them.
 *   - 28 omits Schedule 8812 Part II-B, the alternative refundable
 *     computation for filers with 3+ qualifying children, which can exceed
 *     the 15%-of-earned-income figure. Needs W-2 boxes 4 and 6.
 *   - 10 omits every self-employment adjustment and the IRA deduction, so
 *     self-employed returns understate it (their income lines are equally
 *     incomplete). An HSA cell holding exactly 1 means "maximum" and is
 *     skipped rather than read as one dollar.
 *   - 8 is still partial: prizes, jury duty and hobby income are unlabeled.
 *   - 27 approximates earned income by line 1z (SE earnings unmapped) and
 *     cannot see full-time-student/disabled qualifying children 19+.
 *   - 23 covers NIIT + Additional Medicare only; NII treats line-7 losses
 *     as zero (slightly overstates), MAGI approximated by AGI, and
 *     Medicare wages come from W-2 box 5 cells (falls back to line 1a).
 *
 * Filing status is read straight from the discovered s1 cell
 * (c1000100036: 1=Single, 2=MFJ, 3=MFS, 4=HOH, 5=QSS). If the cell is
 * absent the estimator quietly does nothing rather than guess.
 */

import {
  evaluateComputedLines,
  type FieldCell,
  type Form1040Constant,
  type Form1040Data,
  type Form1040Line,
  type MaskedValue,
} from "./form-1040"

const FS_CELL = { seriesId: "s1", prefixId: "p0", codeId: "c1000100036", suffixId: "x1000" }
const DOB_CELL = { seriesId: "s1", prefixId: "p0", codeId: "c1000100010", suffixId: "x1000" }
/**
 * Spouse age/blindness inputs (scripts/379). ProConnect keeps taxpayer and
 * spouse on SEPARATE ADJACENT CODE IDS on s1 — not on one cell distinguished
 * by `tsj`, which on these cells is only ever 'J' or absent. Taxpayer takes
 * the lower code of each pair, spouse the next one up.
 *
 * Before these were mapped, every stage below counted the taxpayer only,
 * which understated an MFJ return with a 65+ spouse by 1,600 on 12a and by
 * up to 6,000 on 13b. Retiree households — exactly the returns carrying
 * Social Security benefits — are the ones that hit it.
 */
const SPOUSE_DOB_CELL = { seriesId: "s1", prefixId: "p0", codeId: "c1000100012", suffixId: "x1000" }
const BLIND_CELL = { seriesId: "s1", prefixId: "p0", codeId: "c1000100011", suffixId: "x1000" }
const SPOUSE_BLIND_CELL = { seriesId: "s1", prefixId: "p0", codeId: "c1000100013", suffixId: "x1000" }
const DEP_CTC = { seriesId: "s2", codeId: "c1000200014", suffixId: "x1000" }
const DEP_DOB_CODE = "c1000200002"
const DEP_TYPE_CODE = "c1000200006"
const DEP_EIC_CODE = "c1000200007"

/**
 * Schedule 1 component cells, all sentinel-verified (round 4, 2026-08-04;
 * gambling in round 2). Recorded durably in form_1040_line_inputs — these
 * constants are the estimator's working copy.
 */
const LINE8_COMPONENTS = [
  { seriesId: "s15", codeId: "c2", suffixId: "x1000" },     // unemployment (1099-G)
  { seriesId: "s200M", codeId: "c5", suffixId: "x1" },      // alimony received (note suffix)
  { seriesId: "s19", codeId: "c3", suffixId: "x1000" },     // gambling winnings (W-2G box 1)
] as const
const EDUCATOR_CELL = { seriesId: "s300", codeId: "c28", suffixId: "x1000" }
const STUDENT_LOAN_CELL = { seriesId: "s300", codeId: "c23", suffixId: "x1000" }
const HSA_CELL = { seriesId: "s2800", codeId: "c5", suffixId: "x1000" }
const EARLY_WITHDRAWAL_CELL = { seriesId: "s12", codeId: "c18", suffixId: "x1000" }
/**
 * Dependent "Type" enum (s2/c1000200006, read off the PTO dropdown
 * 2026-08-04): 1 = child living with taxpayer, 2 = child not living with
 * taxpayer, 3 = other dependent living with taxpayer, 6 = other dependent
 * not living with taxpayer, 4 = HOH/QSS qualifying person only (not a
 * dependent), 5 = EIC only (not a dependent). CTC can only apply to types
 * 1 and 2.
 */
const CTC_ELIGIBLE_TYPES = new Set([1, 2])
/** EIC qualifying child can also be Type 5 ("EIC only, not a dependent"). */
const EIC_ELIGIBLE_TYPES = new Set([1, 2, 5])

type StatusKey = "single" | "mfj" | "mfs" | "hoh"

/**
 * One row of form_1040_line_inputs (scripts/360): which ProConnect field
 * feeds a given 1040 line, and in what role. Supplied by the caller rather
 * than read here — the addresses are partner-confidential under the Open API
 * agreement and this repository is public, so no tuple may be hardcoded.
 */
export interface LineInputRow {
  lineCode: string
  /** line_arithmetic | schedule | worksheet | table_lookup | statutory */
  sourceKind: string
  sourceRef: string | null
  seriesId: string | null
  codeId: string | null
  /** input | override | discriminator | control */
  role: string
}

/**
 * Is the statutory standard deduction safe to assert as line 12a?
 *
 * Line 12a is deliberately unmapped (scripts/368 cleared the fabricated
 * address), so `isEmpty("12a")` is true on every return and this module would
 * otherwise write the standard deduction unconditionally — including for a
 * client who itemizes, whose deduction, taxable income, tax and credits would
 * then all render wrong while badged merely "estimated".
 *
 * Schedule A cannot be computed here: its constants are still behind
 * `itemized_constants_verified`, which is false. But it can be BOUNDED. Every
 * Schedule A limitation — the 7.5% medical floor, the SALT cap and its
 * phase-down — only ever reduces the deduction below the sum of its inputs.
 * So the raw sum of the Schedule A input cells is an upper bound on the
 * itemized total, and:
 *
 *   bound <= standard   itemizing provably cannot win -> assert the standard
 *   bound >  standard   indeterminate -> write nothing
 *
 * Overcounting only pushes toward the safe branch, so matching on
 * (series, code) without a suffix is deliberate.
 *
 * A "control" field (force itemized/standard) or an "override" on 12a itself
 * means the statutory figure is not the answer regardless of the bound.
 *
 * With no rows for 12a the check is inert and the prior behaviour stands —
 * the gate arms itself as the derivation table is populated.
 */
function standardDeductionIsSafe(
  cells: FieldCell[],
  lineInputs: LineInputRow[],
  standardAmount: number,
): boolean {
  const rows = lineInputs.filter((r) => r.lineCode === "12a")
  if (rows.length === 0) return true // inert until the table is populated

  let scheduleBound = 0
  let sawScheduleRow = false

  for (const r of rows) {
    if (!r.seriesId || !r.codeId) continue
    const matched = cells.filter((c) => c.seriesId === r.seriesId && c.codeId === r.codeId)
    if (matched.length === 0) continue

    if (r.role === "control" || r.role === "override") {
      const set = matched.some((c) => c.val !== null && String(c.val).trim() !== "")
      if (set) return false
      continue
    }
    if (r.sourceKind === "schedule") {
      sawScheduleRow = true
      for (const c of matched) scheduleBound += Math.max(0, toNum(c.val))
    }
  }

  if (!sawScheduleRow) return true
  return scheduleBound <= standardAmount
}

/**
 * Map the ProConnect status code to the constants-key suffix.
 *
 * QSS collapses to MFJ, which is correct ONLY for the parameters that
 * 1(j)(2)(A) and 63 share between joint filers and surviving spouses:
 * the bracket table, the QD/LTCG breakpoints, the basic standard deduction,
 * and the 63(f) additional amount (1,600 — a surviving spouse is not
 * "unmarried and not a surviving spouse", so QSS does NOT get the 2,000).
 *
 * It is WRONG for every parameter keyed to a joint RETURN rather than to the
 * joint rate schedule: the Social Security base amounts (QSS uses 25,000 /
 * 34,000 like Single — see the notes on ss_base_single), the CTC phaseout
 * threshold (QSS is "all other filing statuses", 200,000), the EIC phaseout
 * column, the educator-expense cap, the student-loan MAGI range, and the
 * Schedule 1-A senior deduction threshold. Use `isMfj` for those.
 */
function statusKey(code: number): StatusKey | null {
  switch (code) {
    case 1: return "single"
    case 2: return "mfj"
    case 3: return "mfs"
    case 4: return "hoh"
    case 5: return "mfj" // QSS uses MFJ brackets/deduction
    default: return null
  }
}

function toNum(v: string | number | boolean | MaskedValue | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "boolean") return v ? 1 : 0
  // Masked placeholders (and any other object) carry no numeric meaning.
  if (typeof v === "object") return 0
  const n = Number.parseFloat(String(v).replace(/[,$\s]/g, ""))
  return Number.isNaN(n) ? 0 : n
}

function findCell(cells: FieldCell[], sel: { seriesId: string; prefixId?: string; codeId: string; suffixId: string }) {
  return cells.find(
    (c) =>
      c.seriesId === sel.seriesId &&
      (sel.prefixId === undefined || c.prefixId === sel.prefixId) &&
      c.codeId === sel.codeId &&
      c.suffixId === sel.suffixId,
  )
}

/**
 * True when the date in `cell` falls before `cutoff` — i.e. the person was
 * 65 by the end of the tax year (constant `age_65_cutoff_birthdate`).
 * An absent or unparseable cell is "not established", never a default yes.
 */
function bornBefore(
  cells: FieldCell[],
  cell: { seriesId: string; prefixId?: string; codeId: string; suffixId: string },
  cutoff: string | null,
): boolean {
  if (!cutoff) return false
  const raw = findCell(cells, cell)?.val
  if (!raw) return false
  const dob = new Date(String(raw))
  return !Number.isNaN(dob.getTime()) && dob < new Date(cutoff)
}

/**
 * True when a "Blind?" checkbox is set. The cell is a NUMBER with no
 * constraint enum in the catalog, and every occurrence in the book so far
 * reads '0' (not blind) — there is no positive observation to confirm what
 * "checked" encodes. So this treats any present, non-zero value as checked
 * rather than hard-coding '1': it stays correct whether PTO writes 1, 2 or
 * X, and an absent cell (the common case) is false either way. Revisit if a
 * return with a blind taxpayer ever exports.
 */
function isBlind(
  cells: FieldCell[],
  cell: { seriesId: string; prefixId?: string; codeId: string; suffixId: string },
): boolean {
  const raw = findCell(cells, cell)?.val
  if (raw === null || raw === undefined) return false
  const v = String(raw).trim()
  return v !== "" && v !== "0"
}

function constNum(constants: Form1040Constant[], key: string): number | null {
  const c = constants.find((x) => x.key === key)
  if (!c) return null
  const n = toNum(c.value as string | number)
  return Number.isFinite(n) ? n : null
}

/**
 * Read a structured constant.
 *
 * form_1040_constants.value is JSONB, so the driver hands back an already
 * parsed value: an array for tax_brackets_*, a plain JS string for
 * age_65_cutoff_birthdate (seeded as the JSON string '"1961-01-02"').
 *
 * That plain string is NOT itself valid JSON, so parsing it throws. Returning
 * null on that throw — as this did until 2026-08-11 — silently disabled every
 * caller that reads a date constant: the age-65 additional standard deduction
 * never applied on any return, because `cutoff` was always null. So a failed
 * parse now falls back to the raw value, which is the common case for a jsonb
 * string. The parse attempt is kept for values that really are double-encoded.
 */
function constJson<T>(constants: Form1040Constant[], key: string): T | null {
  const c = constants.find((x) => x.key === key)
  if (!c) return null
  if (typeof c.value === "string") {
    try { return JSON.parse(c.value) as T } catch { return c.value as unknown as T }
  }
  return c.value as T
}

/** Progressive tax over [rate, upperBound|null] pairs. */
function bracketTax(brackets: Array<[number, number | null]>, taxable: number): number {
  let tax = 0
  let lower = 0
  for (const [rate, upper] of brackets) {
    const top = upper ?? Infinity
    if (taxable <= lower) break
    tax += rate * (Math.min(taxable, top) - lower)
    lower = top
  }
  return tax
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** Sum one cell address across every prefix instance (payers, employers). */
function sumCells(
  cells: FieldCell[],
  sel: { seriesId: string; codeId: string; suffixId: string },
): number {
  let total = 0
  for (const c of cells) {
    if (c.seriesId === sel.seriesId && c.codeId === sel.codeId && c.suffixId === sel.suffixId) {
      total += toNum(c.val)
    }
  }
  return total
}

/**
 * Fill estimable lines in-place-ish (returns a new Form1040Data). Runs
 * evaluateComputedLines between stages so downstream totals absorb each
 * estimate before the next one reads them.
 */
export function estimateDeterministicLines(
  data: Form1040Data,
  cells: FieldCell[],
  lines: Form1040Line[],
  constants: Form1040Constant[],
  /**
   * form_1040_line_inputs rows for this (taxYear, returnType). Optional: with
   * none supplied the Schedule A gate on line 12a is inert. See
   * standardDeductionIsSafe.
   */
  lineInputs: LineInputRow[] = [],
): Form1040Data {
  const fsRaw = findCell(cells, FS_CELL)?.val
  const fsCode = Number.parseInt(String(fsRaw ?? ""), 10)
  const fs = statusKey(fsCode)
  if (!fs) return data // no filing status → no safe estimates

  // A genuine joint return, as distinct from `fs === "mfj"` which also
  // covers QSS. See statusKey's doc comment for which parameters need this.
  const isMfj = fsCode === 2

  const lineByCode = new Map(lines.map((l) => [l.lineCode, l]))
  let d: Form1040Data = { ...data }
  const num = (lc: string) => toNum(d[lc]?.value)
  const isEmpty = (lc: string) => d[lc]?.value === null || d[lc]?.value === undefined
  const setEstimate = (lc: string, value: number) => {
    const line = lineByCode.get(lc)
    if (!line) return
    d[lc] = { value: Math.round(value), line, source: "estimated" }
    d = evaluateComputedLines(d, lines, constants)
  }

  // ── 8: Schedule 1 other income (rollup) ─────────────────────────────
  // The single mapped cell is only the "Other income" component. Returns
  // with unemployment, alimony received, or gambling winnings render too
  // low, so sum every verified component and take the larger figure.
  // Still partial: prizes, jury duty, and hobby income are unlabeled.
  {
    const mapped = num("8")
    let rollup = mapped
    for (const sel of LINE8_COMPONENTS) rollup += sumCells(cells, sel)
    if (rollup > mapped) setEstimate("8", rollup)
  }

  // ── 10: Schedule 1 adjustments (rollup, PARTIAL) ─────────────────────
  // Only the components we have verified. Self-employment adjustments (SE
  // tax, SE retirement, SE health insurance) and the IRA deduction are
  // unlabeled, so self-employed returns understate this line — but their
  // income lines are already incomplete for the same reason, so this does
  // not introduce a new class of error.
  // Retained past the stage: the Social Security worksheet adds the
  // student-loan-interest deduction back to arrive at provisional income.
  let studentLoanDeducted = 0
  if (isEmpty("10")) {
    let adjustments = 0

    // Educator expenses: statutory cap per return (doubled only when both
    // spouses are eligible educators on a JOINT return, so QSS uses the
    // single cap).
    const educator = sumCells(cells, EDUCATOR_CELL)
    if (educator > 0) {
      const cap = constNum(constants, isMfj ? "educator_expense_cap_mfj" : "educator_expense_cap")
      adjustments += cap === null ? 0 : Math.min(educator, cap)
    }

    // Student loan interest: capped, then MAGI-phased. MAGI is approximated
    // by total income (line 9), which slightly overstates it and therefore
    // errs toward more phaseout.
    const studentLoan = sumCells(cells, STUDENT_LOAN_CELL)
    if (studentLoan > 0) {
      const cap = constNum(constants, "student_loan_interest_max")
      const range = constJson<number[]>(constants, isMfj ? "student_loan_phaseout_mfj" : "student_loan_phaseout_single")
      if (cap !== null && range?.length === 2) {
        const capped = Math.min(studentLoan, cap)
        const [start, end] = range
        const magi = num("9")
        const phasedOut = magi <= start ? capped : magi >= end ? 0 : capped * (1 - (magi - start) / (end - start))
        studentLoanDeducted = phasedOut
        adjustments += phasedOut
      }
    }

    // HSA: a value of exactly 1 means "compute the maximum" on this screen,
    // not one dollar — we cannot resolve the max without the coverage type,
    // so that case contributes nothing rather than a wrong figure.
    const hsa = sumCells(cells, HSA_CELL)
    if (hsa > 1) {
      const cap = constNum(constants, "hsa_contribution_cap")
      adjustments += cap === null ? hsa : Math.min(hsa, cap)
    }

    // Early withdrawal penalty: no statutory cap; sums across payers.
    adjustments += sumCells(cells, EARLY_WITHDRAWAL_CELL)

    if (adjustments > 0) setEstimate("10", adjustments)
  }

  // ── 6b: taxable Social Security (worksheet) ──────────────────────────
  // Form 1040 Social Security Benefits Worksheet / Pub. 915. One code path
  // for every status; only the threshold pair (base, adjusted − base) varies:
  //
  //   Single / HOH / QSS         25,000 / 9,000   (adjusted base 34,000)
  //   MFJ                        32,000 / 12,000  (adjusted base 44,000)
  //   MFS, lived WITH spouse          0 / 0
  //   MFS, lived apart all year  25,000 / 9,000   (as Single)
  //
  // MFS assumes lived-with-spouse: line 6d, which declares the lived-apart
  // case, is unmapped (scripts/386), and lived-with is the harsher branch.
  // A $0 base is NOT the same as "85% of benefits" — the worksheet still
  // caps the result at 85% of PROVISIONAL income, so a return that is mostly
  // benefits lands near 42.5%. The previous flat 0.85 × benefits overstated
  // taxable SS by up to 2× on exactly those returns.
  //
  // Suppressed entirely when the lump-sum election (6c) is in play: that
  // method reworks prior years and the worksheet no longer applies.
  const ss = num("6a")
  const lumpSum = d["6c"]?.value
  const lumpSumElected = lumpSum === true || lumpSum === 1 || lumpSum === "1"
  if (ss > 0 && isEmpty("6b") && !lumpSumElected) {
    // QSS takes the Single base amounts, not MFJ's — hence isMfj, not fs.
    const base = fs === "mfs" ? 0 : constNum(constants, isMfj ? "ss_base_mfj" : "ss_base_single")
    const adj = fs === "mfs" ? 0 : constNum(constants, isMfj ? "ss_adj_mfj" : "ss_adj_single")
    if (base !== null && adj !== null) {
      // Worksheet line 7 is not AGI: it subtracts only Schedule 1 lines
      // 11-20, 23 and 25, so the student-loan-interest deduction (line 21)
      // is added back. Line 11 excludes 6b here (still null → 0), which is
      // what the worksheet wants.
      const provisional = num("11") + num("2a") + 0.5 * ss + studentLoanDeducted
      if (provisional > base) {
        const overBase = provisional - base          // worksheet line 9
        const band = adj - base                      // worksheet line 10
        const tier1 = Math.min(0.5 * Math.min(overBase, band), 0.5 * ss) // 12-14
        const tier2 = 0.85 * Math.max(0, overBase - band)                // 11, 15
        setEstimate("6b", Math.min(0.85 * ss, tier1 + tier2))            // 16-18
      }
    }
  }

  // ── 12a: standard deduction ──────────────────────────────────────────
  // Set when the Schedule A gate refuses to assert a deduction. Everything
  // downstream of line 14 is then unknown too, and must not be estimated:
  // subtract_floor_zero reads a null operand as zero, so line 15 would render
  // the full AGI, line 16 would tax it, and 19/28 would be limited against
  // that fiction.
  let deductionUnknown = false
  if (isEmpty("12a")) {
    const std = constNum(constants, `std_deduction_${fs === "mfj" ? "mfj" : fs}`)
    if (std !== null) {
      let deduction = std
      // §63(f) additional amount is PER BOX, not one flat add: aged and
      // blind, counted separately for the taxpayer and (on a joint return)
      // the spouse. So MFJ tops out at four boxes, Single/HOH at two.
      //
      // Spouse boxes are counted for MFJ only. On MFS the spouse's boxes
      // are claimable solely when that spouse has no gross income and is
      // not another taxpayer's dependent — neither fact is in the export,
      // so claiming them there would be a guess.
      //
      // This reads `isMfj`, NOT `fs === "mfj"`: statusKey collapses QSS to
      // "mfj" for the rate schedule and the basic deduction, but whether a
      // SPOUSE EXISTS is a joint-return question, and a qualifying
      // surviving spouse has none. Using fs here would hand a QSS filer a
      // phantom spouse's boxes off a leftover DOB cell.
      const cutoff = constJson<string>(constants, "age_65_cutoff_birthdate")
      let boxes = 0
      if (bornBefore(cells, DOB_CELL, cutoff)) boxes++
      if (isBlind(cells, BLIND_CELL)) boxes++
      if (isMfj) {
        if (bornBefore(cells, SPOUSE_DOB_CELL, cutoff)) boxes++
        if (isBlind(cells, SPOUSE_BLIND_CELL)) boxes++
      }
      if (boxes > 0) {
        const perBox = constNum(
          constants,
          fs === "single" || fs === "hoh" ? "additional_std_65_blind_single" : "additional_std_65_blind_mfj",
        )
        if (perBox !== null) deduction += perBox * boxes
      }
      // Only assert the statutory figure when itemizing provably cannot beat
      // it. Otherwise leave 12a blank: "unknown" is honest, "standard
      // deduction" would not be.
      if (standardDeductionIsSafe(cells, lineInputs, deduction)) {
        setEstimate("12a", deduction)
      } else {
        deductionUnknown = true
      }
    }
  }

  // ── 13b: Schedule 1-A additional deductions — Part V only ────────────
  // Enhanced deduction for seniors (OBBBA; Schedule 1-A Part V, lines 31-37):
  //
  //   per person = max(0, 6,000 − 6% × max(0, MAGI − 75,000/150,000))
  //   total      = per person × (eligible taxpayer + eligible spouse)
  //
  // Eligibility is being born before 1961-01-02 with a valid SSN. The amount
  // is PER PERSON, so an MFJ couple with both spouses eligible claims up to
  // 12,000 and does not fully phase out until MAGI 250,000.
  //
  // This is a below-the-line deduction available to itemizers, which is why
  // it belongs on 13b and must never be folded into 12a.
  //
  // MFS is ineligible outright — Part V requires a joint return if married.
  // QSS uses the 75,000 threshold (the form says "if married filing
  // jointly"), so this reads isMfj rather than fs.
  //
  // Counts BOTH spouses on a joint return (scripts/379 mapped the spouse
  // date of birth). Only MFJ can contribute a second person: QSS has no
  // living spouse and MFS is excluded above.
  if (isEmpty("13b") && fs !== "mfs") {
    const maxPerPerson = constNum(constants, "senior_deduction_max")
    const rate = constNum(constants, "senior_deduction_phaseout_rate")
    const threshold = constNum(
      constants,
      isMfj ? "senior_deduction_phaseout_start_mfj" : "senior_deduction_phaseout_start",
    )
    const cutoff = constJson<string>(constants, "age_65_cutoff_birthdate")
    if (maxPerPerson !== null && rate !== null && threshold !== null && cutoff) {
      let eligiblePeople = 0
      // `isMfj`, not `fs` — statusKey folds QSS into "mfj", but a surviving
      // spouse has no spouse to count (same trap as the 12a boxes above).
      if (bornBefore(cells, DOB_CELL, cutoff)) eligiblePeople++
      if (isMfj && bornBefore(cells, SPOUSE_DOB_CELL, cutoff)) eligiblePeople++
      if (eligiblePeople > 0) {
        // MAGI adds back excluded Puerto Rico income and the Form 2555 /
        // Form 4563 exclusions, none of which are visible to us, so AGI is
        // the whole of it on a domestic return.
        const magi = num("11")
        const perPerson = Math.max(0, maxPerPerson - rate * Math.max(0, magi - threshold))
        if (perPerson > 0) setEstimate("13b", perPerson * eligiblePeople)
      }
    }
  }

  // ── 16: tax (QD & LTCG worksheet over the bracket tables) ────────────
  if (isEmpty("16") && !deductionUnknown) {
    const brackets = constJson<Array<[number, number | null]>>(constants, `tax_brackets_${fs}`)
    const zeroTop = constNum(constants, `qdcg_zero_top_${fs}`)
    const fifteenTop = constNum(constants, `qdcg_fifteen_top_${fs}`)
    const taxable = num("15")
    if (brackets && zeroTop !== null && fifteenTop !== null && taxable > 0) {
      const qualified = clamp(Math.max(0, num("3a")) + Math.max(0, num("7")), 0, taxable)
      const ordinary = taxable - qualified
      const at0 = clamp(Math.min(taxable, zeroTop) - ordinary, 0, qualified)
      const at15 = clamp(Math.min(taxable, fifteenTop) - ordinary - at0, 0, qualified - at0)
      const at20 = qualified - at0 - at15
      setEstimate("16", bracketTax(brackets, ordinary) + 0.15 * at15 + 0.2 * at20)
    }
  }

  // ── 23: other taxes — NIIT + Additional Medicare (partial) ──────────
  if (isEmpty("23")) {
    // NIIT (Form 8960): MFJ and QSS share the 250k threshold.
    const niitThreshold = constNum(
      constants,
      fsCode === 2 || fsCode === 5 ? "niit_threshold_mfj" : fsCode === 3 ? "niit_threshold_mfs" : "niit_threshold_single",
    )
    // Additional Medicare (Form 8959): ONLY MFJ gets 250k; QSS is 200k.
    const amThreshold = constNum(
      constants,
      fsCode === 2 ? "addl_medicare_threshold_mfj" : fsCode === 3 ? "addl_medicare_threshold_mfs" : "addl_medicare_threshold_single",
    )
    if (niitThreshold !== null && amThreshold !== null) {
      // Net investment income from mapped lines. 3b already contains 3a
      // (qualified ⊆ ordinary). Line-7 losses clamp to 0 (slight overstate).
      const nii = Math.max(0, num("2b")) + Math.max(0, num("3b")) + Math.max(0, num("7"))
      const magi = num("11") // MAGI ≈ AGI (foreign exclusions invisible)
      const niit = 0.038 * Math.min(nii, Math.max(0, magi - niitThreshold))

      // Medicare wages = W-2 box 5 (s11 c7) summed across instances;
      // falls back to line 1a when box 5 cells are absent.
      let medicareWages = 0
      for (const c of cells) {
        if (c.seriesId === "s11" && c.codeId === "c7" && c.suffixId === "x1000") medicareWages += toNum(c.val)
      }
      if (medicareWages === 0) medicareWages = num("1a")
      const addlMedicare = 0.009 * Math.max(0, medicareWages - amThreshold)

      const total = niit + addlMedicare
      if (total > 0) setEstimate("23", total)
    }
  }

  // ── Dependent census (shared by stages 19, 27, 28) ──────────────────
  // The credit flags are "1 = when applicable" preparer inputs, so
  // eligibility is derived here: Type + age gates per credit.
  const taxYear = lines[0]?.taxYear ?? 2025
  const ctcDobFloor = new Date(`${taxYear - 16}-01-01T00:00:00Z`) // under 17 at 12/31
  const eicDobFloor = new Date(`${taxYear - 18}-01-01T00:00:00Z`) // under 19 at 12/31
  const deps = new Map<string, { ctcFlag?: number; eicFlag?: number; type?: number; dob?: Date }>()
  for (const c of cells) {
    if (c.seriesId !== "s2" || c.suffixId !== "x1000") continue
    const d = deps.get(c.prefixId) ?? {}
    if (c.codeId === DEP_CTC.codeId) d.ctcFlag = toNum(c.val)
    if (c.codeId === DEP_EIC_CODE) d.eicFlag = toNum(c.val)
    if (c.codeId === DEP_TYPE_CODE) d.type = toNum(c.val)
    if (c.codeId === DEP_DOB_CODE && c.val) {
      const parsed = new Date(String(c.val))
      if (!Number.isNaN(parsed.getTime())) d.dob = parsed
    }
    deps.set(c.prefixId, d)
  }
  const ctcKids = [...deps.values()].filter(
    (d) => d.ctcFlag === 1 && d.type !== undefined && CTC_ELIGIBLE_TYPES.has(d.type) && d.dob !== undefined && d.dob >= ctcDobFloor,
  ).length
  // EIC qualifying child: flag set, Type child (1/2) or EIC-only (5), and
  // under 19 at year-end. Full-time students 19-23 and disabled children
  // are invisible to us — undercounts those households (caveated).
  const eicKids = Math.min(
    3,
    [...deps.values()].filter(
      (d) => d.eicFlag === 1 && d.type !== undefined && EIC_ELIGIBLE_TYPES.has(d.type) && d.dob !== undefined && d.dob >= eicDobFloor,
    ).length,
  )
  // Other dependents (Schedule 8812 lines 6-7, $500 each). Types 3 and 6 are
  // "other dependent" (living with / not living with the taxpayer). Line 6
  // also takes in "any qualifying children who are not under age 17 or who
  // do not have the required social security number", so a Type 1/2 child
  // who did not make the CTC count belongs here instead. Types 4 and 5 are
  // not dependents at all (HOH/QSS qualifying person only; EIC only).
  //
  // We cannot test citizenship/residency or whether the dependent has an SSN
  // rather than an ITIN, so a nonresident or ITIN dependent is counted here
  // when the return may not actually be entitled to the $500.
  const odcDeps = [...deps.values()].filter((dep) => {
    if (dep.type === undefined) return false
    if (dep.type === 3 || dep.type === 6) return true
    if (!CTC_ELIGIBLE_TYPES.has(dep.type)) return false
    const countedForCtc = dep.ctcFlag === 1 && dep.dob !== undefined && dep.dob >= ctcDobFloor
    return !countedForCtc
  }).length

  // ── 19: child tax credit + credit for other dependents ───────────────
  // Schedule 8812 Part I. The phaseout applies to the AGGREGATE of CTC and
  // ODC (line 8 = line 5 + line 7, then lines 9-12 reduce that total), so
  // ODC cannot be left out without also overstating the phaseout's effect on
  // the CTC. Line 10 rounds the excess UP to the next 1,000 and line 11
  // takes 5% of it, which is the same as 50 per 1,000-or-fraction.
  //
  // QSS is "all other filing statuses" for the threshold — hence isMfj.
  //
  // potentialCredit is Schedule 8812 line 12 (post-phaseout, pre-tax-limit)
  // and is reused by stage 28 as line 16a's starting point.
  let potentialCredit = 0
  {
    const perChild = constNum(constants, "dependent_credit_ctc")
    const perOther = constNum(constants, "dependent_credit_odc")
    const threshold = constNum(constants, isMfj ? "mfj_ctc_phaseout_start" : "other_ctc_phaseout_start")
    if (perChild !== null && perOther !== null && threshold !== null && ctcKids + odcDeps > 0) {
      let credit = perChild * ctcKids + perOther * odcDeps
      const agi = num("11")
      if (agi > threshold) credit -= Math.ceil((agi - threshold) / 1000) * 50
      potentialCredit = Math.max(0, credit)
      // Line 13 should be Credit Limit Worksheet A (line 18 less the
      // Schedule 3 nonrefundable credits). Those are invisible to the
      // export, so line 18 is the closest available ceiling — see caveats.
      if (isEmpty("19") && potentialCredit > 0 && !deductionUnknown) {
        setEstimate("19", Math.min(potentialCredit, num("18")))
      }
    }
  }

  // ── 27: earned income credit (worksheet over the TY parameter table) ─
  // MFS is generally ineligible (the separated-spouse exception is
  // invisible to us). Earned income approximated by line 1z — SE earnings
  // are unmapped, so self-employed households are not estimated correctly
  // and simply fall out via the income limits in most cases.
  if (isEmpty("27") && fs !== "mfs") {
    const eic = constJson<{
      rate: number[]
      earnedAmount: number[]
      maxCredit: number[]
      phaseoutRate: number[]
      phaseoutStart: number[]
      phaseoutStartMfj: number[]
      investmentIncomeLimit: number
    }>(constants, "eic_params")
    if (eic) {
      const invIncome = Math.max(0, num("2a")) + Math.max(0, num("2b")) + Math.max(0, num("3b")) + Math.max(0, num("7"))
      const earned = num("1z")
      const agi = num("11")
      // Childless claimants must be 25-64 at year-end (taxpayer DOB only;
      // a qualifying spouse age is invisible).
      let ageOk = true
      if (eicKids === 0) {
        const dobRaw = findCell(cells, DOB_CELL)?.val
        const dob = dobRaw ? new Date(String(dobRaw)) : null
        const age = dob && !Number.isNaN(dob.getTime()) ? taxYear - dob.getUTCFullYear() : null
        ageOk = age !== null && age >= 25 && age <= 64
      }
      if (earned > 0 && invIncome <= eic.investmentIncomeLimit && ageOk) {
        const i = eicKids
        const plateau = Math.min(eic.rate[i] * Math.min(earned, eic.earnedAmount[i]), eic.maxCredit[i])
        // The higher phaseout start belongs to joint RETURNS; QSS uses the
        // ordinary column (Rev. Proc. 2024-40 2.06) — hence isMfj, not fs.
        const start = (isMfj ? eic.phaseoutStartMfj : eic.phaseoutStart)[i]
        const reduction = eic.phaseoutRate[i] * Math.max(0, Math.max(agi, earned) - start)
        const credit = Math.max(0, plateau - reduction)
        if (credit > 0) setEstimate("27", credit)
      }
    }
  }

  // ── 28: additional (refundable) child tax credit — Schedule 8812 ─────
  // Part II-A: min(line 16a credit not used against tax, 1,700 × qualifying
  // children, 15% of earned income over 2,500). The refundable cap counts
  // CTC children only — ODC is never refundable, even though it is part of
  // line 16a. Part II-B (3+ children) is not implemented; see caveats.
  if (isEmpty("28") && potentialCredit > 0 && ctcKids > 0 && !deductionUnknown) {
    const refundableCap = constNum(constants, "ctc_refundable_limit")
    const earnedThreshold = constNum(constants, "earned_income_threshold_ctc")
    if (refundableCap !== null && earnedThreshold !== null) {
      const used = num("19")
      const remaining = potentialCredit - used
      const earned = num("1z")
      const actc = Math.min(remaining, refundableCap * ctcKids, 0.15 * Math.max(0, earned - earnedThreshold))
      if (actc > 0) setEstimate("28", actc)
    }
  }

  // An unknown deduction makes lines 14 and 15 unknown, not zero. Blank them
  // so taxable income does not render as the full AGI — a figure that looks
  // like an answer and is not. Done last: every setEstimate above re-runs
  // evaluateComputedLines, which would otherwise recompute them.
  if (deductionUnknown) {
    for (const lc of ["14", "15"]) {
      const line = lineByCode.get(lc)
      if (line) d[lc] = { value: null, line, source: "computed" }
    }
  }

  return d
}
