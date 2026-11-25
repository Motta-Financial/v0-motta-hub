/**
 * Post-create "finalize" step for Hub-created Karbon work items.
 *
 * Creating a work item from a template leaves it on the template's own
 * defaults: whatever status the template starts in and whatever dates the
 * caller happened to pass. For tax preparation that is not what the firm's
 * Karbon workflow expects, so once the work item EXISTS we follow up with
 * `PATCH /v3/WorkItems/{key}` to set:
 *
 *   (A) the status — for a prospect's tax work item, `In Progress › Lead |
 *       Meeting Schd` when a Calendly meeting is on the books and `Lead |
 *       Awaiting Intake` when it isn't (the two stages teammates have been
 *       setting by hand); or the status a teammate explicitly picked in the
 *       work-item builder;
 *   (B) the dates — StartDate 12/31 of the tax year, DueDate and
 *       DeadlineDate on the return's statutory filing date (1040 → 4/15).
 *
 * It is deliberately a SEPARATE call made after the POST rather than extra
 * fields on the POST:
 *
 *   • Karbon's automators key off status CHANGES on an existing work item,
 *     so the transition has to happen after creation to drive the workflow.
 *   • Statuses can only be written by NAME (`PrimaryStatus` +
 *     `SecondaryStatus`). The `WorkStatusKey` the builder used to send on
 *     the POST is not a field Karbon's create endpoint knows about.
 *   • PATCH validates the SecondaryStatus against the work item's work
 *     type and answers 400 when it doesn't apply, where POST/PUT silently
 *     drop it. A loud failure is the one we can report.
 *
 * Everything here is best-effort and never throws: the work item already
 * exists in Karbon, so a failed finalize is reported (and logged) but must
 * not turn a successful create into an error.
 *
 * Reference: https://karbonhq.github.io/karbon-api-reference/ — "Workflow 6
 * — Update a Work Item's Primary and Secondary status".
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/server"
import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"
import {
  AWAITING_MEETING_SECONDARY_STATUS,
  LEAD_PRIMARY_STATUS,
  MEETING_SCHEDULED_SECONDARY_STATUS,
  classifyTaxPrepWorkType,
  isAwaitingIntakeStatusName,
  isMeetingScheduledStatusName,
  isPreMeetingLeadStatusName,
  isUntouchedTemplateStatus,
  normalizePrimaryStatus,
  resolveTaxYear,
  taxReturnSchedule,
  toKarbonDateTime,
  toKarbonPrimaryStatus,
  type LeadStage,
  type TaxReturnKind,
} from "@/lib/karbon/tax-work-item-defaults"

/* ─────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────── */

/** Who the work item is for — used to decide whether a meeting is booked. */
export interface LeadContext {
  /** `jotform_intake_submissions.id` when the work item comes from an intake. */
  intakeSubmissionId?: string | null
  /** Hub contact the prospect resolved to. */
  contactId?: string | null
  /** Prospect's email, for bookings made before the contact was linked. */
  email?: string | null
}

export interface FinalizeWorkItemArgs {
  workItemKey: string
  /** Karbon work type NAME, e.g. "TAX | Individual (1040)". */
  workTypeName?: string | null
  /** Karbon WorkTypeKey — resolves the name and validates the status. */
  workTypeKey?: string | null
  /** WorkTemplateKey — resolves the work type when neither is supplied. */
  workTemplateKey?: string | null
  /** Work item title; its trailing segment names the tax year. */
  title?: string | null
  /** The fiscal-year text the teammate entered ("2026", "LEAD", …). */
  fiscalYear?: string | null
  /** Dates the teammate explicitly chose — these always win. */
  explicitStartDate?: string | null
  explicitDueDate?: string | null
  explicitDeadlineDate?: string | null
  /** `work_status.karbon_status_key` picked in the builder — wins over the lead default. */
  explicitWorkStatusKey?: string | null
  /** Present only for prospect/intake-originated work items. */
  lead?: LeadContext | null
}

export interface AppliedWorkItemFields {
  StartDate?: string
  DueDate?: string
  DeadlineDate?: string
  PrimaryStatus?: string
  SecondaryStatus?: string
}

export interface FinalizeWorkItemResult {
  /** False when there was nothing to set (not tax prep, no status asked for). */
  attempted: boolean
  /** True when every PATCH that was attempted succeeded. */
  ok: boolean
  applied: AppliedWorkItemFields
  taxReturnKind: TaxReturnKind | null
  /** Karbon work type name the item resolved to, when known. */
  workTypeName: string | null
  taxYear: number | null
  /** null = not evaluated (no lead context / not tax prep). */
  meetingScheduled: boolean | null
  /** Human-readable trail of what happened and why — logged and returned. */
  notes: string[]
  error?: string
}

