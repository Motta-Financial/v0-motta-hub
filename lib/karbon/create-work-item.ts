/**
 * Create a Karbon WorkItem from ANY work template.
 *
 * This is the generic counterpart to `create-intake-work-item.ts` (which
 * is hard-wired to the Individual 1040 template). The prospect form's
 * optional "Create Karbon Work Item" section and the shared work-item
 * builder let a teammate pick any synced work template and fill in the
 * core WorkItem fields, so we need a creator that isn't pinned to a single
 * template/work type.
 *
 * Field names mirror Karbon's `RequestCreateWorkItem` schema exactly
 * (PascalCase). We only send fields the teammate actually filled in;
 * anything omitted falls back to the work template's own defaults.
 *
 * Two-step write:
 *   1. `POST /v3/WorkItems` creates the item from the template.
 *   2. `finalizeKarbonWorkItem` then PATCHes the status and — for tax
 *      preparation work — the start / due / deadline dates. See
 *      `lib/karbon/finalize-work-item.ts` for why this is a follow-up
 *      call rather than more fields on the POST.
 *
 * Karbon auto-attaches the new work item to the client's timeline when
 * we pass `ClientKey`, so no separate note is required for linkage.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/server"
import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"
import {
  finalizeKarbonWorkItem,
  resolveKarbonWorkType,
  type FinalizeWorkItemResult,
  type LeadContext,
} from "@/lib/karbon/finalize-work-item"
import {
  classifyTaxPrepWorkType,
  resolveTaxYear,
  taxReturnSchedule,
  toKarbonDateTime,
} from "@/lib/karbon/tax-work-item-defaults"

const KARBON_TENANT_BASE = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

export interface CreateWorkItemArgs {
  /** Karbon ClientKey — a ContactKey or OrganizationKey. */
  clientKey: string
  /** "Contact" | "Organization". */
  clientType: "Contact" | "Organization"
  /** WorkTemplateKey chosen in the dropdown. Required. */
  workTemplateKey: string
  /** Human title for the work item. Required. */
  title: string
  /**
   * The template's work type. Callers pass the Karbon WorkTypeKey (that
   * is what the templates endpoint hands the UI); a work type NAME is
   * accepted too. Karbon's API wants the NAME, so it is resolved before
   * the POST and omitted when it can't be — the template supplies it.
   */
  workType?: string | null
  /** Email of the teammate to assign. Karbon requires one. */
  assigneeEmail?: string | null
  /** ISO 8601 start date. Optional — see the defaults in the body. */
  startDate?: string | null
  /** ISO 8601 due date. Optional. */
  dueDate?: string | null
  /**
   * `work_status.karbon_status_key` picked in the builder. Applied after
   * creation by status NAME — Karbon's create endpoint has no
   * `WorkStatusKey` field.
   */
  workStatusKey?: string | null
  /**
   * Set for prospect / intake-originated work items so tax-prep work
   * lands in the lead funnel ("Lead | Meeting Schd" when a Calendly
   * meeting is booked, "Lead | Awaiting Intake" until then). Leave unset
   * for existing-client work (e.g. from a debrief).
   */
  lead?: LeadContext | null
}

/** What the caller is told the moment the work item exists in Karbon. */
export interface CreatedWorkItem {
  workItemKey: string
  title: string
  workItemUrl: string
  /** Karbon work type NAME the item was created under, when known. */
  workTypeName: string | null
}

export interface CreateWorkItemResult {
  ok: boolean
  workItemKey?: string
  title?: string
  workItemUrl?: string
  /** Karbon work type NAME ("TAX | Individual (1040)"), when resolved. */
  workTypeName?: string | null
  error?: string
  skipped?: "no_credentials"
  /** Outcome of the post-create status/date update. */
  finalize?: FinalizeWorkItemResult
}

function toKarbonDate(value?: string | null): string | undefined {
  if (!value) return undefined
  // Accept either a bare date ("2026-06-01") or a full ISO timestamp.
  return toKarbonDateTime(value)
}

