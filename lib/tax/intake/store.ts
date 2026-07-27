/**
 * Supabase access for tax intake. The only module that reads/writes the
 * tax_input_* tables.
 *
 * Convention (see lib/proconnect/snapshots.ts): the Supabase client is
 * passed IN — never constructed here — so the calling route owns auth. All
 * four tables are service-role-only by RLS, so callers must pass an admin
 * client and must have authenticated the preparer themselves.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { IntakeFieldDef, IntakeSet, IntakeDocument } from "./serialize"
import type { Form1040Constants, FilingStatus } from "./compute"

/** Field definitions for a document type, ordered for form rendering. */
export async function loadFieldDefs(
  sb: SupabaseClient,
  opts: { taxYear: number; returnType?: string; docType?: string },
): Promise<Map<string, IntakeFieldDef[]>> {
  let q = sb
    .from("tax_input_field_defs")
    .select(
      "doc_type, field_key, label, data_type, required, sort_order, help_text, agency, series_id, code_id, suffix_id, cell_field, tsj, confidence",
    )
    .eq("tax_year", opts.taxYear)
    .eq("return_type", opts.returnType ?? "IND")
    .order("sort_order", { ascending: true })
  if (opts.docType) q = q.eq("doc_type", opts.docType)

  const { data, error } = await q
  if (error) throw error

  const byType = new Map<string, IntakeFieldDef[]>()
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>
    const def: IntakeFieldDef = {
      fieldKey: row.field_key as string,
      label: row.label as string,
      dataType: row.data_type as IntakeFieldDef["dataType"],
      required: Boolean(row.required),
      agency: row.agency as string,
      seriesId: row.series_id as string,
      codeId: row.code_id as string,
      suffixId: row.suffix_id as string,
      cellField: row.cell_field as string,
      tsj: (row.tsj as string | null) ?? null,
      confidence: (row.confidence as IntakeFieldDef["confidence"]) ?? "medium",
    }
    const key = row.doc_type as string
    const list = byType.get(key) ?? []
    list.push(def)
    byType.set(key, list)
  }
  return byType
}

/** A gathering with all its documents and entered values. */
export async function loadIntakeSet(
  sb: SupabaseClient,
  inputSetId: string,
): Promise<IntakeSet | null> {
  const { data: setRow, error: setErr } = await sb
    .from("tax_input_sets")
    .select("id, tax_year, return_type, filing_status, proconnect_client_id, proconnect_return_id")
    .eq("id", inputSetId)
    .maybeSingle()
  if (setErr) throw setErr
  if (!setRow) return null

  const { data: docRows, error: docErr } = await sb
    .from("tax_input_documents")
    .select("id, doc_type, instance_index, label, taxpayer_spouse")
    .eq("input_set_id", inputSetId)
    .order("doc_type", { ascending: true })
    .order("instance_index", { ascending: true })
  if (docErr) throw docErr

  const docIds = (docRows ?? []).map((d) => (d as { id: string }).id)
  // Values are fetched in one query rather than per document; a client
  // with many W-2s and 1099s would otherwise be an N+1.
  const valuesByDoc = new Map<string, IntakeDocument["values"]>()
  if (docIds.length > 0) {
    const { data: valRows, error: valErr } = await sb
      .from("tax_input_values")
      .select("document_id, field_key, value_text, value_num")
      .in("document_id", docIds)
    if (valErr) throw valErr
    for (const v of valRows ?? []) {
      const row = v as Record<string, unknown>
      const docId = row.document_id as string
      const bag = valuesByDoc.get(docId) ?? {}
      bag[row.field_key as string] = {
        text: (row.value_text as string | null) ?? null,
        num: row.value_num === null || row.value_num === undefined ? null : Number(row.value_num),
      }
      valuesByDoc.set(docId, bag)
    }
  }

  const documents: IntakeDocument[] = (docRows ?? []).map((d) => {
    const row = d as Record<string, unknown>
    return {
      id: row.id as string,
      docType: row.doc_type as string,
      instanceIndex: Number(row.instance_index),
      label: (row.label as string | null) ?? null,
      taxpayerSpouse: ((row.taxpayer_spouse as string) === "S" ? "S" : "T") as "T" | "S",
      values: valuesByDoc.get(row.id as string) ?? {},
    }
  })

  const s = setRow as Record<string, unknown>
  return {
    id: s.id as string,
    taxYear: Number(s.tax_year),
    returnType: s.return_type as string,
    filingStatus: (s.filing_status as string | null) ?? null,
    proconnectClientId: (s.proconnect_client_id as string | null) ?? null,
    proconnectReturnId: (s.proconnect_return_id as string | null) ?? null,
    documents,
  }
}

/** Constants for the 1040 preview, including the bracket-verification gate. */
export async function loadForm1040Constants(
  sb: SupabaseClient,
  taxYear: number,
): Promise<Form1040Constants> {
  const { data, error } = await sb
    .from("form_1040_constants")
    .select("key, value")
    .eq("tax_year", taxYear)
  if (error) throw error

  const m = new Map<string, unknown>((data ?? []).map((r) => {
    const row = r as { key: string; value: unknown }
    return [row.key, row.value]
  }))
  const num = (k: string, fallback = 0): number => {
    const v = m.get(k)
    return typeof v === "number" ? v : Number(v ?? fallback) || fallback
  }
  const brackets = (k: string) => {
    const v = m.get(k)
    return Array.isArray(v) ? (v as Form1040Constants["brackets"]["single"]) : []
  }

  return {
    stdDeductionSingle: num("std_deduction_single"),
    stdDeductionMfj: num("std_deduction_mfj"),
    stdDeductionMfs: num("std_deduction_mfs"),
    stdDeductionHoh: num("std_deduction_hoh"),
    additionalStd65BlindSingle: num("additional_std_65_blind_single"),
    additionalStd65BlindMfj: num("additional_std_65_blind_mfj"),
    // Anything other than a literal true keeps the gate closed.
    bracketsVerified: m.get("tax_brackets_verified") === true,
    brackets: {
      single: brackets("tax_brackets_single"),
      mfj: brackets("tax_brackets_mfj"),
      mfs: brackets("tax_brackets_mfs"),
      hoh: brackets("tax_brackets_hoh"),
    },
  }
}

/** Flatten W-2 documents into the shape the compute engine consumes. */
export function w2sFromIntakeSet(set: IntakeSet) {
  const numOf = (d: IntakeDocument, key: string) => d.values[key]?.num ?? null
  return set.documents
    .filter((d) => d.docType === "w2")
    .map((d) => ({
      box1Wages: numOf(d, "box1_wages"),
      box2FedWithheld: numOf(d, "box2_fed_withheld"),
      obbbaQualifiedTips: numOf(d, "obbba_qualified_tips"),
      obbbaQualifiedOvertime: numOf(d, "obbba_qualified_overtime"),
      statutoryEmployee: d.values["box13_statutory_employee"]?.num === 1,
    }))
}

export function filingStatusOf(set: IntakeSet): FilingStatus {
  const fs = (set.filingStatus ?? "single").toLowerCase()
  return (["single", "mfj", "mfs", "hoh", "qss"].includes(fs) ? fs : "single") as FilingStatus
}
