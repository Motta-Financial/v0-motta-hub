/**
 * Idempotent upsert of Jotform submissions into Supabase.
 *
 * Used by both the live webhook receiver and the historical backfill,
 * so the dedupe semantics live in one place.
 */
import { createClient } from "@supabase/supabase-js"
import { buildIntakeRow } from "./parse"
import { buildFeedbackRow } from "./parse-feedback"
import { autoLinkIntakeSubmission, autoLinkFeedbackSubmission } from "./match-client"
import { findOrCreateClient } from "@/lib/karbon/client-sync"
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import { postIntakeNoteToKarbon } from "@/lib/karbon/post-intake-note"
import { resolvePreferredTeamMember } from "./assign"
import { enrichIntakeSubmission } from "./enrich"
import { researchProspectQuestions } from "./research-questions"
import { estimateIntakeFees } from "./fee-estimate"
import { notifyTeamOfNewIntake } from "./notify"
import type { JotformSubmission } from "./client"

function getServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured")
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function getFormUuidByJotformId(jotformFormId: string): Promise<string | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("jotform_forms")
    .select("id")
    .eq("jotform_form_id", jotformFormId)
    .maybeSingle()
  if (error) {
    console.log("[v0] getFormUuidByJotformId error:", error.message)
    return null
  }
  return data?.id ?? null
}

