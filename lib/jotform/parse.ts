/**
 * Translate a raw Jotform `answers` map into the denormalized columns
 * stored on `jotform_intake_submissions`.
 *
 * The raw shape is `{ [qid]: { name, text, type, answer, ... } }`. The
 * intake form (242306172162144) has stable `name` slugs we key on, so
 * the parser is index-by-name rather than by qid — that way a question
 * being deleted/added in Jotform won't shift our extraction.
 */

import type { JotformAnswer, JotformSubmission } from "./client"

type AnswerMap = Record<string, JotformAnswer>

/**
 * Convert Jotform's webhook `rawRequest` payload into the same
 * `{ qid: { name, answer, ... } }` shape returned by the API.
 *
 * `rawRequest` is a flat dict whose keys look like `q5_whatBest` or
 * `q19_personalEmail` — `<qid>_<name>`. The values are the answers
 * directly (string for simple inputs, object for fullname/phone/address,
 * array for multi-select). This lets us ingest a webhook delivery
 * without burning an extra API call to refetch the same data Jotform
 * already handed us.
 *
 * Anything that can't be parsed as `q<digits>_<name>` is preserved
 * under a synthetic qid so we never silently drop information; the
 * audit log row in `jotform_webhook_events` still has the untouched
 * payload as a final backstop.
 */
export function rawRequestToAnswerMap(raw: unknown): AnswerMap {
  if (!raw || typeof raw !== "object") return {}
  const out: AnswerMap = {}
  let synthetic = 9000
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const m = /^q(\d+)_(.+)$/.exec(key)
    if (m) {
      const [, qid, name] = m
      out[qid] = { name, answer: value as JotformAnswer["answer"] }
    } else {
      // Top-level meta keys (formID, submissionID, slug, etc.) live
      // here. Skip the well-known meta keys so we don't pollute the
      // answers map with non-question data.
      const meta = new Set([
        "formID",
        "submissionID",
        "ip",
        "username",
        "slug",
        "type",
        "webhookURL",
        "event_id",
        "type",
      ])
      if (meta.has(key)) continue
      out[String(synthetic++)] = { name: key, answer: value as JotformAnswer["answer"] }
    }
  }
  return out
}

/**
 * Build a `JotformSubmission` (the shape `upsertIntakeSubmission`
 * consumes) from the multipart payload Jotform delivers to webhooks.
 * Keeps the live ingest path independent of Jotform's API for real
 * deliveries while still letting the API path stay as a fallback.
 */
export function submissionFromWebhookPayload(args: {
  formId: string
  submissionId: string
  rawRequest: unknown
  ip?: string | null
  createdAt?: string | null
}): JotformSubmission {
  return {
    id: args.submissionId,
    form_id: args.formId,
    ip: args.ip ?? "",
    created_at: args.createdAt ?? new Date().toISOString().slice(0, 19).replace("T", " "),
    updated_at: null,
    status: "ACTIVE",
    new: "1",
    flag: "0",
    answers: rawRequestToAnswerMap(args.rawRequest),
  }
}

function findByName(answers: AnswerMap, name: string): JotformAnswer | undefined {
  for (const a of Object.values(answers)) {
    if (a?.name === name) return a
  }
  return undefined
}

function strAnswer(a: JotformAnswer | undefined): string | null {
  if (!a) return null
  const v = a.answer
  if (v == null) return null
  if (typeof v === "string") return v.trim() || null
  if (typeof v === "number") return String(v)
  return null
}

function arrayAnswer(a: JotformAnswer | undefined): string[] | null {
  if (!a) return null
  const v = a.answer
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean)
  if (typeof v === "string" && v.length > 0) return [v]
  return null
}

