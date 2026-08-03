/**
 * ALFRED Calendly invitee triage.
 *
 * Runs after the deterministic email/name+phone matcher inside
 * app/api/calendly/webhook/route.ts on every `invitee.created` payload.
 * The deterministic matcher only resolves a Contact; ALFRED's job is to:
 *
 *   1. Confirm or upgrade that contact match (catches nicknames /
 *      alternate emails the deterministic step missed).
 *   2. Add an Organization tag when the email-domain or booking-form
 *      Q&A clearly point at one ("I'm calling about Acme's books").
 *   3. Tag a Work item when the Q&A references a project / return.
 *   4. Tag a Service line when the event-type name + Q&A imply one
 *      (e.g. "1040 review", "Bookkeeping cleanup").
 *
 * Model output is constrained two ways:
 *
 *   • We pre-fetch a SHORTLIST of plausible rows (by email domain,
 *     fuzzy name, phone last-10, and event-type tokens) and pass those
 *     IDs to the model. The model can only choose from this list — no
 *     UUID hallucination is possible.
 *   • We use `generateObject` with a strict zod schema, so the output
 *     is structurally valid before any DB write occurs.
 *
 * Confidence policy (matches the user's chosen UX in chat):
 *   ≥ 0.85 → tag automatically (link_source='alfred', needs_review=false)
 *   0.50–0.85 → tag with needs_review=true (Team Calendar shows yellow chip)
 *   < 0.50 → don't tag; outcome='no_match' is logged for ops
 *
 * EVERY invocation produces exactly one row in
 * `calendly_alfred_triage_log` regardless of outcome — that's the audit
 * trail ops uses to debug bad tags. We swallow all errors there: a
 * model failure must never break the webhook.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { generateObject } from "ai"
import { z } from "zod"
import { ALFRED_CHAT_MODEL } from "@/lib/ai/models"

// ─── Public surface ──────────────────────────────────────────────────

export interface AlfredCalendlyTriageInput {
  calendlyEventId: string
  calendlyEventUuid: string | null
  calendlyInviteeUuid: string | null
  eventName: string | null
  eventTypeName: string | null
  startTime: string | null
  invitee: {
    name: string | null
    email: string | null
    phone: string | null
    questionsAndAnswers: Array<{ question: string; answer: string }> | null
  }
  /**
   * Whatever the deterministic matcher resolved before us, if anything.
   * ALFRED uses this as a strong prior — we don't want to override a
   * solid `email` match with a low-confidence guess.
   */
  deterministicMatch: {
    contactId: string | null
    matchMethod: "email" | "name_phone" | "name" | null
  }
}

export interface AlfredCalendlyTriageResult {
  outcome:
    | "tagged"
    | "tagged_review"
    | "no_match"
    | "skipped_existing"
    | "error"
  contactId: string | null
  organizationId: string | null
  workItemId: string | null
  serviceId: string | null
  confidence: number | null
  reason: string | null
}

const AUTO_ACCEPT_THRESHOLD = 0.85
const REVIEW_FLOOR = 0.5
const SHORTLIST_LIMIT = 8 // per category

// ─── Entry point ─────────────────────────────────────────────────────

export async function runAlfredCalendlyTriage(
  supabase: SupabaseClient,
  input: AlfredCalendlyTriageInput,
): Promise<AlfredCalendlyTriageResult> {
  const startedAt = Date.now()
  let usage: { promptTokens?: number; completionTokens?: number } = {}
  let modelOutput: unknown = null
  let candidates: ShortlistedCandidates = emptyShortlist()

  try {
    // 1. Build the candidate shortlists. Each query is index-friendly
    //    and small (≤8 rows) — collectively well under one round-trip
    //    budget. Run them in parallel.
    candidates = await buildCandidateShortlist(supabase, input)

    // Fast-path: if the deterministic matcher already resolved a
    // contact AND there is nothing else for ALFRED to consider
    // (no orgs, work items, or services on the shortlist), skip the
    // model call entirely. This is the common case and saves us a
    // model token + ~1s of latency on every webhook.
    if (
      input.deterministicMatch.contactId &&
      candidates.organizations.length === 0 &&
      candidates.workItems.length === 0 &&
      candidates.services.length === 0
    ) {
      const result: AlfredCalendlyTriageResult = {
        outcome: "skipped_existing",
        contactId: input.deterministicMatch.contactId,
        organizationId: null,
        workItemId: null,
        serviceId: null,
        confidence: null,
        reason: "Deterministic match present; no extra candidates to consider.",
      }
      await writeTriageLog(supabase, input, result, candidates, null, null, Date.now() - startedAt)
      return result
    }

    // 2. Ask the model to pick from the shortlist.
    const decision = await askModel(input, candidates)
    modelOutput = decision
    usage = decision._usage ?? {}

    // 3. Translate the model's decision into a result + side effects.
    const result = await applyDecision(supabase, input, candidates, decision)

    await writeTriageLog(
      supabase,
      input,
      result,
      candidates,
      modelOutput,
      null,
      Date.now() - startedAt,
      usage,
    )
    return result
  } catch (err) {
    console.error("[alfred-calendly-triage] failed:", err)
    const result: AlfredCalendlyTriageResult = {
      outcome: "error",
      contactId: input.deterministicMatch.contactId,
      organizationId: null,
      workItemId: null,
      serviceId: null,
      confidence: null,
      reason: null,
    }
    await writeTriageLog(
      supabase,
      input,
      result,
      candidates,
      modelOutput,
      err instanceof Error ? err.message : String(err),
      Date.now() - startedAt,
      usage,
    ).catch(() => {})
    return result
  }
}

