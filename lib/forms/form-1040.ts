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
 *   6. Per-value conditional mappings (`condition` jsonb, scripts/373):
 *      instance gates (route repeating-screen instances by a sibling
 *      cell, e.g. 1099-R IRA vs pension) and value predicates (boolean
 *      lines over one coded cell, e.g. filing status) — see
 *      MappingCondition
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
 * Default IRS artifact. The schema keys on (tax_year, form, line_code, cell)
 * — see scripts/387 — so a Schedule D or Schedule 1 is a data load, not a
 * migration. `form` is NOT the same axis as `returnType`: returnType is the
 * ProConnect module (IND/COR/PAR/…), form is the artifact within it. A 1040
 * and a Schedule D are both IND.
 */
export const DEFAULT_FORM = "1040"

/**
 * Wildcard prefix_id for mappings that aggregate across every instance of
 * a repeating input screen (e.g. all W-2s on s11, where p1/p2/p3 are the
 * first/second/third W-2). The renderer sums the mapped cell_field over
 * all prefixes for numeric lines. The composer NEVER emits this value —
 * "*" is not a real ProConnect prefix and would be rejected (or worse,
 * misrouted) by the Import API, and a per-line total cannot be written
 * back to a single instance anyway.
 */
export const AGGREGATE_PREFIX = "*"

/** True when a mapping aggregates across all prefix instances. */
export function isAggregateMapping(m: ProConnectMapping): boolean {
  return m.prefixId === AGGREGATE_PREFIX
}

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
  /** IRS artifact the line appears on ('1040', 'Schedule 1', …). */
  form: string
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
  /** Line can never hold a value (e.g. 30 'Reserved', 12b N/A for the year). */
  notApplicable: boolean
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

/**
 * Per-value conditional on a mapping (form_1040_proconnect_map.condition,
 * scripts/373). Two shapes, distinguished by the presence of `cell`:
 *
 *   INSTANCE GATE — `cell` present: the mapping only reads cells whose
 *   sibling cell (same series + prefix, `cell.codeId`, `cell.suffixId`
 *   defaulting to x1000) matches `equals` / `notEquals`. An absent sibling
 *   compares as null, so `notEquals: "1"` passes for an unchecked checkbox
 *   (checkbox cells are simply absent when clear). Composes with
 *   AGGREGATE_PREFIX: each instance is gated first, survivors aggregate
 *   (e.g. 1099-R gross sums IRA instances into 4a, pensions into 5a,
 *   keyed on the per-instance s14/c2 IRA/SEP/SIMPLE checkbox).
 *
 *   VALUE PREDICATE — `cell` absent: the line renders the boolean result
 *   of comparing the mapped cell's own value to `equals`, so several
 *   boolean lines can share one coded cell (e.g. the five fs_* lines over
 *   the s1/c1000100036 filing-status cell, 1=Single … 5=QSS).
 */
export interface MappingCondition {
  cell?: { codeId: string; suffixId?: string }
  equals?: string
  notEquals?: string
}

/** True when the condition matches a raw cell value (null = cell absent/unset). */
export function conditionMatches(cond: MappingCondition, raw: string | null): boolean {
  const v = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw).trim()
  if (cond.equals !== undefined) return v !== null && v === cond.equals
  if (cond.notEquals !== undefined) return v === null || v !== cond.notEquals
  return true
}

/** True when a mapping renders as a boolean predicate over its own cell. */
export function isValuePredicate(m: ProConnectMapping): boolean {
  return m.condition !== null && m.condition.cell === undefined
}

/**
 * What a mapped cell contributes to its line
 * (form_1040_proconnect_map.cell_role, scripts/387). Mirrors the taxonomy
 * in form_1040_line_inputs.role (scripts/360), plus `detail`.
 *
 *   primary        the cell whose value IS the line — the default
 *   detail         one row of an expansion grid behind a primary total
 *                  (e.g. the s200M/c11 suffix rows behind line 8's "other
 *                  income" total). Carried by the schema so a drill-down
 *                  has somewhere to live; NOT consumed as a line value.
 *   override       an [Override] field that displaces a computation
 *   discriminator  routes a value to one line vs another (e.g. s14/c2)
 *   control        changes which branch computes
 */
export type CellRole = "primary" | "detail" | "override" | "discriminator" | "control"

