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
import { pushHubContactToKarbon, pushHubOrganizationToKarbon } from "@/lib/karbon/client-sync"
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import { findOrCreateDeal } from "@/lib/deals/find-or-create-deal"
import { buildProspectEmailHtml, sendEmail } from "@/lib/email"
import { linkReferral } from "@/lib/referrals/link-referral"
import { createWorkItem } from "@/lib/karbon/create-work-item"
import { postIntakeNoteToKarbon } from "@/lib/karbon/post-intake-note"
import { enrichIntakeSubmission } from "@/lib/jotform/enrich"

interface CreateProspectBody {
  // Always required — the teammate filing the form.
  created_by_id: string

  // "individual" | "business" | "individual_business" — drives which
  // Karbon entities are created and which fields are required.
  prospect_type?: "individual" | "business" | "individual_business" | null

  meeting_context?: string | null

  submitter_first_name?: string | null
  submitter_last_name?: string | null
  submitter_email?: string | null
  submitter_phone?: string | null
  submitter_city?: string | null
  submitter_state?: string | null
  submitter_zip?: string | null

  // Individual web presence / socials.
  website?: string | null
  linkedin_url?: string | null
  twitter_url?: string | null
  facebook_url?: string | null
  instagram_url?: string | null

  services_requested?: string[] | null
  service_focus?: string | null
  entity_types?: string[] | null

  business_name?: string | null
  business_email?: string | null
  business_phone?: string | null
  business_email_same_as_owner?: boolean | null
  business_phone_same_as_owner?: boolean | null
  business_state?: string | null
  business_tax_classification?: string | null
  business_revenue_range?: string | null
  business_employee_count?: string | null
  business_uses_accounting_system?: string | null
  business_situation?: string | null
  business_summary?: string | null

  // Business web presence / socials.
  business_website?: string | null
  business_linkedin_url?: string | null
  business_twitter_url?: string | null
  business_facebook_url?: string | null
  business_instagram_url?: string | null

  // Referral attribution. A matched Hub contact id, OR free text the
  // teammate typed (recorded for human review — never auto-creates a
  // referrer per the Motta Hub data model).
  referred_by_contact_id?: string | null
  referred_by_raw?: string | null

