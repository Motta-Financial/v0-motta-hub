/**
 * Direct 1040 line entry — evaluation.
 *
 * This module is deliberately **pure**: no Supabase client, no `next/server`,
 * no environment variables, no I/O. Both the API route and the browser
 * import it, so the preparer sees a line recalculate as they type without a
 * round trip, and the server recomputes the same values from the same code
 * on save. One evaluator, two callers, no drift.
 *
 * The split mirrors `lib/auth/leadership-roles.ts` (pure constants) vs
 * `lib/auth/require-leadership.ts` (server gate) — the existing convention
 * in this codebase for "shared with the client bundle".
 *
 * Note it does NOT reuse `lib/forms/form-1040.ts#evaluateComputedLines`,
 * which is the same DSL: that module reads
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` at module scope and constructs a
 * Supabase client, so importing it from a client component would pull the
 * admin client into the browser bundle. The DSL is ~30 lines; duplicating
 * it is cheaper than making the whole 1040 module isomorphic, and the two
 * are pinned together by `scripts/365`'s comment and the test in
 * `scripts/verify-1040-direct-entry.ts` (`npx tsx`, 59 assertions).
 */

// ---------------------------------------------------------------------------
// Types — the client-visible subset of form_1040_lines
// ---------------------------------------------------------------------------

export type LineDataType =
  | "currency"
  | "integer"
  | "boolean"
  | "text"
  | "ssn"
  | "ein"
  | "date"
  | "enum"
  | "checkbox_group"
  | "phone"
  | "email"
  | "routing"
  | "account"

export type Computation =
  | { kind: "sum"; operands: string[] }
  | { kind: "diff"; operands: string[] }
  | { kind: "copy"; operands: string[] }
  | { kind: "subtract_floor_zero"; operands: string[] }

export interface LineDef {
  lineCode: string
  ordinal: number
  section: string
  label: string
  shortLabel: string | null
  dataType: LineDataType
  enumOptions: string[] | null
  isComputed: boolean
  computation: Computation | null
  scheduleRef: string | null
  notes: string | null
}

export type LineValue = string | number | boolean | null

/** What the preparer has typed, keyed by IRS line code. */
export type LineEntries = Record<string, LineValue>

export interface EvaluatedLine {
  lineCode: string
  value: LineValue
  /** `entry` = typed by a preparer, `computed` = derived from the DSL. */
  source: "entry" | "computed"
  /**
   * Set when a value could not be produced and the reason is a policy
   * decision rather than an empty input. Rendered in place of the number,
   * never alongside a fallback of zero.
   */
  unavailable?: string
}

export type EvaluatedLines = Record<string, EvaluatedLine>

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh" | "qss"

export interface TaxBracket {
  rate: number
  /** Inclusive top of the band; null = no ceiling. */
  upTo: number | null
}

/**
 * The constants the entry surface needs. A subset of `form_1040_constants`,
 * already coerced — the API route does the JSONB unwrapping so the client
 * receives plain numbers and booleans.
 */
export interface EntryConstants {
  bracketsVerified: boolean
  itemizedVerified: boolean
  brackets: Record<FilingStatus, TaxBracket[]>
  standardDeduction: Record<FilingStatus, number>
  additionalStd65BlindSingle: number
  additionalStd65BlindMfj: number
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Coerce any entered value to a number for arithmetic. Strips the
 * formatting a preparer will paste in from a PDF or spreadsheet — `$`,
 * thousands separators, whitespace — and reads `(1,234)` as -1234, which is
 * how a negative appears on most tax documents.
 */
export function toNumber(value: LineValue | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "boolean") return value ? 1 : 0

  const raw = String(value).trim()
  if (raw === "") return 0

  const negatedByParens = /^\(.*\)$/.test(raw)
  const cleaned = raw.replace(/[(),$\s]/g, "")
  const parsed = Number.parseFloat(cleaned)
  if (Number.isNaN(parsed)) return 0
  return negatedByParens ? -parsed : parsed
}

