import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildIntakeWorkItemTitle,
  createIntakeWorkItem,
} from "@/lib/karbon/create-intake-work-item"
import { postIntakeNoteToKarbon } from "@/lib/karbon/post-intake-note"

/**
 * POST /api/jotform/intake/[id]/karbon-work-item
 *
 * Creates a Karbon Individual (1040) WorkItem for the prospect on the
 * given intake submission. Replaces the legacy Zapier flow that fired
 * on every new intake.
 *
 * Behavior:
 *   1. Loads the intake row + the linked Karbon contact key.
 *   2. Resolves the assignee's email from `team_members.email` so the
 *      Karbon API knows who owns the new work item.
 *   3. Builds the title using the firm's naming convention
 *      "TAX | Individual (1040) | Last, First | <fiscalYear>".
 *   4. POSTs to Karbon, persists the returned WorkItemKey on the
 *      intake row so subsequent clicks are no-ops, and posts a
 *      cross-link note onto the contact's timeline.
 *
 * Idempotency: if `karbon_work_item_key` is already set on the row
 * the route returns the existing work item record without calling
 * Karbon again. The UI uses this to render a "View in Karbon" link.
 *
 * Request body (all optional):
 *   {
 *     "fiscalYear": "2026" | "LEAD" | "[NEW CLIENT]" | string,
 *     "startDate":  "2026-12-31T00:00:00Z"   // ISO; defaults to Dec 31 of current year
 *   }
 */

type RequestBody = {
  fiscalYear?: string
  startDate?: string
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id || !isUuid(id)) {
      return NextResponse.json({ error: "Invalid submission id" }, { status: 400 })
    }

    const body: RequestBody = await req.json().catch(() => ({}))
    const supabase = createAdminClient()

    // ── 1. Load the intake row ────────────────────────────────────
    // Select only what we need for the work item — keeps the
    // network payload tight and the type clear.
    const { data: submission, error: submissionError } = await supabase
      .from("jotform_intake_submissions")
      .select(
        [
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
        ].join(","),
      )
      .eq("id", id)
      .maybeSingle()

    if (submissionError) throw submissionError
    if (!submission) {
      return NextResponse.json({ error: "Intake submission not found" }, { status: 404 })
    }
    // Cast once — Supabase types come back as `Record<string, any>` and
    // the rest of the route reads these fields heavily.
    const row = submission as Record<string, any>

    // ── 2. Idempotency guard ──────────────────────────────────────
    // If we already created a work item for this submission, return
    // it as-is so the UI can swap to "View in Karbon" without firing
    // a second POST to Karbon.
    if (row.karbon_work_item_key) {
      return NextResponse.json({
        ok: true,
        alreadyExists: true,
        workItem: {
          key: row.karbon_work_item_key as string,
          title: (row.karbon_work_item_title as string) ?? null,
          url: (row.karbon_work_item_url as string) ?? null,
          createdAt: (row.karbon_work_item_created_at as string) ?? null,
        },
      })
    }

    // ── 3. Validate prerequisites ─────────────────────────────────
    // We need (a) a Karbon contact to attach the work item to and
    // (b) a teammate to assign it to. Both are surfaced clearly so
    // the UI can render an actionable error instead of a stack trace.
    if (!row.contact_id) {
      return NextResponse.json(
        {
          error:
            "This intake isn't linked to a Karbon contact yet. Link or create the contact before creating a Karbon work item.",
          code: "no_contact",
        },
        { status: 422 },
      )
    }

    if (!row.assigned_to_id) {
      return NextResponse.json(
        {
          error:
            "Assign a Motta teammate to this intake before creating the Karbon work item.",
          code: "no_assignee",
        },
        { status: 422 },
      )
    }

    // ── 4. Resolve Karbon contact key + assignee email ────────────
    // Parallelize the two lookups — neither depends on the other.
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

    if (contactError) throw contactError
    if (assigneeError) throw assigneeError

    if (!contact?.karbon_contact_key) {
      return NextResponse.json(
        {
          error:
            "Linked Supabase contact has no Karbon ContactKey — please sync this contact to Karbon first.",
          code: "no_karbon_contact_key",
        },
        { status: 422 },
      )
    }

    if (!assignee?.email) {
      return NextResponse.json(
        {
          error: "Assigned teammate has no email on file — cannot create Karbon work item.",
          code: "no_assignee_email",
        },
        { status: 422 },
      )
    }

    // ── 5. Resolve first/last name ────────────────────────────────
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
      return NextResponse.json(
        {
          error:
            "Intake is missing a first or last name — cannot build a Karbon work item title.",
          code: "no_name",
        },
        { status: 422 },
      )
    }

    // ── 6. Default fiscal year ────────────────────────────────────
    // User can override via body.fiscalYear; default to the current
    // calendar year (matches the example in the brief: "Le, Dat | 2026").
    const fiscalYear =
      (body.fiscalYear || "").trim() || String(new Date().getUTCFullYear())

    // Show a preview of the title to the UI BEFORE we POST — useful
    // for debugging when Karbon rejects the request.
    const previewTitle = buildIntakeWorkItemTitle({ firstName, lastName, fiscalYear })

    // ── 7. Hit Karbon ─────────────────────────────────────────────
    const result = await createIntakeWorkItem({
      contactKey: contact.karbon_contact_key,
      firstName,
      lastName,
      fiscalYear,
      assigneeEmail: assignee.email,
      startDate: body.startDate,
    })

    if (!result.ok || !result.workItemKey) {
      return NextResponse.json(
        {
          error: result.error || "Karbon refused the work item",
          previewTitle,
        },
        { status: 502 },
      )
    }

    // ── 8. Persist on the intake row ──────────────────────────────
    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabase
      .from("jotform_intake_submissions")
      .update({
        karbon_work_item_key: result.workItemKey,
        karbon_work_item_title: result.title ?? previewTitle,
        karbon_work_item_url: result.workItemUrl ?? null,
        karbon_work_item_created_at: nowIso,
      })
      .eq("id", id)

    if (updateError) {
      // We still return the work item — Karbon's source of truth is
      // its own DB; logging is enough for ops to reconcile.
      console.error("[karbon-work-item] persist error:", updateError.message)
    }

    // ── 9. Cross-link timeline note ───────────────────────────────
    // Fire-and-forget: a missing/duplicate note isn't worth failing
    // the user-visible request over. Karbon's automatic
    // "work item attached" timeline entry already covers the worst
    // case if this POST fails.
    //
    // The same note is attached to BOTH the contact's timeline and the
    // new work item's timeline (additionalTimelines) and pinned, so the
    // full intake form context is pinned to the top of the work item.
    void postIntakeNoteToKarbon(
      { entityType: "Contact", entityKey: contact.karbon_contact_key },
      row as any,
      {
        workItem: {
          title: result.title ?? previewTitle,
          url: result.workItemUrl ?? "",
        },
        authorEmail: assignee.email,
        pinned: true,
        additionalTimelines: [
          { entityType: "WorkItem", entityKey: result.workItemKey },
        ],
      },
    ).catch((err) => {
      console.error("[karbon-work-item] cross-link note failed:", err)
    })

    return NextResponse.json({
      ok: true,
      alreadyExists: false,
      workItem: {
        key: result.workItemKey,
        title: result.title ?? previewTitle,
        url: result.workItemUrl ?? null,
        createdAt: nowIso,
      },
    })
  } catch (err: any) {
    console.error("[v0] POST /api/jotform/intake/[id]/karbon-work-item error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 },
    )
  }
}