export interface ProConnectMapping {
  /** IRS artifact ('1040', 'Schedule 1', …) — see DEFAULT_FORM. */
  form: string
  lineCode: string
  returnType: string
  seriesId: string
  prefixId: string
  codeId: string
  suffixId: string
  cellField: CellField
  cellRole: CellRole
  /** `(series, prefix, code, suffix)` as one value — the "cell" half of the key. */
  cellKey: string
  /**
   * True when this cell is a raw ProConnect INPUT the tax team may write.
   * Derived in the database (scripts/387), never set by hand: false for
   * aggregates, instance-gated mappings, non-value-bearing roles, computed
   * or N/A lines, and any cell with no catalog definition.
   *
   * It matches what the API can actually do — Export returns only raw input
   * cells, never calculated values, so writing to a calculated cell is
   * meaningless. This flag makes that a data rule rather than a UI habit.
   *
   * It is NOT the post-e-file lock (tracked separately): it means "writable
   * in principle", not "writable right now".
   */
  editable: boolean
  /** Why `editable` holds its value — audit trail from the derivation. */
  editableBasis: string | null
  confidence: "unknown" | "inferred" | "confirmed"
  /**
   * Optional code→label translation for enum-coded ProConnect values
   * (form_1040_proconnect_map.value_decode), e.g. 35c account type
   * `{"2": "checking", "1": "savings"}`. Codes not in the map are
   * surfaced as `Code <n>` with `decodeMissing` set by the API layer.
   */
  valueDecode: Record<string, string> | null
  condition: MappingCondition | null
  notes: string | null
}

/**
 * Server-side masked placeholder for sensitive values (SSN / EIN /
 * routing / account). The raw value never leaves the server on the
 * GET render endpoint — only via the audited /reveal route.
 */
export interface MaskedValue {
  masked: true
  last4: string
  length: number
}

/** Line data types whose values must be masked before leaving the server. */
export const SENSITIVE_DATA_TYPES: ReadonlySet<string> = new Set([
  "ssn",
  "ein",
  "routing",
  "account",
])

/** Runtime guard for the masked placeholder shape. */
export function isMaskedValue(value: unknown): value is MaskedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { masked?: unknown }).masked === true
  )
}

