/**
 * Compute a Form 1040 preview from gathered intake documents.
 *
 * This is the "review" half of the pipeline: the preparer keys source
 * documents, and the Hub shows the resulting 1040 face BEFORE anything is
 * pushed to ProConnect. ProConnect remains the authority that actually
 * prepares the return — this is a check, not a substitute.
 *
 * Pure over injected inputs (no DB, no network) so it is unit-testable,
 * matching `evalComputation` in lib/forms/form-1040.ts.
 *
 * ── SCOPE ──
 * Handled: W-2 wages, 1099-INT interest, 1099-DIV dividends, 1099-R
 * retirement distributions, and Schedule A itemized deductions, with the
 * standard-vs-itemized comparison on line 12.
 *
 * Deliberately NOT handled, and reported in `outOfScope[]` rather than
 * silently approximated — a preview that quietly omits a Schedule is worse
 * than one that says it cannot compute:
 *   • the Qualified Dividends & Capital Gain Tax Worksheet (so line 16 is
 *     unavailable whenever qualified dividends or capital gain are present)
 *   • Schedule D beyond capital gain distributions
 *   • QBI (§199A), AMT, self-employment tax, credits, Schedule 2/3
 *   • charitable AGI percentage limits and carryovers
 *   • the Form 4952 investment-interest limit
 *   • basis recovery on 1099-R box 2b "taxable amount not determined"
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
  /** Schedule A. Gated separately from the brackets — see migration 362. */
  itemizedVerified: boolean
  medicalAgiFloorPct: number
  saltCap: number
  saltCapMfs: number
  saltPhaseoutStart: number
  saltPhaseoutStartMfs: number
  saltPhaseoutRate: number
  saltPhaseoutFloor: number
  saltPhaseoutFloorMfs: number
  charitableMileageRate: number
  /**
   * Schedule 1-A Parts II-IV (scripts/389). Tips and overtime share one
   * phase-out whose thousands quotient rounds DOWN; QPVLI rounds UP.
   */
  tipsDeductionCap: number
  overtimeDeductionCap: number
  overtimeDeductionCapMfj: number
  tipsOvertimePhaseoutStart: number
  tipsOvertimePhaseoutStartMfj: number
  tipsOvertimePhaseoutPer1000: number
  /** Part V senior deduction (scripts/386). */
  seniorDeductionMax: number
  seniorDeductionPhaseoutStart: number
  seniorDeductionPhaseoutStartMfj: number
  seniorDeductionPhaseoutRate: number
}

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh" | "qss"

export interface W2Input {
  box1Wages: number | null
  box2FedWithheld: number | null
  obbbaQualifiedTips: number | null
  obbbaQualifiedOvertime: number | null
  statutoryEmployee?: boolean
}

export interface Int1099Input {
  interestBanks: number | null
  interestUsBonds: number | null
  /**
   * TOTAL municipal interest. ProConnect also has an in-state field, which
   * is a SUBSET of this one and exists only to split state taxability — it
   * is deliberately not summed here, or muni interest would be double
   * counted on line 2a.
   */
  interestMuniTotal: number | null
  /** In-state muni. Read only to detect the total-left-blank mistake. */
  interestMuniInstate?: number | null
  oid: number | null
  fedWithheld: number | null
  earlyWithdrawalPenalty: number | null
  accruedInterest: number | null
  nomineeInterest: number | null
}

export interface Div1099Input {
  box1aOrdinary: number | null
  box1bQualified: number | null
  box2aCapGain: number | null
  box3Nondividend: number | null
  box4FedWithheld: number | null
  box5Sec199a: number | null
}

export interface R1099Input {
  /** Box 7 IRA/SEP/SIMPLE — routes the distribution to line 4 vs line 5. */
  iraSepSimple: boolean
  box1Gross: number | null
  box2aTaxable: number | null
  box2bNotDetermined: boolean
  box4FedWithheld: number | null
  distCode1: string | null
}

