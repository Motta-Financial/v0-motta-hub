/**
 * ProConnect field catalog — lookup and Import pre-validation.
 *
 * Intuit's IVCS/FRF extract (67,810 codes for IND 2025) declares, per code,
 * which Import sub-fields are legal and what shape their values must take.
 * The Import API enforces the same rules server-side, but every call there
 * lands on a REAL client return: there is no sandbox. This module applies
 * the catalog's rules locally so a malformed batch fails on our machine
 * instead of half-writing someone's 1040.
 *
 * Errors the Import API raises that we can pre-empt:
 *   • SUB_FIELD_NOT_ALLOWED     — a sub-field absent from the code's rules
 *   • FIELD_RULE_VIOLATION      — value outside min/max/maxLength
 *   • CATALOG_SERIES_NOT_FOUND  — a series that does not exist for the year
 *
 * ── Confidentiality ──
 * The catalog is partner-confidential under the Intuit Open API agreement.
 * This module reads it from Supabase; the row data is never committed to
 * this repository and descriptions are never echoed into logs.
 *
 * ── Fail-closed on an unloaded catalog ──
 * The table starts empty (data is loaded out-of-band by
 * scripts/358-load-proconnect-catalog.mjs). A validator that returns "all
 * clear" against zero rows is worse than no validator, so `validateBatch`
 * reports `catalogAvailable: false` and refuses to certify anything rather
 * than passing silently.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ImportBatch, ImportEntry } from "@/lib/tax/intake/serialize"

/** Sub-fields an Import entry may carry, per the Phase 1 body schema. */
export type SubField = "val" | "desc" | "src" | "source" | "tsj" | "cityAbbrev" | "amt"

const ALL_SUB_FIELDS: SubField[] = ["val", "desc", "src", "source", "tsj", "cityAbbrev", "amt"]

/** The `rules` jsonb written by scripts/358-load-proconnect-catalog.mjs. */
export interface CatalogRules {
  allowedSubFields: SubField[]
  val?: {
    type?: string
    charLimit?: number
    formattedNumber?: boolean
    isDate?: boolean
    min?: number
    max?: number
    maxLength?: number
    /** Value must be >= one of these. -1 is Intuit's explicit-zero sentinel. */
    minOr?: number[]
  }
  desc?: { maxLength?: number }
  src?: { kind?: "STRING" | "ENUM" }
  source?: { maxLength?: number }
  tsj?: { maxLength?: number }
  cityAbbrev?: { kind?: "STRING" }
  amt?: { kind?: "NUMBER" }
  /** Constraint clauses the parser did not recognise — treated as unknown. */
  unknown?: string[]
}

export interface CatalogCode {
  taxYear: number
  returnType: string
  agency: string
  seriesId: string
  codeId: string
  description: string
  screenTitle: string | null
  valueType: string | null
  charLimit: number | null
  tsjAllowed: boolean
  rules: CatalogRules
  isSensitive: boolean
}

export interface CatalogKey {
  taxYear: number
  returnType?: string
  agency?: string
  seriesId: string
  codeId: string
}

export type ValidationSeverity = "blocking" | "warning"

export interface ValidationProblem {
  severity: ValidationSeverity
  seriesId: string
  prefixId: string
  codeId: string
  subField: SubField | null
  /** The Import error code this would surface as, when known. */
  apiErrorCode?: "SUB_FIELD_NOT_ALLOWED" | "FIELD_RULE_VIOLATION" | "CATALOG_SERIES_NOT_FOUND"
  message: string
}

export interface ValidationResult {
  /** False when the catalog table is empty — nothing was actually checked. */
  catalogAvailable: boolean
  problems: ValidationProblem[]
  /** True only when the catalog was available AND nothing blocking was found. */
  ok: boolean
  /** Codes referenced by the batch that the catalog does not contain. */
  unknownCodes: Array<{ seriesId: string; codeId: string }>
  /** Codes the catalog marks as holding PII, so callers can avoid logging. */
  sensitiveCodes: Array<{ seriesId: string; codeId: string }>
}

const CATALOG_COLUMNS =
  "tax_year, return_type, agency, series_id, code_id, description, screen_title, value_type, char_limit, tsj_allowed, rules, is_sensitive"

