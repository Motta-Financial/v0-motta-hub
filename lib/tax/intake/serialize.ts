/**
 * Tax intake → ProConnect Import payloads.
 *
 * The Hub gathers source documents (a W-2, a 1099-R) and this module turns
 * them into the `entries[]` the Import API accepts, grouped one batch per
 * series because Import writes a single series per call.
 *
 * Structure mirrors `lib/forms/form-1040.ts`: a DB loader (`loadIntakeSet`)
 * and a PURE transform (`serializeToImportBatches`) that takes everything
 * as arguments, so the mapping logic is testable without a live database
 * or a live Intuit call.
 *
 * ── The address model ──
 * Every value lands at {seriesId}/{prefixId}/{codeId}/{suffixId}. The
 * field def supplies series/code/suffix; the PREFIX comes from the
 * document's instance_index — three W-2s are p0/p1/p2 against the same
 * s11 codes.
 *
 * ⚠️ p{n} is inferred from the Phase 1 field model, NOT confirmed. The
 * catalog carries no prefix information (it is keyed agency/series/code).
 * `prefixAssumed` is set on every batch so callers can surface it, and
 * nothing here may be committed with dryRun:false until an Export of a
 * two-W-2 return shows how ProConnect really enumerates instances.
 */

/** A field definition row: the bridge from a Hub field to a PTO address. */
export interface IntakeFieldDef {
  fieldKey: string
  label: string
  dataType: "currency" | "text" | "ssn" | "ein" | "state" | "checkbox" | "integer"
  required: boolean
  agency: string
  seriesId: string
  codeId: string
  suffixId: string
  cellField: string
  tsj: string | null
  confidence: "high" | "medium" | "low"
}

/** One gathered document plus its entered values. */
export interface IntakeDocument {
  id: string
  docType: string
  instanceIndex: number
  label: string | null
  taxpayerSpouse: "T" | "S"
  values: Record<string, { text: string | null; num: number | null }>
}

export interface IntakeSet {
  id: string
  taxYear: number
  returnType: string
  filingStatus: string | null
  /** The Hub client this return is for — the taxpayer identity source. */
  contactId?: string | null
  proconnectClientId: string | null
  proconnectReturnId: string | null
  documents: IntakeDocument[]
}

/** An Import entry, shaped exactly as the Phase 1 body expects. */
export interface ImportEntry {
  prefixId: string
  codeId: string
  suffixId: string
  val?: string
  desc?: string
  src?: string
  tsj?: string
  source?: string
}

/** One Import call: a series and its entries. */
export interface ImportBatch {
  seriesId: string
  agency: string
  entries: ImportEntry[]
  /** Always true today — see the prefix caveat in the module docstring. */
  prefixAssumed: boolean
  /** Field keys skipped, with the reason, so nothing vanishes silently. */
  skipped: Array<{ fieldKey: string; reason: string }>
}

export interface SerializeProblem {
  severity: "blocking" | "warning"
  docType: string
  instanceIndex: number
  fieldKey: string | null
  message: string
}

export interface SerializeResult {
  batches: ImportBatch[]
  problems: SerializeProblem[]
  /** Total entries across batches — check against the 500-per-call cap. */
  entryCount: number
}

const MAX_ENTRIES_PER_CALL = 500

/** instance_index → prefixId. */
export function prefixForInstance(instanceIndex: number): string {
  return `p${instanceIndex}`
}

/**
 * Normalize a Hub value to the string the Import API wants.
 *
 * Import takes strings for `val` regardless of the catalog's declared
 * type. Checkboxes become "1" when set and are OMITTED when not — sending
 * "0" would write an explicit zero, which is not the same as leaving a
 * ProConnect checkbox blank.
 */
export function formatValue(
  def: IntakeFieldDef,
  raw: { text: string | null; num: number | null },
): string | null {
  if (def.dataType === "checkbox") {
    const on = raw.num === 1 || raw.text === "1" || raw.text === "true"
    return on ? "1" : null
  }
  if (def.dataType === "currency" || def.dataType === "integer") {
    if (raw.num === null || Number.isNaN(raw.num)) return null
    // Currency goes over as a plain decimal string — no thousands
    // separators or currency symbols, which the API would reject.
    return def.dataType === "integer" ? String(Math.trunc(raw.num)) : String(raw.num)
  }
  if (def.dataType === "ein" || def.dataType === "ssn") {
    // Strip formatting; Intuit validates the 9-digit form and never
    // echoes a failing identifier back, so a malformed one is expensive
    // to debug. Reject here instead.
    const digits = (raw.text ?? "").replace(/\D/g, "")
    return digits.length === 9 ? digits : null
  }
  const t = (raw.text ?? "").trim()
  return t === "" ? null : t
}

