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
import type {
  Form1040Constants,
  FilingStatus,
  W2Input,
  Int1099Input,
  Div1099Input,
  R1099Input,
  ScheduleAInput,
} from "./compute"

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
    .select(
      "id, tax_year, return_type, filing_status, contact_id, proconnect_client_id, proconnect_return_id",
    )
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
    contactId: (s.contact_id as string | null) ?? null,
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
    // Schedule A. Gated independently of the brackets — see migration 362.
    itemizedVerified: m.get("itemized_constants_verified") === true,
    medicalAgiFloorPct: num("medical_agi_floor_pct", 0.075),
    saltCap: num("salt_cap"),
    saltCapMfs: num("salt_cap_mfs"),
    saltPhaseoutStart: num("salt_phaseout_start"),
    saltPhaseoutStartMfs: num("salt_phaseout_start_mfs"),
    saltPhaseoutRate: num("salt_phaseout_rate"),
    saltPhaseoutFloor: num("salt_phaseout_floor"),
    saltPhaseoutFloorMfs: num("salt_phaseout_floor_mfs"),
    charitableMileageRate: num("charitable_mileage_rate", 0.14),
    // Schedule 1-A Parts II-V (scripts/389 + 386).
    tipsDeductionCap: num("tips_deduction_cap"),
    overtimeDeductionCap: num("overtime_deduction_cap"),
    overtimeDeductionCapMfj: num("overtime_deduction_cap_mfj"),
    tipsOvertimePhaseoutStart: num("tips_overtime_phaseout_start"),
    tipsOvertimePhaseoutStartMfj: num("tips_overtime_phaseout_start_mfj"),
    tipsOvertimePhaseoutPer1000: num("tips_overtime_phaseout_per_1000"),
    seniorDeductionMax: num("senior_deduction_max"),
    seniorDeductionPhaseoutStart: num("senior_deduction_phaseout_start"),
    seniorDeductionPhaseoutStartMfj: num("senior_deduction_phaseout_start_mfj"),
    seniorDeductionPhaseoutRate: num("senior_deduction_phaseout_rate"),
  }
}

const numOf = (d: IntakeDocument, key: string) => d.values[key]?.num ?? null
const boolOf = (d: IntakeDocument, key: string) => d.values[key]?.num === 1
const textOf = (d: IntakeDocument, key: string) => d.values[key]?.text ?? null

function docsOfType(set: IntakeSet, docType: string): IntakeDocument[] {
  return set.documents.filter((d) => d.docType === docType)
}

/**
 * Flatten gathered documents into the shapes the compute engine consumes.
 *
 * These are the ONLY place field_key strings are coupled to the calculator.
 * A key here that no longer exists in tax_input_field_defs silently reads as
 * null, so `assertComputeKeysExist` below is run at request time to catch
 * drift rather than quietly under-reporting income.
 */
export function w2sFromIntakeSet(set: IntakeSet): W2Input[] {
  return docsOfType(set, "w2").map((d) => ({
    box1Wages: numOf(d, "box1_wages"),
    box2FedWithheld: numOf(d, "box2_fed_withheld"),
    obbbaQualifiedTips: numOf(d, "obbba_qualified_tips"),
    obbbaQualifiedOvertime: numOf(d, "obbba_qualified_overtime"),
    statutoryEmployee: boolOf(d, "box13_statutory_employee"),
  }))
}

export function int1099sFromIntakeSet(set: IntakeSet): Int1099Input[] {
  return docsOfType(set, "1099int").map((d) => ({
    interestBanks: numOf(d, "interest_banks"),
    interestUsBonds: numOf(d, "interest_us_bonds"),
    interestMuniTotal: numOf(d, "interest_muni_total"),
    interestMuniInstate: numOf(d, "interest_muni_instate"),
    oid: numOf(d, "oid"),
    fedWithheld: numOf(d, "fed_withheld"),
    earlyWithdrawalPenalty: numOf(d, "early_withdrawal_penalty"),
    accruedInterest: numOf(d, "accrued_interest"),
    nomineeInterest: numOf(d, "nominee_interest"),
  }))
}

export function div1099sFromIntakeSet(set: IntakeSet): Div1099Input[] {
  return docsOfType(set, "1099div").map((d) => ({
    box1aOrdinary: numOf(d, "box1a_ordinary"),
    box1bQualified: numOf(d, "box1b_qualified"),
    box2aCapGain: numOf(d, "box2a_capgain"),
    box3Nondividend: numOf(d, "box3_nondividend"),
    box4FedWithheld: numOf(d, "box4_fed_withheld"),
    box5Sec199a: numOf(d, "box5_sec199a"),
  }))
}