export interface LeadMeeting {
  booked: boolean
  eventId?: string
  startTime?: string | null
  via?: "intake_attribution" | "contact" | "email"
}

interface ResolvedStatus {
  primary: string
  secondary: string
}

/* ─────────────────────────────────────────────────────────────────────────
 * Karbon PATCH with the documented retry semantics
 * ─────────────────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * `PATCH /v3/WorkItems/{key}`.
 *
 * Retries the two failures Karbon documents as transient:
 *   • 409 — optimistic-concurrency conflict. Routine straight after a
 *     create, while Karbon is still applying the template to the item.
 *   • 429 — rate limit ("Try again in N seconds").
 */
export async function patchKarbonWorkItem(
  workItemKey: string,
  body: Record<string, unknown>,
  credentials: KarbonApiConfig,
): Promise<{ ok: boolean; error?: string }> {
  const delays = [1500, 3000]
  let lastError = "unknown error"

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const { error } = await karbonFetch<unknown>(
      `/WorkItems/${encodeURIComponent(workItemKey)}`,
      credentials,
      { method: "PATCH", body },
    )
    if (!error) return { ok: true }
    lastError = error

    const transient = /^(409|429)\b/.test(error)
    if (!transient || attempt === delays.length) break

    const hinted = error.match(/try again in (\d+) seconds?/i)
    const wait = hinted ? Math.min(Number(hinted[1]) * 1000, 10_000) : delays[attempt]
    await sleep(wait)
  }
  return { ok: false, error: lastError }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Local lookups (tenant config mirrored by lib/karbon/sync-tenant-config.ts)
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Resolve a work item's Karbon work type (NAME + key) from whichever
 * identifier the caller has: the name, the WorkTypeKey, or the
 * WorkTemplateKey the item is being created from. Never throws.
 */
export async function resolveKarbonWorkType(
  supabase: SupabaseClient,
  args: Pick<FinalizeWorkItemArgs, "workTypeName" | "workTypeKey" | "workTemplateKey">,
): Promise<{ name: string | null; key: string | null }> {
  let name = args.workTypeName?.trim() || null
  let key = args.workTypeKey?.trim() || null

  try {
    if (!key && !name && args.workTemplateKey) {
      const { data } = await supabase
        .from("work_templates")
        .select("karbon_work_type_key")
        .eq("karbon_work_template_key", args.workTemplateKey)
        .maybeSingle()
      key = (data?.karbon_work_type_key as string | null) ?? null
    }
    if (key && !name) {
      const { data } = await supabase
        .from("work_types")
        .select("name")
        .eq("karbon_work_type_key", key)
        .maybeSingle()
      name = (data?.name as string | null) ?? null
    }
    if (name && !key) {
      const { data } = await supabase
        .from("work_types")
        .select("karbon_work_type_key")
        .ilike("name", escapeLike(name))
        .limit(1)
        .maybeSingle()
      key = (data?.karbon_work_type_key as string | null) ?? null
    }
  } catch (err) {
    console.warn("[karbon-finalize] work type lookup failed:", err)
  }
  return { name, key }
}

/** Escape LIKE wildcards so an exact, case-insensitive match stays exact. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Is a status enabled for a work type, as far as the local mirror knows?
 *
 *   "yes"     — the mirror lists this work type for the status
 *   "no"      — the mirror lists OTHER work types but not this one
 *   "unknown" — nothing to check against (no work type key, or the
 *               status carries no work-type list at all — the mirror is
 *               only as fresh as the last tenant-config sync)
 *
 * "unknown" is treated as "let Karbon decide": its PATCH answers 400 for
 * a status that doesn't apply, and that failure is reported. Refusing to
 * even try would silently suppress a status Karbon may well accept.
 */
function statusAppliesToWorkType(
  workTypeKeys: unknown,
  workTypeKey: string | null,
): "yes" | "no" | "unknown" {
  if (!workTypeKey) return "unknown"
  if (!Array.isArray(workTypeKeys) || workTypeKeys.length === 0) return "unknown"
  return workTypeKeys.map(String).includes(workTypeKey) ? "yes" : "no"
}