/**
 * PURE: gathered documents → Import batches, one per series.
 *
 * Takes the field defs as a map so the caller owns loading. Produces
 * problems rather than throwing, matching the discriminated-result
 * convention in lib/proconnect/data.ts.
 */
export function serializeToImportBatches(
  set: IntakeSet,
  defsByDocType: Map<string, IntakeFieldDef[]>,
): SerializeResult {
  const problems: SerializeProblem[] = []
  // series → batch, so documents of different types that share a series
  // merge into one call (and so multiple instances accumulate).
  const bySeries = new Map<string, ImportBatch>()

  for (const doc of set.documents) {
    const defs = defsByDocType.get(doc.docType)
    if (!defs || defs.length === 0) {
      problems.push({
        severity: "blocking",
        docType: doc.docType,
        instanceIndex: doc.instanceIndex,
        fieldKey: null,
        message: `No field definitions for document type "${doc.docType}" — cannot map it to ProConnect.`,
      })
      continue
    }

    const prefixId = prefixForInstance(doc.instanceIndex)

    for (const def of defs) {
      const raw = doc.values[def.fieldKey]

      // The spouse flag is derived from the document, not typed by a
      // preparer, so synthesize it rather than expecting a value row.
      const isSpouseFlag = def.fieldKey === "spouse_w2"
      const effective =
        isSpouseFlag
          ? { text: doc.taxpayerSpouse === "S" ? "1" : null, num: doc.taxpayerSpouse === "S" ? 1 : null }
          : raw

      if (!effective) {
        if (def.required) {
          problems.push({
            severity: "blocking",
            docType: doc.docType,
            instanceIndex: doc.instanceIndex,
            fieldKey: def.fieldKey,
            message: `${def.label} is required but empty.`,
          })
        }
        continue
      }

      const formatted = formatValue(def, effective)
      if (formatted === null) {
        if (def.required) {
          problems.push({
            severity: "blocking",
            docType: doc.docType,
            instanceIndex: doc.instanceIndex,
            fieldKey: def.fieldKey,
            message:
              def.dataType === "ein" || def.dataType === "ssn"
                ? `${def.label} must be 9 digits.`
                : `${def.label} is required but empty.`,
          })
        }
        continue
      }

      // A low-confidence mapping is allowed through but flagged — the
      // preparer decides whether to import it. This is what stops a
      // guessed address from quietly writing to a real return.
      if (def.confidence === "low") {
        problems.push({
          severity: "warning",
          docType: doc.docType,
          instanceIndex: doc.instanceIndex,
          fieldKey: def.fieldKey,
          message: `${def.label} maps to ${def.seriesId}/${def.codeId} with LOW confidence — verify before committing.`,
        })
      }

      let batch = bySeries.get(def.seriesId)
      if (!batch) {
        batch = {
          seriesId: def.seriesId,
          agency: def.agency,
          entries: [],
          prefixAssumed: true,
          skipped: [],
        }
        bySeries.set(def.seriesId, batch)
      }

      const entry: ImportEntry = {
        prefixId,
        codeId: def.codeId,
        suffixId: def.suffixId,
      }
      if (def.cellField === "desc") entry.desc = formatted
      else entry.val = formatted
      if (def.tsj) entry.tsj = def.tsj

      batch.entries.push(entry)
    }
  }

  const batches = [...bySeries.values()]
  const entryCount = batches.reduce((n, b) => n + b.entries.length, 0)

  for (const b of batches) {
    if (b.entries.length > MAX_ENTRIES_PER_CALL) {
      problems.push({
        severity: "blocking",
        docType: "-",
        instanceIndex: -1,
        fieldKey: null,
        message: `Series ${b.seriesId} has ${b.entries.length} entries, over the ${MAX_ENTRIES_PER_CALL}-per-call cap. Split the import.`,
      })
    }
  }

  return { batches, problems, entryCount }
}