  // Optional Karbon work item to create alongside the prospect.
  work_item?: {
    template_key: string
    work_type?: string | null
    title?: string | null
    assignee_id?: string | null
    start_date?: string | null
    due_date?: string | null
    budgeted_hours?: number | null
    work_status_key?: string | null
  } | null

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

/**
 * Map a `findOrCreateHubContact` resolution method to a value the
 * `prospect_submissions.link_method` CHECK constraint accepts. The
 * constraint only allows: auto_email | auto_business_name | auto_name |
 * auto_karbon_match | auto_karbon_created | manual (or NULL). Writing
 * the raw hub method (e.g. "auto_hub_created") silently fails the
 * link-back UPDATE and leaves contact_id / organization_id null.
 */
function mapHubMethodToLinkMethod(method: string | null | undefined): string | null {
  switch (method) {
    case "supabase_email":
      return "auto_email"
    case "supabase_business_name":
    case "created_organization":
      return "auto_business_name"
    case "supabase_name_phone":
    case "created_contact":
      return "auto_name"
    default:
      return null
  }
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
        prospect_type: body.prospect_type ?? null,
        meeting_context: body.meeting_context?.trim() || null,

        submitter_first_name: first,
        submitter_last_name: last,
        submitter_full_name: fullName,
        submitter_email: body.submitter_email?.trim().toLowerCase() || null,
        submitter_phone: body.submitter_phone?.trim() || null,
        submitter_city: body.submitter_city?.trim() || null,
        submitter_state: body.submitter_state?.trim() || null,
        submitter_zip: body.submitter_zip?.trim() || null,

        website: body.website?.trim() || null,
        linkedin_url: body.linkedin_url?.trim() || null,
        twitter_url: body.twitter_url?.trim() || null,
        facebook_url: body.facebook_url?.trim() || null,
        instagram_url: body.instagram_url?.trim() || null,

        services_requested: body.services_requested?.length ? body.services_requested : null,
        service_focus: body.service_focus?.trim() || null,
        entity_types: body.entity_types?.length ? body.entity_types : null,

        business_name: body.business_name?.trim() || null,
        business_email: body.business_email?.trim().toLowerCase() || null,
        business_phone: body.business_phone?.trim() || null,
        business_email_same_as_owner: body.business_email_same_as_owner ?? false,
        business_phone_same_as_owner: body.business_phone_same_as_owner ?? false,
        business_state: body.business_state?.trim() || null,
        business_tax_classification: body.business_tax_classification?.trim() || null,
        business_revenue_range: body.business_revenue_range?.trim() || null,
        business_employee_count: body.business_employee_count?.trim() || null,
        business_uses_accounting_system:
          body.business_uses_accounting_system?.trim() || null,
        business_situation: body.business_situation?.trim() || null,
        business_summary: body.business_summary?.trim() || null,

        business_website: body.business_website?.trim() || null,
        business_linkedin_url: body.business_linkedin_url?.trim() || null,
        business_twitter_url: body.business_twitter_url?.trim() || null,
        business_facebook_url: body.business_facebook_url?.trim() || null,
        business_instagram_url: body.business_instagram_url?.trim() || null,

        referred_by_contact_id: isUuid(body.referred_by_contact_id)
          ? body.referred_by_contact_id
          : null,
        referred_by_raw: body.referred_by_raw?.trim() || null,

        karbon_work_template_key: body.work_item?.template_key?.trim() || null,
        karbon_work_item_fields: body.work_item
          ? {
              work_type: body.work_item.work_type ?? null,
              title: body.work_item.title ?? null,
              assignee_id: body.work_item.assignee_id ?? null,
              start_date: body.work_item.start_date ?? null,
              due_date: body.work_item.due_date ?? null,
              budgeted_hours: body.work_item.budgeted_hours ?? null,
              work_status_key: body.work_item.work_status_key ?? null,
            }
          : null,

        internal_notes: body.internal_notes?.trim() || null,

        action_items: body.action_items?.length ? body.action_items : null,

        assigned_to_id: assigneeId,
        lead_status: "new",

        // Platform-push intent. Karbon "queued" only when actually
        // pushing; the others stay queued until their workers run.
        push_to_karbon: pushToKarbon,
        // The CHECK constraint on prospect_submissions only accepts
        // 'pending' | 'success' | 'failed' | 'skipped' (see
        // scripts/161_prospect_platform_push.sql). Earlier code wrote
        // 'queued' / 'pushed' which silently 500'd the form. Keep these
        // string literals aligned with the constraint at all times.
        karbon_push_status: pushToKarbon ? "pending" : "skipped",
        push_to_proconnect: pushToProconnect,
        proconnect_push_status: pushToProconnect ? "pending" : "skipped",
        push_to_ignition: pushToIgnition,
        ignition_push_status: pushToIgnition ? "pending" : "skipped",
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
    // Karbon push is governed by `pushToKarbon`. When true we push the
    // freshly-resolved Hub contact/org INTO Karbon via
    // pushHubContact/OrganizationToKarbon, which backfills
    // karbon_contact_key / karbon_organization_key on the Hub record.
    // When false we skip the push entirely — the teammate can trigger
    // it later from the detail page.
    let finalContactId: string | null = null
    let finalOrganizationId: string | null = null
    let finalLinkMethod: string | null = null
    // Karbon entity key/type — captured during the push so we can post
    // the timeline note and (optionally) create a work item afterward.
    let karbonKey: string | null = null

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
      // Map to a CHECK-constraint-valid link_method. Writing the raw
      // hub method (e.g. "auto_hub_created") silently fails the
      // link-back UPDATE below and leaves contact_id null.
      finalLinkMethod = mapHubMethodToLinkMethod(hub.method)
    } catch (err) {
      console.error("[v0] POST /api/prospects hub create failed:", err)
    }

