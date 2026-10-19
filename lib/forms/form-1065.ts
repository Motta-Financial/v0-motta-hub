/**
 * Form 1065 view — builds a partnership return's sections from its exported
 * ProConnect cells. Pure: no database, so the rules can be checked offline.
 *
 * What the Export API gives us is INPUTS only. ProConnect's own totals
 * (ordinary income, total deductions, ending assets) never appear for the
 * current year, so every total here is the Hub's sum of the entries, using
 * the rules in docs/proconnect-1065-mapping.md that scripts/430 checked
 * against ProConnect's prior-year summaries. Each total says which rule it
 * used and what it cannot see (depreciation, COGS) rather than presenting a
 * partial sum as the return's figure.
 *
 * Field map (PAR, prefix p0 unless noted; c1000+ codes are prior-year
 * mirrors and are never summed with the current year):
 *   s1     client information        s2/s700  partners and percentages (p1, p2…)
 *   s200   income                    s400     deductions (c101–c199 federal)
 *   s5700  Schedule L (c1xx begin, c2xx end)
 *   s1500  Schedule M-2 (c1xx)       s6100    prior-year summary (ProConnect's totals)
 *
 * Labels come from the field catalog. Values that are taxpayer identifiers
 * are masked by the caller before they reach this module's output.
 */

export interface Form1065Cell {
  series_id: string
  prefix_id: string | null
  code_id: string | null
  suffix_id: string | null
  val: string | null
  /** Text fields (names, addresses) carry their value here, not in `val`. */
  description: string | null
}

export type CatalogLabels = Map<string, { description: string; screenTitle: string | null; isSensitive?: boolean }>

export interface AmountDetail {
  suffix: string
  label: string | null
  amount: number
}

export interface AmountLine {
  code: string
  label: string
  /** Form line number, only where the mapping to the form is certain. */
  formLine?: string
  amount: number
  /** Itemized detail rows (suffixes other than x1000), when entered. */
  details: AmountDetail[]
  /** How the line counts toward its section total, when not 1×. */
  factor?: number
  note?: string
}

export interface Form1065Total {
  label: string
  amount: number | null
  /** What the sum includes and leaves out. Shown under the figure. */
  basis: string
}

export interface Form1065Partner {
  prefix: string
  name: string | null
  /** Already masked by the caller when it is an SSN/EIN. */
  taxId: string | null
  generalPartner: boolean | null
  beginning: Percentages
  ending: Percentages
  /**
   * What to show: ending percentages, or beginning ones when every ending
   * field is blank (ProConnect carries beginning forward in that case).
   */
  shown: Percentages
  shownIsBeginning: boolean
}

export type Percentages = { profit: number | null; loss: number | null; capital: number | null }

export interface ScheduleLRow {
  formLine: string
  label: string
  beginCode: string
  endCode: string
  begin: number | null
  end: number | null
  /** "Less …" lines, subtracted from the total. */
  less: boolean
  /** Lines marked * in ProConnect: computed from the depreciation module. */
  fromDepreciation: boolean
}

export interface Form1065View {
  entity: {
    name: string | null
    dba: string | null
    ein: string | null
    address: string | null
    businessActivity: string | null
    productOrService: string | null
    businessCode: string | null
    dateBegan: string | null
  }
  partners: Form1065Partner[]
  /** Sum of each partner's shown percentages. */
  partnerTotals: Percentages
  income: { lines: AmountLine[]; total: Form1065Total; cogsEntered: boolean }
  deductions: { lines: AmountLine[]; total: Form1065Total }
  ordinaryIncome: Form1065Total
  scheduleL: {
    assets: ScheduleLRow[]
    liabilities: ScheduleLRow[]
    totals: { assetsBegin: number; assetsEnd: number; liabilitiesBegin: number; liabilitiesEnd: number }
    endingIncomplete: boolean
    entered: boolean
  }
  m2: { lines: AmountLine[]; endingOverride: number | null; entered: boolean }
  priorYear: AmountLine[]
  /** Screens with entries this view does not lay out yet, with cell counts. */
  unmapped: Array<{ seriesId: string; title: string | null; cells: number }>
}

