/**
 * Form 1040 — U.S. Individual Income Tax Return
 *
 * This module provides:
 *   1. TypeScript types mirroring the `form_1040_lines` / `_constants` /
 *      `_proconnect_map` tables (see scripts/140_form_1040_schema.sql)
 *   2. A loader that hydrates the line schema + constants + ProConnect
 *      mappings for a given (tax year, return type)
 *   3. A computed-line evaluator that runs the JSONB computation DSL
 *      (`{ kind: 'sum'|'diff'|'copy'|'subtract_floor_zero', operands }`)
 *   4. A "renderer" that takes raw ProConnect field cells and produces a
 *      structured Form1040Data object keyed by IRS line code
 *   5. A "composer" that takes Form1040Data and produces the ProConnect
 *      Phase 1 import-series payload (entries array), routing each value
 *      to the correct leaf field (val / desc / tsj / src) via cell_field
 *
 * IMPORTANT — schema alignment:
 *   The DB columns are `line_code`, `label`, `data_type`, `section`,
 *   `computation` (jsonb), `schedule_ref`, `ordinal`, `notes`, etc. The
 *   ProConnect map keys on `(tax_year, line_code, return_type)` and carries
 *   `cell_field` (which leaf property of the series-map cell holds the
 *   value). Mappings start EMPTY — series/code tuples are discovered from a
 *   real Phase 1 export, never guessed (same rule as ProConnect profiles +
 *   Tommy identity). Until a line is mapped, the renderer returns `null`
 *   for that line and the composer skips it.
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

/** Default ProConnect module/return type for Phase 1 (Individual 1040). */
export const DEFAULT_RETURN_TYPE = "IND"

/**
 * Phase 1 spec caps a single import-series call at 500 entries
 * (§B.5 `entries.length ≤ 500`, error `ENTRIES_LIMIT_EXCEEDED`). The
 * composer chunks any over-cap series into multiple batches.
 */
export const MAX_ENTRIES_PER_IMPORT = 500

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Matches form_1040_lines.data_type. */
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

/** Matches form_1040_lines.section. */
export type LineSection =
  | "header"
  | "filing_status"
  | "digital_assets"
  | "dependents"
  | "income"
  | "tax_credits"
  | "payments"
  | "refund"
  | "amount_owed"
  | "signature"
  | "third_party"

/** The JSONB computation DSL stored in form_1040_lines.computation. */
export type Computation =
  | { kind: "sum"; operands: string[] }
  | { kind: "diff"; operands: string[] }
  | { kind: "copy"; operands: string[] }
  | { kind: "subtract_floor_zero"; operands: string[] }

export interface Form1040Line {
  id: number
  taxYear: number
  lineCode: string
  parentCode: string | null
  ordinal: number
  section: string
  label: string
  shortLabel: string | null
  dataType: string
  enumOptions: string[] | null
  isComputed: boolean
  computation: Computation | null
  scheduleRef: string | null
  worksheetRef: string | null
  attachesForm: string | null
  isRefundPath: boolean
  notes: string | null
}

export interface Form1040Constant {
  taxYear: number
  key: string
  /** Stored as JSONB — number, string, or array depending on the constant. */
  value: unknown
  notes: string | null
}

/** Which leaf property of a series-map cell holds the line's value. */
export type CellField = "val" | "desc" | "src" | "tsj" | "scope" | "source" | "cityAbbrev"

export interface ProConnectMapping {
  lineCode: string
  returnType: string
  seriesId: string
  prefixId: string
  codeId: string
  suffixId: string
  cellField: CellField
  confidence: "unknown" | "inferred" | "confirmed"
  notes: string | null
}

/** The result of rendering a return: line code → typed value */
export type Form1040Data = Record<
  string,
  {
    value: string | number | boolean | null
    line: Form1040Line
    source: "proconnect" | "computed" | "input"
  }
>

// ---------------------------------------------------------------------------
// Schema loader (cached per tax year + return type)
// ---------------------------------------------------------------------------

