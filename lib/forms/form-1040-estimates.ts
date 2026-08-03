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
 *   12a — standard deduction by filing status (+ taxpayer 65+; spouse
 *         age and blindness are NOT visible to us — see caveats)
 *   16  — Qualified Dividends and Capital Gain Tax Worksheet over the
 *         TY bracket tables
 *   19  — Child Tax Credit (nonrefundable portion, AGI phaseout,
 *         limited to tax) counted from per-dependent CTC flags
 *
 * Every line this module writes carries source: "estimated" so the viewer
 * can badge it. Estimates are NEVER composed into ProConnect imports (the
 * composer builds its payload from caller-supplied values, not from this
 * render path).
 *
 * CAVEATS (all conservative, all visible via the "estimated" badge):
 *   - 12a assumes the standard deduction; itemizers (Sch A) are invisible
 *     to the export. Taxpayer 65+ is derived from the s1 DOB cell; spouse
 *     age/blindness inputs are not yet mapped.
 *   - 6b for MFS assumes lived-with-spouse (85% taxable) — the worksheet's
 *     worst case; living-apart MFS uses single thresholds.
 *   - 16 treats line 7 (capital gain distributions) + 3a as LTCG/qualified,
 *     which matches how those mapped inputs behave on real returns.
 *   - 19 ignores ODC (dep_odc not yet mappable) and the refundable ACTC.
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
} from "./form-1040"

const FS_CELL = { seriesId: "s1", prefixId: "p0", codeId: "c1000100036", suffixId: "x1000" }
const DOB_CELL = { seriesId: "s1", prefixId: "p0", codeId: "c1000100010", suffixId: "x1000" }
const DEP_CTC = { seriesId: "s2", codeId: "c1000200014", suffixId: "x1000" }

type StatusKey = "single" | "mfj" | "mfs" | "hoh"

/** Map the ProConnect status code to the constants-key suffix (QSS→MFJ). */
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

function toNum(v: string | number | boolean | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "boolean") return v ? 1 : 0
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

function constNum(constants: Form1040Constant[], key: string): number | null {
  const c = constants.find((x) => x.key === key)
  if (!c) return null
  const n = toNum(c.value as string | number)
  return Number.isFinite(n) ? n : null
}

function constJson<T>(constants: Form1040Constant[], key: string): T | null {
  const c = constants.find((x) => x.key === key)
  if (!c) return null
  if (typeof c.value === "string") {
    try { return JSON.parse(c.value) as T } catch { return null }
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
): Form1040Data {
  const fsRaw = findCell(cells, FS_CELL)?.val
  const fs = statusKey(Number.parseInt(String(fsRaw ?? ""), 10))
  if (!fs) return data // no filing status → no safe estimates

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

  // ── 6b: taxable Social Security (worksheet) ──────────────────────────
  const ss = num("6a")
  if (ss > 0 && isEmpty("6b")) {
    if (fs === "mfs") {
      // Lived-with-spouse worst case: 85% taxable.
      setEstimate("6b", 0.85 * ss)
    } else {
      const base = constNum(constants, fs === "mfj" ? "ss_base_mfj" : "ss_base_single")
      const adj = constNum(constants, fs === "mfj" ? "ss_adj_mfj" : "ss_adj_single")
      if (base !== null && adj !== null) {
        // Combined income; line 11 currently excludes 6b (it is null → 0).
        const combined = num("11") + num("2a") + 0.5 * ss
        if (combined > base) {
          const part1 = Math.min(0.5 * (Math.min(combined, adj) - base), 0.5 * ss)
          const part2 = combined > adj ? 0.85 * (combined - adj) : 0
          setEstimate("6b", Math.min(0.85 * ss, part1 + part2))
        }
      }
    }
  }

  // ── 12a: standard deduction ──────────────────────────────────────────
  if (isEmpty("12a")) {
    const std = constNum(constants, `std_deduction_${fs === "mfj" ? "mfj" : fs}`)
    if (std !== null) {
      let deduction = std
      // Taxpayer 65+: born before the cutoff. Spouse DOB/blindness unmapped.
      const cutoff = constJson<string>(constants, "age_65_cutoff_birthdate")
      const dobRaw = findCell(cells, DOB_CELL)?.val
      if (cutoff && dobRaw) {
        const dob = new Date(String(dobRaw))
        if (!Number.isNaN(dob.getTime()) && dob < new Date(cutoff)) {
          const extra = constNum(
            constants,
            fs === "single" || fs === "hoh" ? "additional_std_65_blind_single" : "additional_std_65_blind_mfj",
          )
          if (extra !== null) deduction += extra
        }
      }
      setEstimate("12a", deduction)
    }
  }

  // ── 16: tax (QD & LTCG worksheet over the bracket tables) ────────────
  if (isEmpty("16")) {
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

  // ── 19: child tax credit (nonrefundable, phaseout, limited to tax) ───
  if (isEmpty("19")) {
    const perChild = constNum(constants, "dependent_credit_ctc")
    const threshold = constNum(constants, fs === "mfj" ? "mfj_ctc_phaseout_start" : "other_ctc_phaseout_start")
    const kids = cells.filter(
      (c) => c.seriesId === DEP_CTC.seriesId && c.codeId === DEP_CTC.codeId && c.suffixId === DEP_CTC.suffixId && toNum(c.val) === 1,
    ).length
    if (perChild !== null && threshold !== null && kids > 0) {
      let ctc = perChild * kids
      const agi = num("11")
      if (agi > threshold) ctc -= Math.ceil((agi - threshold) / 1000) * 50
      ctc = Math.max(0, ctc)
      if (ctc > 0) setEstimate("19", Math.min(ctc, num("18")))
    }
  }

  return d
}