export async function upsertIntakeSubmission(submission: JotformSubmission) {
  const supabase = getServiceClient()
  const formUuid = await getFormUuidByJotformId(submission.form_id)
  const row = buildIntakeRow(submission, formUuid)

  const { error } = await supabase
    .from("jotform_intake_submissions")
    .upsert(row, { onConflict: "jotform_submission_id" })

  if (error) {
    throw new Error(`Failed to upsert intake submission ${submission.id}: ${error.message}`)
  }

  // Captured by the karbon-created branch below; consumed AFTER the
  // post-processing pipeline runs so the timeline note we push to
  // Karbon already includes ALFRED's enrichment + question research.
  let newKarbonEntity: { entityType: "Contact" | "Organization"; entityKey: string } | null = null
  // The Supabase row UUID is captured so the timeline note step at
  // the end of this function can re-fetch the fully enriched row
  // without having to re-resolve `jotform_submission_id`.
  let persistedRowId: string | null = null

  // Auto-match the freshly-upserted row to a contact / organization.
  // This is best-effort: a match failure shouldn't fail the webhook,
  // because the row is already safely persisted and the bulk
  // matcher (scripts/jotform-intake-link-clients.mjs) can sweep up
  // any misses later. Logged but not thrown.
  try {
    // Re-read so we have the row's UUID + current link state. We
    // upserted by `jotform_submission_id` so that's our key here.
    const { data: persisted } = await supabase
      .from("jotform_intake_submissions")
      .select("id, submitter_email, submitter_full_name, business_name, phone_number, contact_id, organization_id, link_method")
      .eq("jotform_submission_id", submission.id)
      .maybeSingle()
      if (persisted) {
      persistedRowId = persisted.id
      // First try the standard auto-link (Supabase-only)
      let result = await autoLinkIntakeSubmission(supabase, persisted.id, persisted)

      // If no match found, use the enhanced Karbon search + create flow.
      // Karbon stays the source of truth for billable client identity,
      // but the Hub contact is created/matched FIRST so that:
      //   1. A Karbon outage never blocks Master Hub Contact creation
      //      (Hub-first invariant — Jotform/Calendly/Zoom always
      //      produce a Hub contact regardless of downstream platform
      //      health).
      //   2. The Karbon push step has a stable contacts.id to mirror
      //      onto, eliminating the race where parallel Jotform
      //      submissions could each try to create the same Karbon
      //      contact.
      // We still preserve the existing behaviour of auto-pushing to
      // Karbon for Jotform (per the user's intake-routing decision) —
      // the Hub-first call is purely a safety net + dedupe key.
      if (!result?.link_method) {
        let hubFallback: { contact_id: string | null; organization_id: string | null } = {
          contact_id: null,
          organization_id: null,
        }
        try {
          const hub = await findOrCreateHubContact(
            {
              email: persisted.submitter_email ?? null,
              fullName: persisted.submitter_full_name ?? null,
              businessName: persisted.business_name ?? null,
              phone: persisted.phone_number ?? null,
            },
            { source: "jotform_intake", supabase },
          )
          hubFallback = {
            contact_id: hub.contact_id,
            organization_id: hub.organization_id,
          }
        } catch (err) {
          console.log(
            "[Jotform] hub-first create failed (will still try Karbon):",
            (err as Error).message,
          )
        }

        const karbonResult = await findOrCreateClient(
          {
            email: persisted.submitter_email || undefined,
            fullName: persisted.submitter_full_name || undefined,
            businessName: persisted.business_name || undefined,
            phone: persisted.phone_number || undefined,
          },
          { autoCreate: true, source: "Jotform Intake" }
        )

        // Karbon path won — use its IDs (it has Karbon keys attached).
        // Karbon path failed — fall back to whatever the Hub-first
        // call produced so we never leave the submission unlinked.
        const finalContactId = karbonResult.contact_id ?? hubFallback.contact_id
        const finalOrganizationId =
          karbonResult.organization_id ?? hubFallback.organization_id

        if (finalContactId || finalOrganizationId) {
          const linkMethod =
            karbonResult.method === "karbon_created"
              ? "auto_karbon_created"
              : karbonResult.contact_id || karbonResult.organization_id
                ? "auto_karbon_match"
                : "auto_hub_created"
          await supabase
            .from("jotform_intake_submissions")
            .update({
              contact_id: finalContactId,
              organization_id: finalOrganizationId,
              link_method: linkMethod,
              linked_at: new Date().toISOString(),
            })
            .eq("id", persisted.id)

          // Remember whether we minted a brand-new Karbon entity so the
          // post-processing block can post the legacy "new intake"
          // timeline note onto the freshly-created contact (Zapier did
          // this before Motta Hub took over).
          if (karbonResult.method === "karbon_created" && karbonResult.karbon_key) {
            newKarbonEntity = {
              entityType: karbonResult.contact_id ? "Contact" : "Organization",
              entityKey: karbonResult.karbon_key,
            }
          }

          console.log(
            `[Jotform] resolved intake: hub=${!!hubFallback.contact_id || !!hubFallback.organization_id} karbon=${karbonResult.method} reason=${karbonResult.reason ?? "n/a"}`,
          )
        }
      } else {
        console.log(`[Jotform] auto-linked intake ${submission.id} via ${result.link_method}: ${result.reason}`)
      }
    }
  } catch (err) {
    console.log("[Jotform] intake auto-link error:", (err as Error).message)
  }

  // ── Post-link pipeline ───────────────────────────────────────────
  // Runs after the row is safely persisted AND linked to a client (if
  // we found one). Three independent best-effort steps:
  //   1. Auto-assign to the team member the prospect asked for
  //   2. Enrich with web research (company + answer-to-questions)
  //   3. Email the team (once, idempotent via `notified_at`)
  // Each step is wrapped so a downstream failure (AI rate limit, email
  // provider down) never poisons the upstream upsert.
  try {
    await runIntakePostProcessing(supabase, submission.id)
  } catch (err) {
    console.log("[Jotform] intake post-processing error:", (err as Error).message)
  }

  // ── Legacy "new intake" timeline note on Karbon ──────────────────
  // Before Motta Hub, Zapier would post a Karbon Note onto the new
  // contact's timeline whenever the intake created a brand-new
  // contact. We restore that here — runs AFTER post-processing so
  // the enrichment summary + question research are persisted and
  // therefore included in the note body.
  //
  // Fire-and-forget by design: Karbon being down should not prevent
  // the intake from being marked as processed.
  if (newKarbonEntity && persistedRowId) {
    try {
      const { data: enrichedRow } = await supabase
        .from("jotform_intake_submissions")
        .select("*")
        .eq("id", persistedRowId)
        .maybeSingle()
      if (enrichedRow) {
        const noteResult = await postIntakeNoteToKarbon(
          newKarbonEntity,
          enrichedRow as any,
        )
        if (noteResult.ok) {
          console.log(
            `[Jotform] Posted intake timeline note to Karbon ${newKarbonEntity.entityType} ${newKarbonEntity.entityKey} (note ${noteResult.noteKey})`,
          )
        } else if (noteResult.skipped) {
          console.log(
            `[Jotform] Skipped intake timeline note: ${noteResult.skipped}`,
          )
        } else {
          console.log(`[Jotform] Intake timeline note failed: ${noteResult.error}`)
        }
      }
    } catch (err) {
      console.log("[Jotform] intake timeline note error:", (err as Error).message)
    }
  }

  return { id: submission.id }
}

