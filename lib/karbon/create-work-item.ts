/**
 * Create a Karbon WorkItem from ANY work template.
 *
 * This is the generic counterpart to `create-intake-work-item.ts` (which
 * is hard-wired to the Individual 1040 template). The prospect form's
 * optional "Create Karbon Work Item" section lets a teammate pick any
 * synced work template and fill in the core WorkItem fields, so we need
 * a creator that isn't pinned to a single template/work type.
 *
 * Field names mirror Karbon's WorkItemDTO exactly (PascalCase). We only
 * send fields the teammate actually filled in; anything omitted falls
 * back to the work template's own defaults (status, budget, etc.).
 *
 * Karbon auto-attaches the new work item to the client's timeline when
 * we pass `ClientKey`, so no separate note is required for linkage.
 */

import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"

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
  /** Work type string or key associated with the template. Optional. */
  workType?: string | null
  /** Email of the teammate to assign. Optional. */
  assigneeEmail?: string | null
  /** ISO 8601 start date. Optional. */
  startDate?: string | null
  /** ISO 8601 due date. Optional. */
  dueDate?: string | null
  /** Budgeted hours for the work item. Optional. */
  budgetedHours?: number | null
  /** WorkStatusKey (primary/secondary status taxonomy). Optional. */
  workStatusKey?: string | null
}

export interface CreateWorkItemResult {
  ok: boolean
  workItemKey?: string
  title?: string
  workItemUrl?: string
  error?: string
  skipped?: "no_credentials"
}

function toKarbonDate(value?: string | null): string | undefined {
  if (!value) return undefined
  // Accept either a bare date ("2026-06-01") or a full ISO timestamp.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`
  return value
}

export async function createWorkItem(
  args: CreateWorkItemArgs,
  credentialsOverride?: KarbonApiConfig,
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

  const payload: Record<string, unknown> = {
    Title: args.title.trim(),
    ClientKey: args.clientKey,
    ClientType: args.clientType,
    WorkTemplateKey: args.workTemplateKey,
  }
  if (args.workType) payload.WorkType = args.workType
  if (args.assigneeEmail) payload.AssigneeEmailAddress = args.assigneeEmail
  const start = toKarbonDate(args.startDate)
  if (start) payload.StartDate = start
  const due = toKarbonDate(args.dueDate)
  if (due) payload.DueDate = due
  if (args.workStatusKey) payload.WorkStatusKey = args.workStatusKey
  if (typeof args.budgetedHours === "number" && args.budgetedHours > 0) {
    payload.Budget = { BudgetedHours: args.budgetedHours }
  }

  const { data, error } = await karbonFetch<{ WorkItemKey?: string }>(
    "/WorkItems",
    credentials,
    { method: "POST", body: payload },
  )

  if (error || !data?.WorkItemKey) {
    console.error("[karbon-create-work-item] POST /WorkItems failed:", error)
    return { ok: false, error: error || "Karbon did not return a WorkItemKey" }
  }

  return {
    ok: true,
    workItemKey: data.WorkItemKey,
    title: args.title.trim(),
    workItemUrl: `${KARBON_TENANT_BASE}/work/${data.WorkItemKey}`,
  }
}
