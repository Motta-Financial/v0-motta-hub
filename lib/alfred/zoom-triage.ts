/**
 * ALFRED Zoom meeting triage.
 *
 * This is the Zoom-side counterpart to `lib/alfred/calendly-triage.ts`.
 * It runs AFTER:
 *
 *   1. The deterministic Calendly bridge (`lib/zoom/bridge-to-calendly.ts`)
 *      has had a chance to copy tags from a matching Calendly event.
 *   2. The participant sweep (`lib/zoom/process-meeting-participants.ts`)
 *      has had a chance to auto-tag any external attendees as
 *      `link_source='auto'`.
 *
 * ALFRED's job is to fill in what those layers couldn't:
 *
 *   • Confirm or upgrade ambiguous participant matches (e.g. two
 *     Hub contacts named "John Smith" — pick the one whose org
 *     matches the host's Karbon book).
 *   • Add a Karbon work_item tag when the meeting topic / agenda
 *     references a specific project, return year, or filing.
 *   • Surface organizations referenced by topic/agenda that don't
 *     have a participant on the call (e.g. internal Motta call about
 *     Acme's books — no one from Acme is in the room).
 *
 * Constraints that mirror the Calendly triage:
 *
 *   • Pre-fetch a SHORTLIST of plausible candidates by
 *     participant-email domain, fuzzy contact name, topic tokens, and
 *     the host's existing book of work-items. The model can only
 *     choose IDs from that shortlist — no UUID hallucination.
 *   • `generateObject` with a strict zod schema gates structural
 *     validity before any DB write.
 *   • Confidence policy:
 *       ≥ 0.85 → tag automatically (link_source='alfred', needs_review=false)
 *       0.50–0.85 → tag with needs_review=true (UI shows yellow chip)
 *       < 0.50 → don't tag; outcome='no_match'
 *   • Every invocation produces exactly one `zoom_alfred_triage_log`
 *     row regardless of outcome — model failures must never break the
 *     parent sync.
 *
 * Unlike the Calendly side, we allow MULTIPLE contacts per meeting
 * (small group calls are common) and MULTIPLE work items (a single
 * Zoom meeting often spans two clients' returns). We cap each at 3.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { generateObject } from "ai"
import { z } from "zod"
import { ALFRED_CHAT_MODEL } from "@/lib/ai/models"

// ─── Public surface ──────────────────────────────────────────────────

export interface AlfredZoomTriageInput {
  zoomMeetingId: string // PK of zoom_meetings
  zoomMeetingNumericId: string | number | null
  topic: string | null
  agenda: string | null
  startTime: string | null
  hostEmail: string | null
  hostTeamMemberId: string | null
  /** External (non-internal) participants the participant sweep
   *  surfaced. Already de-duplicated and excluding teammates. */
  participants: Array<{
    name: string | null
    email: string | null
    /** Whether the deterministic step matched this participant to a
     *  Hub contact already. ALFRED uses these as priors. */
    matched_contact_id: string | null
  }>
  /** Whether the bridge resolved a Calendly source — when true, we
   *  almost always skip ALFRED because tags were copied verbatim. */
  bridgedFromCalendlyEventId: string | null
}

export interface AlfredZoomTriageResult {
  outcome:
    | "tagged"
    | "tagged_review"
    | "no_match"
    | "skipped_existing"
    | "skipped_bridged"
    | "error"
  contactIds: string[]
  organizationIds: string[]
  workItemIds: string[]
  confidence: number | null
  reason: string | null
}

const AUTO_ACCEPT_THRESHOLD = 0.85
const REVIEW_FLOOR = 0.5
const SHORTLIST_LIMIT = 8
const MAX_PER_CATEGORY = 3

// ─── Entry point ─────────────────────────────────────────────────────