    // Karbon push — Hub-FIRST. The Hub contact/org is the source of
    // truth; we push it INTO Karbon and backfill the Karbon key.
    //
    // This deliberately does NOT route through `findOrCreateClient`.
    // Because `findOrCreateHubContact` (above) just created the Hub
    // contact stamped with the prospect's email, `findOrCreateClient`'s
    // Step-1 Supabase-email search would re-match that brand-new
    // keyless Hub row and return `supabase_match` with `karbon_key:
    // null` — never actually creating anything in Karbon, yet the route
    // would mark the push "success". `pushHubContact/OrganizationToKarbon`
    // operate on the Hub record directly and create in Karbon when no
    // key exists (the same proven pattern the Calendly webhook uses).
    if (pushToKarbon && (finalContactId || finalOrganizationId)) {
      try {
        if (finalContactId) {
          const res = await pushHubContactToKarbon(finalContactId, {
            source: "Motta Hub Prospect Form",
          })
          karbonKey = res.karbonKey
        } else if (finalOrganizationId) {
          const res = await pushHubOrganizationToKarbon(finalOrganizationId, {
            source: "Motta Hub Prospect Form",
          })
          karbonKey = res.karbonKey
        }

        // Success is gated on an ACTUAL Karbon key — not merely the
        // presence of a Hub contact id (the old false-positive bug).
        await supabase
          .from("prospect_submissions")
          .update({
            karbon_push_status: karbonKey ? "success" : "failed",
            karbon_push_error: karbonKey
              ? null
              : "Karbon create/link returned no key",
            karbon_pushed_at: new Date().toISOString(),
          })
          .eq("id", inserted.id)
      } catch (err: any) {
        console.error("[v0] POST /api/prospects Karbon push failed:", err)
        await supabase
          .from("prospect_submissions")
          .update({
            karbon_push_status: "failed",
            karbon_push_error: String(err?.message ?? err),
          })
          .eq("id", inserted.id)
      }
    } else if (pushToKarbon) {
      // Intended to push but the Hub record never resolved — record the
      // failure instead of leaving the row stuck on "pending".
      await supabase
        .from("prospect_submissions")
        .update({
          karbon_push_status: "failed",
          karbon_push_error: "No Hub contact/organization to push to Karbon",
        })
        .eq("id", inserted.id)
    }

    if (finalContactId || finalOrganizationId) {
      const { error: linkErr } = await supabase
        .from("prospect_submissions")
        .update({
          contact_id: finalContactId,
          organization_id: finalOrganizationId,
          link_method: finalLinkMethod,
          linked_at: new Date().toISOString(),
        })
        .eq("id", inserted.id)
      if (linkErr) {
        console.error("[v0] POST /api/prospects link-back update failed:", linkErr)
      }
    }

    // ── 3a-2. Open the Deal ────────────────────────────────────────
    // A prospect submitted through the in-person form is a brand-new
    // sales opportunity. Open (or reuse) the single open Deal for this
    // contact so the teammate can book meetings against it and run the
    // debrief on the deal later. Best-effort: a deal failure must never
    // break prospect intake.
    if (finalContactId || finalOrganizationId) {
      try {
        await findOrCreateDeal(
          {
            contactId: finalContactId,
            organizationId: finalContactId ? null : finalOrganizationId,
            title: fullName || body.business_name?.trim() || "New Prospect",
            source: "prospect_form",
            ownerTeamMemberId: assigneeId,
          },
          { supabase },
        )
      } catch (err) {
        console.error("[v0] POST /api/prospects deal create failed:", err)
      }
    }

    // ── 3b. Mirror socials onto the master Hub record ──────────────
    // The contacts/organizations tables carry website/linkedin_url/
    // twitter_handle/facebook_url (there is no instagram column — that
    // stays on the prospect row + Karbon note). We only write columns
    // the teammate actually filled in so we never clobber existing
    // values with nulls on a re-link to an existing contact.
    try {
      if (finalContactId) {
        const patch: Record<string, string> = {}
        if (body.website?.trim()) patch.website = body.website.trim()
        if (body.linkedin_url?.trim()) patch.linkedin_url = body.linkedin_url.trim()
        if (body.twitter_url?.trim()) patch.twitter_handle = body.twitter_url.trim()
        if (body.facebook_url?.trim()) patch.facebook_url = body.facebook_url.trim()
        if (Object.keys(patch).length > 0) {
          await supabase.from("contacts").update(patch).eq("id", finalContactId)
        }
      }
      if (finalOrganizationId) {
        const patch: Record<string, string> = {}
        if (body.business_website?.trim()) patch.website = body.business_website.trim()
        if (body.business_linkedin_url?.trim()) patch.linkedin_url = body.business_linkedin_url.trim()
        if (body.business_twitter_url?.trim()) patch.twitter_handle = body.business_twitter_url.trim()
        if (body.business_facebook_url?.trim()) patch.facebook_url = body.business_facebook_url.trim()
        if (Object.keys(patch).length > 0) {
          await supabase.from("organizations").update(patch).eq("id", finalOrganizationId)
        }
      }
    } catch (err) {
      console.error("[v0] POST /api/prospects socials sync failed:", err)
    }