/**
 * Auto-assign + enrich + notify pipeline for a freshly upserted intake
 * submission. Idempotent: re-running it on the same submission only
 * fills in fields that are still null, and the team-wide email only
 * fires when `notified_at IS NULL`.
 *
 * Exported as its own function so a future admin "re-run ALFRED on this
 * intake" button (or a backfill script) can call it without going
 * through the full upsert path.
 */
export async function runIntakePostProcessing(
  supabase: ReturnType<typeof getServiceClient>,
  jotformSubmissionId: string,
): Promise<void> {
  // Pull the canonical row state we need for every downstream step.
  // Field list is intentionally explicit so we don't accidentally
  // depend on transient columns later.
  const { data: row, error } = await supabase
    .from("jotform_intake_submissions")
    .select(
      [
        "id",
        "jotform_submission_id",
        "jotform_created_at",
        "submitter_full_name",
        "submitter_email",
        "submitter_phone",
        "submitter_city",
        "submitter_state",
        "business_name",
        "business_state",
        "business_summary",
        "business_revenue_range",
        "business_situation",
        "service_focus",
        "services_requested",
        "entity_types",
        "questions_or_concerns",
        "additional_notes",
        "preferred_team_member",
        "assigned_to_id",
        "contact_id",
        "organization_id",
        "referral_source",
        "referral_contact_id",
        "referral_organization_id",
        "enrichment",
        "question_research",
        "fee_estimate",
        "notified_at",
      ].join(","),
    )
    .eq("jotform_submission_id", jotformSubmissionId)
    .maybeSingle()

  if (error) {
    console.log("[Jotform] post-processing fetch error:", error.message)
    return
  }
  if (!row) return

  const submissionRow = row as unknown as {
    id: string
    jotform_submission_id: string
    jotform_created_at: string | null
    submitter_full_name: string | null
    submitter_email: string | null
    submitter_phone: string | null
    submitter_city: string | null
    submitter_state: string | null
    business_name: string | null
    business_state: string | null
    business_summary: string | null
    business_revenue_range: string | null
    business_situation: string | null
    service_focus: string | null
    services_requested: string[] | null
    entity_types: string[] | null
    questions_or_concerns: string | null
    additional_notes: string | null
    preferred_team_member: string | null
    assigned_to_id: string | null
    contact_id: string | null
    organization_id: string | null
    referral_source: string | null
    referral_contact_id: string | null
    referral_organization_id: string | null
    enrichment: Record<string, unknown> | null
    question_research: Record<string, unknown> | null
    fee_estimate: Record<string, unknown> | null
    notified_at: string | null
  }

  // ── 1. Auto-assign + persist preferred-teammate FK ─────────────────
  // The resolver runs whenever the prospect typed a preferred name,
  // regardless of `assigned_to_id`. We split the two effects:
  //
  //   • `preferred_team_member_id` — the FK that powers the "Motta
  //     Professional" column on the Intake list. Always written when
  //     the resolver finds a match, even if a human has already
  //     reassigned the row, because it's "who the prospect chose"
  //     and shouldn't disappear behind a manual override.
  //   • `assigned_to_id` — the queue ownership column. Only auto-set
  //     when null, so a manual reassignment is never clobbered.
  //
  // This split lets Hub UIs surface both "the prospect asked for
  // X" and "Y is currently working it" without conflict.
  let resolvedAssignee: { id: string; name: string | null } | null = null
  if (submissionRow.preferred_team_member) {
    try {
      const resolved = await resolvePreferredTeamMember(supabase, submissionRow.preferred_team_member)
      if (resolved.team_member_id) {
        const updates: Record<string, unknown> = { preferred_team_member_id: resolved.team_member_id }
        if (!submissionRow.assigned_to_id) {
          updates.assigned_to_id = resolved.team_member_id
        }
        const { error: assignErr } = await supabase
          .from("jotform_intake_submissions")
          .update(updates)
          .eq("id", submissionRow.id)
        if (assignErr) {
          console.log("[Jotform] auto-assign update error:", assignErr.message)
        } else {
          if (!submissionRow.assigned_to_id) {
            submissionRow.assigned_to_id = resolved.team_member_id
          }
          resolvedAssignee = { id: resolved.team_member_id, name: resolved.team_member_name }
          console.log(
            `[Jotform] resolved preferred teammate "${resolved.input}" → ${resolved.team_member_name ?? resolved.team_member_id} via ${resolved.method}`,
          )
        }
      } else {
        console.log(
          `[Jotform] preferred team member "${submissionRow.preferred_team_member}" did not match any active teammate — leaving unlinked`,
        )
      }
    } catch (err) {
      console.log("[Jotform] auto-assign error:", (err as Error).message)
    }
  }

  // ── 1b. Auto-resolve referral_source → contact/org FK ─────────────
  // The "Who sent you our way?" answer is almost always the name of an
  // existing client. Resolving it to a real Hub record at ingest time
  // gives us:
  //   • clickable referrer cells in the Intake list (deep-link to the
  //     client profile),
  //   • per-client referral counts on the client profile,
  //   • a foundation for "auto-thank the referrer on conversion".
  //
  // Conservative match policy: only write the FK on a SINGLE exact
  // (case-insensitive) name match. Ambiguous or unmatched strings are
  // left for the triager to resolve manually in the detail sheet — a
  // wrong link is worse than no link because it implies a referral
  // relationship that doesn't exist.
  if (
    submissionRow.referral_source &&
    !submissionRow.referral_contact_id &&
    !submissionRow.referral_organization_id
  ) {
    try {
      const needle = (submissionRow.referral_source || "")
        .split(/[,/&]+/)[0]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
      if (needle && needle.length >= 3) {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, full_name")
          .ilike("full_name", needle)
          .limit(2)
        if (contacts && contacts.length === 1) {
          await supabase
            .from("jotform_intake_submissions")
            .update({ referral_contact_id: contacts[0].id })
            .eq("id", submissionRow.id)
          submissionRow.referral_contact_id = contacts[0].id
          console.log(
            `[Jotform] resolved referral "${submissionRow.referral_source}" → contact ${contacts[0].id}`,
          )
        } else if (!contacts || contacts.length === 0) {
          const { data: orgs } = await supabase
            .from("organizations")
            .select("id, name")
            .ilike("name", needle)
            .limit(2)
          if (orgs && orgs.length === 1) {
            await supabase
              .from("jotform_intake_submissions")
              .update({ referral_organization_id: orgs[0].id })
              .eq("id", submissionRow.id)
            submissionRow.referral_organization_id = orgs[0].id
            console.log(
              `[Jotform] resolved referral "${submissionRow.referral_source}" → organization ${orgs[0].id}`,
            )
          }
        }
      }
    } catch (err) {
      console.log("[Jotform] referral auto-resolve error:", (err as Error).message)
    }
  }

  // ── 2. Enrichment + question research (in parallel) ────────────
  // These are independent web/AI calls — running them concurrently
  // shaves ~10s off the worst-case total. Each individually returns
  // null on failure rather than throwing, so `Promise.allSettled` is
  // belt-and-suspenders.
  const needsEnrichment = !submissionRow.enrichment
  const needsResearch = !submissionRow.question_research && !!submissionRow.questions_or_concerns
  const needsFeeEstimate = !submissionRow.fee_estimate

  // All three calls are independent web/AI passes — running them
  // concurrently shaves ~20s off the worst-case total. Each returns
  // null on failure rather than throwing, so the email path always
  // gets to render with whatever did land.
  const [enrichmentResult, researchResult, feeResult] = await Promise.allSettled([
    needsEnrichment
      ? enrichIntakeSubmission(supabase, {
          id: submissionRow.id,
          submitter_full_name: submissionRow.submitter_full_name,
          business_name: submissionRow.business_name,
          business_state: submissionRow.business_state,
          business_summary: submissionRow.business_summary,
          questions_or_concerns: submissionRow.questions_or_concerns,
          additional_notes: submissionRow.additional_notes,
          service_focus: submissionRow.service_focus,
          organization_id: submissionRow.organization_id,
          contact_id: submissionRow.contact_id,
        })
      : Promise.resolve(null),
    needsResearch
      ? researchProspectQuestions({
          questions_or_concerns: submissionRow.questions_or_concerns,
          business_name: submissionRow.business_name,
          business_state: submissionRow.business_state,
          service_focus: submissionRow.service_focus,
        })
      : Promise.resolve(null),
    needsFeeEstimate
      ? estimateIntakeFees(supabase, {
          service_focus: submissionRow.service_focus,
          services_requested: submissionRow.services_requested,
          entity_types: submissionRow.entity_types,
          business_revenue_range: submissionRow.business_revenue_range,
          business_tax_classification: null,
          business_employee_count: null,
          business_state: submissionRow.business_state,
          business_summary: submissionRow.business_summary,
          questions_or_concerns: submissionRow.questions_or_concerns,
        })
      : Promise.resolve(null),
  ])

  const enrichment =
    enrichmentResult.status === "fulfilled" ? enrichmentResult.value : null
  const questionResearch =
    researchResult.status === "fulfilled" ? researchResult.value : null
  const feeEstimate =
    feeResult.status === "fulfilled" ? feeResult.value : null

  // Persist whatever we got. If all three failed we still write the
  // email out with what we have, but skip the wasted UPDATE.
  if (enrichment || questionResearch || feeEstimate) {
    const updates: Record<string, unknown> = {}
    if (enrichment) updates.enrichment = enrichment
    if (questionResearch) updates.question_research = questionResearch
    if (feeEstimate) updates.fee_estimate = feeEstimate
    const { error: updErr } = await supabase
      .from("jotform_intake_submissions")
      .update(updates)
      .eq("id", submissionRow.id)
    if (updErr) {
      console.log("[Jotform] enrichment persist error:", updErr.message)
    }
  }

  // ── 3. Firm-wide email ─────────────────────────────────────────
  // Single-flight: only sends when `notified_at` is null. Setting
  // `notified_at` BEFORE the send would close the window earlier but
  // would also swallow legitimate retries; setting AFTER means a
  // crash mid-send can re-trigger, which is the correct tradeoff
  // (better duplicate than missed prospect intro).
  if (!submissionRow.notified_at) {
    try {
      const { sent, attempted } = await notifyTeamOfNewIntake(supabase, {
        id: submissionRow.id,
        jotform_submission_id: submissionRow.jotform_submission_id,
        submitter_full_name: submissionRow.submitter_full_name,
        submitter_email: submissionRow.submitter_email,
        submitter_phone: submissionRow.submitter_phone,
        submitter_city: submissionRow.submitter_city,
        submitter_state: submissionRow.submitter_state,
        business_name: submissionRow.business_name,
        business_state: submissionRow.business_state,
        service_focus: submissionRow.service_focus,
        services_requested: submissionRow.services_requested,
        entity_types: submissionRow.entity_types,
        business_situation: submissionRow.business_situation,
        business_summary: submissionRow.business_summary,
        business_revenue_range: submissionRow.business_revenue_range,
        questions_or_concerns: submissionRow.questions_or_concerns,
        additional_notes: submissionRow.additional_notes,
        preferred_team_member: submissionRow.preferred_team_member,
        assigned_to_id: submissionRow.assigned_to_id,
        enrichment: enrichment
          ? { summary: enrichment.summary, websites: enrichment.websites }
          : null,
        question_research: questionResearch
          ? {
              summary: questionResearch.summary,
              key_points: questionResearch.key_points,
              references: questionResearch.references,
            }
          : null,
        fee_estimate: feeEstimate ?? null,
        jotform_created_at: submissionRow.jotform_created_at,
      })
      const { error: notifyErr } = await supabase
        .from("jotform_intake_submissions")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", submissionRow.id)
      if (notifyErr) console.log("[Jotform] notified_at update error:", notifyErr.message)
      console.log(`[Jotform] intake ${jotformSubmissionId} notified ${sent}/${attempted} teammates`)
    } catch (err) {
      console.log("[Jotform] notify error:", (err as Error).message)
    }
  } else {
    console.log(`[Jotform] intake ${jotformSubmissionId} already notified at ${submissionRow.notified_at} — skipping email`)
  }

  // Silence the "unused" warning for the assignee handle while leaving
  // the structured value available for future hooks (e.g. push a
  // direct DM to the assigned partner).
  void resolvedAssignee
}

