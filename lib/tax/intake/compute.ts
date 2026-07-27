/**
 * Compute a Form 1040 preview from gathered intake documents.
 *
 * This is the "review" half of the pipeline: the preparer keys W-2s, and
 * the Hub shows the resulting 1040 face BEFORE anything is pushed to
 * ProConnect. ProConnect remains the authority that actually prepares the
 * return — this is a check, not a substitute.
 *
 * Pure over injected inputs (no DB, no network) so it is unit-testable,
 * matching `evalComputation` in lib/forms/form-1040.ts.
 *
 * ── SCOPE: the v1 proof case ──
 * Single filer, one or more W-2s, standard deduction. Anything outside
 * that is reported in `outOfScope[]` rather than silently approximated —
 * a tax preview that quietly omits a Schedule is worse than one that says
 * it cannot compute. Deliberately NOT handled yet: itemized deductions,
 * QBI, Schedule 1/2/3, credits beyond none, capital gains, AMT,
 * self-employment tax.
 */

export interface TaxBracket {
  rate: number
  /** Inclusive top of the band; null means no ceiling. */
  upTo: number | null
}

export interface Form1040Constants {
  stdDeductionSingle: number
  stdDeductionMfj: number
  stdDeductionMfs: number
  stdDeductionHoh: number
  additionalStd65BlindSingle: number
  additionalStd65BlindMfj: number
  bracketsVerified: boolean
  brackets: {
    single: TaxBracket[]
    mfj: TaxBracket[]
    mfs: TaxBracket[]
    hoh: TaxBracket[]
  }
}

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh" | "qss"

export interface ComputeInput {
  filingStatus: FilingStatus
  /** Count of taxpayer/spouse who are 65+ or blind, for IRC 63(f). */
  additionalStdCount?: number
  /** W-2 documents, already flattened to the fields we consume. */
  w2s: Array<{
    box1Wages: number | null
    box2FedWithheld: number | null
    obbbaQualifiedTips: number | null
    obbbaQualifiedOvertime: number | null
    statutoryEmployee?: boolean
  }>
}

export interface ComputedLine {
  lineCode: string
  label: string
  value: number | null
  /** Set when the line could not be computed, explaining why. */
  unavailable?: string
}

export interface ComputeResult {
  lines: ComputedLine[]
  /** Situations this engine refuses to approximate. */
  outOfScope: string[]
  /** Non-fatal notes worth showing the preparer. */
  notes: string[]
}

function sum(xs: Array<number | null>): number {
  // The explicit generic keeps the accumulator `number`; without it TS
  // widens it to `number | null` from the element type.
  return xs.reduce<number>((t, x) => t + (x ?? 0), 0)
}

function stdDeductionFor(fs: FilingStatus, c: Form1040Constants): number {
  switch (fs) {
    case "mfj":
    case "qss":
      return c.stdDeductionMfj
    case "mfs":
      return c.stdDeductionMfs
    case "hoh":
      return c.stdDeductionHoh
    default:
      return c.stdDeductionSingle
  }
}

function bracketsFor(fs: FilingStatus, c: Form1040Constants): TaxBracket[] {
  switch (fs) {
    case "mfj":
    case "qss":
      return c.brackets.mfj
    case "mfs":
      return c.brackets.mfs
    case "hoh":
      return c.brackets.hoh
    default:
      return c.brackets.single
  }
}

/**
 * Progressive tax on ordinary income. Exported for direct testing.
 *
 * Only valid when the income is entirely ordinary — no qualified
 * dividends or long-term capital gain, which require the Qualified
 * Dividends & Capital Gain Tax Worksheet instead. The v1 case (wages
 * only) satisfies that; `computeForm1040Preview` enforces it.
 */
export function taxOnOrdinaryIncome(taxable: number, brackets: TaxBracket[]): number {
  if (taxable <= 0) return 0
  let tax = 0
  let floor = 0
  for (const b of brackets) {
    const ceiling = b.upTo ?? Infinity
    if (taxable > floor) {
      const inBand = Math.min(taxable, ceiling) - floor
      if (inBand > 0) tax += inBand * b.rate
    }
    if (taxable <= ceiling) break
    floor = ceiling
  }
  // Cents are meaningless on a 1040; the IRS rounds to whole dollars.
  return Math.round(tax)
}