/** The status a teammate picked in the builder (`work_status.karbon_status_key`). */
async function resolveExplicitStatus(
  supabase: SupabaseClient,
  workStatusKey: string,
): Promise<ResolvedStatus | null> {
  try {
    const { data } = await supabase
      .from("work_status")
      .select("primary_status_name, secondary_status_name")
      .eq("karbon_status_key", workStatusKey)
      .maybeSingle()
    const primary = (data?.primary_status_name as string | null)?.trim()
    const secondary = (data?.secondary_status_name as string | null)?.trim()
    if (!primary || !secondary) return null
    return { primary, secondary }
  } catch (err) {
    console.warn("[karbon-finalize] explicit status lookup failed:", err)
    return null
  }
}

const LEAD_STAGE_STATUS: Record<
  LeadStage,
  { fallback: string; label: string; matches: (secondary: string) => boolean }
> = {
  meeting_scheduled: {
    fallback: MEETING_SCHEDULED_SECONDARY_STATUS,
    label: "meeting scheduled",
    matches: (name) => /^lead\b/i.test(name.trim()) && isMeetingScheduledStatusName(name),
  },
  awaiting_meeting: {
    fallback: AWAITING_MEETING_SECONDARY_STATUS,
    label: "awaiting intake",
    matches: (name) => isAwaitingIntakeStatusName(name),
  },
}

/**
 * The tenant's status for a lead stage, for a given work type.
 *
 * Looked up live so a rename in Karbon ("Lead | Meeting Schd" → "Lead |
 * Meeting Scheduled") keeps working, and so a work type that doesn't have
 * the status enabled is caught here instead of as a 400 from Karbon.
 * Falls back to the firm's known name only when the mirror can't answer.
 */
