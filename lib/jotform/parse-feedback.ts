/**
 * Translate a raw Jotform `answers` map (from the Feedback + Referral
 * form, ID 240915444941155) into the denormalized columns stored on
 * `jotform_feedback_submissions`.
 *
 * Like the intake parser, this keys by question `name` slug — Jotform
 * preserves slugs across edits, so a question being moved or hidden
 * won't shift our extraction.
 *
 * Form anatomy (43 questions):
 *   - submitter identity: pleaseEnter (fullname), pleaseEnter79 (email)
 *   - client classification: areYou (radio: first-time / existing)
 *   - 1-5 scales: serviceQuality, communication, responsiveness, friendliness
 *   - 1-5 stars (control_rating): rateYour (overall)
 *   - feedback content: describeYour (textarea)
 *   - permission to share: doWe (radio yes/no)
 *   - referral interest: doYou (radio yes/no)
 *   - up to 5 referrals, each: name + email + notes
 *       referralName / referralEmail / doYou81
 *       name40       / referral2     / doYou86
 *       name45       / email46       / doYou87
 *       referral4    / referral489   / doYou90
 *       referral5    / referral594   / doYou95
 */

import type { JotformAnswer, JotformSubmission } from "./client"
import { toIso } from "./parse"

type AnswerMap = Record<string, JotformAnswer>

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

/**
 * Coerce a Jotform 1-5 answer into a smallint or null.
 *
 * `control_scale` answers come back as strings ("5") and `control_rating`
 * answers also come back as strings — we accept numbers too in case
 * the API normalizes.  Anything outside 1-5 (e.g. an empty submission
 * or a stray "0") is dropped so the column-level CHECK constraint
 * doesn't reject the row.
 */
function ratingAnswer(a: JotformAnswer | undefined): number | null {
  if (!a) return null
  const raw = a.answer
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return null
  if (n < 1 || n > 5) return null
  return n
}

/**
 * Map the radio "Are you a first-time client to Motta or existing?"
 * onto the canonical `client_status` enum used by the table.
 *
 * The form's answers vary slightly over time ("Existing client",
 * "Existing", "I'm an existing client", etc.), so we match by the
 * presence of the keyword rather than an exact string.
 */
function clientStatus(a: JotformAnswer | undefined): "first_time" | "existing" | null {
  const v = strAnswer(a)
  if (!v) return null
  const lc = v.toLowerCase()
  if (lc.includes("first")) return "first_time"
  if (lc.includes("exist")) return "existing"
  return null
}

/**
 * Map a yes/no radio answer to a boolean. Accepts "Yes", "No",
 * "Y", "N", and case variants. Empty/unknown → null.
 */
function yesNoAnswer(a: JotformAnswer | undefined): boolean | null {
  const v = strAnswer(a)
  if (!v) return null
  const lc = v.trim().toLowerCase()
  if (lc.startsWith("y")) return true
  if (lc.startsWith("n")) return false
  return null
}

type ReferralRecord = {
  name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  notes: string | null
}

/**
 * Pull a single referral block out of the answers map. Each referral
 * has its own trio of (name, email, notes) field slugs in the form,
 * so callers pass the slug names; this helper centralizes the
 * fullname-object → flat-record reshape.
 *
 * Returns null when the referral block is empty (no name AND no email
 * AND no notes), so we don't store empty placeholder rows for
 * "would you like to add a Nth referral?" radios that were declined.
 */
function extractReferral(
  answers: AnswerMap,
  nameSlug: string,
  emailSlug: string,
  notesSlug: string,
): ReferralRecord | null {
  const name = fullnameAnswer(findByName(answers, nameSlug))
  const email = strAnswer(findByName(answers, emailSlug))
  const notes = strAnswer(findByName(answers, notesSlug))
  if (!name.full && !email && !notes) return null
  return {
    name: name.full,
    first_name: name.first,
    last_name: name.last,
    email,
    notes,
  }
}

export type ParsedFeedbackFields = {
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_full_name: string | null
  submitter_email: string | null
  client_status: "first_time" | "existing" | null

  rating_overall: number | null
  rating_service_quality: number | null
  rating_communication: number | null
  rating_responsiveness: number | null
  rating_friendliness: number | null

  feedback_comments: string | null
  permission_to_share: boolean | null

  has_referral_interest: boolean | null
  referral_count: number
  referrals: ReferralRecord[]
}