/**
 * Idempotent upsert into `jotform_feedback_submissions`. Mirrors
 * `upsertIntakeSubmission` so the webhook receiver can dispatch by
 * form `kind` without caring which target table the row lands in.
 */
export async function upsertFeedbackSubmission(submission: JotformSubmission) {
  const supabase = getServiceClient()
  const formUuid = await getFormUuidByJotformId(submission.form_id)
  const row = buildFeedbackRow(submission, formUuid)

  const { error } = await supabase
    .from("jotform_feedback_submissions")
    .upsert(row, { onConflict: "jotform_submission_id" })

  if (error) {
    throw new Error(`Failed to upsert feedback submission ${submission.id}: ${error.message}`)
  }

  // Auto-match the freshly-upserted row to a contact / organization.
  // Matches the intake auto-link pattern: best-effort, never fails
  // the webhook because the row is already safely persisted and the
  // bulk matcher (scripts/jotform-feedback-link-clients.mjs) can
  // sweep up any misses later.
  try {
    const { data: persisted } = await supabase
      .from("jotform_feedback_submissions")
      .select("id, submitter_email, submitter_full_name, contact_id, organization_id, link_method")
      .eq("jotform_submission_id", submission.id)
      .maybeSingle()
    if (persisted) {
      const result = await autoLinkFeedbackSubmission(supabase, persisted.id, persisted)
      if (result?.link_method) {
        console.log(`[v0] auto-linked feedback ${submission.id} via ${result.link_method}: ${result.reason}`)
      }
    }
  } catch (err) {
    console.log("[v0] feedback auto-link skipped:", (err as Error).message)
  }

  return { id: submission.id }
}

