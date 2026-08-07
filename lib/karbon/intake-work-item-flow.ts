/**
 * Shared "create the prospect's Karbon work item" flow.
 *
 * Two callers with deliberately different failure semantics:
 *
 *   • `POST /api/jotform/intake/[id]/karbon-work-item` — a human clicked
 *     a button and is waiting. Every precondition failure must come back
 *     as an actionable message ("assign a teammate first"), so the route
 *     maps our `skipped` codes onto 422s.
 *
 *   • the auto-trigger on `lead_status → qualified` — nobody is watching.
 *     A missing assignee is not an error, it just means "not yet"; the
 *     teammate will click the button, or set the assignee and re-qualify.
 *     It logs and moves on.
 *
 * Both need identical resolution logic (Karbon contact key, assignee
 * email, first/last name, title convention) and identical side effects
 * (create, persist onto the intake row, post the pinned cross-link
 * note), so that lives here once. The difference is only in how the
 * caller reacts to a `skipped` result.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildIntakeWorkItemTitle,
  createIntakeWorkItem,
} from "@/lib/karbon/create-intake-work-item"
import { postIntakeNoteToKarbon } from "@/lib/karbon/post-intake-note"

/** Columns the flow reads off `jotform_intake_submissions`. */
export const INTAKE_WORK_ITEM_COLUMNS = [
  "id",
  "jotform_submission_id",
  "jotform_created_at",
  "submitter_full_name",
  "submitter_first_name",
  "submitter_last_name",
  "submitter_email",
  "submitter_phone",
  "submitter_city",
  "submitter_state",
  "submitter_zip",
  "business_name",
  "business_state",
  "business_summary",
  "business_revenue_range",
  "business_tax_classification",
  "business_situation",
  "service_focus",
  "services_requested",
  "entity_types",
  "questions_or_concerns",
  "additional_notes",
  "preferred_team_member",
  "enrichment",
  "question_research",
  "contact_id",
  "assigned_to_id",
  "karbon_work_item_key",
  "karbon_work_item_title",
  "karbon_work_item_url",
  "karbon_work_item_created_at",
] as const

export interface WorkItemSummary {
  key: string
  title: string | null
  url: string | null
  createdAt: string | null
}

/**
 * `skipped` means "a precondition wasn't met" — recoverable, and the
 * caller decides whether that's a 422 or a log line. `failed` means
 * Karbon itself refused.
 */
export type IntakeWorkItemOutcome =
  | { status: "created"; workItem: WorkItemSummary }
  | { status: "exists"; workItem: WorkItemSummary }
  | {
      status: "skipped"
      code:
        | "not_found"
        | "no_contact"
        | "no_assignee"
        | "no_karbon_contact_key"
        | "no_assignee_email"
        | "no_name"
      message: string
    }
  | { status: "failed"; message: string; previewTitle?: string }

export interface RunIntakeWorkItemOptions {
  /** Overrides the default "current calendar year". */
  fiscalYear?: string
  /** ISO date; `createIntakeWorkItem` defaults to Dec 31 of this year. */
  startDate?: string
}