function toCode(row: Record<string, unknown>): CatalogCode {
  return {
    taxYear: Number(row.tax_year),
    returnType: row.return_type as string,
    agency: row.agency as string,
    seriesId: row.series_id as string,
    codeId: row.code_id as string,
    description: (row.description as string) ?? "",
    screenTitle: (row.screen_title as string | null) ?? null,
    valueType: (row.value_type as string | null) ?? null,
    charLimit: row.char_limit === null || row.char_limit === undefined ? null : Number(row.char_limit),
    tsjAllowed: Boolean(row.tsj_allowed),
    rules: (row.rules as CatalogRules) ?? { allowedSubFields: ["val"] },
    isSensitive: Boolean(row.is_sensitive),
  }
}

/** True when the catalog has any rows for this year/return type. */
export async function catalogIsLoaded(
  sb: SupabaseClient,
  taxYear: number,
  returnType = "IND",
): Promise<boolean> {
  const { count, error } = await sb
    .from("proconnect_field_catalog")
    .select("code_id", { count: "exact", head: true })
    .eq("tax_year", taxYear)
    .eq("return_type", returnType)
  if (error) throw error
  return (count ?? 0) > 0
}

/**
 * Look up specific codes.
 *
 * Chunked because PostgREST caps a request URL's length and `.in()` lists
 * grow fast; 200 matches the convention in lib/supabase/fetch-all.ts.
 */
export async function lookupCodes(
  sb: SupabaseClient,
  taxYear: number,
  returnType: string,
  keys: Array<{ seriesId: string; codeId: string }>,
): Promise<Map<string, CatalogCode>> {
  const out = new Map<string, CatalogCode>()
  if (keys.length === 0) return out

  // Group by series so each query is one `.in()` over code ids rather than
  // an OR of composite keys, which PostgREST expresses badly.
  const bySeries = new Map<string, Set<string>>()
  for (const k of keys) {
    const s = bySeries.get(k.seriesId) ?? new Set<string>()
    s.add(k.codeId)
    bySeries.set(k.seriesId, s)
  }

  for (const [seriesId, codeSet] of bySeries) {
    const codeIds = [...codeSet]
    for (let i = 0; i < codeIds.length; i += 200) {
      const { data, error } = await sb
        .from("proconnect_field_catalog")
        .select(CATALOG_COLUMNS)
        .eq("tax_year", taxYear)
        .eq("return_type", returnType)
        .eq("series_id", seriesId)
        .in("code_id", codeIds.slice(i, i + 200))
      if (error) throw error
      for (const r of data ?? []) {
        const code = toCode(r as Record<string, unknown>)
            out.set(`${code.seriesId.toLowerCase()}/${code.codeId.toLowerCase()}`, code)
      }
    }
  }
  return out
}

/** Which series exist for a year — pre-empts CATALOG_SERIES_NOT_FOUND. */
export async function knownSeries(
  sb: SupabaseClient,
  taxYear: number,
  returnType: string,
  seriesIds: string[],
): Promise<Set<string>> {
  if (seriesIds.length === 0) return new Set()
  const { data, error } = await sb
    .from("proconnect_field_catalog")
    .select("series_id")
    .eq("tax_year", taxYear)
    .eq("return_type", returnType)
    .in("series_id", seriesIds)
    // One row per series is enough to prove existence; without a limit this
    // would pull every code in the series (s400 alone has 464).
    .limit(1000)
  if (error) throw error
  return new Set((data ?? []).map((r) => (r as { series_id: string }).series_id))
}

/** Which sub-fields an entry actually carries. */
function presentSubFields(entry: ImportEntry): SubField[] {
  return ALL_SUB_FIELDS.filter((sf) => {
    const v = (entry as unknown as Record<string, unknown>)[sf]
    return v !== undefined && v !== null && v !== ""
  })
}

/**
 * PURE: check one entry against a code's rules.
 *
 * Exported so the rule logic is testable without a database. Never includes
 * the value itself in a message — these are real taxpayer figures.
 */