interface LoadedSchema {
  lines: Form1040Line[]
  constants: Form1040Constant[]
  mappings: ProConnectMapping[]
}

const schemaCache = new Map<string, LoadedSchema>()

export async function loadSchema(
  taxYear: number,
  returnType: string = DEFAULT_RETURN_TYPE,
): Promise<LoadedSchema> {
  const cacheKey = `${taxYear}:${returnType}`
  const cached = schemaCache.get(cacheKey)
  if (cached) return cached

  const sb = admin()
  const [linesRes, constsRes, mapRes] = await Promise.all([
    sb
      .from("form_1040_lines")
      .select(
        "id, tax_year, line_code, parent_code, ordinal, section, label, short_label, data_type, enum_options, is_computed, computation, schedule_ref, worksheet_ref, attaches_form, is_refund_path, notes",
      )
      .eq("tax_year", taxYear)
      .order("ordinal"),
    sb
      .from("form_1040_constants")
      .select("tax_year, key, value, notes")
      .eq("tax_year", taxYear),
    sb
      .from("form_1040_proconnect_map")
      .select(
        "line_code, return_type, series_id, prefix_id, code_id, suffix_id, cell_field, confidence, notes",
      )
      .eq("tax_year", taxYear)
      .eq("return_type", returnType),
  ])

  if (linesRes.error) throw linesRes.error
  if (constsRes.error) throw constsRes.error
  if (mapRes.error) throw mapRes.error

  const lines: Form1040Line[] = (linesRes.data ?? []).map((r) => ({
    id: r.id,
    taxYear: r.tax_year,
    lineCode: r.line_code,
    parentCode: r.parent_code,
    ordinal: r.ordinal,
    section: r.section,
    label: r.label,
    shortLabel: r.short_label,
    dataType: r.data_type as LineDataType,
    enumOptions: (r.enum_options as string[] | null) ?? null,
    isComputed: r.is_computed,
    computation: (r.computation as Computation | null) ?? null,
    scheduleRef: r.schedule_ref,
    worksheetRef: r.worksheet_ref,
    attachesForm: r.attaches_form,
    isRefundPath: r.is_refund_path,
    notes: r.notes,
  }))

  const constants: Form1040Constant[] = (constsRes.data ?? []).map((r) => ({
    taxYear: r.tax_year,
    key: r.key,
    value: r.value,
    notes: r.notes,
  }))

  // Only mappings that have actually been discovered (series_id non-null)
  // are usable. Undiscovered rows are skipped — never fabricate a tuple.
  const mappings: ProConnectMapping[] = (mapRes.data ?? [])
    .filter((r) => r.series_id && r.code_id)
    .map((r) => ({
      lineCode: r.line_code,
      returnType: r.return_type,
      seriesId: r.series_id as string,
      prefixId: (r.prefix_id as string) ?? "p0",
      codeId: r.code_id as string,
      suffixId: (r.suffix_id as string) ?? "x1000",
      cellField: ((r.cell_field as CellField) ?? "val") as CellField,
      confidence: (r.confidence as ProConnectMapping["confidence"]) ?? "unknown",
      notes: r.notes,
    }))

  const result: LoadedSchema = { lines, constants, mappings }
  schemaCache.set(cacheKey, result)
  return result
}

/** Clear the in-memory schema cache (e.g. after editing mappings). */
export function clearSchemaCache() {
  schemaCache.clear()
}

// ---------------------------------------------------------------------------
// Computed-line evaluator (JSONB computation DSL)
// ---------------------------------------------------------------------------

/** Coerce any line value to a number for arithmetic. */
function toNumber(value: string | number | boolean | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "boolean") return value ? 1 : 0
  const parsed = Number.parseFloat(String(value).replace(/[,$\s]/g, ""))
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Execute a single computation node against a value resolver.
 *   sum                 → Σ operands
 *   diff                → operands[0] − operands[1] − …
 *   copy                → operands[0]
 *   subtract_floor_zero → max(0, operands[0] − operands[1] − …)
 */
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
 * Evaluate every computed line. Lines are processed in `ordinal` order,
 * which the TY2025 seed guarantees places dependencies before dependents
 * (e.g. line 9 sums 1z..8; line 11 = 9 − 10; line 15 = max(0, 11 − 14)).
 * Operands are resolved from the evolving data map, so multi-level chains
 * (33 → 34 → …) resolve correctly in a single pass.
 */