// ─── Candidate shortlisting ──────────────────────────────────────────

interface ContactCandidate {
  id: string
  full_name: string | null
  primary_email: string | null
  secondary_email: string | null
  phone_primary: string | null
  organization_id: string | null
  organization_name: string | null
  match_signal: string
}

interface OrganizationCandidate {
  id: string
  name: string | null
  primary_email: string | null
  match_signal: string
}

interface WorkItemCandidate {
  id: string
  title: string | null
  client_name: string | null
  contact_id: string | null
  organization_id: string | null
  match_signal: string
}

interface ServiceCandidate {
  id: string
  name: string | null
  match_signal: string
}

interface ShortlistedCandidates {
  contacts: ContactCandidate[]
  organizations: OrganizationCandidate[]
  workItems: WorkItemCandidate[]
  services: ServiceCandidate[]
}

function emptyShortlist(): ShortlistedCandidates {
  return { contacts: [], organizations: [], workItems: [], services: [] }
}

async function buildCandidateShortlist(
  supabase: SupabaseClient,
  input: AlfredCalendlyTriageInput,
): Promise<ShortlistedCandidates> {
  const email = input.invitee.email?.trim().toLowerCase() || null
  const emailDomain = email?.split("@")[1] || null
  const phoneTail = lastTen(normalizeDigits(input.invitee.phone))
  const split = splitName(input.invitee.name)
  const qaText = (input.invitee.questionsAndAnswers ?? [])
    .map((qa) => `${qa.question}: ${qa.answer}`)
    .join(" | ")
    .toLowerCase()
  const eventTokens = tokenize(`${input.eventName ?? ""} ${input.eventTypeName ?? ""} ${qaText}`)

  // 1. Contact candidates: include the deterministic match (if any),
  //    plus fuzzy matches by name/email/phone.
  const [
    contactsByEmail,
    contactsByName,
    contactsByPhone,
    deterministicContact,
  ] = await Promise.all([
    email
      ? supabase
          .from("contacts")
          .select(
            "id, full_name, primary_email, secondary_email, phone_primary, organization_id",
          )
          .or(`primary_email.ilike.${email},secondary_email.ilike.${email}`)
          .limit(SHORTLIST_LIMIT)
      : Promise.resolve({ data: [] as any[] }),

    split
      ? supabase
          .from("contacts")
          .select(
            "id, full_name, primary_email, secondary_email, phone_primary, organization_id",
          )
          .ilike("first_name", split.first)
          .ilike("last_name", split.last)
          .limit(SHORTLIST_LIMIT)
      : Promise.resolve({ data: [] as any[] }),

    phoneTail
      ? supabase
          .from("contacts")
          .select(
            "id, full_name, primary_email, secondary_email, phone_primary, organization_id, phone_mobile, phone_work",
          )
          .or(
            // Best-effort phone match: equality or ilike on the tail.
            // PostgREST doesn't expose regex on phone fields, but the
            // ilike against `%<tail>` catches normalized variants.
            `phone_primary.ilike.%${phoneTail},phone_mobile.ilike.%${phoneTail},phone_work.ilike.%${phoneTail}`,
          )
          .limit(SHORTLIST_LIMIT)
      : Promise.resolve({ data: [] as any[] }),

    input.deterministicMatch.contactId
      ? supabase
          .from("contacts")
          .select(
            "id, full_name, primary_email, secondary_email, phone_primary, organization_id",
          )
          .eq("id", input.deterministicMatch.contactId)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ])

  const contactMap = new Map<string, ContactCandidate>()
  const pushContact = (row: any, signal: string) => {
    if (!row?.id) return
    const existing = contactMap.get(row.id)
    if (existing) {
      existing.match_signal = `${existing.match_signal}, ${signal}`
      return
    }
    contactMap.set(row.id, {
      id: row.id,
      full_name: row.full_name ?? null,
      primary_email: row.primary_email ?? null,
      secondary_email: row.secondary_email ?? null,
      phone_primary: row.phone_primary ?? null,
      organization_id: row.organization_id ?? null,
      organization_name: null,
      match_signal: signal,
    })
  }
  for (const r of contactsByEmail.data ?? []) pushContact(r, "email")
  for (const r of contactsByName.data ?? []) pushContact(r, "name")
  for (const r of contactsByPhone.data ?? []) pushContact(r, "phone")
  if (deterministicContact.data)
    pushContact(deterministicContact.data, `deterministic:${input.deterministicMatch.matchMethod ?? "?"}`)

  // 2. Organization candidates: by email domain, by Q&A token match,
  //    plus the parent orgs of any contact candidates we just found.
  const orgMap = new Map<string, OrganizationCandidate>()
  const pushOrg = (row: any, signal: string) => {
    if (!row?.id) return
    const existing = orgMap.get(row.id)
    if (existing) {
      existing.match_signal = `${existing.match_signal}, ${signal}`
      return
    }
    orgMap.set(row.id, {
      id: row.id,
      name: row.name ?? null,
      primary_email: row.primary_email ?? null,
      match_signal: signal,
    })
  }

  const orgQueries: Array<PromiseLike<any>> = []
  if (emailDomain) {
    // Organizations don't store an `email_domain` column — match by
    // suffix on `primary_email` instead. Indexed via trigram in
    // production; falls back to seq-scan but the table is small.
    orgQueries.push(
      supabase
        .from("organizations")
        .select("id, name, primary_email")
        .ilike("primary_email", `%@${emailDomain}`)
        .limit(SHORTLIST_LIMIT),
    )
  }
  // Token-based fuzzy lookup on org name. Use the first 2 distinctive
  // tokens to avoid spamming `or()` clauses.
  const orgTokens = eventTokens
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t))
    .slice(0, 3)
  for (const t of orgTokens) {
    orgQueries.push(
      supabase
        .from("organizations")
        .select("id, name, primary_email")
        .ilike("name", `%${t}%`)
        .limit(SHORTLIST_LIMIT),
    )
  }
  // Parent orgs of contact candidates.
  const contactOrgIds = [...contactMap.values()]
    .map((c) => c.organization_id)
    .filter((x): x is string => !!x)
  if (contactOrgIds.length > 0) {
    orgQueries.push(
      supabase
        .from("organizations")
        .select("id, name, primary_email")
        .in("id", contactOrgIds),
    )
  }
  const orgResults = await Promise.all(orgQueries)
  if (emailDomain) {
    for (const r of orgResults[0]?.data ?? []) pushOrg(r, `domain:${emailDomain}`)
  }
  let cursor = emailDomain ? 1 : 0
  for (const t of orgTokens) {
    for (const r of orgResults[cursor]?.data ?? []) pushOrg(r, `name:${t}`)
    cursor++
  }
  if (contactOrgIds.length > 0) {
    for (const r of orgResults[cursor]?.data ?? []) pushOrg(r, "parent_of_contact")
  }

  // Hydrate contact candidates with organization names where possible.
  for (const c of contactMap.values()) {
    if (c.organization_id && orgMap.has(c.organization_id)) {
      c.organization_name = orgMap.get(c.organization_id)!.name
    }
  }

  // 3. Work item candidates: any non-archived work item belonging to a
  //    candidate contact / organization. We don't try to match by Q&A
  //    text alone — too noisy. Caps at SHORTLIST_LIMIT.
  let workItems: WorkItemCandidate[] = []
  const wiClientIds = [
    ...new Set([
      ...[...contactMap.values()].map((c) => c.id),
      ...[...orgMap.values()].map((o) => o.id),
    ]),
  ]
  if (wiClientIds.length > 0) {
    const { data: wis } = await supabase
      .from("work_items")
      .select("id, title, client_name, contact_id, organization_id, status, deleted_in_karbon_at")
      .or(
        [
          `contact_id.in.(${[...contactMap.keys()].map(quoteUuid).join(",")})`,
          `organization_id.in.(${[...orgMap.keys()].map(quoteUuid).join(",")})`,
        ]
          .filter((c) => !c.includes("()"))
          .join(","),
      )
      .is("deleted_in_karbon_at", null)
      .order("updated_at", { ascending: false })
      .limit(SHORTLIST_LIMIT)
    workItems = (wis ?? []).map((w: any) => ({
      id: w.id,
      title: w.title,
      client_name: w.client_name,
      contact_id: w.contact_id,
      organization_id: w.organization_id,
      match_signal: "client_match",
    }))
  }

  // 4. Service candidates: token match on service name. The services
  //    table uses `state='active'` (not is_active). When the catalog
  //    is small we just send all active services.
  const { count: serviceCount } = await supabase
    .from("services")
    .select("*", { count: "exact", head: true })
    .eq("state", "active")
  let services: ServiceCandidate[] = []
  if ((serviceCount ?? 0) <= 8) {
    const { data: all } = await supabase
      .from("services")
      .select("id, name")
      .eq("state", "active")
      .limit(SHORTLIST_LIMIT)
    services = (all ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      match_signal: "active_service",
    }))
  } else {
    const tokenFilters = orgTokens.map((t) => `name.ilike.%${t}%`).join(",")
    if (tokenFilters) {
      const { data: matched } = await supabase
        .from("services")
        .select("id, name")
        .eq("state", "active")
        .or(tokenFilters)
        .limit(SHORTLIST_LIMIT)
      services = (matched ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        match_signal: "name_token",
      }))
    }
  }

  return {
    contacts: [...contactMap.values()].slice(0, SHORTLIST_LIMIT),
    organizations: [...orgMap.values()].slice(0, SHORTLIST_LIMIT),
    workItems,
    services,
  }
}