export function validateEntry(
  seriesId: string,
  entry: ImportEntry,
  code: CatalogCode,
): ValidationProblem[] {
  const problems: ValidationProblem[] = []
  const at = (subField: SubField | null): Pick<ValidationProblem, "seriesId" | "prefixId" | "codeId" | "subField"> => ({
    seriesId,
    prefixId: entry.prefixId,
    codeId: entry.codeId,
    subField,
  })

  const allowed = new Set(code.rules?.allowedSubFields ?? ["val"])
  for (const sf of presentSubFields(entry)) {
    if (!allowed.has(sf)) {
      problems.push({
        ...at(sf),
        severity: "blocking",
        apiErrorCode: "SUB_FIELD_NOT_ALLOWED",
        message: `Sub-field "${sf}" is not permitted on ${seriesId}/${entry.codeId}. Allowed: ${[...allowed].join(", ")}.`,
      })
    }
  }

  // ── val ──
  const val = entry.val
  const r = code.rules?.val
  if (val !== undefined && val !== null && val !== "" && r) {
    if (r.maxLength != null && val.length > r.maxLength) {
      problems.push({
        ...at("val"),
        severity: "blocking",
        apiErrorCode: "FIELD_RULE_VIOLATION",
        message: `val is ${val.length} characters; ${seriesId}/${entry.codeId} allows at most ${r.maxLength}.`,
      })
    }
    if (r.charLimit != null && val.length > r.charLimit) {
      problems.push({
        ...at("val"),
        severity: "blocking",
        apiErrorCode: "FIELD_RULE_VIOLATION",
        message: `val is ${val.length} characters; ${seriesId}/${entry.codeId} has a character limit of ${r.charLimit}.`,
      })
    }

    const numeric = r.formattedNumber || r.type === "NUMBER" || r.min != null || r.max != null
    if (numeric) {
      const n = Number(val.replace(/[$,\s]/g, ""))
      if (Number.isNaN(n)) {
        problems.push({
          ...at("val"),
          severity: "blocking",
          apiErrorCode: "FIELD_RULE_VIOLATION",
          message: `${seriesId}/${entry.codeId} expects a number, but val is not numeric.`,
        })
      } else {
        // min and minOr are alternatives, never both — the loader verified
        // that invariant across all 29,538 constrained rows.
        if (r.min != null && n < r.min) {
          problems.push({
            ...at("val"),
            severity: "blocking",
            apiErrorCode: "FIELD_RULE_VIOLATION",
            message: `val is below the minimum of ${r.min} for ${seriesId}/${entry.codeId}.`,
          })
        }
        if (r.minOr && r.minOr.length > 0 && !r.minOr.some((m) => n >= m)) {
          problems.push({
            ...at("val"),
            severity: "blocking",
            apiErrorCode: "FIELD_RULE_VIOLATION",
            message: `val must be at least one of ${r.minOr.join(" or ")} for ${seriesId}/${entry.codeId}.`,
          })
        }
        if (r.max != null && n > r.max) {
          problems.push({
            ...at("val"),
            severity: "blocking",
            apiErrorCode: "FIELD_RULE_VIOLATION",
            message: `val exceeds the maximum of ${r.max} for ${seriesId}/${entry.codeId}.`,
          })
        }
      }
    }

    if (r.isDate && !/^\d{2}\/\d{2}\/\d{4}$|^\d{8}$/.test(val)) {
      problems.push({
        ...at("val"),
        severity: "warning",
        message: `${seriesId}/${entry.codeId} is a date field; val does not look like MM/DD/YYYY or MMDDYYYY.`,
      })
    }
  }

  // ── desc / source / tsj length limits ──
  if (entry.desc && code.rules?.desc?.maxLength != null && entry.desc.length > code.rules.desc.maxLength) {
    problems.push({
      ...at("desc"),
      severity: "blocking",
      apiErrorCode: "FIELD_RULE_VIOLATION",
      message: `desc is ${entry.desc.length} characters; ${seriesId}/${entry.codeId} allows at most ${code.rules.desc.maxLength}.`,
    })
  }
  if (
    entry.source &&
    code.rules?.source?.maxLength != null &&
    entry.source.length > code.rules.source.maxLength
  ) {
    problems.push({
      ...at("source"),
      severity: "blocking",
      apiErrorCode: "FIELD_RULE_VIOLATION",
      message: `source is ${entry.source.length} characters; ${seriesId}/${entry.codeId} allows at most ${code.rules.source.maxLength}.`,
    })
  }
  if (entry.tsj) {
    const max = code.rules?.tsj?.maxLength ?? 1
    if (entry.tsj.length > max) {
      problems.push({
        ...at("tsj"),
        severity: "blocking",
        apiErrorCode: "FIELD_RULE_VIOLATION",
        message: `tsj is ${entry.tsj.length} characters; ${seriesId}/${entry.codeId} allows at most ${max}.`,
      })
    }
    if (!["T", "S", "J"].includes(entry.tsj.toUpperCase())) {
      problems.push({
        ...at("tsj"),
        severity: "blocking",
        apiErrorCode: "FIELD_RULE_VIOLATION",
        message: `tsj must be T, S, or J on ${seriesId}/${entry.codeId}.`,
      })
    }
  }

  // A code the extract carries unparsed constraints for may have rules we
  // are not checking. Say so rather than implying a clean bill of health.
  if (code.rules?.unknown?.length) {
    problems.push({
      ...at(null),
      severity: "warning",
      message: `${seriesId}/${entry.codeId} carries ${code.rules.unknown.length} constraint clause(s) the Hub does not understand and therefore did not check.`,
    })
  }

  return problems
}