    // ── 3c. Referral linking ───────────────────────────────────────
    // Requires the Hub contact to exist (the referrals table needs a
    // referee_contact_id). Free-text referrers are recorded for review,
    // never auto-created — per the Motta Hub referral state machine.
    let referralInfo: { name: string | null; matched: boolean } | null = null
    if (finalContactId && (body.referred_by_contact_id || body.referred_by_raw?.trim())) {
      try {
        const refResult = await linkReferral(supabase, {
          refereeContactId: finalContactId,
          refereeName: fullName,
          referredByContactId: isUuid(body.referred_by_contact_id)
            ? body.referred_by_contact_id
            : null,
          referredByRaw: body.referred_by_raw ?? null,
        })
        if (refResult.referralId) {
          await supabase
            .from("prospect_submissions")
            .update({ referral_id: refResult.referralId })
            .eq("id", inserted.id)
        }
        // Resolve a display name for the email/note.
        let refName: string | null = body.referred_by_raw?.trim() || null
        if (isUuid(body.referred_by_contact_id)) {
          const { data: refRow } = await supabase
            .from("contacts")
            .select("full_name")
            .eq("id", body.referred_by_contact_id)
            .maybeSingle()
          refName = refRow?.full_name ?? refName
        }
        referralInfo = { name: refName, matched: refResult.matchStatus === "matched" }
      } catch (err) {
        console.error("[v0] POST /api/prospects referral link failed:", err)
      }
    }

    // ── 3d. ALFRED enrichment from website + socials ───────────────
    // Reuses the intake enrichment engine. It scans the free-text we
    // pass for URLs, so we feed it the socials + meeting context. Has
    // its own internal timeouts; failures never block the response.
    let enrichmentSummary: string | null = null
    try {
      const socialBlob = [
        body.website,
        body.linkedin_url,
        body.twitter_url,
        body.facebook_url,
        body.instagram_url,
        body.business_website,
        body.business_linkedin_url,
        body.business_twitter_url,
        body.business_facebook_url,
        body.business_instagram_url,
      ]
        .filter((s) => s && s.trim())
        .join("\n")
      const enrichmentNotes = [body.meeting_context, body.internal_notes, socialBlob]
        .filter((s) => s && s.trim())
        .join("\n\n")

      const blob = await enrichIntakeSubmission(supabase, {
        id: inserted.id,
        submitter_full_name: fullName,
        business_name: body.business_name?.trim() || null,
        business_state: body.business_state?.trim() || null,
        business_summary: body.business_summary?.trim() || null,
        questions_or_concerns: null,
        additional_notes: enrichmentNotes || null,
        service_focus: body.service_focus?.trim() || null,
        organization_id: finalOrganizationId,
        contact_id: finalContactId,
      })
      if (blob) {
        enrichmentSummary = blob.summary || null
        await supabase
          .from("prospect_submissions")
          .update({ enrichment: blob, enriched_at: new Date().toISOString() })
          .eq("id", inserted.id)
      }
    } catch (err) {
      console.error("[v0] POST /api/prospects enrichment failed:", err)
    }