async function resolveLeadStageStatus(
  supabase: SupabaseClient,
  workTypeKey: string | null,
  stage: LeadStage,
): Promise<{ status: ResolvedStatus | null; reason?: string }> {
  const spec = LEAD_STAGE_STATUS[stage]
  const fallback: ResolvedStatus = { primary: LEAD_PRIMARY_STATUS, secondary: spec.fallback }

  try {
    const { data, error } = await supabase
      .from("work_status")
      .select("primary_status_name, secondary_status_name, work_type_keys, is_active")
      .eq("is_active", true)
      .not("secondary_status_name", "is", null)
    if (error) throw error

    // Mirror not synced at all — use the known name and let Karbon validate.
    if ((data ?? []).length === 0) return { status: fallback }

    const candidates = (data ?? []).filter((r) => spec.matches(String(r.secondary_status_name ?? "")))
    if (candidates.length === 0) {
      return { status: null, reason: `no "${spec.fallback}"-style status exists in Karbon` }
    }

    const ranked = candidates
      .map((r) => ({ row: r, applies: statusAppliesToWorkType(r.work_type_keys, workTypeKey) }))
      .filter((c) => c.applies !== "no")
    if (ranked.length === 0) {
      return {
        status: null,
        reason: `the "${spec.label}" lead status is not enabled for this work type in Karbon`,
      }
    }

    const isExact = (r: { secondary_status_name?: unknown }) =>
      String(r.secondary_status_name ?? "").trim().toLowerCase() === spec.fallback.toLowerCase()
    // Best: confirmed for this work type, exact name. Then confirmed, then
    // exact-but-unconfirmed, then anything left.
    const pick =
      ranked.find((c) => c.applies === "yes" && isExact(c.row)) ??
      ranked.find((c) => c.applies === "yes") ??
      ranked.find((c) => isExact(c.row)) ??
      ranked[0]

    return {
      status: {
        primary: String(pick.row.primary_status_name ?? LEAD_PRIMARY_STATUS).trim() || LEAD_PRIMARY_STATUS,
        secondary: String(pick.row.secondary_status_name).trim(),
      },
    }
  } catch (err) {
    console.warn(`[karbon-finalize] ${stage} status lookup failed:`, err)
    return { status: fallback }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * "Has this lead booked a meeting?"
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * True when the prospect has an ACTIVE (not cancelled) Calendly meeting
 * that has not happened yet.
 *
 * Signals, strongest first:
 *   1. the intake row's own attribution (`calendly_event_id`, written from
 *      the tracking id the intake's booking link carries);
 *   2. a Calendly invitee linked to the same Hub contact;
 *   3. a Calendly invitee with the same email address.
 *
 * "Not happened yet" is deliberate. In practice the firm opens the work
 * item the day the lead arrives, while the discovery call is still ahead
 * — that is the state "Lead | Meeting Schd" describes. A meeting that
 * already took place is not "scheduled", and flipping a work item into
 * that status after the fact could fire a pre-meeting automation in
 * Karbon for a call that is over.
 */
export async function detectLeadMeeting(
  supabase: SupabaseClient,
  lead: LeadContext | null | undefined,
  now: Date = new Date(),
): Promise<LeadMeeting> {
  if (!lead) return { booked: false }

  let contactId = lead.contactId ?? null
  let email = lead.email?.trim() || null
  const nowIso = now.toISOString()

  try {
    if (lead.intakeSubmissionId) {
      const { data: intake } = await supabase
        .from("jotform_intake_submissions")
        .select("calendly_event_id, contact_id, submitter_email")
        .eq("id", lead.intakeSubmissionId)
        .maybeSingle()

      if (intake) {
        contactId = contactId ?? (intake.contact_id as string | null)
        email = email ?? ((intake.submitter_email as string | null)?.trim() || null)

        if (intake.calendly_event_id) {
          const { data: event } = await supabase
            .from("calendly_events")
            .select("id, status, start_time")
            .eq("id", intake.calendly_event_id)
            .maybeSingle()
          if (
            event &&
            event.status === "active" &&
            event.start_time &&
            new Date(event.start_time as string).getTime() >= now.getTime()
          ) {
            return {
              booked: true,
              eventId: event.id as string,
              startTime: event.start_time as string,
              via: "intake_attribution",
            }
          }
          // Attributed meeting was cancelled or is already over — fall
          // through: they may have rebooked under a new Calendly event.
        }
      }
    }

    if (!contactId && !email) return { booked: false }

    const candidates: Array<{ eventId: string; via: "contact" | "email" }> = []
    if (contactId) {
      const { data } = await supabase
        .from("calendly_invitees")
        .select("calendly_event_id")
        .eq("contact_id", contactId)
        .eq("status", "active")
        .not("calendly_event_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(200)
      for (const row of data ?? []) {
        candidates.push({ eventId: row.calendly_event_id as string, via: "contact" })
      }
    }
    if (email) {
      const { data } = await supabase
        .from("calendly_invitees")
        .select("calendly_event_id")
        .ilike("email", escapeLike(email))
        .eq("status", "active")
        .not("calendly_event_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(200)
      for (const row of data ?? []) {
        if (!candidates.some((c) => c.eventId === row.calendly_event_id)) {
          candidates.push({ eventId: row.calendly_event_id as string, via: "email" })
        }
      }
    }
    if (candidates.length === 0) return { booked: false }

    const { data: events } = await supabase
      .from("calendly_events")
      .select("id, status, start_time")
      .in(
        "id",
        candidates.map((c) => c.eventId),
      )
      .eq("status", "active")
      .gte("start_time", nowIso)
      .order("start_time", { ascending: true })
      .limit(1)

    const hit = events?.[0]
    if (!hit) return { booked: false }
    return {
      booked: true,
      eventId: hit.id as string,
      startTime: (hit.start_time as string | null) ?? null,
      via: candidates.find((c) => c.eventId === hit.id)?.via ?? "contact",
    }
  } catch (err) {
    console.warn("[karbon-finalize] lead meeting lookup failed:", err)
    return { booked: false }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Finalize
 * ─────────────────────────────────────────────────────────────────────── */

/** Accept `YYYY-MM-DD` or a full ISO timestamp from callers. */
function cleanDate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim()
  return v ? v : null
}

export async function finalizeKarbonWorkItem(
  args: FinalizeWorkItemArgs,
  deps: { supabase?: SupabaseClient; credentials?: KarbonApiConfig } = {},
): Promise<FinalizeWorkItemResult> {
  const result: FinalizeWorkItemResult = {
    attempted: false,
    ok: true,
    applied: {},
    taxReturnKind: null,
    workTypeName: null,
    taxYear: null,
    meetingScheduled: null,
    notes: [],
  }

  try {
    const credentials = deps.credentials ?? getKarbonCredentials()
    if (!credentials) {
      result.ok = false
      result.error = "Karbon credentials are not configured"
      return result
    }
    const supabase = deps.supabase ?? (createAdminClient() as unknown as SupabaseClient)

    const workType = await resolveKarbonWorkType(supabase, args)
    const kind = classifyTaxPrepWorkType(workType.name)
    result.taxReturnKind = kind
    result.workTypeName = workType.name

    // ── (B) Dates ────────────────────────────────────────────────────
    // Only tax-preparation work has a statutory date to anchor to. Dates
    // the teammate typed in always win over the convention.
    const datePatch: Record<string, string> = {}
    if (kind) {
      const { taxYear, source } = resolveTaxYear({ fiscalYear: args.fiscalYear, title: args.title })
      const schedule = taxReturnSchedule(kind, taxYear)
      result.taxYear = taxYear

      if (schedule) {
        const start = cleanDate(args.explicitStartDate) ?? schedule.startDate
        const due = cleanDate(args.explicitDueDate) ?? schedule.dueDate
        // The deadline is the external (IRS) date. When the teammate
        // chose their own due date and no deadline, the statutory date
        // still applies as the deadline.
        const deadline = cleanDate(args.explicitDeadlineDate) ?? schedule.deadlineDate

        datePatch.StartDate = toKarbonDateTime(start)
        datePatch.DueDate = toKarbonDateTime(due)
        datePatch.DeadlineDate = toKarbonDateTime(deadline)
        result.notes.push(
          `tax year ${taxYear} (from ${source.replace("_", " ")}): start ${start}, due ${due}, deadline ${deadline}`,
        )
      } else {
        result.notes.push(
          `${kind} returns have no single filing date (fiscal-year filers) — dates left as entered`,
        )
      }
    }

    // ── (A) Status ───────────────────────────────────────────────────
    let status: ResolvedStatus | null = null
    if (args.explicitWorkStatusKey) {
      status = await resolveExplicitStatus(supabase, args.explicitWorkStatusKey)
      if (status) {
        result.notes.push(`status chosen by teammate: ${status.primary} › ${status.secondary}`)
      } else {
        result.notes.push(
          `selected status ${args.explicitWorkStatusKey} has no primary/secondary name on file — left on the template default`,
        )
      }
    } else if (kind && args.lead) {
      // A prospect's tax work item belongs in the lead funnel, at one of
      // two stages — the same two teammates have been setting by hand:
      // a meeting is booked, or we are still waiting on them.
      const meeting = await detectLeadMeeting(supabase, args.lead)
      result.meetingScheduled = meeting.booked
      const stage: LeadStage = meeting.booked ? "meeting_scheduled" : "awaiting_meeting"
      const resolved = await resolveLeadStageStatus(supabase, workType.key, stage)
      status = resolved.status
      const why = meeting.booked
        ? `upcoming Calendly meeting on file (${meeting.via})`
        : "no upcoming Calendly meeting on file"
      result.notes.push(
        status
          ? `${why} → ${status.primary} › ${status.secondary}`
          : `${why}, but status left on the template default: ${resolved.reason}`,
      )
    }

    if (Object.keys(datePatch).length === 0 && !status) {
      return result // nothing to do for this work item
    }
    result.attempted = true

    // Dates first, status second: an automator that fires on the status
    // change then sees the correct dates, and a status Karbon rejects
    // can't take the dates down with it.
    if (Object.keys(datePatch).length > 0) {
      const res = await patchKarbonWorkItem(args.workItemKey, datePatch, credentials)
      if (res.ok) {
        Object.assign(result.applied, datePatch)
      } else {
        result.ok = false
        result.error = `dates: ${res.error}`
        result.notes.push(`Karbon rejected the dates: ${res.error}`)
      }
    }

    if (status) {
      const statusPatch = {
        PrimaryStatus: toKarbonPrimaryStatus(status.primary),
        SecondaryStatus: status.secondary,
      }
      const res = await patchKarbonWorkItem(args.workItemKey, statusPatch, credentials)
      if (res.ok) {
        Object.assign(result.applied, statusPatch)
      } else {
        result.ok = false
        result.error = result.error ? `${result.error}; status: ${res.error}` : `status: ${res.error}`
        result.notes.push(`Karbon rejected the status: ${res.error}`)
      }
    }

    console.log(
      `[karbon-finalize] ${args.workItemKey} ${result.ok ? "ok" : "PARTIAL/FAILED"} — ${result.notes.join(" | ")}`,
    )
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[karbon-finalize] ${args.workItemKey} threw:`, err)
    result.ok = false
    result.error = message
    return result
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Booking arrives AFTER the work item exists
 * ───────────────────────────────────────────────────────────────────────
 * Order isn't guaranteed: in practice about a quarter of prospects book
 * a day or more AFTER a teammate has already opened their work item. When
 * the booking lands we move that prospect's Hub-created tax work item on
 * to "meeting scheduled" — but only from a status that sits BEFORE a
 * meeting ("Lead | Awaiting Intake", "LEAD | Prospect", or the template's
 * untouched default), so work that has progressed (debrief, discovery,
 * proposal, prep…) is never pulled backwards.
 */

export interface AdvanceOnBookingResult {
  checked: number
  advanced: string[]
  skipped: Array<{ workItemKey: string; reason: string }>
}

export async function advanceLeadWorkItemsOnBooking(
  supabase: SupabaseClient,
  booking: { contactId?: string | null; intakeSubmissionId?: string | null },
  deps: { credentials?: KarbonApiConfig } = {},
): Promise<AdvanceOnBookingResult> {
  const out: AdvanceOnBookingResult = { checked: 0, advanced: [], skipped: [] }

  try {
    if (!booking.contactId && !booking.intakeSubmissionId) return out
    const credentials = deps.credentials ?? getKarbonCredentials()
    if (!credentials) return out

    // Only work items the Hub itself opened for this prospect.
    const keys = new Set<string>()
    if (booking.intakeSubmissionId) {
      const { data } = await supabase
        .from("jotform_intake_submissions")
        .select("karbon_work_item_key")
        .eq("id", booking.intakeSubmissionId)
        .not("karbon_work_item_key", "is", null)
        .maybeSingle()
      if (data?.karbon_work_item_key) keys.add(data.karbon_work_item_key as string)
    }
    if (booking.contactId) {
      const [{ data: intakes }, { data: prospects }] = await Promise.all([
        supabase
          .from("jotform_intake_submissions")
          .select("karbon_work_item_key")
          .eq("contact_id", booking.contactId)
          .not("karbon_work_item_key", "is", null)
          .limit(10),
        supabase
          .from("prospect_submissions")
          .select("karbon_work_item_key")
          .eq("contact_id", booking.contactId)
          .not("karbon_work_item_key", "is", null)
          .limit(10),
      ])
      for (const row of [...(intakes ?? []), ...(prospects ?? [])]) {
        if (row.karbon_work_item_key) keys.add(row.karbon_work_item_key as string)
      }
    }
    if (keys.size === 0) return out

    for (const workItemKey of keys) {
      out.checked += 1

      // Read the LIVE status from Karbon — the local mirror can lag a
      // teammate's edit by minutes, and regressing their change is the
      // one thing this must not do.
      const { data: live, error } = await karbonFetch<Record<string, any>>(
        `/WorkItems/${encodeURIComponent(workItemKey)}`,
        credentials,
      )
      if (error || !live) {
        out.skipped.push({ workItemKey, reason: `could not read from Karbon: ${error ?? "empty"}` })
        continue
      }

      const workTypeName = (live.WorkType as string | undefined) ?? null
      if (!classifyTaxPrepWorkType(workTypeName)) {
        out.skipped.push({ workItemKey, reason: "not a tax-preparation work item" })
        continue
      }
      if (normalizePrimaryStatus(live.PrimaryStatus) === "completed") {
        out.skipped.push({ workItemKey, reason: "already completed" })
        continue
      }
      const primary = (live.PrimaryStatus as string | undefined) ?? null
      const secondary = (live.SecondaryStatus as string | undefined) ?? null
      const advanceable =
        isPreMeetingLeadStatusName(secondary) || isUntouchedTemplateStatus(primary, secondary)
      if (!advanceable) {
        out.skipped.push({
          workItemKey,
          reason: `status "${secondary ?? primary ?? "(none)"}" is not a pre-meeting lead status`,
        })
        continue
      }

      const workType = await resolveKarbonWorkType(supabase, { workTypeName })
      const resolved = await resolveLeadStageStatus(supabase, workType.key, "meeting_scheduled")
      if (!resolved.status) {
        out.skipped.push({ workItemKey, reason: resolved.reason ?? "no meeting-scheduled status" })
        continue
      }

      const res = await patchKarbonWorkItem(
        workItemKey,
        {
          PrimaryStatus: toKarbonPrimaryStatus(resolved.status.primary),
          SecondaryStatus: resolved.status.secondary,
        },
        credentials,
      )
      if (res.ok) {
        out.advanced.push(workItemKey)
        console.log(
          `[karbon-finalize] ${workItemKey} "${secondary}" → "${resolved.status.secondary}" (meeting booked)`,
        )
      } else {
        out.skipped.push({ workItemKey, reason: `Karbon rejected the status: ${res.error}` })
      }
    }
  } catch (err) {
    console.error("[karbon-finalize] advanceLeadWorkItemsOnBooking threw:", err)
  }
  return out
}
