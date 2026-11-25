/**
 * Create a Karbon WorkItem for an intake prospect.
 *
 * This mirrors the legacy Zapier flow the firm used before Motta Hub
 * existed:
 *
 *   - Step 10 (SCRIPT): built the title from first / last / work type
 *     / fiscal year, replacing hyphens with bars in the work type.
 *   - Step 11 (POST):   posted to `https://api.karbonhq.com/v3/WorkItems`
 *     with `ClientType=Contact`, `WorkType="TAX | Individual (1040)"`,
 *     `WorkTemplateKey=4lgMRtcGXwDl`, and a Bearer token in the
 *     `Authorization` header.
 *
 * The Karbon API itself attaches the new work item to the prospect's
 * Contact timeline automatically when we supply a `ClientKey`, so the
 * caller does NOT need to post a separate Note for that. (We DO post a
 * separate intake-summary note when a brand-new contact is created —
 * that lives in `lib/karbon/post-intake-note.ts` and runs in the
 * Jotform ingest pipeline.)
 *
 * All Karbon-facing constants are exported so the API route + the
 * confirmation dialog can render an accurate preview of the title that
 * will be posted, without having to round-trip through this module.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"
import {
  finalizeKarbonWorkItem,
  type FinalizeWorkItemResult,
  type LeadContext,
} from "@/lib/karbon/finalize-work-item"
import {
  resolveTaxYear,
  taxReturnSchedule,
  toKarbonDateTime,
} from "@/lib/karbon/tax-work-item-defaults"

// ── Constants pulled directly from the Zapier flow ────────────────────
// (See the user-supplied screenshots: Step 10 "SCRIPT | Create Work
// Title Name" and Step 11 "POST | Create Prospect 1040 Work Item".)
//
// These are the Individual (1040) work-template specifics — they
// describe the *type* of work, not the prospect. They live as module
// constants because they don't vary per submission; the user picks
// the fiscal year + start date in the UI and everything else is fixed.
export const INDIVIDUAL_1040_WORK_TEMPLATE_KEY = "4lgMRtcGXwDl"
export const INDIVIDUAL_1040_WORK_TYPE = "TAX | Individual (1040)"
export const INDIVIDUAL_1040_CLIENT_TYPE = "Contact"

// Karbon tenant base URL used to build deep-links. Hard-coded to the
// Motta tenant since this codebase is single-tenant; matches the same
// constant in post-debrief-note.ts (`KARBON_TENANT_BASE`). Kept local
// rather than imported so this module has zero internal dependencies.
const KARBON_TENANT_BASE = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

// ── Title builder ─────────────────────────────────────────────────────
//
// Equivalent to the Zapier Step 10 JavaScript:
//
//   function replaceHyphenWithBar(text) { return text.replace(/-/g, '|') }
//   function generateTitle(firstName, lastName, workType, fiscalYear) {
//     return `${replaceHyphenWithBar(workType)} | ${lastName}, ${firstName} | ${fiscalYear}`
//   }
//
// I'm replicating the hyphen-to-bar swap even though our constant
// `INDIVIDUAL_1040_WORK_TYPE` already uses bars — the firm's
// convention may evolve to add a hyphenated work type later, and
// matching the legacy script avoids surprise when someone copy/pastes
// a Karbon work type string in.

export function buildIntakeWorkItemTitle(args: {
  firstName: string
  lastName: string
  fiscalYear: string
  workType?: string
}): string {
  const workType = (args.workType || INDIVIDUAL_1040_WORK_TYPE).replace(/-/g, "|")
  const last = (args.lastName || "").trim()
  const first = (args.firstName || "").trim()
  const fy = (args.fiscalYear || "").trim()
  return `${workType} | ${last}, ${first} | ${fy}`
}

// ── Public API ────────────────────────────────────────────────────────

export interface CreateIntakeWorkItemArgs {
  /** Karbon ContactKey of the prospect — required by Karbon's API. */
  contactKey: string
  firstName: string
  lastName: string
  /** e.g. "2026" or "LEAD" — the literal value that goes in the title. */
  fiscalYear: string
  /** Email of the teammate to assign the work item to. */
  assigneeEmail: string
  /**
   * StartDate posted to Karbon, ISO 8601. The Zapier flow used
   * `2025-12-31T00:00:00Z` — Dec 31 of the tax year the return covers.
   * Defaults to Dec 31 of the tax year named by `fiscalYear` (or, when
   * that isn't a year — "LEAD" — the seasonal default tax year).
   */
  startDate?: string
  /**
   * Who the work item is for. Lets the post-create step move the item to
   * "Lead | Meeting Schd" when this prospect has a Calendly meeting booked.
   */
  lead?: LeadContext | null
}