export async function runIntakeWorkItemFlow(
  supabase: SupabaseClient,
  submissionId: string,
  options: RunIntakeWorkItemOptions = {},
): Promise<IntakeWorkItemOutcome> {
  const { data: submission, error: submissionError } = await supabase
    .from("jotform_intake_submissions")
    .select(INTAKE_WORK_ITEM_COLUMNS.join(","))
    .eq("id", submissionId)
    .maybeSingle()

  if (submissionError) {
    return { status: "failed", message: submissionError.message }
  }
  if (!submission) {
    return { status: "skipped", code: "not_found", message: "Intake submission not found" }
  }
  const row = submission as unknown as Record<string, any>

  // Idempotency: never mint a second Karbon work item for one intake.
  // Both callers rely on this — the button so a double-click is a no-op,
  // the auto-trigger so re-qualifying a lead doesn't duplicate.
  if (row.karbon_work_item_key) {
    return {
      status: "exists",
      workItem: {
        key: row.karbon_work_item_key as string,
        title: (row.karbon_work_item_title as string) ?? null,
        url: (row.karbon_work_item_url as string) ?? null,
        createdAt: (row.karbon_work_item_created_at as string) ?? null,
      },
    }
  }

  if (!row.contact_id) {
    return {
      status: "skipped",
      code: "no_contact",
      message:
        "This intake isn't linked to a Karbon contact yet. Link or create the contact before creating a Karbon work item.",
    }
  }
  if (!row.assigned_to_id) {
    return {
      status: "skipped",
      code: "no_assignee",
      message: "Assign a Motta teammate to this intake before creating the Karbon work item.",
    }
  }

  const [{ data: contact, error: contactError }, { data: assignee, error: assigneeError }] =
    await Promise.all([
      supabase
        .from("contacts")
        .select("id, karbon_contact_key, first_name, last_name, full_name")
        .eq("id", row.contact_id)
        .maybeSingle(),
      supabase
        .from("team_members")
        .select("id, email, full_name")
        .eq("id", row.assigned_to_id)
        .maybeSingle(),
    ])

  if (contactError) return { status: "failed", message: contactError.message }
  if (assigneeError) return { status: "failed", message: assigneeError.message }

  if (!contact?.karbon_contact_key) {
    return {
      status: "skipped",
      code: "no_karbon_contact_key",
      message:
        "Linked Supabase contact has no Karbon ContactKey — please sync this contact to Karbon first.",
    }
  }
  if (!assignee?.email) {
    return {
      status: "skipped",
      code: "no_assignee_email",
      message: "Assigned teammate has no email on file — cannot create Karbon work item.",
    }
  }

  // Prefer the structured intake columns; fall back to the synced
  // contact (most reliable when intake parsing missed something);
  // last-ditch parse the full_name on a single whitespace.
  const fallbackName = (row.submitter_full_name as string) || contact.full_name || ""
  const fallbackParts = fallbackName.trim().split(/\s+/)
  const firstName =
    (row.submitter_first_name as string)?.trim() ||
    contact.first_name ||
    fallbackParts[0] ||
    ""
  const lastName =
    (row.submitter_last_name as string)?.trim() ||
    contact.last_name ||
    fallbackParts.slice(1).join(" ") ||
    ""

  if (!firstName || !lastName) {
    return {
      status: "skipped",
      code: "no_name",
      message:
        "Intake is missing a first or last name — cannot build a Karbon work item title.",
    }
  }

  const fiscalYear =
    (options.fiscalYear || "").trim() || String(new Date().getUTCFullYear())
  const previewTitle = buildIntakeWorkItemTitle({ firstName, lastName, fiscalYear })

  const result = await createIntakeWorkItem({
    contactKey: contact.karbon_contact_key,
    firstName,
    lastName,
    fiscalYear,
    assigneeEmail: assignee.email,
    startDate: options.startDate,
  })

  if (!result.ok || !result.workItemKey) {
    return {
      status: "failed",
      message: result.error || "Karbon refused the work item",
      previewTitle,
    }
  }

  const nowIso = new Date().toISOString()
  const { error: updateError } = await supabase
    .from("jotform_intake_submissions")
    .update({
      karbon_work_item_key: result.workItemKey,
      karbon_work_item_title: result.title ?? previewTitle,
      karbon_work_item_url: result.workItemUrl ?? null,
      karbon_work_item_created_at: nowIso,
    })
    .eq("id", submissionId)

  if (updateError) {
    // The work item exists in Karbon regardless — Karbon is its own
    // source of truth. Log for reconciliation rather than failing.
    console.error("[karbon-work-item] persist error:", updateError.message)
  }

  // Fire-and-forget cross-link note, pinned to BOTH the contact timeline
  // and the new work item so the full intake context sits at the top of
  // the work item. Karbon's own "work item attached" entry covers the
  // worst case if this fails.
  void postIntakeNoteToKarbon(
    { entityType: "Contact", entityKey: contact.karbon_contact_key },
    row as any,
    {
      workItem: { title: result.title ?? previewTitle, url: result.workItemUrl ?? "" },
      authorEmail: assignee.email,
      pinned: true,
      additionalTimelines: [{ entityType: "WorkItem", entityKey: result.workItemKey }],
    },
  ).catch((err) => {
    console.error("[karbon-work-item] cross-link note failed:", err)
  })

  return {
    status: "created",
    workItem: {
      key: result.workItemKey,
      title: result.title ?? previewTitle,
      url: result.workItemUrl ?? null,
      createdAt: nowIso,
    },
  }
}