    // ── 3e. Karbon timeline note (pinned, best-effort) ─────────────
    // Posts a rich "New prospect" note to the contact/org timeline so
    // the prospect's Karbon profile carries full context immediately.
    if (pushToKarbon && karbonKey) {
      try {
        const entityType: "Contact" | "Organization" = finalOrganizationId
          ? "Organization"
          : "Contact"
        await postIntakeNoteToKarbon(
          { entityType, entityKey: karbonKey },
          {
            id: inserted.id,
            submitter_full_name: fullName,
            submitter_email: body.submitter_email ?? null,
            submitter_phone: body.submitter_phone ?? null,
            submitter_city: body.submitter_city ?? null,
            submitter_state: body.submitter_state ?? null,
            submitter_zip: body.submitter_zip ?? null,
            business_name: body.business_name ?? null,
            business_state: body.business_state ?? null,
            business_summary: body.business_summary ?? null,
            business_revenue_range: body.business_revenue_range ?? null,
            business_tax_classification: body.business_tax_classification ?? null,
            business_situation: body.business_situation ?? null,
            service_focus: body.service_focus ?? null,
            services_requested: body.services_requested ?? null,
            entity_types: body.entity_types ?? null,
            questions_or_concerns: null,
            additional_notes: body.internal_notes ?? null,
            website: body.website ?? body.business_website ?? null,
            linkedin_url: body.linkedin_url ?? body.business_linkedin_url ?? null,
            twitter_handle: body.twitter_url ?? body.business_twitter_url ?? null,
            facebook_url: body.facebook_url ?? body.business_facebook_url ?? null,
            instagram_url: body.instagram_url ?? body.business_instagram_url ?? null,
            referral: referralInfo,
            enrichment: enrichmentSummary ? { summary: enrichmentSummary } : null,
          },
          { pinned: true },
        )
      } catch (err) {
        console.error("[v0] POST /api/prospects Karbon note failed:", err)
      }
    }

    // ── 3f. Optional Karbon work item ──────────────────────────────
    let workItemInfo: { title: string; url: string | null } | null = null
    if (pushToKarbon && karbonKey && body.work_item?.template_key) {
      try {
        // Resolve the assignee team member's email for Karbon.
        let assigneeEmail: string | null = null
        if (isUuid(body.work_item.assignee_id)) {
          const { data: tm } = await supabase
            .from("team_members")
            .select("email")
            .eq("id", body.work_item.assignee_id)
            .maybeSingle()
          assigneeEmail = tm?.email ?? null
        }
        const wi = await createWorkItem({
          clientKey: karbonKey,
          clientType: finalOrganizationId ? "Organization" : "Contact",
          workTemplateKey: body.work_item.template_key,
          title: body.work_item.title?.trim() || body.business_name?.trim() || fullName || "Prospect work",
          workType: body.work_item.work_type ?? null,
          assigneeEmail,
          startDate: body.work_item.start_date ?? null,
          dueDate: body.work_item.due_date ?? null,
          budgetedHours:
            typeof body.work_item.budgeted_hours === "number"
              ? body.work_item.budgeted_hours
              : null,
          workStatusKey: body.work_item.work_status_key ?? null,
        })
        if (wi.ok && wi.workItemKey) {
          workItemInfo = { title: wi.title || "Work item", url: wi.workItemUrl ?? null }
          await supabase
            .from("prospect_submissions")
            .update({
              karbon_work_item_key: wi.workItemKey,
              karbon_work_item_title: wi.title ?? null,
              karbon_work_item_url: wi.workItemUrl ?? null,
            })
            .eq("id", inserted.id)
        } else {
          console.warn("[v0] POST /api/prospects work item create failed:", wi.error)
        }
      } catch (err) {
        console.error("[v0] POST /api/prospects work item create failed:", err)
      }
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
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"
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
            prospectType:
              body.prospect_type === "individual_business"
                ? "both"
                : body.prospect_type === "business"
                  ? "business"
                  : body.prospect_type === "individual"
                    ? "individual"
                    : null,
            serviceFocus: body.service_focus ?? null,
            servicesRequested: body.services_requested ?? [],
            entityTypes: body.entity_types ?? [],
            personal: {
              email: body.submitter_email ?? null,
              phone: body.submitter_phone ?? null,
              location,
            },
            socials: {
              website: body.website ?? body.business_website ?? null,
              linkedin: body.linkedin_url ?? body.business_linkedin_url ?? null,
              twitter: body.twitter_url ?? body.business_twitter_url ?? null,
              facebook: body.facebook_url ?? body.business_facebook_url ?? null,
              instagram: body.instagram_url ?? body.business_instagram_url ?? null,
            },
            referral: referralInfo
              ? {
                  name: referralInfo.name,
                  contactUrl: isUuid(body.referred_by_contact_id)
                    ? `${process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"}/contacts/${body.referred_by_contact_id}`
                    : null,
                  matched: referralInfo.matched,
                }
              : null,
            enrichmentSummary,
            workItem: workItemInfo,
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