/** Today's date (`YYYY-MM-DD`) on the firm's clock, US Eastern. */
function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export async function createWorkItem(
  args: CreateWorkItemArgs,
  credentialsOverride?: KarbonApiConfig,
  deps: {
    supabase?: SupabaseClient
    /**
     * Called as soon as Karbon has created the work item — BEFORE the
     * status/date follow-up, which can take several seconds. Callers
     * persist the key here so an interrupted follow-up can't leave a
     * Karbon work item the Hub doesn't know about (and a second click
     * creating a duplicate).
     */
    onCreated?: (created: CreatedWorkItem) => Promise<void> | void
  } = {},
): Promise<CreateWorkItemResult> {
  const credentials = credentialsOverride ?? getKarbonCredentials()
  if (!credentials) {
    console.warn("[karbon-create-work-item] Karbon credentials missing — skipping create.")
    return { ok: false, skipped: "no_credentials", error: "Karbon credentials are not configured" }
  }

  if (!args.workTemplateKey) {
    return { ok: false, error: "A Karbon work template is required" }
  }
  if (!args.title?.trim()) {
    return { ok: false, error: "A work item title is required" }
  }
  // Karbon rejects a work item with no assignee (`AssigneeEmailAddress`
  // is a required field). Say so in plain words instead of relaying its
  // 400 — the fix is one dropdown away.
  if (!args.assigneeEmail?.trim()) {
    return {
      ok: false,
      error: "Pick an assignee for this work item — Karbon requires one to create it.",
    }
  }
  const title = args.title.trim()

  // Work out what kind of work this is BEFORE the POST: Karbon wants the
  // work type by name, and tax-preparation work has a conventional start
  // date (12/31 of the tax year) that has to be on the create call
  // because StartDate is a required field.
  const supabase = deps.supabase ?? (createAdminClient() as unknown as SupabaseClient)
  let workType = await resolveKarbonWorkType(supabase, {
    workTypeKey: args.workType ?? null,
    workTemplateKey: args.workTemplateKey,
  })
  if (!workType.name) {
    // The supplied key didn't resolve — the template knows its own type.
    workType = await resolveKarbonWorkType(supabase, { workTemplateKey: args.workTemplateKey })
  }
  if (!workType.name && args.workType) {
    // Last resort: the caller passed a NAME. Only trust it when a real
    // work type carries that name.
    const asName = await resolveKarbonWorkType(supabase, { workTypeName: args.workType })
    if (asName.key) workType = asName
  }
  const taxKind = classifyTaxPrepWorkType(workType.name)
  const schedule = taxKind
    ? taxReturnSchedule(taxKind, resolveTaxYear({ title }).taxYear)
    : null

  const payload: Record<string, unknown> = {
    Title: title,
    ClientKey: args.clientKey,
    ClientType: args.clientType,
    WorkTemplateKey: args.workTemplateKey,
    AssigneeEmailAddress: args.assigneeEmail.trim(),
    // StartDate is required by Karbon. A date the teammate picked wins;
    // tax preparation starts 12/31 of the tax year; anything else starts
    // today.
    StartDate:
      toKarbonDate(args.startDate) ??
      toKarbonDateTime(schedule?.startDate ?? todayEastern()),
  }
  // Karbon's `WorkType` is the work type's NAME ("TAX | Individual
  // (1040)"), never its key. Sent only when resolved; otherwise the
  // template's own work type applies.
  if (workType.name) payload.WorkType = workType.name
  const due = toKarbonDate(args.dueDate)
  if (due) payload.DueDate = due
  // NOT sent, on purpose:
  //   • `WorkStatusKey` — not a WorkItem field. The chosen status is
  //     applied by name in the finalize step below.
  //   • `Budget: { BudgetedHours }` — not a WorkItem field either (none
  //     of the firm's 4,300 synced work items has ever carried one).
  //     Karbon exposes time budgets only through per-user
  //     EstimateSummaries, which are read-only at creation, so the
  //     template's own estimate stands. Sending undeclared properties
  //     risks a 400 on the whole create.

  const { data, error } = await karbonFetch<{ WorkItemKey?: string }>(
    "/WorkItems",
    credentials,
    { method: "POST", body: payload },
  )

  if (error || !data?.WorkItemKey) {
    console.error("[karbon-create-work-item] POST /WorkItems failed:", error)
    return { ok: false, error: error || "Karbon did not return a WorkItemKey" }
  }

  const workItemUrl = `${KARBON_TENANT_BASE}/work/${data.WorkItemKey}`

  // Let the caller record the key before anything else can go wrong.
  try {
    await deps.onCreated?.({
      workItemKey: data.WorkItemKey,
      title,
      workItemUrl,
      workTypeName: workType.name,
    })
  } catch (err) {
    console.error("[karbon-create-work-item] onCreated handler failed:", err)
  }

  // Step 2 — status + tax dates, now that the work item exists. Never
  // throws and never fails the create: the item is already in Karbon.
  const finalize = await finalizeKarbonWorkItem(
    {
      workItemKey: data.WorkItemKey,
      workTypeName: workType.name,
      workTypeKey: workType.key,
      workTemplateKey: args.workTemplateKey,
      title,
      explicitStartDate: args.startDate ?? null,
      explicitDueDate: args.dueDate ?? null,
      explicitWorkStatusKey: args.workStatusKey ?? null,
      lead: args.lead ?? null,
    },
    { supabase, credentials },
  )

  return {
    ok: true,
    workItemKey: data.WorkItemKey,
    title,
    workItemUrl,
    workTypeName: workType.name,
    finalize,
  }
}