export function r1099sFromIntakeSet(set: IntakeSet): R1099Input[] {
  return docsOfType(set, "1099r").map((d) => ({
    // The line-4 vs line-5 discriminator. See scripts/361.
    iraSepSimple: boolOf(d, "ira_sep_simple"),
    box1Gross: numOf(d, "box1_gross"),
    box2aTaxable: numOf(d, "box2a_taxable"),
    box2bNotDetermined: boolOf(d, "box2b_not_determined"),
    box4FedWithheld: numOf(d, "box4_fed_withheld"),
    distCode1: textOf(d, "box7_dist_code1"),
  }))
}

export function scheduleAFromIntakeSet(set: IntakeSet): ScheduleAInput[] {
  return docsOfType(set, "scha").map((d) => ({
    medPrescriptions: numOf(d, "med_prescriptions"),
    medDoctors: numOf(d, "med_doctors"),
    medHospitals: numOf(d, "med_hospitals"),
    medInsurance: numOf(d, "med_insurance"),
    medReimbursement: numOf(d, "med_reimbursement"),
    medOther: numOf(d, "med_other"),
    taxStateIncome: numOf(d, "tax_state_income"),
    taxSales: numOf(d, "tax_sales"),
    taxRealestateResidence: numOf(d, "tax_realestate_residence"),
    taxRealestateInvestment: numOf(d, "tax_realestate_investment"),
    taxPersonalProperty: numOf(d, "tax_personal_property"),
    intMortgage1098: numOf(d, "int_mortgage_1098"),
    intMortgageNo1098: numOf(d, "int_mortgage_no1098"),
    intPointsNo1098: numOf(d, "int_points_no1098"),
    intInvestment: numOf(d, "int_investment"),
    charityCash: numOf(d, "charity_cash"),
    charityNoncash50: numOf(d, "charity_noncash_50"),
    charityNoncash30: numOf(d, "charity_noncash_30"),
    charityMiles: numOf(d, "charity_miles"),
    otherItemized: numOf(d, "other_itemized"),
  }))
}

/**
 * Every field_key the flatteners above read, by document type.
 *
 * The flatteners read by string, so a renamed or dropped field def would
 * make income silently vanish from the preview rather than error. This list
 * is checked against the loaded defs on every preview request.
 */
const COMPUTE_KEYS: Record<string, string[]> = {
  w2: [
    "box1_wages",
    "box2_fed_withheld",
    "obbba_qualified_tips",
    "obbba_qualified_overtime",
    "box13_statutory_employee",
  ],
  "1099int": [
    "interest_banks",
    "interest_us_bonds",
    "interest_muni_total",
    "interest_muni_instate",
    "oid",
    "fed_withheld",
    "early_withdrawal_penalty",
    "accrued_interest",
    "nominee_interest",
  ],
  "1099div": [
    "box1a_ordinary",
    "box1b_qualified",
    "box2a_capgain",
    "box3_nondividend",
    "box4_fed_withheld",
    "box5_sec199a",
  ],
  "1099r": [
    "ira_sep_simple",
    "box1_gross",
    "box2a_taxable",
    "box2b_not_determined",
    "box4_fed_withheld",
    "box7_dist_code1",
  ],
  scha: [
    "med_prescriptions",
    "med_doctors",
    "med_hospitals",
    "med_insurance",
    "med_reimbursement",
    "med_other",
    "tax_state_income",
    "tax_sales",
    "tax_realestate_residence",
    "tax_realestate_investment",
    "tax_personal_property",
    "int_mortgage_1098",
    "int_mortgage_no1098",
    "int_points_no1098",
    "int_investment",
    "charity_cash",
    "charity_noncash_50",
    "charity_noncash_30",
    "charity_miles",
    "other_itemized",
  ],
}

/**
 * Returns a human-readable problem for each field key the calculator reads
 * that no longer has a definition. Empty means the flatteners and the
 * field defs agree.
 */
export function computeKeyDrift(defs: Map<string, IntakeFieldDef[]>): string[] {
  const problems: string[] = []
  for (const [docType, keys] of Object.entries(COMPUTE_KEYS)) {
    const defined = defs.get(docType)
    // A type with no defs at all is not drift — it just isn't seeded for
    // this tax year, and documents of that type cannot be created.
    if (!defined?.length) continue
    const have = new Set(defined.map((d) => d.fieldKey))
    for (const k of keys) {
      if (!have.has(k)) {
        problems.push(
          `The 1040 calculator reads ${docType}.${k}, but no field definition exists for it. ` +
            "That amount would be silently omitted from the preview.",
        )
      }
    }
  }
  return problems
}

export function filingStatusOf(set: IntakeSet): FilingStatus {
  const fs = (set.filingStatus ?? "single").toLowerCase()
  return (["single", "mfj", "mfs", "hoh", "qss"].includes(fs) ? fs : "single") as FilingStatus
}