// ─── Model call ─���────────────────────────────────────────────────────

const decisionSchema = z.object({
  contact_id: z
    .string()
    .nullable()
    .describe("UUID of the chosen contact, or null if none of the candidates is the right person."),
  organization_id: z
    .string()
    .nullable()
    .describe("UUID of the chosen organization, or null."),
  work_item_id: z
    .string()
    .nullable()
    .describe("UUID of the chosen work item, or null."),
  service_id: z.string().nullable().describe("UUID of the chosen service, or null."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Self-reported overall confidence 0..1 across all chosen IDs."),
  reason: z.string().describe("One short sentence explaining the picks."),
})

interface DecisionWithUsage extends z.infer<typeof decisionSchema> {
  _usage?: { promptTokens?: number; completionTokens?: number }
}

async function askModel(
  input: AlfredCalendlyTriageInput,
  candidates: ShortlistedCandidates,
): Promise<DecisionWithUsage> {
  const system = `You are ALFRED, the assistant that classifies inbound Calendly meetings for Motta Financial.

Your job: choose at most one contact, one organization, one work item, and one service from the shortlist below. Return only IDs that appear in the shortlist; never invent IDs. If none of the candidates is a confident match for a category, return null for that category.

Rules:
- Prefer email match over name match. A booking-form email exactly matching contacts.primary_email/secondary_email is ground truth.
- Only return an organization_id when the email domain or booking form clearly references that organization. Personal-domain bookings (gmail/yahoo/outlook) almost never warrant an org tag unless Q&A explicitly names one.
- Only return a work_item_id when the booking notes/Q&A reference a specific project, return year, or filing — not just because a client has work items.
- Only return a service_id when the event type name plus Q&A clearly imply one of the listed services.
- Confidence is your overall confidence across the four picks. Use ~0.95+ for email matches, ~0.7 for strong name+phone, ~0.5 when you're guessing from one signal.`

  const userPayload = {
    invitee: {
      name: input.invitee.name,
      email: input.invitee.email,
      phone: input.invitee.phone,
      questions_and_answers: input.invitee.questionsAndAnswers,
    },
    event: {
      name: input.eventName,
      type: input.eventTypeName,
      start_time: input.startTime,
    },
    deterministic_match: input.deterministicMatch,
    candidates: {
      contacts: candidates.contacts,
      organizations: candidates.organizations,
      work_items: candidates.workItems,
      services: candidates.services,
    },
  }

  const { object, usage } = await generateObject({
    model: ALFRED_CHAT_MODEL,
    system,
    schema: decisionSchema,
    prompt: `Classify this Calendly meeting:\n\n${JSON.stringify(userPayload, null, 2)}`,
    temperature: 0,
  })

  // Token usage is captured by writeTriageLog() into
  // calendly_alfred_triage_log; we don't double-log here because the
  // shared `ai_usage_log` table is keyed on a fixed AIUseCase enum and
  // we deliberately keep this audit on the dedicated table instead.

  // Validate IDs are in shortlist (defense-in-depth — generateObject
  // already constrains structure, but the model could echo a bogus
  // string).
  const safeId = (id: string | null, allowed: string[]) =>
    id && allowed.includes(id) ? id : null
  const decision: DecisionWithUsage = {
    contact_id: safeId(object.contact_id, candidates.contacts.map((c) => c.id)),
    organization_id: safeId(object.organization_id, candidates.organizations.map((o) => o.id)),
    work_item_id: safeId(object.work_item_id, candidates.workItems.map((w) => w.id)),
    service_id: safeId(object.service_id, candidates.services.map((s) => s.id)),
    confidence: clamp01(object.confidence),
    reason: object.reason ?? "",
    _usage: {
      promptTokens: usage?.inputTokens,
      completionTokens: usage?.outputTokens,
    },
  }
  return decision
}

// ─── Decision → side effects ─────────────────────────────────────────

async function applyDecision(
  supabase: SupabaseClient,
  input: AlfredCalendlyTriageInput,
  candidates: ShortlistedCandidates,
  decision: DecisionWithUsage,
): Promise<AlfredCalendlyTriageResult> {
  const anyChoice =
    decision.contact_id ||
    decision.organization_id ||
    decision.work_item_id ||
    decision.service_id

  if (!anyChoice) {
    return {
      outcome: "no_match",
      contactId: input.deterministicMatch.contactId,
      organizationId: null,
      workItemId: null,
      serviceId: null,
      confidence: decision.confidence,
      reason: decision.reason,
    }
  }

  if (decision.confidence < REVIEW_FLOOR) {
    return {
      outcome: "no_match",
      contactId: input.deterministicMatch.contactId,
      organizationId: null,
      workItemId: null,
      serviceId: null,
      confidence: decision.confidence,
      reason: decision.reason,
    }
  }

  const needsReview = decision.confidence < AUTO_ACCEPT_THRESHOLD

  // Each insert is wrapped to swallow uniqueness violations — the
  // existing partial-unique indexes on (event, contact_id),
  // (event, organization_id), (event, work_item_id), (event, service_id)
  // mean re-runs are idempotent.
  const tasks: Promise<void>[] = []

  // 1. Contact tag — only insert if a row doesn't already exist for
  //    this contact (deterministic matcher may have written it).
  if (decision.contact_id) {
    tasks.push(
      insertOrUpdateClientTag(supabase, {
        eventId: input.calendlyEventId,
        contactId: decision.contact_id,
        organizationId: null,
        confidence: decision.confidence,
        reason: decision.reason,
        needsReview,
      }),
    )
  }
  if (decision.organization_id) {
    tasks.push(
      insertOrUpdateClientTag(supabase, {
        eventId: input.calendlyEventId,
        contactId: null,
        organizationId: decision.organization_id,
        confidence: decision.confidence,
        reason: decision.reason,
        needsReview,
      }),
    )
  }

  if (decision.work_item_id) {
    tasks.push(
      insertSimpleTag(supabase, "calendly_event_work_items", {
        calendly_event_id: input.calendlyEventId,
        work_item_id: decision.work_item_id,
        link_source: "alfred",
        confidence: decision.confidence,
        alfred_reason: decision.reason,
        needs_review: needsReview,
      }),
    )
  }
  if (decision.service_id) {
    tasks.push(
      insertSimpleTag(supabase, "calendly_event_services", {
        calendly_event_id: input.calendlyEventId,
        service_id: decision.service_id,
        link_source: "alfred",
        confidence: decision.confidence,
        alfred_reason: decision.reason,
        needs_review: needsReview,
      }),
    )
  }

  await Promise.all(tasks)

  return {
    outcome: needsReview ? "tagged_review" : "tagged",
    contactId: decision.contact_id ?? input.deterministicMatch.contactId,
    organizationId: decision.organization_id,
    workItemId: decision.work_item_id,
    serviceId: decision.service_id,
    confidence: decision.confidence,
    reason: decision.reason,
  }
}

async function insertOrUpdateClientTag(
  supabase: SupabaseClient,
  params: {
    eventId: string
    contactId: string | null
    organizationId: string | null
    confidence: number
    reason: string
    needsReview: boolean
  },
): Promise<void> {
  // If a tag already exists from the deterministic matcher (link_source='auto'),
  // upgrade it in place to add ALFRED's confidence/reason but keep the
  // stronger 'auto' source — auto-from-email is more trustworthy than
  // any model output.
  const filter = supabase
    .from("calendly_event_clients")
    .select("id, link_source")
    .eq("calendly_event_id", params.eventId)

  const existingQ = params.contactId
    ? filter.eq("contact_id", params.contactId)
    : filter.eq("organization_id", params.organizationId!)
  const { data: existing } = await existingQ.maybeSingle()

  if (existing) {
    // Don't downgrade an 'auto' or 'manual' tag to 'alfred'.
    if (existing.link_source === "auto" || existing.link_source === "manual") {
      // Still record ALFRED's reasoning for transparency.
      await supabase
        .from("calendly_event_clients")
        .update({
          alfred_reason: params.reason,
          confidence: params.confidence,
        })
        .eq("id", existing.id)
      return
    }
    // ALFRED is replacing its own previous tag — bump confidence/reason.
    await supabase
      .from("calendly_event_clients")
      .update({
        link_source: "alfred",
        match_method: "alfred",
        confidence: params.confidence,
        alfred_reason: params.reason,
        needs_review: params.needsReview,
      })
      .eq("id", existing.id)
    return
  }

  const { error } = await supabase.from("calendly_event_clients").insert({
    calendly_event_id: params.eventId,
    contact_id: params.contactId,
    organization_id: params.organizationId,
    link_source: "alfred",
    match_method: "alfred",
    confidence: params.confidence,
    alfred_reason: params.reason,
    needs_review: params.needsReview,
  })
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[alfred-calendly-triage] client tag insert warning:", error.message)
  }
}

