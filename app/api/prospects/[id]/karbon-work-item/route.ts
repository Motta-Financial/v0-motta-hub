/**
 * POST /api/prospects/[id]/karbon-work-item
 *
 * Creates a Karbon Individual (1040) WorkItem for the prospect on
 * the given internal prospect submission. Mirrors
 * `app/api/jotform/intake/[id]/karbon-work-item/route.ts` line-for-
 * line so the two surfaces behave identically — same Karbon work
 * template, same title formula, same idempotency guard, same
 * cross-link note on the Contact's timeline.
 *
 * The only differences vs. the intake variant:
 *   - reads from `prospect_submissions` instead of
 *     `jotform_intake_submissions`
 *   - posts a different "source" line in the Karbon note body so the
 *     timeline entry reads "Internal Prospect Form" rather than
 *     "Intake Form".
 *
 * Request body (all optional):
 *   { fiscalYear?: string, startDate?: string }
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildIntakeWorkItemTitle,
  createIntakeWorkItem,
} from "@/lib/karbon/create-intake-work-item"
import { postIntakeNoteToKarbon } from "@/lib/karbon/post-intake-note"

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
      return NextResponse.json({ error: "Invalid prospect id" }, { status: 400 })
    }

    const body: RequestBody = await req.json().catch(() => ({}))
    const supabase = createAdminClient()

    // ── 1. Load the prospect row ───────────────────────────────────
    const { data: submission, error: submissionError } = await supabase
      .from("prospect_submissions")
      .select(
        [
          "id",
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
          "internal_notes",
          "meeting_context",
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
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 })
    }
    const row = submission as Record<string, any>

    // ── 2. Idempotency guard ───────────────────────────────────────
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

    // ── 3. Validate prerequisites ──────────────────────────────────
    if (!row.contact_id) {
      return NextResponse.json(
        {
          error:
            "This prospect isn't linked to a Karbon contact yet. Link or create the contact before creating a Karbon work item.",
          code: "no_contact",
        },
        { status: 422 },
      )
    }
    if (!row.assigned_to_id) {
      return NextResponse.json(
        {
          error:
            "Assign a Motta teammate to this prospect before creating the Karbon work item.",
          code: "no_assignee",
        },
        { status: 422 },
      )
    }

    // ── 4. Resolve Karbon contact key + assignee email ─────────────
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

    // ── 5. Resolve first/last name ─────────────────────────────────
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
            "Prospect is missing a first or last name — cannot build a Karbon work item title.",
          code: "no_name",
        },
        { status: 422 },
      )
    }

    // ── 6. Default fiscal year ─────────────────────────────────────
    const fiscalYear =
      (body.fiscalYear || "").trim() || String(new Date().getUTCFullYear())
    const previewTitle = buildIntakeWorkItemTitle({ firstName, lastName, fiscalYear })

    // ── 7. Hit Karbon ──────────────────────────────────────────────
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
        { error: result.error || "Karbon refused the work item", previewTitle },
        { status: 502 },
      )
    }

    // ── 8. Persist on the prospect row ─────────────────────────────
    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabase
      .from("prospect_submissions")
      .update({
        karbon_work_item_key: result.workItemKey,
        karbon_work_item_title: result.title ?? previewTitle,
        karbon_work_item_url: result.workItemUrl ?? null,
        karbon_work_item_created_at: nowIso,
      })
      .eq("id", id)

    if (updateError) {
      console.error("[prospect-karbon-work-item] persist error:", updateError.message)
    }

    // ── 9. Cross-link Karbon timeline note ─────────────────────────
    // We reuse the intake note builder but inject a synthetic
    // `additional_notes` block so the partner reading the timeline
    // sees both the meeting_context and the teammate's internal
    // notes (the intake version pulled these from the prospect
    // themselves). Best-effort — failures get logged, not surfaced.
    void postIntakeNoteToKarbon(
      { entityType: "Contact", entityKey: contact.karbon_contact_key },
      {
        ...(row as any),
        // Surface the teammate-authored content under the same
        // keys the note builder already reads so the rendered
        // HTML matches the intake layout.
        questions_or_concerns: row.internal_notes ?? null,
        additional_notes: row.meeting_context
          ? `Meeting context: ${row.meeting_context}`
          : null,
      },
      {
        workItem: {
          title: result.title ?? previewTitle,
          url: result.workItemUrl ?? "",
        },
        authorEmail: assignee.email,
      },
    ).catch((err) => {
      console.error("[prospect-karbon-work-item] cross-link note failed:", err)
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
    console.error("[v0] POST /api/prospects/[id]/karbon-work-item error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 },
    )
  }
}