export function parseFeedbackAnswers(answers: AnswerMap): ParsedFeedbackFields {
  const fullname = fullnameAnswer(findByName(answers, "pleaseEnter"))

  // Five referral blocks, each with its own three slugs. Order is
  // significant — index 0 is "Referral 1" in the form. Empty blocks
  // are filtered out below.
  const referralSlugs = [
    { name: "referralName", email: "referralEmail", notes: "doYou81" },
    { name: "name40", email: "referral2", notes: "doYou86" },
    { name: "name45", email: "email46", notes: "doYou87" },
    { name: "referral4", email: "referral489", notes: "doYou90" },
    { name: "referral5", email: "referral594", notes: "doYou95" },
  ] as const

  const referrals: ReferralRecord[] = []
  for (const slugs of referralSlugs) {
    const r = extractReferral(answers, slugs.name, slugs.email, slugs.notes)
    if (r) referrals.push(r)
  }

  return {
    submitter_first_name: fullname.first,
    submitter_last_name: fullname.last,
    submitter_full_name: fullname.full,
    submitter_email: strAnswer(findByName(answers, "pleaseEnter79")),
    client_status: clientStatus(findByName(answers, "areYou")),

    rating_overall: ratingAnswer(findByName(answers, "rateYour")),
    rating_service_quality: ratingAnswer(findByName(answers, "serviceQuality")),
    rating_communication: ratingAnswer(findByName(answers, "communication")),
    rating_responsiveness: ratingAnswer(findByName(answers, "responsiveness")),
    rating_friendliness: ratingAnswer(findByName(answers, "friendliness")),

    feedback_comments: strAnswer(findByName(answers, "describeYour")),
    permission_to_share: yesNoAnswer(findByName(answers, "doWe")),

    has_referral_interest: yesNoAnswer(findByName(answers, "doYou")),
    referral_count: referrals.length,
    referrals,
  }
}

/**
 * Karbon work-item linkage. Submissions delivered through an embed
 * URL like `…?workItemId=ABC&workItemTitle=…` come through with
 * those keys living in `rawRequest` alongside the question answers
 * (Jotform passes URL params straight through). We pull a few known
 * keys here so the column lights up automatically when the firm
 * starts embedding the form inside Karbon work items.
 *
 * The full prefill payload is also stored verbatim in
 * `prefill_metadata` so a future field can be added without a
 * migration — just update the parser.
 */
export function extractKarbonLink(answers: AnswerMap): {
  karbon_work_item_id: string | null
  karbon_work_item_title: string | null
  karbon_work_item_url: string | null
} {
  const a = (slug: string) => strAnswer(findByName(answers, slug))
  return {
    karbon_work_item_id: a("workItemId") ?? a("karbonWorkItemId"),
    karbon_work_item_title: a("workItemTitle") ?? a("karbonWorkItemTitle"),
    karbon_work_item_url: a("workItemUrl") ?? a("karbonWorkItemUrl"),
  }
}

/** Build the row payload to upsert into `jotform_feedback_submissions`. */
export function buildFeedbackRow(submission: JotformSubmission, formUuid?: string | null) {
  const answers = submission.answers ?? {}
  const parsed = parseFeedbackAnswers(answers)
  const karbon = extractKarbonLink(answers)

  return {
    jotform_submission_id: submission.id,
    jotform_form_id: submission.form_id,
    form_id: formUuid ?? null,

    ...parsed,
    ...karbon,

    raw_answers: answers,
    // Stash anything that looked like a prefill key (workItem*, ref,
    // utm_*, etc.) so we can retroactively wire columns later
    // without re-fetching from Jotform's API.
    prefill_metadata: collectPrefillMetadata(answers),

    status: submission.status ?? null,
    flag: typeof submission.flag === "string" ? Number.parseInt(submission.flag, 10) : submission.flag,
    is_new: String(submission.new) === "1",
    ip_address: submission.ip ?? null,
    jotform_created_at: toIso(submission.created_at),
    jotform_updated_at: toIso(submission.updated_at),
    last_synced_at: new Date().toISOString(),
  }
}

/**
 * Pull anything that looks like an out-of-band prefill key out of the
 * answers map. Anything not matched against a known question slug
 * gets surfaced here so it survives in the DB even if we don't have
 * a column for it yet.
 */
function collectPrefillMetadata(answers: AnswerMap): Record<string, unknown> {
  const knownQuestionSlugs = new Set([
    "clickTo",
    "pleaseEnter",
    "pleaseEnter79",
    "areYou",
    "serviceQuality",
    "communication",
    "responsiveness",
    "friendliness",
    "rateYour",
    "describeYour",
    "doWe",
    "doYou",
    "referral",
    "referralName",
    "referralEmail",
    "doYou81",
    "wouldYou",
    "divider",
    "referral298",
    "name40",
    "referral2",
    "doYou86",
    "wouldYou83",
    "divider47",
    "referral3",
    "name45",
    "email46",
    "doYou87",
    "wouldYou84",
    "divider62",
    "referral4100",
    "referral4",
    "referral489",
    "doYou90",
    "wouldYou91",
    "divider92",
    "referral5101",
    "referral5",
    "referral594",
    "doYou95",
    "clickTo102",
    "typeA",
    "submit",
  ])
  const meta: Record<string, unknown> = {}
  for (const a of Object.values(answers)) {
    if (!a?.name) continue
    if (knownQuestionSlugs.has(a.name)) continue
    meta[a.name] = a.answer ?? null
  }
  return meta
}
