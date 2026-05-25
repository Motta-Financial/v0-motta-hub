/**
 * Form 1040 — U.S. Individual Income Tax Return
 *
 * This module provides:
 *   1. TypeScript types mirroring the `form_1040_lines` / `_constants` tables
 *   2. A loader that hydrates the line schema + constants for a given tax year
 *   3. Computed-line evaluation helpers (lines like 11, 15, 24 that derive
 *      from other lines or lookup tables)
 *   4. A "renderer" that takes raw ProConnect field cells and produces a
 *      structured Form1040Data object keyed by line number
 *   5. A "composer" that takes Form1040Data and produces the ProConnect
 *      import-series payload (entries array) ready for the Phase 1 API
 *
 * The mapping between IRS line numbers and ProConnect series/prefix/code/suffix
 * tuples lives in `form_1040_proconnect_map`. That table starts empty and is
 * populated via admin tooling once we observe a successful Phase 1 export.
 * Until a line is mapped, the renderer returns `null` for that line's value
 * and the composer skips it.
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineType = "currency" | "integer" | "text" | "checkbox" | "date" | "ssn" | "ein"
export type LineCategory =
  | "filing_status"
  | "personal_info"
  | "dependents"
  | "income"
  | "adjustments"
  | "deductions"
  | "tax_credits"
  | "other_taxes"
  | "payments"
  | "refund"
  | "amount_owed"
  | "third_party"
  | "signature"

export interface Form1040Line {
  id: string
  taxYear: number
  lineNumber: string
  lineLabel: string
  lineType: LineType
  category: LineCategory
  isComputed: boolean
  computeFormula: string | null
  scheduleSource: string | null
  instructions: string | null
  sortOrder: number
}

export interface Form1040Constant {
  id: string
  taxYear: number
  constantKey: string
  constantValue: string
  description: string | null
}

export interface ProConnectMapping {
  lineNumber: string
  seriesId: string
  prefixId: string
  codeId: string
  suffixId: string
  direction: "import" | "export" | "both"
  notes: string | null
}

/** The result of rendering a return: line number → typed value */
export type Form1040Data = Record<
  string,
  { value: string | number | boolean | null; line: Form1040Line; source: "proconnect" | "computed" | "input" }
>

// ---------------------------------------------------------------------------
// Schema loader (cached per tax year)
// ---------------------------------------------------------------------------

const schemaCache = new Map<number, { lines: Form1040Line[]; constants: Form1040Constant[]; mappings: ProConnectMapping[] }>()

export async function loadSchema(taxYear: number) {
  if (schemaCache.has(taxYear)) return schemaCache.get(taxYear)!

  const sb = admin()
  const [linesRes, constsRes, mapRes] = await Promise.all([
    sb
      .from("form_1040_lines")
      .select("id, tax_year, line_number, line_label, line_type, category, is_computed, compute_formula, schedule_source, instructions, sort_order")
      .eq("tax_year", taxYear)
      .order("sort_order"),
    sb
      .from("form_1040_constants")
      .select("id, tax_year, constant_key, constant_value, description")
      .eq("tax_year", taxYear),
    sb
      .from("form_1040_proconnect_map")
      .select("line_number, series_id, prefix_id, code_id, suffix_id, direction, notes")
      .eq("tax_year", taxYear),
  ])

  if (linesRes.error) throw linesRes.error
  if (constsRes.error) throw constsRes.error
  if (mapRes.error) throw mapRes.error

  const lines: Form1040Line[] = (linesRes.data ?? []).map((r) => ({
    id: r.id,
    taxYear: r.tax_year,
    lineNumber: r.line_number,
    lineLabel: r.line_label,
    lineType: r.line_type as LineType,
    category: r.category as LineCategory,
    isComputed: r.is_computed,
    computeFormula: r.compute_formula,
    scheduleSource: r.schedule_source,
    instructions: r.instructions,
    sortOrder: r.sort_order,
  }))

  const constants: Form1040Constant[] = (constsRes.data ?? []).map((r) => ({
    id: r.id,
    taxYear: r.tax_year,
    constantKey: r.constant_key,
    constantValue: r.constant_value,
    description: r.description,
  }))

  const mappings: ProConnectMapping[] = (mapRes.data ?? []).map((r) => ({
    lineNumber: r.line_number,
    seriesId: r.series_id,
    prefixId: r.prefix_id,
    codeId: r.code_id,
    suffixId: r.suffix_id,
    direction: r.direction as "import" | "export" | "both",
    notes: r.notes,
  }))

  const result = { lines, constants, mappings }
  schemaCache.set(taxYear, result)
  return result
}