export function evaluateComputedLines(
  data: Form1040Data,
  lines: Form1040Line[],
  _constants: Form1040Constant[],
): Form1040Data {
  const computed: Form1040Data = { ...data }
  const resolve = (lineCode: string) => toNumber(computed[lineCode]?.value)

  // lines are pre-sorted by ordinal in loadSchema; sort defensively in case
  // a caller passes an unsorted array.
  const ordered = [...lines].sort((a, b) => a.ordinal - b.ordinal)

  for (const line of ordered) {
    if (!line.isComputed || !line.computation) continue
    let result: number | null = null
    try {
      result = evalComputation(line.computation, resolve)
    } catch {
      result = null
    }
    computed[line.lineCode] = { value: result, line, source: "computed" }
  }

  return computed
}

// ---------------------------------------------------------------------------
// Renderer: ProConnect cells → Form1040Data
// ---------------------------------------------------------------------------

/**
 * A flattened ProConnect field cell, as stored in
 * proconnect_return_field_cells. The renderer reads whichever leaf field
 * the mapping's `cell_field` points at (defaults to `val`).
 */
export interface FieldCell {
  seriesId: string
  prefixId: string
  codeId: string
  suffixId: string
  val: string | null
  desc?: string | null
  src?: string | null
  tsj?: string | null
  scope?: string | null
  source?: string | null
  cityAbbrev?: string | null
}

function readCellField(cell: FieldCell, field: CellField): string | null {
  switch (field) {
    case "val":
      return cell.val ?? null
    case "desc":
      return cell.desc ?? null
    case "src":
      return cell.src ?? null
    case "tsj":
      return cell.tsj ?? null
    case "scope":
      return cell.scope ?? null
    case "source":
      return cell.source ?? null
    case "cityAbbrev":
      return cell.cityAbbrev ?? null
    default:
      return cell.val ?? null
  }
}

