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
import { findOrCreateClient, pushHubOrganizationToKarbon } from "@/lib/karbon/client-sync"
import {
  findOrCreateHubContact,
  findOrCreateHubOrganization,
  linkContactToOrganization,
} from "@/lib/hub/find-or-create-contact"
import { postIntakeNoteToKarbon } from "@/lib/karbon/post-intake-note"
import { findOrCreateDeal } from "@/lib/deals/find-or-create-deal"
import { resolveDiscoveryBookingUrl } from "@/lib/intake/booking-link"
import { sendProspectIntakeConfirmation } from "@/lib/intake/notify-prospect"
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
  // Why client-resolution didn't produce a link, persisted onto the row
  // so failures are queryable instead of living only in a serverless
  // console.log. Stays null on success.
  let linkError: string | null = null
  // Set once we know the resolution attempt ran at all — distinguishes
  // "never attempted" from "attempted and found nothing".
  let linkAttempted = false

  // Auto-match the freshly-upserted row to a contact / organization.
  // This is best-effort: a match failure shouldn't fail the webhook,
  // because the row is already safely persisted and the bulk
  // matcher (scripts/jotform-intake-link-clients.mjs) can sweep up
  // any misses later. Logged but not thrown.
  try {
    // Re-read so we have the row's UUID + current link state. We
    // upserted by `jotform_submission_id` so that's our key here.
    // NOTE: the phone column is `submitter_phone`. This select asked for
    // a `phone_number` column that has never existed on the table, which
    // made PostgREST fail the whole request — so `persisted` was ALWAYS
    // null and the entire linking block below never executed for any
    // submission. The `{ data }`-only destructure discarded the error,
    // so it failed completely silently: the 83% of Jotform rows that
    // look linked were linked by the backfill sweep
    // (scripts/jotform-intake-link-clients.mjs), never by this live
    // path, and website intakes — which the sweep doesn't cover — sat at
    // 1 of 12 linked. Capture the error from here on.
    const { data: persisted, error: readErr } = await supabase
      .from("jotform_intake_submissions")
      .select("id, submitter_email, submitter_full_name, business_name, submitter_phone, contact_id, organization_id, link_method")
      .eq("jotform_submission_id", submission.id)
      .maybeSingle()
      if (readErr) {
        linkAttempted = true
        linkError = `read-back: ${readErr.message}`
        console.error("[Jotform] intake read-back failed, cannot link:", readErr.message)
      }
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
        linkAttempted = true
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
              phone: persisted.submitter_phone ?? null,
            },
            { source: "jotform_intake", supabase },
          )
          hubFallback = {
            contact_id: hub.contact_id,
            organization_id: hub.organization_id,
          }
        } catch (err) {
          linkError = `hub: ${(err as Error).message}`
          console.log(
            "[Jotform] hub-first create failed (will still try Karbon):",
            (err as Error).message,
          )
        }

        // `findOrCreateClient` is a long chain of Karbon API calls and
        // Supabase writes, any of which can throw. It used to run
        // unguarded here, so a Karbon hiccup propagated straight to the
        // outer catch — skipping the `.update()` below and DISCARDING
        // the Hub contact we had just successfully created. That is how
        // 11 of 12 website intakes ended up with link_method NULL while
        // a matching Hub contact existed all along. Guard it, keep the
        // Hub-first result, and record why Karbon didn't contribute.
        let karbonResult: Awaited<ReturnType<typeof findOrCreateClient>> = {
          contact_id: null,
          organization_id: null,
          karbon_key: null,
          method: "not_found",
          reason: "not attempted",
        }
        try {
          karbonResult = await findOrCreateClient(
            {
              email: persisted.submitter_email || undefined,
              fullName: persisted.submitter_full_name || undefined,
              businessName: persisted.business_name || undefined,
              phone: persisted.submitter_phone || undefined,
            },
            { autoCreate: true, source: "Jotform Intake" }
          )
        } catch (err) {
          // Append rather than overwrite — if the Hub call ALSO failed
          // we want both reasons on the row, since that combination is
          // what leaves a submission genuinely orphaned.
          const karbonMsg = `karbon: ${(err as Error).message}`
          linkError = linkError ? `${linkError}; ${karbonMsg}` : karbonMsg
          console.log("[Jotform] Karbon find-or-create failed (falling back to Hub contact):", karbonMsg)
        }

        // Karbon path won — use its IDs (it has Karbon keys attached).
        // Karbon path failed — fall back to whatever the Hub-first
        // call produced so we never leave the submission unlinked.
        const finalContactId = karbonResult.contact_id ?? hubFallback.contact_id
        const finalOrganizationId =
          karbonResult.organization_id ?? hubFallback.organization_id

        if (!finalContactId && !finalOrganizationId && !linkError) {
          linkError = "no contact or organization could be resolved or created"
        }

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

          // ── Business intake: guarantee the Person + Organization pair ──
          // findOrCreateClient / findOrCreateHubContact each resolve only
          // ONE entity, so a business prospect who also gave their personal
          // name would otherwise be missing the company half. When we have a
          // person contact AND a business name, find-or-create the org in the
          // Hub, link it to the person (Owner), mirror it onto the intake row,
          // and push it to Karbon. pushHubOrganizationToKarbon now searches
          // Karbon first, so this never mints a duplicate org.
          const businessName = persisted.business_name?.trim() || null
          if (finalContactId && businessName && businessName.length >= 2) {
            try {
              const org = await findOrCreateHubOrganization(
                {
                  name: businessName,
                  email: persisted.submitter_email ?? null,
                  phone: persisted.submitter_phone ?? null,
                  source: "jotform_intake",
                },
                supabase,
              )
              if (org.organization_id) {
                await linkContactToOrganization(finalContactId, org.organization_id, { supabase })
                await supabase
                  .from("jotform_intake_submissions")
                  .update({ organization_id: org.organization_id })
                  .eq("id", persisted.id)
                try {
                  await pushHubOrganizationToKarbon(org.organization_id, { source: "Jotform Intake" })
                } catch (err) {
                  console.log("[Jotform] business org Karbon push failed:", (err as Error).message)
                }
                console.log(
                  `[Jotform] linked business org ${org.organization_id} (${org.created ? "created" : "matched"}) to contact ${finalContactId}`,
                )
              }
            } catch (err) {
              console.log("[Jotform] business org create/link failed:", (err as Error).message)
            }
          }
        }
      } else {
        console.log(`[Jotform] auto-linked intake ${submission.id} via ${result.link_method}: ${result.reason}`)
      }

      // ── Open an opportunity ─────────────────────────────────────────
      // A Calendly booking has always opened a Deal; an intake never
      // did. That left form-only prospects — the majority, since most
      // intakes never book — with a contact and a triage row but no
      // opportunity, invisible to the deals pipeline.
      //
      // Re-read rather than reusing the in-scope ids: the business-org
      // branch above may have rewritten `organization_id`, and the
      // already-auto-linked branch never populated locals at all.
      // findOrCreateDeal is idempotent, so the Calendly webhook will
      // later reuse this same open deal rather than opening a second.
      try {
        const { data: linked } = await supabase
          .from("jotform_intake_submissions")
          .select("contact_id, organization_id")
          .eq("id", persisted.id)
          .maybeSingle()
        if (linked?.contact_id || linked?.organization_id) {
          await findOrCreateDeal(
            {
              contactId: linked.contact_id ?? undefined,
              organizationId: linked.organization_id ?? undefined,
              title:
                persisted.business_name ||
                persisted.submitter_full_name ||
                persisted.submitter_email ||
                "Intake Prospect",
              source: "intake_form",
            },
            { supabase },
          )
        }
      } catch (err) {
        console.log("[Jotform] deal create failed (non-blocking):", (err as Error).message)
      }
    }
  } catch (err) {
    // Anything that still escapes the per-step guards above. Recorded
    // on the row (below) rather than only in the runtime log, because a
    // console.log in a serverless function is not an operational signal
    // — that is precisely why the website-intake linking failures went
    // unnoticed for months.
    linkError = `unhandled: ${(err as Error).message}`
    linkAttempted = true
    console.log("[Jotform] intake auto-link error:", (err as Error).message)
  }

  // Persist link diagnostics regardless of outcome. `link_error` is
  // informational even on a successful link — "linked via Hub, but the
  // Karbon mirror failed" is exactly the state worth knowing about.
  if (persistedRowId && linkAttempted) {
    const { error: diagErr } = await supabase
      .from("jotform_intake_submissions")
      .update({
        link_attempted_at: new Date().toISOString(),
        link_error: linkError,
      })
      .eq("id", persistedRowId)
    if (diagErr) console.log("[Jotform] link diagnostics write failed:", diagErr.message)
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

  // Hand the caller the resolved identity + booking link. The public
  // intake route relays these to the website form so it can render the
  // booking step immediately, rather than telling the prospect to wait
  // for a callback.
  let bookingUrl: string | null = null
  let contactId: string | null = null
  let organizationId: string | null = null
  if (persistedRowId) {
    const { data: final } = await supabase
      .from("jotform_intake_submissions")
      .select("booking_url, contact_id, organization_id")
      .eq("id", persistedRowId)
      .maybeSingle()
    bookingUrl = final?.booking_url ?? null
    contactId = final?.contact_id ?? null
    organizationId = final?.organization_id ?? null
  }

  return {
    id: submission.id,
    row_id: persistedRowId,
    booking_url: bookingUrl,
    contact_id: contactId,
    organization_id: organizationId,
  }
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
        "behind_on_filings",
        "pending_tax_notices",
        "current_cpa_status",
        "cpa_switch_reason",
        "enrichment",
        "question_research",
        "fee_estimate",
        "notified_at",
        "preferred_team_member_id",
        "booking_url",
        "prospect_confirmation_sent_at",
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
    behind_on_filings: string | null
    pending_tax_notices: string | null
    current_cpa_status: string | null
    cpa_switch_reason: string | null
    enrichment: Record<string, unknown> | null
    question_research: Record<string, unknown> | null
    fee_estimate: Record<string, unknown> | null
    notified_at: string | null
    preferred_team_member_id: string | null
    booking_url: string | null
    prospect_confirmation_sent_at: string | null
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
          // Mirror onto the local row too — the booking-link step below
          // routes off this field, and it was read from the DB *before*
          // this update, so without the write-back it would still be
          // null and every prospect would land on the firm round-robin.
          submissionRow.preferred_team_member_id = resolved.team_member_id
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

  // ── 1a. Discovery-call booking link ───────────────────────────────
  // Generated here, AFTER the preferred-teammate resolution above, so a
  // prospect who asked for a specific person is routed to that person's
  // calendar rather than the firm round-robin.
  //
  // Persisted on the row so every surface that offers the link — the
  // wizard's booking step, the prospect confirmation email, the team
  // email, any later nudge — hands out the SAME url. Regenerating would
  // be harmless for the prospect but would fragment attribution, since
  // the salesforce_uuid we thread through it is what ties the resulting
  // booking back to this intake.
  //
  // Idempotent: only computed when the column is still null, so a
  // replayed webhook or a manual re-run never rewrites a link already
  // sitting in someone's inbox.
  if (!submissionRow.booking_url) {
    try {
      const booking = await resolveDiscoveryBookingUrl(supabase, {
        submissionId: submissionRow.id,
        fullName: submissionRow.submitter_full_name,
        email: submissionRow.submitter_email,
        // Fall back to the queue owner: on a re-run of an intake a human
        // has already reassigned, that is the person actually working it.
        preferredTeamMemberId:
          submissionRow.preferred_team_member_id ?? submissionRow.assigned_to_id,
      })
      const { error: bookingErr } = await supabase
        .from("jotform_intake_submissions")
        .update({ booking_url: booking.url })
        .eq("id", submissionRow.id)
      if (bookingErr) {
        console.log("[Jotform] booking url persist error:", bookingErr.message)
      } else {
        submissionRow.booking_url = booking.url
        console.log(
          `[Jotform] booking link routed via ${booking.routing}${booking.hostName ? ` (${booking.hostName})` : ""}`,
        )
      }
    } catch (err) {
      console.log("[Jotform] booking link error:", (err as Error).message)
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
  //
  // The stamp is now conditional on `sent > 0`. `sendCategoryEmail`
  // reports transport failures by RETURNING `{ sent: 0 }` rather than
  // throwing, so the previous unconditional stamp meant a Resend outage
  // silently consumed the intake alert AND the single-flight guard then
  // blocked every retry. A prospect could arrive with nobody told.
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
        behind_on_filings: submissionRow.behind_on_filings,
        pending_tax_notices: submissionRow.pending_tax_notices,
        current_cpa_status: submissionRow.current_cpa_status,
        cpa_switch_reason: submissionRow.cpa_switch_reason,
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
      if (sent > 0) {
        const { error: notifyErr } = await supabase
          .from("jotform_intake_submissions")
          .update({ notified_at: new Date().toISOString() })
          .eq("id", submissionRow.id)
        if (notifyErr) console.log("[Jotform] notified_at update error:", notifyErr.message)
        console.log(`[Jotform] intake ${jotformSubmissionId} notified ${sent}/${attempted} teammates`)
      } else {
        // Leave `notified_at` null so a replay or a sweep can retry.
        // Loud, because zero delivered on a live prospect is an incident,
        // not a routine outcome.
        console.error(
          `[Jotform] intake ${jotformSubmissionId} notified 0/${attempted} teammates — leaving notified_at NULL for retry`,
        )
      }
    } catch (err) {
      console.log("[Jotform] notify error:", (err as Error).message)
    }
  } else {
    console.log(`[Jotform] intake ${jotformSubmissionId} already notified at ${submissionRow.notified_at} — skipping email`)
  }

  // ── 4. Prospect confirmation + booking link ───────────────────────
  // The client-facing half of the funnel fix. Until now the prospect
  // got nothing at all — only the team was emailed — and the wizard
  // told them to wait for a callback. Of 130 intakes with a resolved
  // contact in the 18 months to 2026-08, 8 booked within a week.
  //
  // Same single-flight discipline as the team email, and the same
  // send-verified stamp: `sendEmail` returns `{ success: false }` on a
  // transport failure instead of throwing, so stamping unconditionally
  // would burn the one automated chance to reach this prospect.
  if (!submissionRow.prospect_confirmation_sent_at && submissionRow.submitter_email) {
    if (!submissionRow.booking_url) {
      console.log(
        `[Jotform] intake ${jotformSubmissionId} has no booking_url — skipping prospect confirmation`,
      )
    } else {
      try {
        const firstName =
          submissionRow.submitter_full_name?.trim().split(/\s+/)[0] ?? null
        const { sent, error: sendErr } = await sendProspectIntakeConfirmation({
          firstName,
          email: submissionRow.submitter_email,
          bookingUrl: submissionRow.booking_url,
          // Only name the host when we actually routed to their calendar;
          // `preferred_team_member` is the prospect's raw typed answer and
          // may not have matched anyone.
          hostName: submissionRow.preferred_team_member_id
            ? submissionRow.preferred_team_member
            : null,
          serviceFocus: submissionRow.service_focus,
        })
        if (sent) {
          const { error: stampErr } = await supabase
            .from("jotform_intake_submissions")
            .update({ prospect_confirmation_sent_at: new Date().toISOString() })
            .eq("id", submissionRow.id)
          if (stampErr) {
            console.log("[Jotform] prospect confirmation stamp error:", stampErr.message)
          }
          console.log(`[Jotform] intake ${jotformSubmissionId} prospect confirmation sent`)
        } else {
          console.error(
            `[Jotform] intake ${jotformSubmissionId} prospect confirmation NOT sent: ${sendErr ?? "unknown"}`,
          )
        }
      } catch (err) {
        console.log("[Jotform] prospect confirmation error:", (err as Error).message)
      }
    }
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