// ---------------------------------------------------------------------------
// Computed-line evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates computed lines in dependency order.
 *
 * The `compute_formula` column uses a minimal DSL:
 *   - `L1 + L2` → sum lines 1 and 2
 *   - `L11 - L14` → subtract
 *   - `MIN(L10, $STANDARD_DEDUCTION_SINGLE)` → lesser of line or constant
 *   - `MAX(0, L15 - L18)` → ensure non-negative
 *   - `SCHEDULE_1_LINE_26` → placeholder for schedule flow-in
 *
 * For Phase 1 we implement only the arithmetic subset; schedule flow-ins
 * return 0 until we integrate Schedule 1/2/3/A/B/C/D/E/SE.
 */
export function evaluateComputedLines(
  data: Form1040Data,
  lines: Form1040Line[],
  constants: Form1040Constant[],
): Form1040Data {
  const constMap = new Map(constants.map((c) => [`$${c.constantKey}`, parseFloat(c.constantValue) || 0]))
  const computed = { ...data }

  // Topological evaluation: sort by sortOrder (already done in DB) ensures

// dependencies are evaluated before dependents for simple formulas.
  for (const line of lines) {
    if (!line.isComputed || !line.computeFormula) continue

    const formula = line.computeFormula
    let result: number | null = null

    try {
      result = evalFormula(formula, computed, constMap)
    } catch {
      // Leave as null if formula fails (missing dependency, bad syntax)
    }

    computed[line.lineNumber] = {
      value: result,
      line,
      source: "computed",
    }
  }

  return computed
}

function evalFormula(
  formula: string,
  data: Form1040Data,
  constants: Map<string, number>,
): number {
  // Replace line references L<num> with their numeric value
  let expr = formula.replace(/L(\d+[a-z]?)/gi, (_, num) => {
    const entry = data[num] ?? data[num.toLowerCase()] ?? data[num.toUpperCase()]
    const val = entry?.value
    if (val === null || val === undefined) return "0"
    if (typeof val === "boolean") return val ? "1" : "0"
    if (typeof val === "number") return String(val)
    const parsed = parseFloat(String(val).replace(/[,$]/g, ""))
    return isNaN(parsed) ? "0" : String(parsed)
  })

  // Replace constants $KEY with their value
  for (const [key, val] of constants) {
    expr = expr.replace(new RegExp(`\\${key}`, "g"), String(val))
  }

  // Handle MIN/MAX
  expr = expr.replace(/MIN\s*\(([^,]+),([^)]+)\)/gi, (_, a, b) => {
    const va = safeEval(a)
    const vb = safeEval(b)
    return String(Math.min(va, vb))
  })
  expr = expr.replace(/MAX\s*\(([^,]+),([^)]+)\)/gi, (_, a, b) => {
    const va = safeEval(a)
    const vb = safeEval(b)
    return String(Math.max(va, vb))
  })

  // Schedule placeholders → 0 for now
  expr = expr.replace(/SCHEDULE_\w+/gi, "0")

  return safeEval(expr)
}