/**
 * Validate serialized Import batches against the catalog before any call
 * to Intuit. Run this ahead of the mandatory dryRun, not instead of it —
 * dryRun catches cross-field and return-state rules the catalog does not
 * express (RETURN_LOCKED, for one).
 */
export async function validateBatches(
  sb: SupabaseClient,
  opts: { taxYear: number; returnType?: string },
  batches: ImportBatch[],
): Promise<ValidationResult> {
  const returnType = opts.returnType ?? "IND"
  const problems: ValidationProblem[] = []
  const unknownCodes: Array<{ seriesId: string; codeId: string }> = []
  const sensitiveCodes: Array<{ seriesId: string; codeId: string }> = []

  if (!(await catalogIsLoaded(sb, opts.taxYear, returnType))) {
    return {
      catalogAvailable: false,
      ok: false,
      problems: [
        {
          severity: "warning",
          seriesId: "-",
          prefixId: "-",
          codeId: "-",
          subField: null,
          message:
            `The ProConnect field catalog holds no rows for ${returnType} ${opts.taxYear}, so no field ` +
            "rules could be checked. Load it with scripts/358-load-proconnect-catalog.mjs before relying " +
            "on pre-validation.",
        },
      ],
      unknownCodes: [],
      sensitiveCodes: [],
    }
  }

  const seriesIds = [...new Set(batches.map((b) => b.seriesId))]
  const present = await knownSeries(sb, opts.taxYear, returnType, seriesIds)
  for (const s of seriesIds) {
    if (!present.has(s)) {
      problems.push({
        severity: "blocking",
        seriesId: s,
        prefixId: "-",
        codeId: "-",
        subField: null,
        apiErrorCode: "CATALOG_SERIES_NOT_FOUND",
        message: `Series ${s} does not exist for ${returnType} ${opts.taxYear}.`,
      })
    }
  }

  const keys = batches.flatMap((b) => b.entries.map((e) => ({ seriesId: b.seriesId, codeId: e.codeId })))
  const codes = await lookupCodes(sb, opts.taxYear, returnType, keys)

  for (const batch of batches) {
    if (!present.has(batch.seriesId)) continue // already reported
    for (const entry of batch.entries) {
      const code = codes.get(`${batch.seriesId}/${entry.codeId}`)
      if (!code) {
        unknownCodes.push({ seriesId: batch.seriesId, codeId: entry.codeId })
        problems.push({
          severity: "blocking",
          seriesId: batch.seriesId,
          prefixId: entry.prefixId,
          codeId: entry.codeId,
          subField: null,
          message: `Code ${batch.seriesId}/${entry.codeId} is not in the ${returnType} ${opts.taxYear} catalog. Writing it would be a guess.`,
        })
        continue
      }
      if (code.isSensitive) sensitiveCodes.push({ seriesId: batch.seriesId, codeId: entry.codeId })
      problems.push(...validateEntry(batch.seriesId, entry, code))
    }
  }

  return {
    catalogAvailable: true,
    ok: !problems.some((p) => p.severity === "blocking"),
    problems,
    unknownCodes,
    sensitiveCodes,
  }
}