export interface ScheduleAInput {
  medPrescriptions: number | null
  medDoctors: number | null
  medHospitals: number | null
  medInsurance: number | null
  medReimbursement: number | null
  medOther: number | null
  taxStateIncome: number | null
  taxSales: number | null
  taxRealestateResidence: number | null
  taxRealestateInvestment: number | null
  taxPersonalProperty: number | null
  intMortgage1098: number | null
  intMortgageNo1098: number | null
  intPointsNo1098: number | null
  intInvestment: number | null
  charityCash: number | null
  charityNoncash50: number | null
  charityNoncash30: number | null
  charityMiles: number | null
  otherItemized: number | null
}

export interface ComputeInput {
  filingStatus: FilingStatus
  /** Count of taxpayer/spouse who are 65+ or blind, for IRC 63(f). */
  additionalStdCount?: number
  /**
   * How many of the taxpayer/spouse were born before 1961-01-02, for the
   * Schedule 1-A Part V enhanced deduction for seniors. Distinct from
   * `additionalStdCount`, which counts aged AND blind boxes together and so
   * cannot stand in for it — a blind 50-year-old adds a 63(f) box but no
   * senior deduction. Left undefined the deduction is omitted rather than
   * guessed, and that omission is reported in `outOfScope`.
   */
  seniorCount?: number
  w2s: W2Input[]
  int1099s?: Int1099Input[]
  div1099s?: Div1099Input[]
  r1099s?: R1099Input[]
  /** At most one in practice; an array keeps the shape uniform. */
  scheduleA?: ScheduleAInput[]
}

export interface ComputedLine {
  lineCode: string
  label: string
  value: number | null
  /** Set when the line could not be computed, explaining why. */
  unavailable?: string
}

export interface ScheduleALine {
  lineCode: string
  label: string
  value: number
}

