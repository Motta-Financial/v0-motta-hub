import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { loadForm1040Constants } from "@/lib/tax/intake/store"
import {
  evaluateLines,
  checkLines,
  type EntryConstants,
  type FilingStatus,
  type LineDef,
  type LineEntries,
  type LineValue,
} from "@/lib/tax/intake/direct-lines"

/**
 * Direct 1040 line entry.
 *
 *   GET /api/tax/intake/{setId}/lines
 *   PUT /api/tax/intake/{setId}/lines
 *
 * The document intake path (`../route.ts`) derives 1040 lines from source
 * documents. This route is the complement: lines a preparer types directly,
 * for figures that have no document behind them. Both feed the same return;
 * neither calls Intuit.
 *
 * Computed lines are never persisted — see scripts/365 for why. They are
 * re-derived on every read by the shared evaluator, which the browser also
 * runs so typing recalculates without a round trip.
 */

const VALID_FILING_STATUSES: FilingStatus[] = ["single", "mfj", "mfs", "hoh", "qss"]

function isFilingStatus(v: unknown): v is FilingStatus {
  return typeof v === "string" && (VALID_FILING_STATUSES as string[]).includes(v)
}

/** Numeric line types are stored in `value_num`, booleans in `value_bool`. */
const NUMERIC_TYPES = new Set(["currency", "integer"])

interface LineRow {
  line_code: string
  ordinal: number
  section: string
  label: string
  short_label: string | null
  data_type: string
  enum_options: unknown
  is_computed: boolean
  computation: unknown
  schedule_ref: string | null
  notes: string | null
}

function toLineDef(r: LineRow): LineDef {
  return {
    lineCode: r.line_code,
    ordinal: r.ordinal,
    section: r.section,
    label: r.label,
    shortLabel: r.short_label,
    dataType: r.data_type as LineDef["dataType"],
    enumOptions: Array.isArray(r.enum_options) ? (r.enum_options as string[]) : null,
    isComputed: r.is_computed,
    computation: (r.computation as LineDef["computation"]) ?? null,
    scheduleRef: r.schedule_ref,
    notes: r.notes,
  }
}

/**
 * Reshape the store's constants into the client-safe subset the evaluator
 * takes. QSS is not stored separately — it tracks MFJ for both the standard
 * deduction (see the note on `std_deduction_mfj`) and the bracket table.
 */
function toEntryConstants(c: Awaited<ReturnType<typeof loadForm1040Constants>>): EntryConstants {
  return {
    bracketsVerified: c.bracketsVerified,
    itemizedVerified: c.itemizedVerified,
    brackets: {
      single: c.brackets.single,
      mfj: c.brackets.mfj,
      mfs: c.brackets.mfs,
      hoh: c.brackets.hoh,
      qss: c.brackets.mfj,
    },
    standardDeduction: {
      single: c.stdDeductionSingle,
      mfj: c.stdDeductionMfj,
      mfs: c.stdDeductionMfs,
      hoh: c.stdDeductionHoh,
      qss: c.stdDeductionMfj,
    },
    additionalStd65BlindSingle: c.additionalStd65BlindSingle,
    additionalStd65BlindMfj: c.additionalStd65BlindMfj,
  }
}

/** Read persisted entries back into the evaluator's input shape. */
function rowsToEntries(
  rows: Array<{ line_code: string; value_num: number | null; value_text: string | null; value_bool: boolean | null }>,
  defsByCode: Map<string, LineDef>,
): LineEntries {
  const entries: LineEntries = {}
  for (const row of rows) {
    const def = defsByCode.get(row.line_code)
    if (!def) continue
    if (def.dataType === "boolean") entries[row.line_code] = row.value_bool ?? false
    else if (NUMERIC_TYPES.has(def.dataType)) entries[row.line_code] = row.value_num
    else entries[row.line_code] = row.value_text
  }
  return entries
}