/** Round to whole cents, avoiding float drift accumulating across a sum. */
function money(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// The computation DSL
// ---------------------------------------------------------------------------

export function evalComputation(
  computation: Computation,
  resolve: (lineCode: string) => number,
): number {
  const values = computation.operands.map(resolve)
  switch (computation.kind) {
    case "sum":
      return values.reduce((a, b) => a + b, 0)
    case "diff":
      return values.reduce((a, b) => a - b)
    case "copy":
      return values[0] ?? 0
    case "subtract_floor_zero":
      return Math.max(0, values.reduce((a, b) => a - b))
    default:
      return 0
  }
}

/**
 * Evaluate every line for a set of entries.
 *
 * Lines are processed in `ordinal` order, which the TY2025 seed guarantees
 * places operands before their dependents (1z before 9, 9 before 11, 24 and
 * 33 before 34/37). Operands resolve from the evolving map, so chains
 * resolve in one pass.
 *
 * A computed line whose operands are all empty evaluates to 0, not null —
 * that matches the IRS form, where an unused line is zero, not blank.
 */
export function evaluateLines(defs: LineDef[], entries: LineEntries): EvaluatedLines {
  const out: EvaluatedLines = {}

  for (const def of defs) {
    if (def.isComputed) continue
    const raw = entries[def.lineCode]
    out[def.lineCode] = {
      lineCode: def.lineCode,
      value: raw === undefined ? null : raw,
      source: "entry",
    }
  }

  const resolve = (lineCode: string) => toNumber(out[lineCode]?.value)
  const ordered = [...defs].sort((a, b) => a.ordinal - b.ordinal)

  for (const def of ordered) {
    if (!def.isComputed || !def.computation) continue
    let value: number | null
    try {
      value = money(evalComputation(def.computation, resolve))
    } catch {
      value = null
    }
    out[def.lineCode] = { lineCode: def.lineCode, value, source: "computed" }
  }

  return out
}

// ---------------------------------------------------------------------------
// Assists
// ---------------------------------------------------------------------------

/**
 * The result of an assist: either a value to drop into a line, or a reason
 * it cannot be produced. Never both, and never a value with a caveat — a
 * preparer who sees a number will use it.
 */
export type AssistResult =
  | { ok: true; value: number; explanation: string }
  | { ok: false; reason: string }

/** Progressive tax on ordinary income. Bands are inclusive-top. */
export function taxOnOrdinaryIncome(taxable: number, brackets: TaxBracket[]): number {
  if (taxable <= 0 || brackets.length === 0) return 0
  let tax = 0
  let floor = 0
  for (const band of brackets) {
    const ceiling = band.upTo ?? Infinity
    if (taxable <= floor) break
    const slice = Math.min(taxable, ceiling) - floor
    if (slice > 0) tax += slice * band.rate
    floor = ceiling
    if (!Number.isFinite(ceiling)) break
  }
  return money(tax)
}

/**
 * Line 16 (Tax) assist.
 *
 * Fail-closed, matching `lib/tax/intake/compute.ts`. Three independent
 * refusals, each of which would otherwise produce a plausible but wrong
 * number on a real client return:
 *
 *   1. Brackets not verified against Rev. Proc. 2024-40.
 *   2. Preferential income present (qualified dividends on 3a, or net
 *      capital gain on 7). Those are taxed via the Qualified Dividends and
 *      Capital Gain Tax Worksheet, which the Hub does not implement;
 *      taxing them at ordinary rates overstates the tax.
 *   3. No taxable income to work from.
 *
 * The assist fills line 16, which is an INPUT line, not a computed one —
 * the preparer stays responsible for it and can overwrite the result.
 */
export function taxAssist(
  evaluated: EvaluatedLines,
  filingStatus: FilingStatus,
  constants: EntryConstants,
): AssistResult {
  if (!constants.bracketsVerified) {
    return {
      ok: false,
      reason:
        "Tax brackets for this year are not verified. Set form_1040_constants.tax_brackets_verified = true " +
        "once they have been checked against Rev. Proc. 2024-40 (as amended by OBBBA §70101). Until then the " +
        "Hub will not compute a tax figure — a wrong bracket produces a wrong tax on a filed return.",
    }
  }

  const qualifiedDividends = toNumber(evaluated["3a"]?.value)
  const capitalGain = toNumber(evaluated["7"]?.value)
  const preferential = qualifiedDividends + Math.max(0, capitalGain)
  if (preferential > 0) {
    return {
      ok: false,
      reason:
        `Qualified dividends and/or net capital gain of ${preferential.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })} are taxed at preferential rates via the Qualified Dividends and Capital Gain Tax Worksheet, ` +
        "which the Hub does not implement. Enter line 16 from ProConnect or the worksheet.",
    }
  }

  const taxable = toNumber(evaluated["15"]?.value)
  if (taxable <= 0) {
    return { ok: false, reason: "Taxable income (line 15) is zero, so there is no ordinary tax to compute." }
  }

  const brackets = constants.brackets[filingStatus] ?? []
  if (brackets.length === 0) {
    return { ok: false, reason: `No bracket table is loaded for filing status "${filingStatus}".` }
  }

  const value = taxOnOrdinaryIncome(taxable, brackets)
  return {
    ok: true,
    value,
    explanation:
      `Ordinary tax on taxable income of ${taxable.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      })} at the ${filingStatus.toUpperCase()} brackets.`,
  }
}

/**
 * Line 12a (standard or itemized deduction) assist — standard only.
 *
 * Deliberately does NOT offer an itemized figure. Itemizing depends on the
 * SALT cap and its phase-down, which are behind `itemized_constants_verified`
 * and, per migration 362, easy to get wrong for TY2025. A Schedule A belongs
 * on the document intake path where `computeScheduleA` handles it, not as a
 * number typed onto line 12a.
 *
 * `additionalCount` is the number of 65-or-blind boxes checked (0–4).
 */
export function standardDeductionAssist(
  filingStatus: FilingStatus,
  constants: EntryConstants,
  additionalCount = 0,
): AssistResult {
  const base = constants.standardDeduction[filingStatus]
  if (base === undefined) {
    return { ok: false, reason: `No standard deduction is loaded for filing status "${filingStatus}".` }
  }

  const perBox =
    filingStatus === "mfj" || filingStatus === "qss" || filingStatus === "mfs"
      ? constants.additionalStd65BlindMfj
      : constants.additionalStd65BlindSingle
  const extra = Math.max(0, Math.min(4, additionalCount)) * perBox

  return {
    ok: true,
    value: base + extra,
    explanation:
      extra > 0
        ? `Standard deduction ${base.toLocaleString()} plus ${additionalCount} × ${perBox.toLocaleString()} for age 65+/blind.`
        : `Standard deduction for ${filingStatus.toUpperCase()}.`,
  }
}

// ---------------------------------------------------------------------------
// Cross-line consistency checks
// ---------------------------------------------------------------------------

export interface LineWarning {
  lineCode: string
  severity: "blocking" | "warning"
  message: string
}

/**
 * Checks that catch a mis-keyed entry before it reaches ProConnect. These
 * are arithmetic and structural relationships that hold on every 1040 —
 * not tax advice, and not a substitute for review.
 */
export function checkLines(evaluated: EvaluatedLines, filingStatus: FilingStatus): LineWarning[] {
  const warnings: LineWarning[] = []
  const v = (code: string) => toNumber(evaluated[code]?.value)
  const present = (code: string) => {
    const raw = evaluated[code]?.value
    return raw !== null && raw !== undefined && raw !== ""
  }

  // Taxable portion cannot exceed the gross it comes from.
  const pairs: Array<[string, string, string]> = [
    ["4b", "4a", "IRA distributions"],
    ["5b", "5a", "Pensions and annuities"],
    ["6b", "6a", "Social security benefits"],
  ]
  for (const [taxableCode, grossCode, label] of pairs) {
    if (present(taxableCode) && present(grossCode) && v(taxableCode) > v(grossCode)) {
      warnings.push({
        lineCode: taxableCode,
        severity: "blocking",
        message: `${label}: the taxable amount on line ${taxableCode} exceeds the gross on line ${grossCode}.`,
      })
    }
  }

  // Qualified dividends are a subset of ordinary dividends.
  if (present("3a") && present("3b") && v("3a") > v("3b")) {
    warnings.push({
      lineCode: "3a",
      severity: "blocking",
      message: "Qualified dividends (3a) cannot exceed ordinary dividends (3b).",
    })
  }

  // Social security is at most 85% taxable.
  if (present("6a") && present("6b") && v("6b") > v("6a") * 0.85 + 0.5) {
    warnings.push({
      lineCode: "6b",
      severity: "warning",
      message: "No more than 85% of social security benefits is taxable (IRC §86). Line 6b looks too high.",
    })
  }

  // A capital loss on line 7 is limited to $3,000 ($1,500 MFS).
  const capLossLimit = filingStatus === "mfs" ? 1500 : 3000
  if (present("7") && v("7") < -capLossLimit) {
    warnings.push({
      lineCode: "7",
      severity: "warning",
      message: `A net capital loss is limited to ${capLossLimit.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      })} (IRC §1211(b)); the excess carries forward.`,
    })
  }

  // Refund and amount-owed are mutually exclusive by construction, but a
  // preparer can type a refund on 35a that exceeds the overpayment on 34.
  if (present("35a") && v("35a") > v("34")) {
    warnings.push({
      lineCode: "35a",
      severity: "blocking",
      message: "The refund requested on line 35a exceeds the overpayment on line 34.",
    })
  }
  if (present("36") && v("35a") + v("36") > v("34") + 0.5) {
    warnings.push({
      lineCode: "36",
      severity: "blocking",
      message: "Line 35a (refunded) plus line 36 (applied to next year) exceeds the overpayment on line 34.",
    })
  }

  // Direct deposit needs all three parts or none.
  const depositParts = ["35b", "35c", "35d"].filter(present)
  if (depositParts.length > 0 && depositParts.length < 3) {
    warnings.push({
      lineCode: "35b",
      severity: "blocking",
      message: "Direct deposit needs routing number, account type and account number. Supply all three or none.",
    })
  }
  if (present("35b") && !/^\d{9}$/.test(String(evaluated["35b"]?.value ?? "").replace(/\s/g, ""))) {
    warnings.push({
      lineCode: "35b",
      severity: "blocking",
      message: "A routing number is exactly 9 digits.",
    })
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Section display order and labels — keys match form_1040_lines.section. */
export const SECTION_ORDER: Array<{ key: string; label: string; blurb?: string }> = [
  { key: "filing_status", label: "Filing Status" },
  { key: "digital_assets", label: "Digital Assets" },
  { key: "dependents", label: "Dependents" },
  { key: "income", label: "Income" },
  { key: "tax_credits", label: "Tax and Credits" },
  { key: "payments", label: "Payments" },
  { key: "refund", label: "Refund" },
  { key: "amount_owed", label: "Amount You Owe" },
]

/** The lines worth showing in a persistent summary bar. */
export const SUMMARY_LINES: Array<{ code: string; label: string; tone?: "emerald" | "rose" }> = [
  { code: "9", label: "Total income" },
  { code: "11", label: "AGI" },
  { code: "15", label: "Taxable income" },
  { code: "24", label: "Total tax" },
  { code: "33", label: "Total payments" },
  { code: "34", label: "Refund", tone: "emerald" },
  { code: "37", label: "Amount owed", tone: "rose" },
]

export const FILING_STATUS_OPTIONS: Array<{ value: FilingStatus; label: string; lineCode: string }> = [
  { value: "single", label: "Single", lineCode: "fs_single" },
  { value: "mfj", label: "Married filing jointly", lineCode: "fs_mfj" },
  { value: "mfs", label: "Married filing separately", lineCode: "fs_mfs" },
  { value: "hoh", label: "Head of household", lineCode: "fs_hoh" },
  { value: "qss", label: "Qualifying surviving spouse", lineCode: "fs_qss" },
]
