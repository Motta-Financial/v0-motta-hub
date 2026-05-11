/**
 * POST /api/prospects
 *
 * Creates an internal "prospect" submission — the Motta Hub-native
 * counterpart to a Jotform intake. Teammates use this when they've
 * met a prospect out in the world (conference, referral, text
 * message intro) and the prospect would never fill out the public
 * Jotform themselves.
 *
 * Pipeline (mirrors lib/jotform/ingest.ts at the relevant steps):
 *   1. Validate the minimum required fields (created_by + a name).
 *   2. Insert the prospect row.
 *   3. Auto-link to an existing Karbon contact, or auto-create one
 *      via `findOrCreateClient` so the row is immediately ready for
 *      the "Create Karbon Work Item" action on the detail page.
 *   4. Return the created row's id; client redirects to /prospects/[id].
 *
 * Attachments are handled by the separate /attachments route — this
 * route deals only with the structured form payload because file
 * uploads need multipart/form-data while everything else here is
 * JSON.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { findOrCreateClient } from "@/lib/karbon/client-sync"

interface CreateProspectBody {
  // Always required — the teammate filing the form.
  created_by_id: string

  meeting_context?: string | null

  submitter_first_name?: string | null
  submitter_last_name?: string | null
  submitter_email?: string | null
  submitter_phone?: string | null
  submitter_city?: string | null
  submitter_state?: string | null
  submitter_zip?: string | null

  services_requested?: string[] | null
  service_focus?: string | null
  entity_types?: string[] | null

  business_name?: string | null
  business_email?: string | null
  business_phone?: string | null
  business_state?: string | null
  business_tax_classification?: string | null
  business_revenue_range?: string | null
  business_employee_count?: string | null
  business_uses_accounting_system?: string | null
  business_situation?: string | null
  business_summary?: string | null

  internal_notes?: string | null

  // Optional teammate to assign the prospect to. Defaults to the
  // creator if omitted — most of the time the teammate filing the
  // form is also the one who will own the follow-up.
  assigned_to_id?: string | null
}

function isUuid(s: string | undefined | null): s is string {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateProspectBody

    // ── 1. Validate ────────────────────────────────────────────────
    if (!isUuid(body.created_by_id)) {
      return NextResponse.json(
        { error: "created_by_id is required and must be a valid UUID" },
        { status: 400 },
      )
    }

    const hasName =
      (body.submitter_first_name?.trim() && body.submitter_last_name?.trim()) ||
      body.business_name?.trim()
    if (!hasName) {
      return NextResponse.json(
        {
          error:
            "At least a first + last name OR a business name is required to create a prospect.",
        },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    // ── 2. Insert the row ──────────────────────────────────────────
    // submitter_full_name is derived from first/last so downstream
    // helpers (Karbon note builder, intake matcher) don't have to
    // re-derive it.
    const first = body.submitter_first_name?.trim() ?? null
    const last = body.submitter_last_name?.trim() ?? null
    const fullName = [first, last].filter(Boolean).join(" ").trim() || null

    const assigneeId = isUuid(body.assigned_to_id) ? body.assigned_to_id : body.created_by_id

    const { data: inserted, error: insertError } = await supabase
      .from("prospect_submissions")
      .insert({
        created_by_id: body.created_by_id,
        meeting_context: body.meeting_context?.trim() || null,

        submitter_first_name: first,
        submitter_last_name: last,
        submitter_full_name: fullName,
        submitter_email: body.submitter_email?.trim().toLowerCase() || null,
        submitter_phone: body.submitter_phone?.trim() || null,
        submitter_city: body.submitter_city?.trim() || null,
        submitter_state: body.submitter_state?.trim() || null,
        submitter_zip: body.submitter_zip?.trim() || null,

        services_requested: body.services_requested?.length ? body.services_requested : null,
        service_focus: body.service_focus?.trim() || null,
        entity_types: body.entity_types?.length ? body.entity_types : null,

        business_name: body.business_name?.trim() || null,
        business_email: body.business_email?.trim().toLowerCase() || null,
        business_phone: body.business_phone?.trim() || null,
        business_state: body.business_state?.trim() || null,
        business_tax_classification: body.business_tax_classification?.trim() || null,
        business_revenue_range: body.business_revenue_range?.trim() || null,
        business_employee_count: body.business_employee_count?.trim() || null,
        business_uses_accounting_system:
          body.business_uses_accounting_system?.trim() || null,
        business_situation: body.business_situation?.trim() || null,
        business_summary: body.business_summary?.trim() || null,

        internal_notes: body.internal_notes?.trim() || null,

        assigned_to_id: assigneeId,
        lead_status: "new",
      })
      .select("id")
      .single()

    if (insertError || !inserted) {
      console.error("[v0] POST /api/prospects insert error:", insertError)
      return NextResponse.json(
        { error: insertError?.message || "Failed to create prospect" },
        { status: 500 },
      )
    }

    // ── 3. Auto-link / create Karbon contact ───────────────────────
    // Best-effort: failures here don't fail the request. The row is
    // already persisted; the detail page will show the "no linked
    // contact yet" affordance and the teammate can resolve manually.
    try {
      const linkResult = await findOrCreateClient(
        {
          email: body.submitter_email ?? undefined,
          fullName: fullName ?? undefined,
          businessName: body.business_name ?? undefined,
          phone: body.submitter_phone ?? undefined,
        },
        { autoCreate: true, source: "Motta Hub Prospect Form" },
      )

      if (linkResult.contact_id || linkResult.organization_id) {
        const linkMethod =
          linkResult.method === "karbon_created"
            ? "auto_karbon_created"
            : linkResult.method === "karbon_match"
              ? "auto_karbon_match"
              : "auto_email" // supabase_match — most likely matched by email

        await supabase
          .from("prospect_submissions")
          .update({
            contact_id: linkResult.contact_id,
            organization_id: linkResult.organization_id,
            link_method: linkMethod,
            linked_at: new Date().toISOString(),
          })
          .eq("id", inserted.id)
      }
    } catch (err) {
      console.error("[v0] POST /api/prospects auto-link failed:", err)
    }

    return NextResponse.json({ id: inserted.id }, { status: 201 })
  } catch (err: any) {
    console.error("[v0] POST /api/prospects error:", err)
    return NextResponse.json(
      { error: err?.message || "Internal error" },
      { status: 500 },
    )
  }
}