function safeEval(expr: string): number {
  // Only allow digits, operators, parens, decimal points, and whitespace
  const sanitized = expr.replace(/[^0-9+\-*/().  ]/g, "")
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${sanitized})`)()
    return typeof result === "number" && isFinite(result) ? result : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Renderer: ProConnect cells → Form1040Data
// ---------------------------------------------------------------------------

export interface FieldCell {
  seriesId: string
  prefixId: string
  codeId: string
  suffixId: string
  val: string | null
}

export async function renderForm1040(
  taxYear: number,
  cells: FieldCell[],
): Promise<Form1040Data> {
  const schema = await loadSchema(taxYear)
  const { lines, constants, mappings } = schema

  // Build reverse lookup: (series,prefix,code,suffix) → lineNumber
  const cellKey = (c: { seriesId: string; prefixId: string; codeId: string; suffixId: string }) =>
    `${c.seriesId}|${c.prefixId}|${c.codeId}|${c.suffixId}`
  const reverseMap = new Map<string, string>()
  for (const m of mappings) {
    if (m.direction === "export" || m.direction === "both") {
      reverseMap.set(cellKey(m), m.lineNumber)
    }
  }

  // Initialize all lines with null
  const data: Form1040Data = {}
  for (const line of lines) {
    data[line.lineNumber] = { value: null, line, source: "proconnect" }
  }

  // Populate from cells
  for (const cell of cells) {
    const lineNum = reverseMap.get(cellKey(cell))
    if (!lineNum) continue
    const line = lines.find((l) => l.lineNumber === lineNum)
    if (!line) continue

    let value: string | number | boolean | null = cell.val
    if (line.lineType === "currency" || line.lineType === "integer") {
      const parsed = parseFloat(String(cell.val ?? "0").replace(/[,$]/g, ""))
      value = isNaN(parsed) ? 0 : parsed
    } else if (line.lineType === "checkbox") {
      value = cell.val === "X" || cell.val === "1" || cell.val === "true"
    }

    data[lineNum] = { value, line, source: "proconnect" }
  }

  // Evaluate computed lines
  return evaluateComputedLines(data, lines, constants)
}

// ---------------------------------------------------------------------------
// Composer: Form1040Data → ProConnect import entries
// ---------------------------------------------------------------------------

export interface ImportEntry {
  prefixId: string
  codeId: string
  suffixId: string
  val: string
}

/**
 * Phase 1 spec caps a single import-series call at 500 entries (§B.5
 * `entries.length ≤ 500`, error `ENTRIES_LIMIT_EXCEEDED`). The composer
 * chunks any over-cap series into multiple { seriesId, entries } batches
 * so callers can iterate and POST each one — preserving series identity
 * across chunks because every chunk targets the same seriesId.
 */
export const MAX_ENTRIES_PER_IMPORT = 500

export async function composeImportEntries(
  taxYear: number,
  data: Form1040Data,
): Promise<{ seriesId: string; entries: ImportEntry[] }[]> {
  const schema = await loadSchema(taxYear)
  const { mappings } = schema

  // Group mappings by seriesId
  const bySeriesId = new Map<string, ProConnectMapping[]>()
  for (const m of mappings) {
    if (m.direction === "import" || m.direction === "both") {
      const arr = bySeriesId.get(m.seriesId) ?? []
      arr.push(m)
      bySeriesId.set(m.seriesId, arr)
    }
  }

  const result: { seriesId: string; entries: ImportEntry[] }[] = []

  for (const [seriesId, maps] of bySeriesId) {
    const entries: ImportEntry[] = []
    for (const m of maps) {
      const entry = data[m.lineNumber]
      if (!entry || entry.value === null || entry.value === undefined) continue

      let val: string
      if (typeof entry.value === "boolean") {
        val = entry.value ? "X" : ""
      } else if (typeof entry.value === "number") {
        // ProConnect expects whole dollars for currency, no decimals
        val = String(Math.round(entry.value))
      } else {
        val = String(entry.value)
      }

      if (val === "") continue

      entries.push({
        prefixId: m.prefixId,
        codeId: m.codeId,
        suffixId: m.suffixId,
        val,
      })
    }

    if (entries.length === 0) continue

    // Chunk to satisfy the 500-entry cap. A single series with > 500
    // mapped lines is unlikely on Form 1040 today, but the schedule
    // flow-ins (Schedule A/B/C/D/E with detail lines) can blow past
    // 500 — so we chunk defensively.
    for (let i = 0; i < entries.length; i += MAX_ENTRIES_PER_IMPORT) {
      result.push({
        seriesId,
        entries: entries.slice(i, i + MAX_ENTRIES_PER_IMPORT),
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Utility: line number helpers
// ---------------------------------------------------------------------------

export function getLinesByCategory(lines: Form1040Line[], category: LineCategory): Form1040Line[] {
  return lines.filter((l) => l.category === category)
}

export function getTaxOwedOrRefund(data: Form1040Data): { owed: number; refund: number } {
  const line37 = data["37"]?.value
  const line34 = data["34"]?.value
  return {
    owed: typeof line37 === "number" ? Math.max(0, line37) : 0,
    refund: typeof line34 === "number" ? Math.max(0, line34) : 0,
  }
}