async function insertSimpleTag(
  supabase: SupabaseClient,
  table: "calendly_event_work_items" | "calendly_event_services",
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from(table).insert(row)
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn(`[alfred-calendly-triage] ${table} insert warning:`, error.message)
  }
}

// ─── Audit log ──────────────────────────────────────────────────────

async function writeTriageLog(
  supabase: SupabaseClient,
  input: AlfredCalendlyTriageInput,
  result: AlfredCalendlyTriageResult,
  candidates: ShortlistedCandidates,
  rawModelOutput: unknown,
  errorMessage: string | null,
  durationMs: number,
  usage: { promptTokens?: number; completionTokens?: number } = {},
): Promise<void> {
  const { error } = await supabase.from("calendly_alfred_triage_log").insert({
    calendly_event_id: input.calendlyEventId,
    calendly_invitee_uuid: input.calendlyInviteeUuid,
    invitee_name: input.invitee.name,
    invitee_email: input.invitee.email,
    invitee_phone: input.invitee.phone,
    questions_and_answers: input.invitee.questionsAndAnswers ?? null,
    event_name: input.eventName,
    outcome: result.outcome,
    resolved_contact_id: result.contactId,
    resolved_organization_id: result.organizationId,
    resolved_work_item_id: result.workItemId,
    resolved_service_id: result.serviceId,
    confidence: result.confidence,
    reason: result.reason,
    candidates_considered: candidates,
    raw_model_output: rawModelOutput,
    model_id: ALFRED_CHAT_MODEL,
    prompt_tokens: usage.promptTokens ?? null,
    completion_tokens: usage.completionTokens ?? null,
    duration_ms: durationMs,
    error_message: errorMessage,
  })
  if (error) {
    console.warn("[alfred-calendly-triage] audit log insert failed:", error.message)
  }
}

// ─── Tiny utilities ─────────────────────────────────────────────────

function normalizeDigits(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.replace(/\D+/g, "")
}
function lastTen(digits: string): string {
  return digits.length > 10 ? digits.slice(-10) : digits
}
function splitName(name: string | null | undefined): { first: string; last: string } | null {
  if (!name) return null
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return { first: parts[0]!, last: parts[parts.length - 1]! }
}
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}
function quoteUuid(id: string): string {
  // PostgREST .or() with .in() needs unquoted UUIDs. They're safe (UUID
  // chars only), but we still validate to fail loudly on tampering.
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error(`bad uuid: ${id}`)
  return id
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "have",
  "about",
  "would",
  "could",
  "should",
  "into",
  "over",
  "meeting",
  "call",
  "discussion",
  "intro",
  "introduction",
  "consultation",
  "follow",
  "followup",
  "tax",
  "return",
  "review",
  "session",
  "phone",
  "email",
])