export interface CreateIntakeWorkItemResult {
  ok: boolean
  /** Set when ok=true. */
  workItemKey?: string
  /** Always populated when ok=true; useful for client-side rendering. */
  title?: string
  /** Karbon tenant deep-link to the new work item. */
  workItemUrl?: string
  /** Reason a caller should surface to the user when ok=false. */
  error?: string
  /** Set when ok=false and we never even reached Karbon. */
  skipped?: "no_credentials"
  /** Outcome of the post-create status / start / due / deadline update. */
  finalize?: FinalizeWorkItemResult
}

/**
 * The firm-convention dates for this 1040: start 12/31 of the tax year,
 * due + deadline 4/15 of the following year. The tax year is the one the
 * teammate typed into the fiscal-year field; a non-year value ("LEAD")
 * falls back to the seasonal default (see `defaultProspectTaxYear`).
 *
 * The legacy Zapier flow hard-coded `2025-12-31T00:00:00Z`, and the first
 * Hub version used "Dec 31 of the current calendar year" — which is a
 * year late for anyone who walks in during filing season.
 */
function startDateFor(fiscalYear: string): string {
  const { taxYear } = resolveTaxYear({ fiscalYear })
  return taxReturnSchedule("1040", taxYear)?.startDate ?? `${taxYear}-12-31`
}

/** What the caller is told the moment the work item exists in Karbon. */
export interface CreatedWorkItem {
  workItemKey: string
  title: string
  workItemUrl: string
}

export async function createIntakeWorkItem(
  args: CreateIntakeWorkItemArgs,
  credentialsOverride?: KarbonApiConfig,
  deps: {
    supabase?: SupabaseClient
    /**
     * Called as soon as Karbon has created the work item — BEFORE the
     * status/date follow-up. Callers persist the key here: the follow-up
     * can take several seconds (two PATCHes with retries), and a work
     * item that exists in Karbon but isn't recorded locally is exactly
     * how a second click mints a duplicate.
     */
    onCreated?: (created: CreatedWorkItem) => Promise<void> | void
  } = {},
): Promise<CreateIntakeWorkItemResult> {
  const credentials = credentialsOverride ?? getKarbonCredentials()
  if (!credentials) {
    console.warn("[karbon-intake-work-item] Karbon credentials missing — skipping create.")
    return { ok: false, skipped: "no_credentials", error: "Karbon credentials are not configured" }
  }

  const title = buildIntakeWorkItemTitle({
    firstName: args.firstName,
    lastName: args.lastName,
    fiscalYear: args.fiscalYear,
  })

  // Payload key names mirror Karbon's WorkItemDTO exactly (PascalCase).
  // The create call stays minimal on purpose: status and the due /
  // deadline dates are applied by the finalize step AFTER the work item
  // exists (below), so Karbon sees them as changes to a live work item
  // and its workflow automations run. StartDate is the one date that
  // must be here — Karbon requires it on create.
  const payload = {
    Title: title,
    ClientKey: args.contactKey,
    ClientType: INDIVIDUAL_1040_CLIENT_TYPE,
    WorkType: INDIVIDUAL_1040_WORK_TYPE,
    WorkTemplateKey: INDIVIDUAL_1040_WORK_TEMPLATE_KEY,
    AssigneeEmailAddress: args.assigneeEmail,
    StartDate: args.startDate || toKarbonDateTime(startDateFor(args.fiscalYear)),
  }

  const { data, error } = await karbonFetch<{ WorkItemKey?: string }>(
    "/WorkItems",
    credentials,
    { method: "POST", body: payload },
  )

  if (error || !data?.WorkItemKey) {
    console.error("[karbon-intake-work-item] POST /WorkItems failed:", error)
    return { ok: false, error: error || "Karbon did not return a WorkItemKey" }
  }

  const workItemUrl = `${KARBON_TENANT_BASE}/work/${data.WorkItemKey}`

  // Let the caller record the key before anything else can go wrong.
  try {
    await deps.onCreated?.({ workItemKey: data.WorkItemKey, title, workItemUrl })
  } catch (err) {
    console.error("[karbon-intake-work-item] onCreated handler failed:", err)
  }

  // Step 2 — now that the work item exists, set the status the firm's
  // Karbon workflow expects ("Lead | Meeting Schd" when the prospect has
  // a Calendly meeting booked, "Lead | Awaiting Intake" until then) and
  // the start / due / deadline dates (12/31 of the tax year → 4/15).
  // Never throws, and never fails the create: the work item is already
  // in Karbon either way.
  const finalize = await finalizeKarbonWorkItem(
    {
      workItemKey: data.WorkItemKey,
      workTypeName: INDIVIDUAL_1040_WORK_TYPE,
      workTemplateKey: INDIVIDUAL_1040_WORK_TEMPLATE_KEY,
      title,
      fiscalYear: args.fiscalYear,
      explicitStartDate: args.startDate ?? null,
      lead: args.lead ?? null,
    },
    { supabase: deps.supabase, credentials },
  )

  return {
    ok: true,
    workItemKey: data.WorkItemKey,
    title,
    workItemUrl,
    finalize,
  }
}