export async function runAlfredZoomTriage(
  supabase: SupabaseClient,
  input: AlfredZoomTriageInput,
): Promise<AlfredZoomTriageResult> {
  const startedAt = Date.now()
  let usage: { promptTokens?: number; completionTokens?: number } = {}
  let modelOutput: unknown = null
  let candidates: ShortlistedCandidates = emptyShortlist()

  try {
    // Skip if the Calendly bridge already populated tags AND the
    // meeting has at least one client + one work-item already. The
    // bridge is higher-trust than ALFRED — don't second-guess it.
    if (input.bridgedFromCalendlyEventId) {
      const tagState = await getCurrentTagState(supabase, input.zoomMeetingId)
      if (tagState.hasClient && tagState.hasWorkItem) {
        const result: AlfredZoomTriageResult = {
          outcome: "skipped_bridged",
          contactIds: [],
          organizationIds: [],
          workItemIds: [],
          confidence: null,
          reason: "Calendly bridge already populated client + work-item tags.",
        }
        await writeTriageLog(
          supabase,
          input,
          result,
          candidates,
          null,
          null,
          Date.now() - startedAt,
        )
        return result
      }
    }

    candidates = await buildCandidateShortlist(supabase, input)

    // Fast-path: no candidates ⇒ no model call.
    if (
      candidates.contacts.length === 0 &&
      candidates.organizations.length === 0 &&
      candidates.workItems.length === 0
    ) {
      const result: AlfredZoomTriageResult = {
        outcome: "no_match",
        contactIds: [],
        organizationIds: [],
        workItemIds: [],
        confidence: null,
        reason: "No plausible candidates within Hub.",
      }
      await writeTriageLog(supabase, input, result, candidates, null, null, Date.now() - startedAt)
      return result
    }

    // Fast-path #2: deterministic participant matches already cover
    // the room AND there are no work-item candidates worth trying.
    // Skip the model — saves tokens and latency.
    const participantContactIds = input.participants
      .map((p) => p.matched_contact_id)
      .filter((x): x is string => !!x)
    if (
      participantContactIds.length > 0 &&
      candidates.workItems.length === 0 &&
      candidates.organizations.length === 0
    ) {
      const result: AlfredZoomTriageResult = {
        outcome: "skipped_existing",
        contactIds: participantContactIds.slice(0, MAX_PER_CATEGORY),
        organizationIds: [],
        workItemIds: [],
        confidence: null,
        reason:
          "Deterministic participant matches cover the room; no work-item or org candidates worth tagging.",
      }
      await writeTriageLog(supabase, input, result, candidates, null, null, Date.now() - startedAt)
      return result
    }

    const decision = await askModel(input, candidates)
    modelOutput = decision
    usage = decision._usage ?? {}

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

    // Persist the triage timestamp so the sweep can skip already-seen meetings.
    await supabase
      .from("zoom_meetings")
      .update({ alfred_triage_at: new Date().toISOString() })
      .eq("id", input.zoomMeetingId)

    return result
  } catch (err) {
    console.error("[v0] [alfred-zoom-triage] failed:", err)
    const result: AlfredZoomTriageResult = {
      outcome: "error",
      contactIds: [],
      organizationIds: [],
      workItemIds: [],
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

// ─── Tag-state probe ─────────────────────────────────────────────────

async function getCurrentTagState(
  supabase: SupabaseClient,
  zoomMeetingId: string,
): Promise<{ hasClient: boolean; hasWorkItem: boolean }> {
  const [{ count: clientCount }, { count: wiCount }] = await Promise.all([
    supabase
      .from("zoom_meeting_clients")
      .select("*", { count: "exact", head: true })
      .eq("zoom_meeting_id", zoomMeetingId),
    supabase
      .from("zoom_meeting_work_items")
      .select("*", { count: "exact", head: true })
      .eq("zoom_meeting_id", zoomMeetingId),
  ])
  return {
    hasClient: (clientCount ?? 0) > 0,
    hasWorkItem: (wiCount ?? 0) > 0,
  }
}

// ─── Candidate shortlisting ──────────────────────────────────────────

interface ContactCandidate {
  id: string
  full_name: string | null
  primary_email: string | null
  organization_id: string | null
  organization_name: string | null
  match_signal: string
}

interface OrganizationCandidate {
  id: string
  name: string | null
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

interface ShortlistedCandidates {
  contacts: ContactCandidate[]
  organizations: OrganizationCandidate[]
  workItems: WorkItemCandidate[]
}

function emptyShortlist(): ShortlistedCandidates {
  return { contacts: [], organizations: [], workItems: [] }
}

async function buildCandidateShortlist(
  supabase: SupabaseClient,
  input: AlfredZoomTriageInput,
): Promise<ShortlistedCandidates> {
  // Inputs distilled to lookup signals.
  const externalEmails = input.participants
    .map((p) => p.email?.trim().toLowerCase())
    .filter((x): x is string => !!x)
  const externalDomains = [
    ...new Set(externalEmails.map((e) => e.split("@")[1]).filter(Boolean)),
  ]
  const externalNames = input.participants
    .map((p) => p.name?.trim())
    .filter((x): x is string => !!x)
  const priorContactIds = input.participants
    .map((p) => p.matched_contact_id)
    .filter((x): x is string => !!x)
  const topicTokens = tokenize(`${input.topic ?? ""} ${input.agenda ?? ""}`).filter(
    (t) => t.length >= 4 && !STOP_WORDS.has(t),
  )

  // 1. Contacts: priors + email-domain + fuzzy name.
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
      organization_id: row.organization_id ?? null,
      organization_name: null,
      match_signal: signal,
    })
  }

  if (priorContactIds.length > 0) {
    const { data: priorRows } = await supabase
      .from("contacts")
      .select("id, full_name, primary_email, organization_id")
      .in("id", priorContactIds)
    for (const r of priorRows ?? []) pushContact(r, "participant")
  }

  if (externalEmails.length > 0) {
    // Match on either primary or secondary email.
    const orFilter = externalEmails
      .slice(0, 8)
      .flatMap((e) => [`primary_email.ilike.${e}`, `secondary_email.ilike.${e}`])
      .join(",")
    const { data: byEmail } = await supabase
      .from("contacts")
      .select("id, full_name, primary_email, organization_id")
      .or(orFilter)
      .limit(SHORTLIST_LIMIT)
    for (const r of byEmail ?? []) pushContact(r, "email")
  }

  for (const name of externalNames.slice(0, 4)) {
    const split = splitName(name)
    if (!split) continue
    const { data: byName } = await supabase
      .from("contacts")
      .select("id, full_name, primary_email, organization_id")
      .ilike("first_name", split.first)
      .ilike("last_name", split.last)
      .limit(4)
    for (const r of byName ?? []) pushContact(r, "name")
  }

  // 2. Organizations: by external email domain + topic tokens +
  //    parent orgs of contact candidates.
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
      match_signal: signal,
    })
  }

  for (const domain of externalDomains.slice(0, 5)) {
    if (isPersonalDomain(domain)) continue
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .ilike("primary_email", `%@${domain}`)
      .limit(SHORTLIST_LIMIT)
    for (const r of data ?? []) pushOrg(r, `domain:${domain}`)
  }

  for (const t of topicTokens.slice(0, 3)) {
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .ilike("name", `%${t}%`)
      .limit(SHORTLIST_LIMIT)
    for (const r of data ?? []) pushOrg(r, `topic:${t}`)
  }

  const contactOrgIds = [...contactMap.values()]
    .map((c) => c.organization_id)
    .filter((x): x is string => !!x)
  if (contactOrgIds.length > 0) {
    const { data } = await supabase
      .from("organizations")
      .select("id, name")
      .in("id", contactOrgIds)
    for (const r of data ?? []) pushOrg(r, "parent_of_contact")
  }

  // Hydrate contact org names where possible.
  for (const c of contactMap.values()) {
    if (c.organization_id && orgMap.has(c.organization_id)) {
      c.organization_name = orgMap.get(c.organization_id)!.name
    }
  }

  // 3. Work items: open work-items for any candidate contact / org.
  let workItems: WorkItemCandidate[] = []
  const wiContactIds = [...contactMap.keys()]
  const wiOrgIds = [...orgMap.keys()]
  if (wiContactIds.length > 0 || wiOrgIds.length > 0) {
    const orParts: string[] = []
    if (wiContactIds.length > 0) {
      orParts.push(`contact_id.in.(${wiContactIds.map(quoteUuid).join(",")})`)
    }
    if (wiOrgIds.length > 0) {
      orParts.push(`organization_id.in.(${wiOrgIds.map(quoteUuid).join(",")})`)
    }
    if (orParts.length > 0) {
      const { data: wis } = await supabase
        .from("work_items")
        .select("id, title, client_name, contact_id, organization_id, status, deleted_in_karbon_at, updated_at")
        .or(orParts.join(","))
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
  }

  return {
    contacts: [...contactMap.values()].slice(0, SHORTLIST_LIMIT),
    organizations: [...orgMap.values()].slice(0, SHORTLIST_LIMIT),
    workItems,
  }
}

