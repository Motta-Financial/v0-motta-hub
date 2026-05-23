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
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import { buildProspectEmailHtml, sendEmail } from "@/lib/email"

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

  // Action items from the prospect form
  action_items?: Array<{
    description: string
    assignee_id: string
    assignee_name: string
    due_date: string | null
    priority: "low" | "medium" | "high"
    create_task: boolean
  }> | null

  // Optional teammate to assign the prospect to. Defaults to the
  // creator if omitted — most of the time the teammate filing the
  // form is also the one who will own the follow-up.
  assigned_to_id?: string | null

  // Platform-push picker. The form auto-recommends these based on
  // service_focus / business presence (see prospect-form.tsx) but the
  // teammate can uncheck any of them. The Hub contact is ALWAYS
  // created; these flags only control whether we queue a downstream
  // mirror call.
  //
  // - push_to_karbon: true today actually performs the create+mirror.
  //   This preserves the existing behaviour where every prospect ends
  //   up in Karbon ready for a work item.
  // - push_to_proconnect / push_to_ignition: stored as intent only;
  //   the actual API calls are queued by their respective sync
  //   workers (or invoked from the contact detail page) once the
  //   relevant integrations are wired up. The status starts as
  //   'queued' and the worker flips it to 'pushed' / 'failed'.
  push_to_karbon?: boolean
  push_to_proconnect?: boolean
  push_to_ignition?: boolean
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

    // Decide platform-push intent. Defaults mirror the form's "what
    // to recommend" logic so a curl-only client gets the same
    // pipeline as the UI:
    //   - Karbon: always recommended (every prospect is a billable
    //     candidate).
    //   - ProConnect: recommended when service_focus mentions tax.
    //   - Ignition: recommended when there's a business name (the
    //     proposal flow is almost always business-side).
    const focus = (body.service_focus ?? "").toLowerCase()
    const services = (body.services_requested ?? []).map((s) => s.toLowerCase())
    const looksTax =
      focus.includes("tax") ||
      services.some((s) => s.includes("tax") || s.includes("1040") || s.includes("return"))
    const hasBusiness = !!body.business_name?.trim()

    const pushToKarbon = body.push_to_karbon ?? true
    const pushToProconnect = body.push_to_proconnect ?? looksTax
    const pushToIgnition = body.push_to_ignition ?? hasBusiness

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

        action_items: body.action_items?.length ? body.action_items : null,

        assigned_to_id: assigneeId,
        lead_status: "new",

        // Platform-push intent. Karbon "queued" only when actually
        // pushing; the others stay queued until their workers run.
        push_to_karbon: pushToKarbon,
        karbon_push_status: pushToKarbon ? "queued" : "skipped",
        push_to_proconnect: pushToProconnect,
        proconnect_push_status: pushToProconnect ? "queued" : "skipped",
        push_to_ignition: pushToIgnition,
        ignition_push_status: pushToIgnition ? "queued" : "skipped",
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

    // ── 3. Master Hub Contact (always) + optional Karbon push ─────
    // The Master Hub Contact is the single source of truth (per the
    // Motta Hub data model). Calendly/Jotform/Zoom and now the
    // Prospect Form all funnel into the same `contacts` table; this
    // route used to call Karbon-first, which meant a Karbon outage
    // could leave a prospect un-linked. Hub-first guarantees we
    // always have a Hub contact id to redirect the teammate to.
    //
    // Karbon push is now governed by `pushToKarbon`. When true we
    // still call findOrCreateClient (which mirrors back into the
    // Hub) so the Karbon-mirrored fields like karbon_contact_key
    // get populated. When false we skip the push entirely — the
    // teammate can trigger it later from the detail page.
    let finalContactId: string | null = null
    let finalOrganizationId: string | null = null
    let finalLinkMethod: string | null = null

    try {
      const hub = await findOrCreateHubContact(
        {
          email: body.submitter_email ?? null,
          fullName: fullName ?? null,
          businessName: body.business_name ?? null,
          phone: body.submitter_phone ?? null,
        },
        { source: "prospect_form", supabase },
      )
      finalContactId = hub.contact_id
      finalOrganizationId = hub.organization_id
      finalLinkMethod = hub.created ? "auto_hub_created" : `auto_hub_${hub.method}`
    } catch (err) {
      console.error("[v0] POST /api/prospects hub create failed:", err)
    }

    if (pushToKarbon) {
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
        // Karbon's findOrCreateClient writes back to contacts/orgs
        // already; prefer its IDs since they carry the Karbon keys.
        if (linkResult.contact_id) finalContactId = linkResult.contact_id
        if (linkResult.organization_id) finalOrganizationId = linkResult.organization_id

        finalLinkMethod =
          linkResult.method === "karbon_created"
            ? "auto_karbon_created"
            : linkResult.method === "karbon_match"
              ? "auto_karbon_match"
              : finalLinkMethod ?? "auto_email"

        await supabase
          .from("prospect_submissions")
          .update({
            karbon_push_status: linkResult.contact_id || linkResult.organization_id
              ? "pushed"
              : "failed",
            karbon_pushed_at: new Date().toISOString(),
          })
          .eq("id", inserted.id)
      } catch (err) {
        console.error("[v0] POST /api/prospects Karbon push failed:", err)
        await supabase
          .from("prospect_submissions")
          .update({ karbon_push_status: "failed" })
          .eq("id", inserted.id)
      }
    }

    if (finalContactId || finalOrganizationId) {
      await supabase
        .from("prospect_submissions")
        .update({
          contact_id: finalContactId,
          organization_id: finalOrganizationId,
          link_method: finalLinkMethod,
          linked_at: new Date().toISOString(),
        })
        .eq("id", inserted.id)
    }

    // ── 4. Team-wide notification — UNCONDITIONAL ──────────────────
    // Same firm policy as debriefs: every new prospect is broadcast
    // to ALL active teammates (excluding Company / Alumni roles),
    // author included. In-app notification + email. Failures here
    // never fail the request — the row is already persisted, the
    // teammate is mid-redirect to the detail page, and we don't want
    // a transient Resend hiccup to surface as a "save failed" error.
    try {
      const { data: authorRow } = await supabase
        .from("team_members")
        .select("full_name")
        .eq("id", body.created_by_id)
        .single()
      const authorName = authorRow?.full_name || "A team member"

      // Display name for the email subject and body banner. Prefer the
      // person's name (consistent with how partners think about new
      // prospects), fall back to the business if it's a business-only.
      const prospectDisplayName =
        fullName || body.business_name?.trim() || "(unnamed prospect)"

      const { data: activeTeam } = await supabase
        .from("team_members")
        .select("id, full_name, email, role")
        .eq("is_active", true)
        .not("role", "eq", "Company")
        .not("role", "eq", "Alumni")

      const recipients = activeTeam || []

      if (recipients.length > 0) {
        // 4a. In-app notification row for every active teammate.
        //     Author gets a confirmation-styled message so they can
        //     verify the broadcast went through.
        const notifications = recipients.map((tm: any) => {
          const isAuthor = tm.id === body.created_by_id
          return {
            team_member_id: tm.id,
            notification_type: "prospect",
            entity_type: "prospect",
            entity_id: inserted.id,
            title: isAuthor ? "Prospect Submitted" : "New Prospect",
            message: isAuthor
              ? `Your prospect ${prospectDisplayName} was saved and emailed to the team.`
              : `${authorName} added a new prospect: ${prospectDisplayName}`,
            action_url: `/prospects/${inserted.id}`,
            is_read: false,
          }
        })
        await supabase.from("notifications").insert(notifications)

        // 4b. Email every active teammate who has an email address.
        //     Like debriefs this bypasses per-user opt-outs because
        //     new prospects are a firm-wide signal.
        const recipientEmails = recipients
          .filter((tm: any) => !!tm.email)
          .map((tm: any) => tm.email as string)

        if (recipientEmails.length > 0) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"
          const prospectUrl = `${appUrl}/prospects/${inserted.id}`

          // Stitch a single "City, ST ZIP" string from the parts so
          // the email doesn't show a row per geographic component.
          const locationParts = [
            body.submitter_city?.trim(),
            [body.submitter_state?.trim(), body.submitter_zip?.trim()]
              .filter(Boolean)
              .join(" "),
          ].filter(Boolean)
          const location = locationParts.length > 0 ? locationParts.join(", ") : null

          const html = buildProspectEmailHtml({
            authorName,
            prospectName: prospectDisplayName,
            serviceFocus: body.service_focus ?? null,
            servicesRequested: body.services_requested ?? [],
            entityTypes: body.entity_types ?? [],
            personal: {
              email: body.submitter_email ?? null,
              phone: body.submitter_phone ?? null,
              location,
            },
            business: body.business_name?.trim()
              ? {
                  name: body.business_name ?? null,
                  situation: body.business_situation ?? null,
                  email: body.business_email ?? null,
                  phone: body.business_phone ?? null,
                  state: body.business_state ?? null,
                  taxClassification: body.business_tax_classification ?? null,
                  revenueRange: body.business_revenue_range ?? null,
                  employees: body.business_employee_count ?? null,
                  accountingSystem: body.business_uses_accounting_system ?? null,
                  summary: body.business_summary ?? null,
                }
              : null,
            internalNotes: body.internal_notes ?? null,
            // Attachments upload AFTER this row is created (the
            // client sequences POST /api/prospects -> POST
            // /api/prospects/[id]/attachments) so we can't surface a
            // count here. The email's CTA links to the detail page
            // which will show them whenever they finish uploading.
            attachmentCount: 0,
            prospectUrl,
          })

          const emailResult = await sendEmail({
            to: recipientEmails,
            subject: `PROSPECT: ${prospectDisplayName}`,
            html,
          })

          if (!emailResult.success) {
            console.warn(
              "[prospect] Email send failed (in-app notifications still created):",
              emailResult.error,
            )
          } else {
            console.log(
              `[prospect] Email sent to ${recipientEmails.length} active team members for prospect ${inserted.id}`,
            )
          }
        }
      }
    } catch (err) {
      console.error("[v0] POST /api/prospects broadcast failed:", err)
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