const num = (v: string | null | undefined): number | null => {
  if (v == null) return null
  const s = String(v).replace(/[$,\s]/g, "")
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}
const codeNo = (code: string) => Number(code.slice(1))

/**
 * Catalog labels carry ProConnect UI hints ("(Click on button to expand)",
 * "[Override]", "{}"). Strip them for display; the raw code stays visible.
 */
export function cleanCatalogLabel(label: string | null | undefined): string | null {
  if (!label) return null
  const out = label
    .replace(/\(Click on button to expand\)/gi, "")
    .replace(/\[(Override|Adjust)\]/gi, "")
    .replace(/\{\}/g, "")
    .replace(/\s+\*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  return out || null
}

class CellIndex {
  private bySeries = new Map<string, Form1065Cell[]>()
  constructor(cells: Form1065Cell[]) {
    for (const c of cells) {
      if (!c.code_id) continue
      const list = this.bySeries.get(c.series_id) ?? []
      list.push(c)
      this.bySeries.set(c.series_id, list)
    }
  }
  series(id: string) {
    return this.bySeries.get(id) ?? []
  }
  seriesIds() {
    return [...this.bySeries.keys()]
  }
  /** First text value of a code (val, else description). */
  text(series: string, code: string, prefix = "p0"): string | null {
    const c = this.series(series).find((x) => x.code_id === code && (x.prefix_id ?? "p0") === prefix)
    const v = c?.val ?? c?.description ?? null
    return v && String(v).trim() ? String(v).trim() : null
  }
  /**
   * Amount for a code: x1000 plus any detail rows. On real 1065s the two
   * coexist and are additive (the detail grid does not repeat the x1000
   * figure), which is also how scripts/430 sums and reconciles.
   */
  amount(series: string, code: string, prefix = "p0"): { amount: number; details: AmountDetail[]; entered: boolean } {
    let amount = 0
    let entered = false
    const details: AmountDetail[] = []
    for (const c of this.series(series)) {
      if (c.code_id !== code || (c.prefix_id ?? "p0") !== prefix) continue
      const n = num(c.val)
      if (n == null) continue
      entered = true
      amount += n
      if (c.suffix_id && c.suffix_id !== "x1000") {
        details.push({ suffix: c.suffix_id, label: c.description?.trim() || null, amount: n })
      }
    }
    return { amount, details, entered }
  }
  /** Distinct codes with a numeric entry in a series, in code order. */
  enteredCodes(series: string, filter: (code: string) => boolean, prefix = "p0"): string[] {
    const set = new Set<string>()
    for (const c of this.series(series)) {
      if (!c.code_id || (c.prefix_id ?? "p0") !== prefix || !filter(c.code_id)) continue
      if (num(c.val) != null) set.add(c.code_id)
    }
    return [...set].sort((a, b) => codeNo(a) - codeNo(b))
  }
}

function labelFor(labels: CatalogLabels, series: string, code: string, fallback?: string): string {
  return cleanCatalogLabel(labels.get(`${series}/${code}`)?.description) ?? fallback ?? `${series}/${code}`
}

// ── Income (s200) ────────────────────────────────────────────────────
const INCOME_LINES: Record<string, { formLine?: string; factor?: number }> = {
  c101: { formLine: "1a" },
  c102: { formLine: "1b", factor: -1 },
  c103: {},
  c104: {},
  c105: {},
}

// ── Deductions (s400) — rules verified by scripts/430 (12/14) ─────────
/** How each s400 code counts toward total deductions. 0 = excluded. */
function deductionFactor(code: string): number {
  const n = codeNo(code)
  if (n < 101 || n > 199) return 0
  if (code === "c169" || code === "c179" || code === "c180") return 0
  if (code === "c123") return 0.5
  if (code === "c146") return 0.8
  if (code === "c152") return -1
  return 1
}
const DEDUCTION_NOTES: Record<string, string> = {
  c123: "50% deductible",
  c146: "80% deductible",
  c152: "Subtracted",
  c169: "Nondeductible — not in the total",
  c179: "163(j) election flag — not an amount",
  c180: "Form 8990 limit — not in the total",
}
// The catalog labels these by sub-heading only ("For services").
const GUARANTEED_PAYMENT_CODES = new Set(["c115", "c116", "c181", "c182"])

// ── Schedule L (s5700) ───────────────────────────────────────────────
// Line numbers follow the 2023–2025 Schedule L. Begin = c1xx, end = c2xx.
const SCHEDULE_L_ASSETS: Array<[string, string, boolean?, boolean?]> = [
  ["1", "c101"], ["2a", "c102"], ["2b", "c103", true], ["3", "c104"], ["4", "c105"],
  ["5", "c106"], ["6", "c107"], ["7a", "c118"], ["7b", "c108"], ["8", "c109"],
  ["9a", "c110", false, true], ["9b", "c111", true, true], ["10a", "c112", false, true],
  ["10b", "c113", true, true], ["11", "c114", false, true], ["12a", "c115", false, true],
  ["12b", "c116", true, true], ["13", "c117"],
]
const SCHEDULE_L_LIABILITIES: Array<[string, string]> = [
  ["15", "c151"], ["16", "c152"], ["17", "c153"], ["18", "c154"], ["19a", "c158"],
  ["19b", "c155"], ["20", "c156"], ["21", "c157"],
]

// ── Schedule M-2 (s1500, c1xx) ───────────────────────────────────────
const M2_LINES: Array<{ code: string; formLine: string; prefix?: string; factor: number }> = [
  { code: "c101", formLine: "1", factor: 1 },
  { code: "c102", formLine: "2a", prefix: "Capital contributed:", factor: 1 },
  { code: "c108", formLine: "2b", prefix: "Capital contributed:", factor: 1 },
  { code: "c103", formLine: "4", factor: 1 },
  { code: "c104", formLine: "6a", prefix: "Distributions:", factor: -1 },
  { code: "c105", formLine: "6b", prefix: "Distributions:", factor: -1 },
  { code: "c106", formLine: "7", factor: -1 },
]

// ── Prior-year summary (s6100) — ProConnect's own totals for last year ─
const PRIOR_YEAR_CODES = ["c1", "c8", "c16", "c21", "c22", "c23", "c49", "c67", "c70", "c72", "c73"]

/** Series this view lays out; everything else with entries is listed as unmapped. */
const MAPPED_SERIES = new Set(["s1", "s2", "s700", "s200", "s400", "s5700", "s1500", "s6100"])

export function buildForm1065View(
  cells: Form1065Cell[],
  labels: CatalogLabels,
  seriesTitles: Map<string, string> = new Map(),
): Form1065View {
  const ix = new CellIndex(cells)

  // Entity
  const addr = [
    ix.text("s1", "c1000100003"),
    [ix.text("s1", "c1000100004"), ix.text("s1", "c1000100005")].filter(Boolean).join(", "),
    ix.text("s1", "c1000100006"),
  ]
    .filter(Boolean)
    .join(" ")
  const entity = {
    name: ix.text("s1", "c1000100001"),
    dba: ix.text("s1", "c1000100002"),
    ein: ix.text("s1", "c1000100009"),
    address: addr || null,
    businessActivity: ix.text("s1", "c1000100013"),
    productOrService: ix.text("s1", "c1000100014"),
    businessCode: ix.text("s1", "c1000100012"),
    dateBegan: ix.text("s1", "c1000100011"),
  }

  // Partners — one prefix per partner on s2 (identity) and s700 (percentages).
  const prefixes = [
    ...new Set(
      [...ix.series("s2"), ...ix.series("s700")]
        .map((c) => c.prefix_id ?? "p0")
        .filter((p) => p !== "p0"),
    ),
  ].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  const pct = (prefix: string, code: string) => {
    const a = ix.amount("s700", code, prefix)
    return a.entered ? a.amount : null
  }
  const partners: Form1065Partner[] = prefixes.map((p) => {
    const gp = ix.text("s2", "c1000200013", p)
    const beginning = { profit: pct(p, "c501"), loss: pct(p, "c502"), capital: pct(p, "c503") }
    const ending = { profit: pct(p, "c504"), loss: pct(p, "c505"), capital: pct(p, "c506") }
    const shownIsBeginning = ending.profit == null && ending.loss == null && ending.capital == null
    return {
      prefix: p,
      name: ix.text("s2", "c1000200002", p),
      taxId: ix.text("s2", "c1000200009", p),
      generalPartner: gp == null ? null : gp === "1",
      beginning,
      ending,
      shown: shownIsBeginning ? beginning : ending,
      shownIsBeginning,
    }
  })
  const sumOrNull = (xs: Array<number | null>) => (xs.some((x) => x != null) ? xs.reduce<number>((t, x) => t + (x ?? 0), 0) : null)
  const partnerTotals = {
    profit: sumOrNull(partners.map((p) => p.shown.profit)),
    loss: sumOrNull(partners.map((p) => p.shown.loss)),
    capital: sumOrNull(partners.map((p) => p.shown.capital)),
  }

  // Income
  const incomeLines: AmountLine[] = []
  for (const [code, meta] of Object.entries(INCOME_LINES)) {
    const a = ix.amount("s200", code)
    if (!a.entered) continue
    incomeLines.push({ code, label: labelFor(labels, "s200", code), formLine: meta.formLine, amount: a.amount, details: a.details, factor: meta.factor })
  }
  const cogsEntered = ix.series("s300").some((c) => num(c.val) != null && codeNo(c.code_id!) < 1000)
  const incomeSum = incomeLines.reduce((t, l) => t + l.amount * (l.factor ?? 1), 0)
  const incomeTotal: Form1065Total = cogsEntered
    ? {
        label: "Total income",
        amount: null,
        basis: "Not computed: this return has cost-of-goods-sold entries (s300), which the Hub does not map yet.",
      }
    : {
        label: "Total income (sum of entries)",
        amount: incomeSum,
        basis:
          "Gross receipts less returns, plus other income entered on the Income screen. Gross receipts reconcile to ProConnect (9/9); farm income, Form 4797 gains and income from other partnerships are computed elsewhere in ProConnect and are not included unless entered here.",
      }

  // Deductions
  const deductionLines: AmountLine[] = ix
    .enteredCodes("s400", (c) => codeNo(c) >= 101 && codeNo(c) <= 199)
    .map((code) => {
      const a = ix.amount("s400", code)
      const base = labelFor(labels, "s400", code)
      const factor = deductionFactor(code)
      return {
        code,
        label: GUARANTEED_PAYMENT_CODES.has(code) ? `Guaranteed payments — ${base.toLowerCase()}` : base,
        formLine: code === "c133" ? "9" : GUARANTEED_PAYMENT_CODES.has(code) ? "10" : undefined,
        amount: a.amount,
        details: a.details,
        factor: factor === 1 ? undefined : factor,
        note: DEDUCTION_NOTES[code],
      }
    })
  const deductionSum = deductionLines.reduce((t, l) => t + l.amount * (l.factor ?? 1), 0)
  const deprOverride = ix.amount("s400", "c111").entered
  const deprScreen = ix.series("s61").length > 0
  const deductionTotal: Form1065Total = {
    label: "Total deductions (sum of entries)",
    amount: deductionSum,
    basis:
      deprOverride
        ? "Deduction screen entries with ProConnect's limits applied (meals 50%, DOT meals 80%, employment credits subtracted). Depreciation is the override entered here."
        : `Deduction screen entries with ProConnect's limits applied (meals 50%, DOT meals 80%, employment credits subtracted). Excludes depreciation, which ProConnect computes from the depreciation module${deprScreen ? " — this return has depreciation entries" : ""}.`,
  }

  const ordinaryIncome: Form1065Total =
    incomeTotal.amount == null
      ? { label: "Ordinary business income", amount: null, basis: "Not computed: total income is unavailable." }
      : {
          label: "Ordinary business income (estimate)",
          amount: incomeTotal.amount - deductionSum,
          basis:
            !deprOverride && deprScreen
              ? "Total income less total deductions above, before depreciation. ProConnect's figure will be lower by the depreciation it computes."
              : "Total income less total deductions above. ProConnect computes the filed figure; this is the Hub's sum of the entries.",
        }

  // Schedule L
  const lRow = (formLine: string, beginCode: string, less = false, fromDepreciation = false): ScheduleLRow => {
    const endCode = `c${codeNo(beginCode) + 100}`
    const b = ix.amount("s5700", beginCode)
    const e = ix.amount("s5700", endCode)
    return {
      formLine,
      label: labelFor(labels, "s5700", beginCode),
      beginCode,
      endCode,
      begin: b.entered ? b.amount : null,
      end: e.entered ? e.amount : null,
      less,
      fromDepreciation,
    }
  }
  const assets = SCHEDULE_L_ASSETS.map(([line, code, less, depr]) => lRow(line, code, !!less, !!depr))
  const liabilities = SCHEDULE_L_LIABILITIES.map(([line, code]) => lRow(line, code))
  const total = (rows: ScheduleLRow[], key: "begin" | "end") =>
    rows.reduce((t, r) => t + (r[key] ?? 0) * (r.less ? -1 : 1), 0)
  const scheduleL = {
    assets,
    liabilities,
    totals: {
      assetsBegin: total(assets, "begin"),
      assetsEnd: total(assets, "end"),
      liabilitiesBegin: total(liabilities, "begin"),
      liabilitiesEnd: total(liabilities, "end"),
    },
    // Ending * lines come from the depreciation module, so the ending total
    // only reconciles when that module has nothing to add.
    endingIncomplete: deprScreen,
    entered: [...assets, ...liabilities].some((r) => r.begin != null || r.end != null),
  }

  // Schedule M-2
  const m2Lines: AmountLine[] = []
  for (const l of M2_LINES) {
    const a = ix.amount("s1500", l.code)
    if (!a.entered) continue
    const base = labelFor(labels, "s1500", l.code)
    m2Lines.push({
      code: l.code,
      label: l.prefix ? `${l.prefix} ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base,
      formLine: l.formLine,
      amount: a.amount,
      details: a.details,
      factor: l.factor === 1 ? undefined : l.factor,
    })
  }
  const endingOverride = ix.amount("s1500", "c107")
  const m2 = {
    lines: m2Lines,
    endingOverride: endingOverride.entered ? endingOverride.amount : null,
    entered: m2Lines.length > 0 || endingOverride.entered,
  }

  // Prior-year summary
  const priorYear: AmountLine[] = PRIOR_YEAR_CODES.flatMap((code) => {
    const a = ix.amount("s6100", code)
    return a.entered ? [{ code, label: labelFor(labels, "s6100", code), amount: a.amount, details: [] }] : []
  })

  const unmapped = ix
    .seriesIds()
    .filter((s) => !MAPPED_SERIES.has(s))
    .map((s) => ({ seriesId: s, title: seriesTitles.get(s) ?? null, cells: ix.series(s).length }))
    .sort((a, b) => b.cells - a.cells)

  return {
    entity,
    partners,
    partnerTotals,
    income: { lines: incomeLines, total: incomeTotal, cogsEntered },
    deductions: { lines: deductionLines, total: deductionTotal },
    ordinaryIncome,
    scheduleL,
    m2,
    priorYear,
    unmapped,
  }
}