/**
 * Look up a form's `kind` (intake / feedback / debrief / other) and
 * Hub UUID by the per-form webhook secret token. Used by the webhook
 * receiver to dispatch to the right ingest function in O(1) without
 * baking form IDs into application code.
 */
export async function getFormByWebhookToken(token: string): Promise<{
  id: string
  jotform_form_id: string
  kind: "intake" | "feedback" | "debrief" | "other"
  webhook_secret: string
} | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("jotform_forms")
    .select("id, jotform_form_id, kind, webhook_secret")
    .eq("webhook_secret", token)
    .maybeSingle()
  if (error) {
    console.log("[v0] getFormByWebhookToken error:", error.message)
    return null
  }
  if (!data) return null
  // Defensive: an old row written before migration 046 might have a
  // null kind even though the column has a default — coerce to
  // 'intake' so the dispatcher still routes correctly.
  return {
    ...data,
    kind: (data.kind as "intake" | "feedback" | "debrief" | "other") ?? "intake",
  }
}

export async function recordWebhookEvent(args: {
  jotform_form_id: string | null
  jotform_submission_id: string | null
  raw_payload: unknown
  request_headers: Record<string, string>
  source_ip: string | null
}): Promise<string> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("jotform_webhook_events")
    .insert({
      jotform_form_id: args.jotform_form_id,
      jotform_submission_id: args.jotform_submission_id,
      raw_payload: args.raw_payload as never,
      request_headers: args.request_headers as never,
      source_ip: args.source_ip,
      processing_status: "pending",
    })
    .select("id")
    .single()
  if (error) {
    throw new Error(`Failed to record webhook event: ${error.message}`)
  }
  return data.id
}

export async function markWebhookProcessed(eventId: string) {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from("jotform_webhook_events")
    .update({ processing_status: "processed", processed_at: new Date().toISOString() })
    .eq("id", eventId)
  if (error) console.log("[v0] markWebhookProcessed error:", error.message)
}

export async function markWebhookFailed(eventId: string, message: string) {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from("jotform_webhook_events")
    .update({
      processing_status: "failed",
      processing_error: message,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)
  if (error) console.log("[v0] markWebhookFailed error:", error.message)
}