function jsonAnswer(a: JotformAnswer | undefined): Record<string, unknown> | null {
  if (!a) return null
  const v = a.answer
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function fullnameAnswer(a: JotformAnswer | undefined): {
  first: string | null
  last: string | null
  full: string | null
} {
  const o = jsonAnswer(a)
  if (!o) return { first: null, last: null, full: null }
  const first = (o.first as string | undefined)?.trim() || null
  const last = (o.last as string | undefined)?.trim() || null
  const middle = (o.middle as string | undefined)?.trim() || null
  const full = [first, middle, last].filter(Boolean).join(" ") || null
  return { first, last, full }
}

function phoneAnswer(a: JotformAnswer | undefined): string | null {
  const o = jsonAnswer(a)
  if (o && typeof o.full === "string") return o.full.trim() || null
  return strAnswer(a)
}

function addressAnswer(a: JotformAnswer | undefined): {
  full: Record<string, unknown> | null
  city: string | null
  state: string | null
  zip: string | null
} {
  const o = jsonAnswer(a)
  if (!o) return { full: null, city: null, state: null, zip: null }
  // Jotform address fields: addr_line1, addr_line2, city, state, postal, country
  const city = (o.city as string | undefined)?.trim() || null
  const state = (o.state as string | undefined)?.trim() || null
  const zip = (o.postal as string | undefined)?.trim() || null
  return { full: o, city, state, zip }
}

/**
 * The "existing business primary contact info" field is a `control_mixed`
 * (a custom multi-input). We pass it through as JSON if present, but
 * also try to surface email/phone if the keys exist.
 */
function mixedContactExtract(a: JotformAnswer | undefined): {
  email: string | null
  phone: string | null
} {
  const o = jsonAnswer(a)
  if (!o) return { email: null, phone: null }
  const email = (o.email as string | undefined)?.trim() || null
  const phone = (o.phone as string | undefined)?.trim() || null
  return { email, phone }
}

export type ParsedIntakeFields = {
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_full_name: string | null
  submitter_email: string | null
  submitter_phone: string | null
  submitter_address: Record<string, unknown> | null
  submitter_city: string | null
  submitter_state: string | null
  submitter_zip: string | null

  services_requested: string[] | null
  service_focus: string | null
  entity_types: string[] | null
  business_situation: string | null

  business_name: string | null
  business_email: string | null
  business_phone: string | null
  business_address: Record<string, unknown> | null
  business_state: string | null
  business_tax_classification: string | null
  business_summary: string | null
  business_revenue_range: string | null
  business_employee_count: string | null
  business_uses_accounting_system: string | null

  questions_or_concerns: string | null
  additional_notes: string | null

  // Free-text name the prospect chose for the "Is there a specific team
  // member you would prefer to meet with?" question (raw answer
  // `lastlyTo53`). We keep this even when we can't match it to a
  // current team_members row so the triager always sees who the
  // prospect actually asked for. The team_members lookup happens
  // downstream in `resolvePreferredTeamMember`.
  preferred_team_member: string | null
}

export function parseIntakeAnswers(answers: AnswerMap): ParsedIntakeFields {
  // ── Submitter (personal) ──────────────────────────────────────────
  const fullname = fullnameAnswer(findByName(answers, "whatIs1"))
  const personalAddr = addressAnswer(findByName(answers, "personalAddress"))

  // ── Business (existing OR new) ────────────────────────────────────
  // Existing business fields
  const existingBizName = strAnswer(findByName(answers, "whatsThe"))
  const existingBizAddr = addressAnswer(findByName(answers, "whatIs"))
  const existingContact = mixedContactExtract(findByName(answers, "existingBusiness"))
  const existingTaxClass = strAnswer(findByName(answers, "whatIs75"))
  const existingSummary = strAnswer(findByName(answers, "pleaseProvide91"))
  const existingAccounting = strAnswer(findByName(answers, "doesYour"))
  const existingEmployees = strAnswer(findByName(answers, "howMany105"))
  const existingRevenue = strAnswer(findByName(answers, "whatIs118"))
  const existingExtra = strAnswer(findByName(answers, "isThere"))

  // New business fields
  const newBizName = strAnswer(findByName(answers, "whatIs31"))
  const newBizAddr = addressAnswer(findByName(answers, "whatIs82"))
  const newBizPhone = phoneAnswer(findByName(answers, "whatIs93"))
  const newBizState = addressAnswer(findByName(answers, "whatIs33"))
  const newBizSummary = strAnswer(findByName(answers, "pleaseProvide"))

  // Whichever side of the form was used wins for denormalized columns.
  const business_name = existingBizName ?? newBizName
  const business_address = existingBizAddr.full ?? newBizAddr.full
  const business_state = existingBizAddr.state ?? newBizState.state
  const business_phone = existingContact.phone ?? newBizPhone
  const business_email = existingContact.email
  const business_summary = existingSummary ?? newBizSummary

  return {
    submitter_first_name: fullname.first,
    submitter_last_name: fullname.last,
    submitter_full_name: fullname.full,
    submitter_email: strAnswer(findByName(answers, "personalEmail")),
    submitter_phone: phoneAnswer(findByName(answers, "personalPhone")),
    submitter_address: personalAddr.full,
    submitter_city: personalAddr.city,
    submitter_state: personalAddr.state,
    submitter_zip: personalAddr.zip,

    services_requested: arrayAnswer(findByName(answers, "whatServices")),
    service_focus: strAnswer(findByName(answers, "whatBest")),
    entity_types: arrayAnswer(findByName(answers, "whatTypes")),
    business_situation: strAnswer(findByName(answers, "whichBest")),

    business_name,
    business_email,
    business_phone,
    business_address,
    business_state,
    business_tax_classification: existingTaxClass,
    business_summary,
    business_revenue_range: existingRevenue,
    business_employee_count: existingEmployees,
    business_uses_accounting_system: existingAccounting,

    questions_or_concerns: strAnswer(findByName(answers, "doYou")),
    additional_notes: existingExtra,

    // Form field name confirmed against real submissions in production:
    // `lastlyTo53` (control_radio) — values look like "Mark Dwyer" or
    // "Dat Le". Null when the prospect skipped the question.
    preferred_team_member: strAnswer(findByName(answers, "lastlyTo53")),
  }
}

/**
 * Convert the Jotform-formatted timestamp ("2026-05-04 12:27:09" in
 * America/New_York or UTC depending on form settings — we treat it as
 * UTC to be deterministic) to an ISO string for Postgres.
 */
export function toIso(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  // Jotform returns "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SSZ"
  const t = timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T") + "Z"
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Build the row payload to upsert into `jotform_intake_submissions`. */
export function buildIntakeRow(submission: JotformSubmission, formUuid?: string | null) {
  const parsed = parseIntakeAnswers(submission.answers ?? {})
  return {
    jotform_submission_id: submission.id,
    jotform_form_id: submission.form_id,
    form_id: formUuid ?? null,
    status: submission.status ?? null,
    flag: typeof submission.flag === "string" ? Number.parseInt(submission.flag, 10) : submission.flag,
    is_new: String(submission.new) === "1",
    ip_address: submission.ip ?? null,
    jotform_created_at: toIso(submission.created_at),
    jotform_updated_at: toIso(submission.updated_at),
    raw_answers: submission.answers ?? {},
    last_synced_at: new Date().toISOString(),
    ...parsed,
  }
}
