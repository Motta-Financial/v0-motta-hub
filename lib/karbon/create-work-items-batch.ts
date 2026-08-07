/**
 * Create several Karbon work items from `WorkItemBuilder` drafts.
 *
 * The single-template creators that came before this
 * (`create-intake-work-item.ts`, pinned to the Individual 1040 template;
 * `create-work-item.ts`, generic but one-at-a-time) each served exactly
 * one caller. This is the shared path for surfaces where a teammate
 * queues up whatever the engagement actually needs — a discovery call
 * that produces a 1040 *and* a bookkeeping cleanup *and* an S-corp
 * election shouldn't require three round-trips through the UI.
 *
 * ── Partial success is the expected outcome, not an error ────────────
 * Karbon can reject one work item (bad template, assignee not a Karbon
 * user) while accepting its siblings. We create each independently and
 * return per-draft results, so the caller can persist the ones that
 * landed and report the ones that didn't. Aborting the batch on the
 * first failure would be worse: the teammate would have to work out
 * which ones already exist before retrying.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createWorkItem } from "@/lib/karbon/create-work-item"

export interface WorkItemDraftPayload {
  template_key: string
  title: string
  work_type_key?: string | null
  assignee_team_member_id?: string | null
  work_status_key?: string | null
  start_date?: string | null
  due_date?: string | null
  budgeted_hours?: number | null
}

export interface BatchWorkItemResult {
  title: string
  ok: boolean
  workItemKey?: string
  workItemUrl?: string
  /** The `work_items` row id, once the created item is mirrored locally. */
  workItemRowId?: string
  error?: string
}

export interface CreateWorkItemsBatchArgs {
  drafts: WorkItemDraftPayload[]
  /** Karbon ContactKey or OrganizationKey to hang the work items on. */
  clientKey: string
  clientType: "Contact" | "Organization"
  /** Hub ids, so the locally-mirrored rows are attributable. */
  contactId?: string | null
  organizationId?: string | null
}

/**
 * Resolve `team_members.id` → email in one query, since Karbon assigns by
 * email address and the form works in Hub ids.
 */
async function resolveAssigneeEmails(
  supabase: SupabaseClient,
  drafts: WorkItemDraftPayload[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(drafts.map((d) => d.assignee_team_member_id).filter(Boolean) as string[]),
  )
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const { data } = await supabase.from("team_members").select("id, email").in("id", ids)
  for (const m of data ?? []) {
    if (m.email) out.set(m.id as string, m.email as string)
  }
  return out
}

/**
 * Mirror a freshly-created Karbon work item into `work_items` so the Hub
 * can reference it by row id immediately — join tables
 * (`debrief_work_items`, `deal_work_items`) take a `work_items.id`, and
 * waiting for the next Karbon sync would leave those links dangling for
 * up to 15 minutes.
 *
 * Deliberately minimal: the Karbon sync owns this table and will enrich
 * the row on its next pass. We write only what identifies it.
 */
async function mirrorWorkItemRow(
  supabase: SupabaseClient,
  args: {
    karbonWorkItemKey: string
    title: string
    workType?: string | null
    contactId?: string | null
    organizationId?: string | null
    karbonClientKey: string
    karbonUrl?: string | null
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("work_items")
    .upsert(
      {
        karbon_work_item_key: args.karbonWorkItemKey,
        title: args.title,
        work_type: args.workType ?? null,
        contact_id: args.contactId ?? null,
        organization_id: args.organizationId ?? null,
        karbon_client_key: args.karbonClientKey,
        karbon_url: args.karbonUrl ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "karbon_work_item_key" },
    )
    .select("id")
    .maybeSingle()

  if (error) {
    // Non-fatal: the work item exists in Karbon, which is what matters.
    // The next sync will create the local row; only the immediate join
    // link is lost.
    console.warn("[karbon-batch] work_items mirror failed:", error.message)
    return null
  }
  return data?.id ?? null
}

export async function createWorkItemsBatch(
  supabase: SupabaseClient,
  args: CreateWorkItemsBatchArgs,
): Promise<BatchWorkItemResult[]> {
  if (args.drafts.length === 0) return []

  const emails = await resolveAssigneeEmails(supabase, args.drafts)
  const results: BatchWorkItemResult[] = []

  // Sequential rather than parallel: Karbon's API is rate-sensitive and a
  // batch here is a handful of items, so the latency cost is trivial next
  // to the risk of tripping a throttle mid-submit.
  for (const draft of args.drafts) {
    if (!draft.template_key || !draft.title?.trim()) {
      results.push({
        title: draft.title ?? "(untitled)",
        ok: false,
        error: "Missing template or title",
      })
      continue
    }

    try {
      const created = await createWorkItem({
        clientKey: args.clientKey,
        clientType: args.clientType,
        workTemplateKey: draft.template_key,
        title: draft.title.trim(),
        workType: draft.work_type_key ?? null,
        assigneeEmail: draft.assignee_team_member_id
          ? (emails.get(draft.assignee_team_member_id) ?? null)
          : null,
        startDate: draft.start_date ?? null,
        dueDate: draft.due_date ?? null,
        budgetedHours: draft.budgeted_hours ?? null,
        workStatusKey: draft.work_status_key ?? null,
      })

      if (!created.ok || !created.workItemKey) {
        results.push({
          title: draft.title,
          ok: false,
          error: created.error || created.skipped || "Karbon refused the work item",
        })
        continue
      }

      const rowId = await mirrorWorkItemRow(supabase, {
        karbonWorkItemKey: created.workItemKey,
        title: created.title ?? draft.title,
        workType: draft.work_type_key ?? null,
        contactId: args.contactId,
        organizationId: args.organizationId,
        karbonClientKey: args.clientKey,
        karbonUrl: created.workItemUrl ?? null,
      })

      results.push({
        title: created.title ?? draft.title,
        ok: true,
        workItemKey: created.workItemKey,
        workItemUrl: created.workItemUrl,
        workItemRowId: rowId ?? undefined,
      })
    } catch (err) {
      results.push({
        title: draft.title,
        ok: false,
        error: (err as Error).message,
      })
    }
  }

  return results
}
