/**
 * POST /api/jotform/intake/[id]/karbon-work-items
 *
 * Create one or more Karbon work items for an intake prospect, from any
 * work template.
 *
 * The singular sibling route (`…/karbon-work-item`) is pinned to the
 * Individual 1040 template — `4lgMRtcGXwDl`, inherited verbatim from the
 * old Zap — so every intake prospect got a 1040 work item or nothing,
 * regardless of whether they came in for bookkeeping, payroll or an
 * S-corp election. That route stays as the one-click fast path for the
 * common case (and owns `karbon_work_item_key` on the row); this one
 * handles everything else.
 *
 * Body: { drafts: WorkItemDraftPayload[] } — the serialized output of
 * `components/karbon/work-item-builder.tsx`.
 *
 * Partial success is a normal outcome: Karbon can reject one item and
 * accept its siblings, so the response reports per-item results rather
 * than failing the whole request.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  createWorkItemsBatch,
  type WorkItemDraftPayload,
} from "@/lib/karbon/create-work-items-batch"

export const runtime = "nodejs"

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

    const body = (await req.json().catch(() => ({}))) as { drafts?: WorkItemDraftPayload[] }
    const drafts = Array.isArray(body.drafts) ? body.drafts : []
    if (drafts.length === 0) {
      return NextResponse.json({ error: "No work items supplied" }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: submission, error: subErr } = await supabase
      .from("jotform_intake_submissions")
      .select("id, contact_id, organization_id")
      .eq("id", id)
      .maybeSingle()

    if (subErr) throw subErr
    if (!submission) {
      return NextResponse.json({ error: "Intake submission not found" }, { status: 404 })
    }
    if (!submission.contact_id && !submission.organization_id) {
      return NextResponse.json(
        {
          error:
            "This intake isn't linked to a client yet. Link or create the contact before creating work items.",
          code: "no_contact",
        },
        { status: 422 },
      )
    }

    // Karbon hangs work items off a ClientKey, so we need the Karbon-side
    // identity — the Hub uuid alone isn't enough.
    let clientKey: string | null = null
    let clientType: "Contact" | "Organization" = "Contact"
    if (submission.organization_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("karbon_organization_key")
        .eq("id", submission.organization_id)
        .maybeSingle()
      if (org?.karbon_organization_key) {
        clientKey = org.karbon_organization_key
        clientType = "Organization"
      }
    }
    if (!clientKey && submission.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("karbon_contact_key")
        .eq("id", submission.contact_id)
        .maybeSingle()
      if (contact?.karbon_contact_key) {
        clientKey = contact.karbon_contact_key
        clientType = "Contact"
      }
    }

    if (!clientKey) {
      return NextResponse.json(
        {
          error:
            "The linked client has no Karbon key yet — sync it to Karbon before creating work items.",
          code: "no_karbon_client_key",
        },
        { status: 422 },
      )
    }

    const results = await createWorkItemsBatch(supabase, {
      drafts,
      clientKey,
      clientType,
      contactId: submission.contact_id,
      organizationId: submission.organization_id,
    })

    const created = results.filter((r) => r.ok)

    // Record the first created key on the intake row when it has none, so
    // the sheet's existing "work item created" state reflects reality and
    // the singular route's idempotency guard stays honest.
    if (created.length > 0 && created[0].workItemKey) {
      await supabase
        .from("jotform_intake_submissions")
        .update({
          karbon_work_item_key: created[0].workItemKey,
          karbon_work_item_title: created[0].title,
          karbon_work_item_url: created[0].workItemUrl ?? null,
          karbon_work_item_created_at: new Date().toISOString(),
        })
        .eq("id", id)
        .is("karbon_work_item_key", null)
    }

    return NextResponse.json({
      ok: created.length > 0,
      created: created.length,
      failed: results.length - created.length,
      results,
    })
  } catch (err) {
    console.error("[intake/karbon-work-items] failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    )
  }
}