async function loadSetAndSchema(setId: string) {
  const admin = createAdminClient()

  const { data: set, error: setErr } = await admin
    .from("tax_input_sets")
    .select("id, tax_year, return_type, filing_status, contact_id, proconnect_client_id, proconnect_return_id, status")
    .eq("id", setId)
    .maybeSingle()
  if (setErr) throw new Error(setErr.message)
  if (!set) return { admin, set: null as null, defs: [] as LineDef[] }

  const { data: lineRows, error: lineErr } = await admin
    .from("form_1040_lines")
    .select(
      "line_code, ordinal, section, label, short_label, data_type, enum_options, is_computed, computation, schedule_ref, notes",
    )
    .eq("tax_year", set.tax_year)
    .order("ordinal")
  if (lineErr) throw new Error(lineErr.message)

  return { admin, set, defs: (lineRows ?? []).map((r) => toLineDef(r as LineRow)) }
}

// ---------------------------------------------------------------------------
// GET — schema + saved entries + evaluated state
// ---------------------------------------------------------------------------

export async function GET(_req: Request, ctx: { params: Promise<{ setId: string }> }) {
  const { setId } = await ctx.params

  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { admin, set, defs } = await loadSetAndSchema(setId)
    if (!set) return NextResponse.json({ error: "Intake set not found" }, { status: 404 })

    if (defs.length === 0) {
      return NextResponse.json(
        {
          error:
            `No Form 1040 line schema is seeded for TY${set.tax_year}. ` +
            "Seed form_1040_lines for that year before using direct entry.",
        },
        { status: 422 },
      )
    }

    const defsByCode = new Map(defs.map((d) => [d.lineCode, d]))

    const { data: entryRows, error: entryErr } = await admin
      .from("form_1040_line_entries")
      .select("line_code, value_num, value_text, value_bool, updated_at")
      .eq("set_id", setId)
    if (entryErr) throw new Error(entryErr.message)

    const entries = rowsToEntries(entryRows ?? [], defsByCode)
    const filingStatus: FilingStatus = isFilingStatus(set.filing_status) ? set.filing_status : "single"
    const evaluated = evaluateLines(defs, entries)
    const constants = toEntryConstants(await loadForm1040Constants(admin, set.tax_year))

    const lastSaved = (entryRows ?? []).reduce<string | null>((latest, r) => {
      const t = (r as { updated_at?: string }).updated_at
      if (!t) return latest
      return !latest || t > latest ? t : latest
    }, null)

    return NextResponse.json({
      set: {
        id: set.id,
        taxYear: set.tax_year,
        returnType: set.return_type,
        filingStatus,
        contactId: set.contact_id,
        proconnectClientId: set.proconnect_client_id,
        proconnectReturnId: set.proconnect_return_id,
        status: set.status,
      },
      lines: defs,
      entries,
      evaluated,
      warnings: checkLines(evaluated, filingStatus),
      constants,
      lastSaved,
      // Direct entry is Hub-side only. Stated here so the UI never implies
      // a value has reached Intuit: Export is 403 across the board and the
      // Import path is gated separately. See
      // docs/proconnect-api-coverage-status.md.
      proconnect: {
        writable: false,
        reason:
          "Direct line entry is stored in the Hub only. Writing to ProConnect goes through the Import path, " +
          "which is leadership-gated and currently blocked upstream.",
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] [tax/intake/lines] GET failed:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT — upsert entered values
// ---------------------------------------------------------------------------

interface PutBody {
  /** Line code → value. `null` clears the line but keeps the row. */
  entries?: Record<string, LineValue>
  /** Optional: change the set's filing status in the same round trip. */
  filingStatus?: string
}

export async function PUT(req: Request, ctx: { params: Promise<{ setId: string }> }) {
  const { setId } = await ctx.params

  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: PutBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const { admin, set, defs } = await loadSetAndSchema(setId)
    if (!set) return NextResponse.json({ error: "Intake set not found" }, { status: 404 })

    const defsByCode = new Map(defs.map((d) => [d.lineCode, d]))

    // Filing status first — the evaluation below and the standard-deduction
    // assist both read it.
    let filingStatus: FilingStatus = isFilingStatus(set.filing_status) ? set.filing_status : "single"
    if (body.filingStatus !== undefined) {
      if (!isFilingStatus(body.filingStatus)) {
        return NextResponse.json(
          { error: `filingStatus must be one of: ${VALID_FILING_STATUSES.join(", ")}` },
          { status: 400 },
        )
      }
      filingStatus = body.filingStatus
      const { error: fsErr } = await admin
        .from("tax_input_sets")
        .update({ filing_status: filingStatus, updated_at: new Date().toISOString() })
        .eq("id", setId)
      if (fsErr) throw new Error(fsErr.message)
    }

    const submitted = body.entries ?? {}
    const rejected: Array<{ lineCode: string; reason: string }> = []
    const rows: Array<Record<string, unknown>> = []

    for (const [lineCode, raw] of Object.entries(submitted)) {
      const def = defsByCode.get(lineCode)
      if (!def) {
        rejected.push({ lineCode, reason: "No such line in the seeded schema for this tax year." })
        continue
      }
      // A computed line is derived, never stored. Accepting one would let a
      // stored value drift away from its operands — wrong on screen and
      // wrong on the return, with nothing to indicate which.
      if (def.isComputed) {
        rejected.push({ lineCode, reason: "Line is computed from other lines and cannot be set directly." })
        continue
      }
      // Filing status has exactly one home: tax_input_sets.filing_status.
      if (def.section === "filing_status") {
        rejected.push({
          lineCode,
          reason: "Set filing status via the `filingStatus` field, not the fs_* lines.",
        })
        continue
      }
      // Taxpayer identifiers are NOT accepted here. `contacts.ssn_encrypted`
      // is already an unencrypted store of real SSNs (see migration 364);
      // creating a second one in this table would widen a problem the firm
      // has not yet closed. The document intake path deliberately reads
      // identity from the client profile and masks it server-side rather
      // than re-keying it, and direct entry follows the same rule.
      if (def.dataType === "ssn" || def.dataType === "ein") {
        rejected.push({
          lineCode,
          reason:
            "Taxpayer identifiers are not stored by direct entry. Record the SSN/EIN on the client " +
            "profile, where it is read and masked rather than re-keyed.",
        })
        continue
      }

      const row: Record<string, unknown> = {
        set_id: setId,
        line_code: lineCode,
        tax_year: set.tax_year,
        return_type: set.return_type ?? "IND",
        entered_by: user.id,
        value_num: null,
        value_text: null,
        value_bool: null,
        updated_at: new Date().toISOString(),
      }

      if (raw === null || raw === "") {
        // Keep the row: "visited and deliberately blank" is information.
      } else if (def.dataType === "boolean") {
        row.value_bool = raw === true || raw === "true" || raw === 1
      } else if (NUMERIC_TYPES.has(def.dataType)) {
        const cleaned = String(raw).trim()
        const negated = /^\(.*\)$/.test(cleaned)
        const parsed = Number.parseFloat(cleaned.replace(/[(),$\s]/g, ""))
        if (Number.isNaN(parsed)) {
          rejected.push({ lineCode, reason: `"${raw}" is not a number.` })
          continue
        }
        row.value_num = negated ? -parsed : parsed
      } else if (def.dataType === "enum") {
        const allowed = def.enumOptions ?? []
        if (allowed.length > 0 && !allowed.includes(String(raw))) {
          rejected.push({ lineCode, reason: `Must be one of: ${allowed.join(", ")}.` })
          continue
        }
        row.value_text = String(raw)
      } else {
        row.value_text = String(raw)
      }

      rows.push(row)
    }

    if (rows.length > 0) {
      const { error: upsertErr } = await admin
        .from("form_1040_line_entries")
        .upsert(rows, { onConflict: "set_id,line_code" })
      if (upsertErr) throw new Error(upsertErr.message)
    }

    // Re-read and re-evaluate server-side so the response is authoritative
    // rather than an echo of what the client believed.
    const { data: entryRows, error: readErr } = await admin
      .from("form_1040_line_entries")
      .select("line_code, value_num, value_text, value_bool, updated_at")
      .eq("set_id", setId)
    if (readErr) throw new Error(readErr.message)

    const entries = rowsToEntries(entryRows ?? [], defsByCode)
    const evaluated = evaluateLines(defs, entries)

    return NextResponse.json({
      saved: rows.length,
      rejected,
      filingStatus,
      entries,
      evaluated,
      warnings: checkLines(evaluated, filingStatus),
      savedAt: new Date().toISOString(),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] [tax/intake/lines] PUT failed:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