function coerceToLineType(
  raw: string | null,
  dataType: string,
): string | number | boolean | null {
  if (raw === null || raw === undefined) return null
  if (dataType === "currency" || dataType === "integer") {
    const parsed = Number.parseFloat(String(raw).replace(/[,$\s]/g, ""))
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (dataType === "boolean") {
    return raw === "X" || raw === "x" || raw === "1" || raw === "true"
  }
  return raw
}

export async function renderForm1040(
  taxYear: number,
  cells: FieldCell[],
  returnType: string = DEFAULT_RETURN_TYPE,
): Promise<Form1040Data> {
  const { lines, constants, mappings } = await loadSchema(taxYear, returnType)

  const cellKey = (c: {
    seriesId: string
    prefixId: string
    codeId: string
    suffixId: string
  }) => `${c.seriesId}|${c.prefixId}|${c.codeId}|${c.suffixId}`

  // (series,prefix,code,suffix) → mapping (carries cellField + lineCode)
  const reverseMap = new Map<string, ProConnectMapping>()
  for (const m of mappings) reverseMap.set(cellKey(m), m)

  const lineByCode = new Map(lines.map((l) => [l.lineCode, l]))

  // Initialize every line as null/unpopulated.
  const data: Form1040Data = {}
  for (const line of lines) {
    data[line.lineCode] = { value: null, line, source: "proconnect" }
  }

  // Populate from cells, reading the mapped leaf field.
  for (const cell of cells) {
    const mapping = reverseMap.get(cellKey(cell))
    if (!mapping) continue
    const line = lineByCode.get(mapping.lineCode)
    if (!line) continue
    const raw = readCellField(cell, mapping.cellField)
    data[line.lineCode] = {
      value: coerceToLineType(raw, line.dataType),
      line,
      source: "proconnect",
    }
  }

  return evaluateComputedLines(data, lines, constants)
}

// ---------------------------------------------------------------------------
// Composer: Form1040Data → ProConnect import entries
// ---------------------------------------------------------------------------

/** Mirrors the Phase 1 ImportEntry (lib/proconnect/data.ts). */
export interface ImportEntry {
  prefixId: string
  codeId: string
  suffixId: string
  val?: string
  desc?: string
  src?: string
  tsj?: "T" | "S" | "J" | "N" | ""
  source?: string
  cityAbbrev?: string
}

export interface ComposedSeries {
  seriesId: string
  entries: ImportEntry[]
}

/**
 * Format a line value for import, honoring the mapping's cell_field.
 * Numeric/currency lines → whole-dollar string in `val`; boolean → "X"/""
 * in `val`; text-bearing fields (cell_field = desc) → `desc`. Returns null
 * when the value is empty so the caller can skip the entry.
 */
function buildEntry(
  mapping: ProConnectMapping,
  entry: Form1040Data[string],
): ImportEntry | null {
  const value = entry.value
  if (value === null || value === undefined) return null

  let formatted: string
  if (typeof value === "boolean") {
    formatted = value ? "X" : ""
  } else if (typeof value === "number") {
    // ProConnect expects whole dollars for currency, no decimals.
    formatted =
      entry.line.dataType === "currency" || entry.line.dataType === "integer"
        ? String(Math.round(value))
        : String(value)
  } else {
    formatted = String(value)
  }

  if (formatted === "") return null

  const base: ImportEntry = {
    prefixId: mapping.prefixId,
    codeId: mapping.codeId,
    suffixId: mapping.suffixId,
  }

  // Route the value into the leaf field the mapping declares.
  switch (mapping.cellField) {
    case "desc":
      base.desc = formatted
      break
    case "src":
      base.src = formatted
      break
    case "tsj":
      base.tsj = formatted as ImportEntry["tsj"]
      break
    case "source":
      base.source = formatted
      break
    case "cityAbbrev":
      base.cityAbbrev = formatted
      break
    case "val":
    default:
      base.val = formatted
      break
  }

  return base
}

export async function composeImportEntries(
  taxYear: number,
  data: Form1040Data,
  returnType: string = DEFAULT_RETURN_TYPE,
): Promise<ComposedSeries[]> {
  const { mappings } = await loadSchema(taxYear, returnType)

  // Group usable mappings by seriesId.
  const bySeries = new Map<string, ProConnectMapping[]>()
  for (const m of mappings) {
    const arr = bySeries.get(m.seriesId) ?? []
    arr.push(m)
    bySeries.set(m.seriesId, arr)
  }

  const result: ComposedSeries[] = []

  for (const [seriesId, maps] of bySeries) {
    const entries: ImportEntry[] = []
    for (const m of maps) {
      const lineData = data[m.lineCode]
      if (!lineData) continue
      const entry = buildEntry(m, lineData)
      if (entry) entries.push(entry)
    }
    if (entries.length === 0) continue

    // Chunk to satisfy the 500-entry cap. Every chunk targets the same
    // seriesId so series identity is preserved across chunks.
    for (let i = 0; i < entries.length; i += MAX_ENTRIES_PER_IMPORT) {
      result.push({ seriesId, entries: entries.slice(i, i + MAX_ENTRIES_PER_IMPORT) })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

export function getLinesBySection(
  lines: Form1040Line[],
  section: string,
): Form1040Line[] {
  return lines.filter((l) => l.section === section)
}

/** Look up a constant's numeric value (constants are stored as JSONB). */
export function getConstantNumber(
  constants: Form1040Constant[],
  key: string,
): number | null {
  const c = constants.find((x) => x.key === key)
  if (!c) return null
  const n = toNumber(c.value as string | number)
  return Number.isFinite(n) ? n : null
}

/** Derive the refund (line 34) vs amount-owed (line 37) summary. */
export function getTaxOwedOrRefund(data: Form1040Data): {
  owed: number
  refund: number
} {
  return {
    owed: toNumber(data["37"]?.value),
    refund: toNumber(data["34"]?.value),
  }
}