/** The result of rendering a return: line code → typed value */
export type Form1040Data = Record<
  string,
  {
    value: string | number | boolean | MaskedValue | null
    /**
     * Every occurrence of a REPEATING non-numeric line, in prefix order —
     * the dependents grid (s2: p1/p2/p3 = first/second/third dependent) is
     * the case this exists for. Set only on aggregate ('*' prefix) mappings
     * whose line is not currency/integer; numeric repeats sum into `value`
     * instead and carry no instances.
     *
     * `value` mirrors instances[0], so a consumer that only understands a
     * scalar keeps working and simply shows the first occurrence. Anything
     * presenting the line to a human should render `instances` when present
     * — showing one of three dependents is how this line lied before.
     *
     * Values here are subject to the same masking as `value`: a sensitive
     * data type (dep_ssn) is masked per instance before leaving the server.
     */
    instances?: Array<{
      /** ProConnect prefix — the occurrence id on the repeating screen. */
      prefixId: string
      value: string | number | boolean | MaskedValue | null
    }>
    line: Form1040Line
    source: "proconnect" | "computed" | "input" | "estimated"
    /**
     * True when the line is backed by a writable raw-input cell. Carried
     * from the mapping's `editable` flag so the UI gates on data, not on a
     * convention. Absent/false means: do not offer an edit control.
     */
    editable?: boolean
    /** Why `editable` holds its value — surfaced for tooltips/diagnostics. */
    editableBasis?: string | null
    /** Mapping confidence from form_1040_proconnect_map (mapped lines only). */
    confidence?: "unknown" | "inferred" | "confirmed"
    /** Code→label map carried through from the mapping row, if any. */
    valueDecode?: Record<string, string> | null
    /** Set by the API layer when a coded value had no entry in valueDecode. */
    decodeMissing?: boolean
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
  form: string = DEFAULT_FORM,
): Promise<LoadedSchema> {
  const cacheKey = `${taxYear}:${returnType}:${form}`
  const cached = schemaCache.get(cacheKey)
  if (cached) return cached

  const sb = admin()
  const [linesRes, constsRes, mapRes] = await Promise.all([
    sb
      .from("form_1040_lines")
      .select(
        "id, tax_year, form, line_code, parent_code, ordinal, section, label, short_label, data_type, enum_options, is_computed, computation, schedule_ref, worksheet_ref, attaches_form, is_refund_path, not_applicable, notes",
      )
      .eq("tax_year", taxYear)
      .eq("form", form)
      .order("ordinal"),
    sb
      .from("form_1040_constants")
      .select("tax_year, key, value, notes")
      .eq("tax_year", taxYear),
    sb
      .from("form_1040_proconnect_map")
      .select(
        "form, line_code, return_type, series_id, prefix_id, code_id, suffix_id, cell_field, cell_role, cell_key, editable, editable_basis, confidence, value_decode, condition, notes",
      )
      .eq("tax_year", taxYear)
      .eq("return_type", returnType)
      .eq("form", form),
  ])

  if (linesRes.error) throw linesRes.error
  if (constsRes.error) throw constsRes.error
  if (mapRes.error) throw mapRes.error

  const lines: Form1040Line[] = (linesRes.data ?? []).map((r) => ({
    id: r.id,
    taxYear: r.tax_year,
    form: (r.form as string) ?? DEFAULT_FORM,
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
    notApplicable: r.not_applicable ?? false,
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
      form: (r.form as string) ?? DEFAULT_FORM,
      lineCode: r.line_code,
      returnType: r.return_type,
      seriesId: r.series_id as string,
      prefixId: (r.prefix_id as string) ?? "p0",
      codeId: r.code_id as string,
      suffixId: (r.suffix_id as string) ?? "x1000",
      cellField: ((r.cell_field as CellField) ?? "val") as CellField,
      cellRole: ((r.cell_role as CellRole) ?? "primary") as CellRole,
      cellKey:
        (r.cell_key as string) ??
        `${r.series_id ?? ""}/${r.prefix_id ?? ""}/${r.code_id ?? ""}/${r.suffix_id ?? ""}`,
      // Default FALSE, not true: a row predating scripts/387 (or an
      // environment where the derivation has not run) must not become
      // silently writable. Editing is opt-in via the derivation.
      editable: (r.editable as boolean) ?? false,
      editableBasis: (r.editable_basis as string | null) ?? null,
      confidence: (r.confidence as ProConnectMapping["confidence"]) ?? "unknown",
      valueDecode: (r.value_decode as Record<string, string> | null) ?? null,
      condition: (r.condition as MappingCondition | null) ?? null,
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
function toNumber(
  value: string | number | boolean | MaskedValue | null | undefined,
): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "boolean") return value ? 1 : 0
  // Masked placeholders (and any other object) carry no numeric meaning.
  if (typeof value === "object") return 0
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
  form: string = DEFAULT_FORM,
): Promise<Form1040Data> {
  const { lines, constants, mappings: allMappings } = await loadSchema(
    taxYear,
    returnType,
    form,
  )

  // Since scripts/387 a line may carry SEVERAL cells — the key is
  // (tax_year, form, line, cell). Only value-bearing roles resolve to the
  // line's scalar value; `detail` rows are the expansion-grid rows behind a
  // total (e.g. the s200M/c11 suffix rows behind line 8) and belong to a
  // drill-down, not to the line itself. Folding them in here would make the
  // line's value depend on map iteration order.
  const mappings = allMappings.filter((m) => m.cellRole !== "detail")

  const cellKey = (c: {
    seriesId: string
    prefixId: string
    codeId: string
    suffixId: string
  }) => `${c.seriesId}|${c.prefixId}|${c.codeId}|${c.suffixId}`

  // (series,prefix,code,suffix) → mappings (carries cellField + lineCode).
  // Plural: value-predicate mappings share one cell (all five fs_* lines
  // read the single filing-status cell).
  const reverseMap = new Map<string, ProConnectMapping[]>()
  // (series,code,suffix) → aggregate mappings (prefix_id = "*"): these
  // match a cell at ANY prefix instance of a repeating screen.
  const aggregateKey = (c: { seriesId: string; codeId: string; suffixId: string }) =>
    `${c.seriesId}|${c.codeId}|${c.suffixId}`
  const aggregateMap = new Map<string, ProConnectMapping[]>()
  for (const m of mappings) {
    if (isAggregateMapping(m)) {
      const arr = aggregateMap.get(aggregateKey(m)) ?? []
      arr.push(m)
      aggregateMap.set(aggregateKey(m), arr)
    } else {
      const arr = reverseMap.get(cellKey(m)) ?? []
      arr.push(m)
      reverseMap.set(cellKey(m), arr)
    }
  }

  // Index every cell for sibling lookups (instance-gate conditions).
  const cellByKey = new Map<string, FieldCell>()
  for (const cell of cells) cellByKey.set(cellKey(cell), cell)

  // Instance gate: a condition with a `cell` selector only admits cells
  // whose sibling (same series + prefix) matches. Gates compare the
  // sibling's `val` — checkbox/coded cells carry their state there, and
  // an absent sibling compares as null (unchecked).
  const gatePasses = (m: ProConnectMapping, cell: FieldCell): boolean => {
    const cond = m.condition
    if (!cond?.cell) return true
    const sibling = cellByKey.get(
      cellKey({
        seriesId: cell.seriesId,
        prefixId: cell.prefixId,
        codeId: cond.cell.codeId,
        suffixId: cond.cell.suffixId ?? "x1000",
      }),
    )
    return conditionMatches(cond, sibling?.val ?? null)
  }

  const lineByCode = new Map(lines.map((l) => [l.lineCode, l]))

  // Initialize every line as null/unpopulated.
  const data: Form1040Data = {}
  for (const line of lines) {
    data[line.lineCode] = { value: null, line, source: "proconnect" }
  }

  // Populate from cells, reading the mapped leaf field.
  for (const cell of cells) {
    const cellMappings = reverseMap.get(cellKey(cell))
    if (!cellMappings) continue
    for (const mapping of cellMappings) {
      const line = lineByCode.get(mapping.lineCode)
      if (!line) continue
      if (!gatePasses(mapping, cell)) continue
      const raw = readCellField(cell, mapping.cellField)
      data[line.lineCode] = {
        // Value predicates render the comparison result, not the raw
        // coded value (fs_hoh = true, not "4").
        value: isValuePredicate(mapping)
          ? conditionMatches(mapping.condition!, raw)
          : coerceToLineType(raw, line.dataType),
        line,
        source: "proconnect",
        editable: mapping.editable,
        editableBasis: mapping.editableBasis,
        confidence: mapping.confidence,
        valueDecode: mapping.valueDecode,
      }
    }
  }

  // Aggregate mappings: fold every prefix instance into the line.
  //
  //   NUMERIC lines SUM across instances — three W-2s become one wages total.
  //
  //   NON-NUMERIC lines KEEP EVERY INSTANCE, in prefix order, on `instances`.
  //   A repeating screen whose values are text cannot be summed and must not
  //   be silently truncated: the dependents grid (s2, p1/p2/p3 = first,
  //   second, third dependent) is the motivating case. Before this, the
  //   renderer kept only the lowest-numbered instance, so a family with
  //   three children rendered one child and dropped the rest with no
  //   indication anything was missing.
  //
  //   `value` stays the FIRST instance so every existing scalar consumer
  //   (the composer, the estimator, computed-line operands, the summary
  //   tiles) behaves exactly as before; `instances` is purely additive.
  if (aggregateMap.size > 0) {
    const numericAcc = new Map<string, number>()
    const perInstance = new Map<string, Array<{ prefixNum: number; prefixId: string; raw: string }>>()
    // Carry mapping metadata (confidence / valueDecode) into the final
    // aggregate assignments below.
    const mappingByLine = new Map<string, ProConnectMapping>()
    for (const cell of cells) {
      const aggMappings = aggregateMap.get(aggregateKey(cell))
      if (!aggMappings) continue
      for (const mapping of aggMappings) {
        const line = lineByCode.get(mapping.lineCode)
        if (!line) continue
        // Gate each instance before it contributes (e.g. only IRA-checked
        // 1099-Rs feed 4a). Value predicates are undefined over "*" — a
        // boolean has no cross-instance aggregate — so they're skipped.
        if (isValuePredicate(mapping)) continue
        if (!gatePasses(mapping, cell)) continue
        const raw = readCellField(cell, mapping.cellField)
        if (raw === null || raw === "") continue
        mappingByLine.set(line.lineCode, mapping)
        if (line.dataType === "currency" || line.dataType === "integer") {
          const n = coerceToLineType(raw, line.dataType)
          if (typeof n === "number") {
            numericAcc.set(line.lineCode, (numericAcc.get(line.lineCode) ?? 0) + n)
          }
        } else {
          const parsed = Number.parseInt(cell.prefixId.replace(/^p/, ""), 10)
          const arr = perInstance.get(line.lineCode) ?? []
          arr.push({
            prefixNum: Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER,
            prefixId: cell.prefixId,
            raw,
          })
          perInstance.set(line.lineCode, arr)
        }
      }
    }
    for (const [lineCode, sum] of numericAcc) {
      const line = lineByCode.get(lineCode)
      if (!line) continue
      const mapping = mappingByLine.get(lineCode)
      data[lineCode] = {
        value: sum,
        line,
        source: "proconnect",
        editable: mapping?.editable ?? false,
        editableBasis: mapping?.editableBasis ?? null,
        confidence: mapping?.confidence,
        valueDecode: mapping?.valueDecode ?? null,
      }
    }
    for (const [lineCode, found] of perInstance) {
      const line = lineByCode.get(lineCode)
      if (!line) continue
      const mapping = mappingByLine.get(lineCode)
      // Prefix order is the screen order the preparer entered, and it is the
      // order the 1040 expects its dependent rows in. Ties (a non-numeric
      // prefix) fall back to the raw prefix string so the result is stable
      // rather than dependent on cell iteration order.
      const ordered = [...found].sort(
        (a, b) => a.prefixNum - b.prefixNum || a.prefixId.localeCompare(b.prefixId),
      )
      data[lineCode] = {
        value: coerceToLineType(ordered[0].raw, line.dataType),
        instances: ordered.map((i) => ({
          prefixId: i.prefixId,
          value: coerceToLineType(i.raw, line.dataType),
        })),
        line,
        source: "proconnect",
        editable: mapping?.editable ?? false,
        editableBasis: mapping?.editableBasis ?? null,
        confidence: mapping?.confidence,
        valueDecode: mapping?.valueDecode ?? null,
      }
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
  // The data rule (form_1040_proconnect_map.editable, scripts/387) is the
  // outermost gate: only raw INPUT cells are writable. It already subsumes
  // the two structural refusals below — and, beyond them, refuses cells with
  // no catalog definition (the M-series detail grids behind totals like
  // line 8). The specific checks stay as defence in depth in case a caller
  // hands us a mapping assembled outside loadSchema.
  if (!mapping.editable) return null

  // Aggregate mappings ("*" prefix) are render-only: the value is a total
  // across every instance of a repeating screen, and there is no single
  // cell to write it to. Emitting "*" as a literal prefixId would corrupt
  // the Import call.
  if (isAggregateMapping(mapping)) return null

  // Instance-gated mappings are render-only too: whether the write-target
  // instance satisfies the sibling condition cannot be verified from here,
  // and writing to the wrong instance would silently misroute the value.
  if (mapping.condition?.cell) return null

  const value = entry.value
  if (value === null || value === undefined) return null

  // Masked placeholders ({ masked: true, last4, length }) are display
  // artifacts from the GET renderer — they are NEVER importable values.
  // Reject any object-shaped value outright so a round-tripped masked
  // payload can't be written back to ProConnect.
  if (typeof value === "object") return null

  let formatted: string
  if (isValuePredicate(mapping)) {
    // A true boolean resolves to the coded value the predicate tests for
    // (fs_hoh = true → val "4" on the filing-status cell). False booleans
    // are skipped — several lines share the cell and only the true one
    // may write it.
    if (value !== true || mapping.condition!.equals === undefined) return null
    formatted = mapping.condition!.equals
  } else if (mapping.valueDecode && typeof value === "string") {
    // Reverse a decoded label back to ProConnect's code ("savings" -> "1").
    // The API layer hands out labels, so a caller round-tripping a rendered
    // value would otherwise write the label into a code-only cell. An
    // unrecognized label is refused rather than written through raw.
    const code = Object.entries(mapping.valueDecode).find(([, label]) => label === value)?.[0]
    if (code === undefined) return null
    formatted = code
  } else if (typeof value === "boolean") {
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
  form: string = DEFAULT_FORM,
): Promise<ComposedSeries[]> {
  const { mappings } = await loadSchema(taxYear, returnType, form)

  // Group writable mappings by seriesId. `editable` (scripts/387) is the
  // gate: only raw ProConnect input cells compose into an Import. That
  // excludes aggregate ("*"-prefix) mappings — a cross-instance total is
  // not a writable cell — instance-gated mappings, whose sibling condition
  // cannot be verified on the write target, and any cell without a catalog
  // definition. Those two structural cases are also checked explicitly so
  // the intent survives a bad `editable` value. Value predicates stay in:
  // they resolve to writing the coded value when the line is true.
  const bySeries = new Map<string, ProConnectMapping[]>()
  for (const m of mappings) {
    if (!m.editable) continue
    if (isAggregateMapping(m) || m.condition?.cell) continue
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