export function computeForm1040Preview(
  input: ComputeInput,
  c: Form1040Constants,
): ComputeResult {
  const outOfScope: string[] = []
  const notes: string[] = []

  if (input.w2s.some((w) => w.statutoryEmployee)) {
    outOfScope.push(
      "A W-2 is marked statutory employee — those wages route to Schedule C, not line 1a. Not handled.",
    )
  }

  // ── Income ──
  const line1a = sum(input.w2s.map((w) => w.box1Wages))
  const line1z = line1a // no 1b–1h in the v1 case
  const line9 = line1z

  // ── Adjustments: the OBBBA deductions ProConnect routes via Schedule 1 ──
  const tips = sum(input.w2s.map((w) => w.obbbaQualifiedTips))
  const overtime = sum(input.w2s.map((w) => w.obbbaQualifiedOvertime))
  const line10 = tips + overtime
  if (line10 > 0) {
    notes.push(
      `Line 10 includes OBBBA deductions: ${tips > 0 ? `qualified tips ${tips.toLocaleString()}` : ""}` +
        `${tips > 0 && overtime > 0 ? " and " : ""}` +
        `${overtime > 0 ? `qualified overtime ${overtime.toLocaleString()}` : ""}. ` +
        "Statutory caps (§224 / §225) and their income phase-outs are NOT applied here — ProConnect will apply them.",
    )
    outOfScope.push(
      "OBBBA §224/§225 caps and phase-outs are not modelled. The preview may overstate the deduction, so treat line 10 onward as indicative.",
    )
  }

  const line11 = line9 - line10 // AGI

  // ── Deduction ──
  const baseStd = stdDeductionFor(input.filingStatus, c)
  const extraPer =
    input.filingStatus === "mfj" || input.filingStatus === "qss" || input.filingStatus === "mfs"
      ? c.additionalStd65BlindMfj
      : c.additionalStd65BlindSingle
  const extra = (input.additionalStdCount ?? 0) * extraPer
  const line12 = baseStd + extra
  if (extra > 0) {
    notes.push(
      `Line 12 includes ${input.additionalStdCount} × ${extraPer.toLocaleString()} additional standard deduction for age 65+/blind.`,
    )
  }
  notes.push(
    "OBBBA §63(f)'s additional senior deduction has no ProConnect input field — it is derived from date of birth — so it is NOT included here. Expect ProConnect's line 12 to be higher for taxpayers 65+.",
  )

  const line13 = 0 // no QBI in the v1 case
  const line14 = line12 + line13
  const line15 = Math.max(0, line11 - line14) // taxable income

  // ── Tax ──
  // Fail closed. Showing a tax figure from unverified brackets is worse
  // than showing none, because a preparer may act on it.
  let line16: number | null = null
  let line16Unavailable: string | undefined
  if (!c.bracketsVerified) {
    line16Unavailable =
      "Tax brackets are not yet verified against Rev. Proc. 2024-40. Set form_1040_constants.tax_brackets_verified = true once checked."
  } else {
    line16 = taxOnOrdinaryIncome(line15, bracketsFor(input.filingStatus, c))
  }

  const line24 = line16 // no Schedule 2, no credits in the v1 case
  const line25a = sum(input.w2s.map((w) => w.box2FedWithheld))
  const line25d = line25a
  const line33 = line25d

  const line34 = line24 === null ? null : Math.max(0, line33 - line24)
  const line37 = line24 === null ? null : Math.max(0, line24 - line33)

  const lines: ComputedLine[] = [
    { lineCode: "1a", label: "Wages from Form(s) W-2, box 1", value: line1a },
    { lineCode: "1z", label: "Total wages", value: line1z },
    { lineCode: "9", label: "Total income", value: line9 },
    { lineCode: "10", label: "Adjustments to income", value: line10 },
    { lineCode: "11", label: "Adjusted gross income", value: line11 },
    { lineCode: "12", label: "Standard deduction", value: line12 },
    { lineCode: "13", label: "Qualified business income deduction", value: line13 },
    { lineCode: "14", label: "Total deductions", value: line14 },
    { lineCode: "15", label: "Taxable income", value: line15 },
    { lineCode: "16", label: "Tax", value: line16, unavailable: line16Unavailable },
    { lineCode: "24", label: "Total tax", value: line24, unavailable: line16Unavailable },
    { lineCode: "25a", label: "Federal income tax withheld from W-2s", value: line25a },
    { lineCode: "25d", label: "Total withholding", value: line25d },
    { lineCode: "33", label: "Total payments", value: line33 },
    { lineCode: "34", label: "Amount overpaid (refund)", value: line34, unavailable: line16Unavailable },
    { lineCode: "37", label: "Amount you owe", value: line37, unavailable: line16Unavailable },
  ]

  return { lines, outOfScope, notes }
}
