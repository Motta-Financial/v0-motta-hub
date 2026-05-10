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

import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"

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
   * `2025-12-31T00:00:00Z` — Dec 31 of the year the work begins.
   * Defaults to Dec 31 of the current calendar year when omitted.
   */
  startDate?: string
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
}

/**
 * Default StartDate when the caller doesn't supply one. Dec 31 of the
 * current calendar year in UTC, matching the convention from the
 * legacy Zapier flow (which hard-coded `2025-12-31T00:00:00Z`).
 */
function defaultStartDate(): string {
  const year = new Date().getUTCFullYear()
  return `${year}-12-31T00:00:00Z`
}

export async function createIntakeWorkItem(
  args: CreateIntakeWorkItemArgs,
  credentialsOverride?: KarbonApiConfig,
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
  // Fields beyond these are accepted by Karbon but rejected by our
  // intake convention — we intentionally don't pass `WorkStatus`,
  // `Description`, `Deadline`, etc. so the work template's own
  // defaults (planned status, no description) apply.
  const payload = {
    Title: title,
    ClientKey: args.contactKey,
    ClientType: INDIVIDUAL_1040_CLIENT_TYPE,
    WorkType: INDIVIDUAL_1040_WORK_TYPE,
    WorkTemplateKey: INDIVIDUAL_1040_WORK_TEMPLATE_KEY,
    AssigneeEmailAddress: args.assigneeEmail,
    StartDate: args.startDate || defaultStartDate(),
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

  return {
    ok: true,
    workItemKey: data.WorkItemKey,
    title,
    workItemUrl: `${KARBON_TENANT_BASE}/work/${data.WorkItemKey}`,
  }
}