// ─── Model call ──────────────────────────────────────────────────────

const decisionSchema = z.object({
  contact_ids: z
    .array(z.string())
    .max(MAX_PER_CATEGORY)
    .describe("UUIDs of confirmed contacts on the call. Empty array if none of the candidates match."),
  organization_ids: z
    .array(z.string())
    .max(MAX_PER_CATEGORY)
    .describe("UUIDs of organizations the meeting is about. Empty array if none."),
  work_item_ids: z
    .array(z.string())
    .max(MAX_PER_CATEGORY)
    .describe("UUIDs of Karbon work items the meeting is about. Empty array if none."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Self-reported overall confidence 0..1 across all picks."),
  reason: z.string().describe("One short sentence explaining the picks."),
})

interface DecisionWithUsage extends z.infer<typeof decisionSchema> {
  _usage?: { promptTokens?: number; completionTokens?: number }
}

async function askModel(
  input: AlfredZoomTriageInput,
  candidates: ShortlistedCandidates,
): Promise<DecisionWithUsage> {
  const system = `You are ALFRED, the assistant that classifies Zoom meetings for Motta Financial.

Your job: choose contacts (people who attended), organizations (the firm or clients the meeting is about), and Karbon work items (the specific projects/returns/filings the meeting is about) from the shortlist below. Return only IDs that appear in the shortlist; never invent IDs.

Rules:
- A participant whose email exactly matches contacts.primary_email/secondary_email is a confirmed contact_id pick. The shortlist marks these with match_signal containing "email".
- Only return an organization_id when the participant email domain or the topic/agenda clearly references that organization. Personal-domain participants (gmail/yahoo/outlook) almost never warrant an org tag unless the topic explicitly names one.
- Only return a work_item_id when the topic/agenda references a specific project, return year, or filing — not just because a client has open work items. If the topic is generic ("intro call", "monthly check-in") return no work item.
- It is normal for a Zoom meeting to have multiple contacts (group call). It is uncommon for a meeting to have multiple organizations or multiple work items at once — only pick more than one if the topic explicitly references both.
- Confidence is your overall confidence across ALL picks. Use ~0.95+ when you have email + topic agreement, ~0.7 for strong name match plus org match, ~0.5 when you're guessing from one signal. If your confidence is below 0.5, return empty arrays.`

  const userPayload = {
    meeting: {
      topic: input.topic,
      agenda: input.agenda,
      start_time: input.startTime,
      host_email: input.hostEmail,
    },
    external_participants: input.participants.map((p) => ({
      name: p.name,
      email: p.email,
      already_matched_contact_id: p.matched_contact_id,
    })),
    candidates: {
      contacts: candidates.contacts,
      organizations: candidates.organizations,
      work_items: candidates.workItems,
    },
  }

  const { object, usage } = await generateObject({
    model: ALFRED_CHAT_MODEL,
    system,
    schema: decisionSchema,
    prompt: `Classify this Zoom meeting:\n\n${JSON.stringify(userPayload, null, 2)}`,
    temperature: 0,
  })

  const allowedContact = new Set(candidates.contacts.map((c) => c.id))
  const allowedOrg = new Set(candidates.organizations.map((o) => o.id))
  const allowedWi = new Set(candidates.workItems.map((w) => w.id))
  const filterIds = (arr: string[], allow: Set<string>) =>
    arr.filter((id) => allow.has(id)).slice(0, MAX_PER_CATEGORY)

  const decision: DecisionWithUsage = {
    contact_ids: filterIds(object.contact_ids ?? [], allowedContact),
    organization_ids: filterIds(object.organization_ids ?? [], allowedOrg),
    work_item_ids: filterIds(object.work_item_ids ?? [], allowedWi),
    confidence: clamp01(object.confidence ?? 0),
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
  input: AlfredZoomTriageInput,
  _candidates: ShortlistedCandidates,
  decision: DecisionWithUsage,
): Promise<AlfredZoomTriageResult> {
  const total =
    decision.contact_ids.length +
    decision.organization_ids.length +
    decision.work_item_ids.length

  if (total === 0 || decision.confidence < REVIEW_FLOOR) {
    return {
      outcome: "no_match",
      contactIds: [],
      organizationIds: [],
      workItemIds: [],
      confidence: decision.confidence,
      reason: decision.reason,
    }
  }

  const needsReview = decision.confidence < AUTO_ACCEPT_THRESHOLD
  const tasks: Promise<void>[] = []

  for (const contactId of decision.contact_ids) {
    tasks.push(
      upsertClientTag(supabase, {
        zoomMeetingId: input.zoomMeetingId,
        contactId,
        organizationId: null,
        confidence: decision.confidence,
        reason: decision.reason,
        needsReview,
      }),
    )
  }
  for (const organizationId of decision.organization_ids) {
    tasks.push(
      upsertClientTag(supabase, {
        zoomMeetingId: input.zoomMeetingId,
        contactId: null,
        organizationId,
        confidence: decision.confidence,
        reason: decision.reason,
        needsReview,
      }),
    )
  }
  for (const workItemId of decision.work_item_ids) {
    tasks.push(
      insertWorkItemTag(supabase, {
        zoomMeetingId: input.zoomMeetingId,
        workItemId,
        confidence: decision.confidence,
        reason: decision.reason,
        needsReview,
      }),
    )
  }

  await Promise.all(tasks)

  return {
    outcome: needsReview ? "tagged_review" : "tagged",
    contactIds: decision.contact_ids,
    organizationIds: decision.organization_ids,
    workItemIds: decision.work_item_ids,
    confidence: decision.confidence,
    reason: decision.reason,
  }
}

async function upsertClientTag(
  supabase: SupabaseClient,
  params: {
    zoomMeetingId: string
    contactId: string | null
    organizationId: string | null
    confidence: number
    reason: string
    needsReview: boolean
  },
): Promise<void> {
  // If a tag already exists from the deterministic auto/bridge/manual
  // path, don't downgrade it — just record ALFRED's reasoning.
  const probe = supabase
    .from("zoom_meeting_clients")
    .select("id, link_source")
    .eq("zoom_meeting_id", params.zoomMeetingId)

  const existingQ = params.contactId
    ? probe.eq("contact_id", params.contactId)
    : probe.eq("organization_id", params.organizationId!)
  const { data: existing } = await existingQ.maybeSingle()

  if (existing) {
    if (
      existing.link_source === "auto" ||
      existing.link_source === "manual" ||
      existing.link_source === "calendly_bridge"
    ) {
      await supabase
        .from("zoom_meeting_clients")
        .update({
          alfred_reason: params.reason,
          confidence: params.confidence,
        })
        .eq("id", existing.id)
      return
    }
    await supabase
      .from("zoom_meeting_clients")
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

  const { error } = await supabase.from("zoom_meeting_clients").insert({
    zoom_meeting_id: params.zoomMeetingId,
    contact_id: params.contactId,
    organization_id: params.organizationId,
    link_source: "alfred",
    match_method: "alfred",
    confidence: params.confidence,
    alfred_reason: params.reason,
    needs_review: params.needsReview,
  })
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[v0] [alfred-zoom-triage] client tag insert warning:", error.message)
  }
}

async function insertWorkItemTag(
  supabase: SupabaseClient,
  params: {
    zoomMeetingId: string
    workItemId: string
    confidence: number
    reason: string
    needsReview: boolean
  },
): Promise<void> {
  const { data: existing } = await supabase
    .from("zoom_meeting_work_items")
    .select("id, link_source")
    .eq("zoom_meeting_id", params.zoomMeetingId)
    .eq("work_item_id", params.workItemId)
    .maybeSingle()

  if (existing) {
    // Same downgrade-protection as above.
    if (
      existing.link_source === "manual" ||
      existing.link_source === "calendly_bridge"
    ) {
      await supabase
        .from("zoom_meeting_work_items")
        .update({
          alfred_reason: params.reason,
          confidence: params.confidence,
        })
        .eq("id", existing.id)
      return
    }
    await supabase
      .from("zoom_meeting_work_items")
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

  const { error } = await supabase.from("zoom_meeting_work_items").insert({
    zoom_meeting_id: params.zoomMeetingId,
    work_item_id: params.workItemId,
    link_source: "alfred",
    match_method: "alfred",
    confidence: params.confidence,
    alfred_reason: params.reason,
    needs_review: params.needsReview,
  })
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[v0] [alfred-zoom-triage] work_item tag insert warning:", error.message)
  }
}

// ─── Audit log ───────────────────────────────────────────────────────

async function writeTriageLog(
  supabase: SupabaseClient,
  input: AlfredZoomTriageInput,
  result: AlfredZoomTriageResult,
  candidates: ShortlistedCandidates,
  rawModelOutput: unknown,
  errorMessage: string | null,
  durationMs: number,
  usage: { promptTokens?: number; completionTokens?: number } = {},
): Promise<void> {
  const { error } = await supabase.from("zoom_alfred_triage_log").insert({
    zoom_meeting_id: input.zoomMeetingId,
    topic: input.topic,
    agenda: input.agenda,
    start_time: input.startTime,
    host_email: input.hostEmail,
    participant_emails: input.participants
      .map((p) => p.email)
      .filter((x): x is string => !!x),
    participant_names: input.participants
      .map((p) => p.name)
      .filter((x): x is string => !!x),
    bridged_from_calendly_event_id: input.bridgedFromCalendlyEventId,
    outcome: result.outcome,
    resolved_contact_ids: result.contactIds,
    resolved_organization_ids: result.organizationIds,
    resolved_work_item_ids: result.workItemIds,
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
    console.warn("[v0] [alfred-zoom-triage] audit log insert failed:", error.message)
  }
}

// ─── Tiny utilities (mirrors calendly-triage.ts to keep them in sync) ─

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
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error(`bad uuid: ${id}`)
  return id
}
function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase())
}

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.ca",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "msn.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "ymail.com",
  "protonmail.com",
])

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
  "zoom",
])