export interface ComputeResult {
  lines: ComputedLine[]
  /** Schedule A detail, present only when a Schedule A was gathered. */
  scheduleA?: {
    lines: ScheduleALine[]
    total: number
    /** True when itemizing beats the standard deduction. */
    itemizingWins: boolean
  }
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

/** Whole dollars — the IRS rounds, and cents are noise on a 1040 face. */
function dollars(n: number): number {
  return Math.round(n)
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
 * Dividends & Capital Gain Tax Worksheet instead. `computeForm1040Preview`
 * enforces that precondition before calling this.
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
  return dollars(tax)
}

/**
 * The SALT cap as amended by OBBBA §70120, including its phase-down.
 *
 * Exported for direct testing because the phase-down is the single most
 * error-prone number in the TY2025 return: it reduces the cap by 30% of
 * MAGI above the threshold but never below the floor.
 */
export function saltCapFor(
  fs: FilingStatus,
  magi: number,
  c: Form1040Constants,
): number {
  const isMfs = fs === "mfs"
  const cap = isMfs ? c.saltCapMfs : c.saltCap
  const start = isMfs ? c.saltPhaseoutStartMfs : c.saltPhaseoutStart
  const floor = isMfs ? c.saltPhaseoutFloorMfs : c.saltPhaseoutFloor
  if (magi <= start) return cap
  return Math.max(floor, cap - (magi - start) * c.saltPhaseoutRate)
}

interface ScheduleAResult {
  lines: ScheduleALine[]
  total: number
  notes: string[]
  outOfScope: string[]
}

/**
 * Schedule A, given AGI (the medical floor and the SALT phase-down both
 * depend on it, which is why this runs after line 11 rather than with the
 * rest of the income lines).
 */
function computeScheduleA(
  a: ScheduleAInput,
  fs: FilingStatus,
  agi: number,
  c: Form1040Constants,
): ScheduleAResult {
  const notes: string[] = []
  const outOfScope: string[] = []

  // Lines 1-4: medical and dental.
  const medGross =
    sum([a.medPrescriptions, a.medDoctors, a.medHospitals, a.medInsurance, a.medOther]) -
    (a.medReimbursement ?? 0)
  const medFloor = agi * c.medicalAgiFloorPct
  const line1 = Math.max(0, medGross)
  const line4 = dollars(Math.max(0, line1 - medFloor))
  if (line1 > 0 && line4 === 0) {
    notes.push(
      `Medical expenses of ${dollars(line1).toLocaleString()} fall entirely below the ` +
        `${(c.medicalAgiFloorPct * 100).toFixed(1)}% AGI floor of ${dollars(medFloor).toLocaleString()}, so nothing is deductible.`,
    )
  }

  // Lines 5-7: taxes you paid. §164(b)(5) is an either/or election —
  // income tax OR sales tax, never both. Take the larger, which is what a
  // preparer would elect, and say so.
  const stateIncome = a.taxStateIncome ?? 0
  const salesTax = a.taxSales ?? 0
  const line5a = Math.max(stateIncome, salesTax)
  if (stateIncome > 0 && salesTax > 0) {
    notes.push(
      `Both state income tax (${dollars(stateIncome).toLocaleString()}) and sales tax ` +
        `(${dollars(salesTax).toLocaleString()}) were entered. §164(b)(5) allows only one; ` +
        `the larger is used. ProConnect makes the same election.`,
    )
  }
  const line5b = sum([a.taxRealestateResidence, a.taxRealestateInvestment])
  const line5c = a.taxPersonalProperty ?? 0
  const line5dRaw = line5a + line5b + line5c
  const cap = saltCapFor(fs, agi, c)
  const line5e = dollars(Math.min(line5dRaw, cap))
  if (line5dRaw > cap) {
    notes.push(
      `State and local taxes of ${dollars(line5dRaw).toLocaleString()} are limited to the ` +
        `§164(b)(6) cap of ${dollars(cap).toLocaleString()}` +
        (cap < (fs === "mfs" ? c.saltCapMfs : c.saltCap)
          ? " (phased down because MAGI exceeds the threshold)"
          : "") +
        ".",
    )
  }

  // Lines 8-10: interest you paid.
  const line8a = a.intMortgage1098 ?? 0
  const line8b = a.intMortgageNo1098 ?? 0
  const line8c = a.intPointsNo1098 ?? 0
  const line9 = a.intInvestment ?? 0
  const line10 = dollars(line8a + line8b + line8c + line9)
  if (line8a + line8b > 0) {
    outOfScope.push(
      "The §163(h)(3) acquisition-debt limit ($750,000 / $1,000,000 grandfathered) is not applied. " +
        "Mortgage interest is taken as entered; ProConnect will limit it if the debt exceeds the cap.",
    )
  }
  if (line9 > 0) {
    outOfScope.push(
      "Investment interest is taken as entered. The §163(d) limit to net investment income (Form 4952) is not applied.",
    )
  }

  // Lines 11-14: gifts to charity.
  const mileageDeduction = (a.charityMiles ?? 0) * c.charitableMileageRate
  const line11 = sum([a.charityCash])
  const line12 = sum([a.charityNoncash50, a.charityNoncash30]) + mileageDeduction
  const line14 = dollars(line11 + line12)
  if (line14 > 0) {
    outOfScope.push(
      "Charitable AGI percentage limits (60%/50%/30%/20%) and prior-year carryovers are not applied. " +
        "Contributions are taken as entered.",
    )
    if (mileageDeduction > 0) {
      notes.push(
        `${(a.charityMiles ?? 0).toLocaleString()} charitable miles × ${c.charitableMileageRate} = ` +
          `${dollars(mileageDeduction).toLocaleString()} included in gifts to charity.`,
      )
    }
  }

  const line16 = dollars(a.otherItemized ?? 0)
  const total = line4 + line5e + line10 + line14 + line16

  return {
    lines: [
      { lineCode: "A1", label: "Medical and dental expenses", value: dollars(line1) },
      { lineCode: "A3", label: `AGI × ${(c.medicalAgiFloorPct * 100).toFixed(1)}%`, value: dollars(medFloor) },
      { lineCode: "A4", label: "Deductible medical", value: line4 },
      { lineCode: "A5a", label: "State and local income (or sales) tax", value: dollars(line5a) },
      { lineCode: "A5b", label: "State and local real estate taxes", value: dollars(line5b) },
      { lineCode: "A5c", label: "State and local personal property taxes", value: dollars(line5c) },
      { lineCode: "A5e", label: "Total taxes paid (after cap)", value: line5e },
      { lineCode: "A8a", label: "Home mortgage interest on Form 1098", value: dollars(line8a) },
      { lineCode: "A8b", label: "Home mortgage interest not on Form 1098", value: dollars(line8b) },
      { lineCode: "A8c", label: "Points not on Form 1098", value: dollars(line8c) },
      { lineCode: "A9", label: "Investment interest", value: dollars(line9) },
      { lineCode: "A10", label: "Total interest paid", value: line10 },
      { lineCode: "A11", label: "Gifts by cash or check", value: dollars(line11) },
      { lineCode: "A12", label: "Gifts other than by cash or check", value: dollars(line12) },
      { lineCode: "A14", label: "Total gifts to charity", value: line14 },
      { lineCode: "A16", label: "Other itemized deductions", value: line16 },
      { lineCode: "A17", label: "Total itemized deductions", value: total },
    ],
    total,
    notes,
    outOfScope,
  }
}

export function computeForm1040Preview(
  input: ComputeInput,
  c: Form1040Constants,
): ComputeResult {
  const outOfScope: string[] = []
  const notes: string[] = []

  const w2s = input.w2s ?? []
  const ints = input.int1099s ?? []
  const divs = input.div1099s ?? []
  const rs = input.r1099s ?? []
  const schAs = input.scheduleA ?? []

  if (w2s.some((w) => w.statutoryEmployee)) {
    outOfScope.push(
      "A W-2 is marked statutory employee — those wages route to Schedule C, not line 1a. Not handled.",
    )
  }
  if (schAs.length > 1) {
    outOfScope.push(
      `${schAs.length} Schedule A documents were gathered. Only one Schedule A exists per return; ` +
        "they are summed here, which is almost certainly wrong. Consolidate them.",
    )
  }

  // ── Income ──
  const line1a = sum(w2s.map((w) => w.box1Wages))
  const line1z = line1a // no 1b-1h in scope

  // 2a tax-exempt interest is reported but not taxed; 2b is taxable.
  // Accrued and nominee interest are subtractions — amounts received but
  // belonging to someone else (or to the seller of the bond).
  const line2a = dollars(sum(ints.map((i) => i.interestMuniTotal)))
  // The in-state field is a subset of the total, so a preparer who fills in
  // only the in-state box produces a line 2a of zero. ProConnect would make
  // the same omission — catch it here rather than on the filed return.
  const instateWithoutTotal = ints.filter(
    (i) => (i.interestMuniInstate ?? 0) > 0 && (i.interestMuniTotal ?? 0) === 0,
  )
  if (instateWithoutTotal.length > 0) {
    outOfScope.push(
      `${instateWithoutTotal.length} Form(s) 1099-INT have in-state municipal interest but no total ` +
        "municipal interest. The in-state field is a subset of the total, not a substitute — line 2a " +
        "will understate tax-exempt interest until the total is entered.",
    )
  }
  const taxableInterestGross = sum(
    ints.flatMap((i) => [i.interestBanks, i.interestUsBonds, i.oid]),
  )
  const interestSubtractions = sum(ints.flatMap((i) => [i.accruedInterest, i.nomineeInterest]))
  const line2b = dollars(Math.max(0, taxableInterestGross - interestSubtractions))
  if (interestSubtractions > 0) {
    notes.push(
      `Line 2b is net of ${dollars(interestSubtractions).toLocaleString()} in accrued and nominee interest.`,
    )
  }

  const line3a = dollars(sum(divs.map((d) => d.box1bQualified)))
  const line3b = dollars(sum(divs.map((d) => d.box1aOrdinary)))
  if (line3a > line3b) {
    outOfScope.push(
      "Qualified dividends (line 3a) exceed total ordinary dividends (line 3b). Box 1b cannot exceed " +
        "box 1a on a 1099-DIV — check the entries.",
    )
  }
  const nondividend = sum(divs.map((d) => d.box3Nondividend))
  if (nondividend > 0) {
    notes.push(
      `${dollars(nondividend).toLocaleString()} of nondividend distributions were entered. These reduce ` +
        "basis rather than appearing on the 1040 face, and become gain only once basis reaches zero. " +
        "Not tracked here.",
    )
  }
  const sec199a = sum(divs.map((d) => d.box5Sec199a))
  if (sec199a > 0) {
    outOfScope.push(
      `${dollars(sec199a).toLocaleString()} of §199A (REIT) dividends were entered. They generate a QBI ` +
        "deduction on line 13, which this engine does not compute.",
    )
  }

  // 1099-R: box 7 IRA/SEP/SIMPLE is the discriminator between line 4
  // (IRAs) and line 5 (pensions and annuities).
  const iras = rs.filter((r) => r.iraSepSimple)
  const pensions = rs.filter((r) => !r.iraSepSimple)
  const line4a = dollars(sum(iras.map((r) => r.box1Gross)))
  const line4b = dollars(sum(iras.map((r) => r.box2aTaxable)))
  const line5a = dollars(sum(pensions.map((r) => r.box1Gross)))
  const line5b = dollars(sum(pensions.map((r) => r.box2aTaxable)))
  const undetermined = rs.filter((r) => r.box2bNotDetermined)
  if (undetermined.length > 0) {
    outOfScope.push(
      `${undetermined.length} 1099-R(s) have box 2b "taxable amount not determined" checked. The taxable ` +
        "amount is taken as box 2a was entered; basis recovery (Form 8606 / the Simplified Method) is not computed.",
    )
  }
  for (const r of rs) {
    const code = (r.distCode1 ?? "").trim().toUpperCase()
    if (code === "1" || code === "J" || code === "S") {
      outOfScope.push(
        `A 1099-R carries distribution code ${code}, an early distribution. The 10% additional tax ` +
          "(§72(t), Form 5329) routes to Schedule 2 and is not computed here.",
      )
      break
    }
    if (code === "G" || code === "H") {
      notes.push(
        `A 1099-R carries distribution code ${code} (direct rollover). Verify box 2a is zero — a rollover ` +
          "is reported on line 4a/5a but generally not taxable.",
      )
    }
  }

  // Capital gain distributions from 1099-DIV. When they are the only
  // capital transactions, they go directly on line 7 with no Schedule D.
  const line7 = dollars(sum(divs.map((d) => d.box2aCapGain)))
  if (line7 > 0) {
    notes.push(
      "Line 7 is capital gain distributions from Form(s) 1099-DIV box 2a only. If the client had any " +
        "security sales, Schedule D is required and this figure is incomplete.",
    )
  }

  const line8 = 0 // Schedule 1 additional income — not in scope
  const line9 = dollars(line1z + line2b + line3b + line4b + line5b + line7 + line8)

  // ── Adjustments (Schedule 1 part II) ──
  // OBBBA qualified tips and overtime are NOT here. They are Schedule 1-A
  // deductions and land on line 13b, below the line — see the line 13b block
  // further down. Putting them on line 10 (as this did until 2026-08-11)
  // understates AGI by their full amount, and AGI drives Social Security
  // taxability, the CTC phaseout, NIIT, and the phase-outs of these very
  // deductions.
  const tips = sum(w2s.map((w) => w.obbbaQualifiedTips))
  const overtime = sum(w2s.map((w) => w.obbbaQualifiedOvertime))
  const earlyWithdrawal = sum(ints.map((i) => i.earlyWithdrawalPenalty))
  const line10 = dollars(earlyWithdrawal)
  if (earlyWithdrawal > 0) {
    notes.push(
      `Line 10 includes ${dollars(earlyWithdrawal).toLocaleString()} of early-withdrawal penalty ` +
        "(Schedule 1 line 18), which is deductible in full.",
    )
  }

  const line11 = line9 - line10 // AGI

  // ── Deduction: standard vs itemized ──
  const baseStd = stdDeductionFor(input.filingStatus, c)
  const extraPer =
    input.filingStatus === "mfj" || input.filingStatus === "qss" || input.filingStatus === "mfs"
      ? c.additionalStd65BlindMfj
      : c.additionalStd65BlindSingle
  const extra = (input.additionalStdCount ?? 0) * extraPer
  const standardDeduction = baseStd + extra
  if (extra > 0) {
    notes.push(
      `The standard deduction includes ${input.additionalStdCount} × ${extraPer.toLocaleString()} for age 65+/blind.`,
    )
  }
  notes.push(
    "OBBBA §63(f)'s additional senior deduction has no ProConnect input field — it is derived from date of birth — so it is NOT included here. Expect ProConnect's line 12 to be higher for taxpayers 65+.",
  )

  let scheduleABlock: ComputeResult["scheduleA"]
  let line12: number | null = standardDeduction
  let line12Unavailable: string | undefined

  if (schAs.length > 0) {
    if (!c.itemizedVerified) {
      // Fail closed. An unverified SALT cap changes whether the client
      // itemizes at all, which changes every line below it.
      line12 = null
      line12Unavailable =
        "A Schedule A was gathered, but the TY2025 itemized-deduction constants (SALT cap, medical " +
        "floor, charitable mileage rate) are not yet verified. Set " +
        "form_1040_constants.itemized_constants_verified = true once checked against the IRS Schedule A " +
        "instructions and P.L. 119-21 §70120."
      outOfScope.push(
        "Itemized deductions are gathered but not applied — see line 12. Everything from line 14 down is unavailable.",
      )
    } else {
      const merged = schAs.reduce<ScheduleAInput>((acc, s) => {
        const keys = Object.keys(s) as Array<keyof ScheduleAInput>
        for (const k of keys) acc[k] = (acc[k] ?? 0) + (s[k] ?? 0)
        return acc
      }, {} as ScheduleAInput)
      const a = computeScheduleA(merged, input.filingStatus, line11, c)
      notes.push(...a.notes)
      outOfScope.push(...a.outOfScope)
      const itemizingWins = a.total > standardDeduction
      scheduleABlock = { lines: a.lines, total: a.total, itemizingWins }
      line12 = itemizingWins ? a.total : standardDeduction
      notes.push(
        itemizingWins
          ? `Itemizing (${a.total.toLocaleString()}) beats the standard deduction (${standardDeduction.toLocaleString()}) by ${(a.total - standardDeduction).toLocaleString()}.`
          : `The standard deduction (${standardDeduction.toLocaleString()}) beats itemizing (${a.total.toLocaleString()}) by ${(standardDeduction - a.total).toLocaleString()}. Schedule A is not used.`,
      )
    }
  }

  const line13 = 0 // no QBI computation

  // ── Line 13b: Schedule 1-A additional deductions ──
  // Below the line, so AGI (line 11) is already final and is the MAGI these
  // phase-outs read. MAGI proper is Schedule 1-A line 3 = AGI plus excluded
  // Puerto Rico income and the Form 2555/4563 exclusions, none of which the
  // intake documents show; on a domestic return AGI is the whole of it.
  //
  // Parts II-V all require a joint return if married, so an MFS filer claims
  // none of them.
  const isJoint = input.filingStatus === "mfj"
  const sch1aEligible = input.filingStatus !== "mfs"
  const magi = line11

  // Parts II/III: reduced by $100 per WHOLE $1,000 over the threshold — the
  // quotient rounds DOWN (Schedule 1-A lines 11 and 19).
  const tipsOvertimeReduction = (() => {
    const start = isJoint ? c.tipsOvertimePhaseoutStartMfj : c.tipsOvertimePhaseoutStart
    const over = Math.max(0, magi - start)
    return Math.floor(over / 1000) * c.tipsOvertimePhaseoutPer1000
  })()
  const tipsDeduction = sch1aEligible
    ? Math.max(0, Math.min(tips, c.tipsDeductionCap) - tipsOvertimeReduction)
    : 0
  const overtimeDeduction = sch1aEligible
    ? Math.max(
        0,
        Math.min(overtime, isJoint ? c.overtimeDeductionCapMfj : c.overtimeDeductionCap) -
          tipsOvertimeReduction,
      )
    : 0

  // Part V: 6% of MAGI over the threshold, per eligible person.
  const seniorCount = sch1aEligible ? Math.min(input.seniorCount ?? 0, isJoint ? 2 : 1) : 0
  const seniorPerPerson = Math.max(
    0,
    c.seniorDeductionMax -
      c.seniorDeductionPhaseoutRate *
        Math.max(0, magi - (isJoint ? c.seniorDeductionPhaseoutStartMfj : c.seniorDeductionPhaseoutStart)),
  )
  const seniorDeduction = seniorCount * seniorPerPerson

  const line13b = dollars(tipsDeduction + overtimeDeduction + seniorDeduction)

  if (tips > 0 || overtime > 0) {
    notes.push(
      `Line 13b includes OBBBA Schedule 1-A deductions: ` +
        `${tips > 0 ? `qualified tips ${dollars(tipsDeduction).toLocaleString()} (of ${dollars(tips).toLocaleString()} reported)` : ""}` +
        `${tips > 0 && overtime > 0 ? " and " : ""}` +
        `${overtime > 0 ? `qualified overtime ${dollars(overtimeDeduction).toLocaleString()} (of ${dollars(overtime).toLocaleString()} reported)` : ""}. ` +
        "These are below-the-line deductions, so they do NOT reduce AGI on line 11.",
    )
    if (!sch1aEligible) {
      notes.push(
        "Filing status is married filing separately, so no Schedule 1-A deduction is allowed — each part requires a joint return.",
      )
    }
    outOfScope.push(
      "Schedule 1-A caps and phase-outs are applied, but eligibility is not verified: qualified tips count only in an occupation on the IRS.gov/TippedOccupations list, and every part requires a valid SSN.",
    )
  }
  if (seniorCount > 0) {
    notes.push(
      `Line 13b includes the enhanced deduction for seniors: ${seniorCount} × ` +
        `${Math.round(seniorPerPerson).toLocaleString()} = ${Math.round(seniorDeduction).toLocaleString()}.`,
    )
  } else if (sch1aEligible && input.seniorCount === undefined) {
    outOfScope.push(
      "The enhanced deduction for seniors (up to 6,000 per person 65+, Schedule 1-A Part V) is not included: the intake does not record how many of the taxpayer/spouse were born before 1961-01-02. It is derived from date of birth, not entered, so ProConnect's line 13b will be higher for a 65+ household.",
    )
  }
  // Vehicle loan interest (Part IV) has no intake field at all.
  if (line13b > 0 || tips > 0 || overtime > 0) {
    outOfScope.push(
      "Qualified passenger vehicle loan interest (Schedule 1-A Part IV) is never included — the intake does not gather vehicle loan interest or VINs.",
    )
  }

  const line14 = line12 === null ? null : line12 + line13 + line13b
  const line15 = line14 === null ? null : Math.max(0, line11 - line14) // taxable income

  // ── Tax ──
  // Two independent gates, both fail-closed. Showing a tax figure from
  // unverified brackets — or ordinary rates on preferential income — is
  // worse than showing none, because a preparer may act on it.
  let line16: number | null = null
  let taxUnavailable: string | undefined
  const preferentialIncome = line3a + line7
  if (line15 === null) {
    taxUnavailable = line12Unavailable
  } else if (!c.bracketsVerified) {
    taxUnavailable =
      "Tax brackets are not yet verified against Rev. Proc. 2024-40. Set form_1040_constants.tax_brackets_verified = true once checked."
  } else if (preferentialIncome > 0) {
    taxUnavailable =
      `Qualified dividends and/or capital gain distributions of ${preferentialIncome.toLocaleString()} are ` +
      "taxed at preferential rates via the Qualified Dividends and Capital Gain Tax Worksheet, which the " +
      "Hub does not implement. Taxing them at ordinary rates would overstate the tax, so line 16 is left blank. " +
      "ProConnect computes it."
  } else {
    line16 = taxOnOrdinaryIncome(line15, bracketsFor(input.filingStatus, c))
  }

  const line24 = line16 // no Schedule 2, no credits in scope
  const line25a = dollars(sum(w2s.map((w) => w.box2FedWithheld)))
  const line25b = dollars(
    sum([
      ...ints.map((i) => i.fedWithheld),
      ...divs.map((d) => d.box4FedWithheld),
      ...rs.map((r) => r.box4FedWithheld),
    ]),
  )
  const line25d = line25a + line25b
  const line33 = line25d

  const line34 = line24 === null ? null : Math.max(0, line33 - line24)
  const line37 = line24 === null ? null : Math.max(0, line24 - line33)

  // Only surface lines the return actually uses — a preview full of zeroes
  // for schedules the client does not have is harder to check, not easier.
  const lines: ComputedLine[] = [
    { lineCode: "1a", label: "Wages from Form(s) W-2, box 1", value: line1a },
    { lineCode: "1z", label: "Total wages", value: line1z },
  ]
  if (ints.length > 0) {
    lines.push(
      { lineCode: "2a", label: "Tax-exempt interest", value: line2a },
      { lineCode: "2b", label: "Taxable interest", value: line2b },
    )
  }
  if (divs.length > 0) {
    lines.push(
      { lineCode: "3a", label: "Qualified dividends", value: line3a },
      { lineCode: "3b", label: "Ordinary dividends", value: line3b },
    )
  }
  if (iras.length > 0) {
    lines.push(
      { lineCode: "4a", label: "IRA distributions", value: line4a },
      { lineCode: "4b", label: "IRA distributions — taxable amount", value: line4b },
    )
  }
  if (pensions.length > 0) {
    lines.push(
      { lineCode: "5a", label: "Pensions and annuities", value: line5a },
      { lineCode: "5b", label: "Pensions and annuities — taxable amount", value: line5b },
    )
  }
  if (line7 > 0) {
    lines.push({ lineCode: "7", label: "Capital gain or (loss)", value: line7 })
  }
  lines.push(
    { lineCode: "9", label: "Total income", value: line9 },
    { lineCode: "10", label: "Adjustments to income", value: line10 },
    { lineCode: "11", label: "Adjusted gross income", value: line11 },
    {
      lineCode: "12",
      label: scheduleABlock?.itemizingWins ? "Itemized deductions" : "Standard deduction",
      value: line12,
      unavailable: line12Unavailable,
    },
    { lineCode: "13", label: "Qualified business income deduction", value: line13 },
    {
      lineCode: "13b",
      label: "Additional deductions (Schedule 1-A)",
      value: line13b,
    },
    { lineCode: "14", label: "Total deductions", value: line14, unavailable: line12Unavailable },
    { lineCode: "15", label: "Taxable income", value: line15, unavailable: line12Unavailable },
    { lineCode: "16", label: "Tax", value: line16, unavailable: taxUnavailable },
    { lineCode: "24", label: "Total tax", value: line24, unavailable: taxUnavailable },
    { lineCode: "25a", label: "Federal income tax withheld from W-2s", value: line25a },
  )
  if (line25b > 0) {
    lines.push({ lineCode: "25b", label: "Federal income tax withheld from Form(s) 1099", value: line25b })
  }
  lines.push(
    { lineCode: "25d", label: "Total withholding", value: line25d },
    { lineCode: "33", label: "Total payments", value: line33 },
    { lineCode: "34", label: "Amount overpaid (refund)", value: line34, unavailable: taxUnavailable },
    { lineCode: "37", label: "Amount you owe", value: line37, unavailable: taxUnavailable },
  )

  return { lines, scheduleA: scheduleABlock, outOfScope, notes }
}
