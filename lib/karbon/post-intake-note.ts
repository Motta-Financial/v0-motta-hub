/**
 * Post a "New intake form received" Note onto a Karbon Contact's
 * timeline so the prospect's profile carries the full intake context
 * the moment they land in Karbon.
 *
 * Replaces the legacy Zapier behavior the firm relied on before Motta
 * Hub existed (the old `ZAP - New Intake → Karbon Note` step). Now
 * called automatically from `lib/jotform/ingest.ts` whenever the
 * intake pipeline creates a brand-new Karbon contact via
 * `findOrCreateClient`.
 *
 * Mechanics mirror `lib/karbon/post-debrief-note.ts`:
 *   - HTML body assembled from the intake row's most informative
 *     fields (services, business snapshot, prospect Q&A, ALFRED's
 *     enrichment & question research when present)
 *   - POST to `/v3/Notes` with `Timelines: [{ EntityType, EntityKey }]`
 *     so the note lands on the correct entity's timeline (Contact for
 *     individuals, Organization for businesses).
 *   - Fire-and-forget: failures are logged but never surface to the
 *     intake webhook (the row is already safely persisted to Supabase).
 *
 * The Subject line is intentionally short and human-readable —
 * "Intake Form — {Prospect Name}" — so it's scannable in the Karbon
 * timeline. The Body is rich HTML the partner can skim or copy/paste.
 */

import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"

// ── Types ────────────────────────────────────────────────────────────

export type IntakeNoteEntity = {
  /** "Contact" or "Organization" — must match Karbon's entity type. */
  entityType: "Contact" | "Organization"
  /** Karbon entity key the note should attach to. */
  entityKey: string
}

export type IntakeNoteSubmission = {
  id: string
  jotform_submission_id?: string | null
  jotform_created_at?: string | null
  submitter_full_name?: string | null
  submitter_email?: string | null
  submitter_phone?: string | null
  submitter_city?: string | null
  submitter_state?: string | null
  submitter_zip?: string | null
  business_name?: string | null
  business_state?: string | null
  business_summary?: string | null
  business_revenue_range?: string | null
  business_tax_classification?: string | null
  business_situation?: string | null
  service_focus?: string | null
  services_requested?: string[] | null
  entity_types?: string[] | null
  questions_or_concerns?: string | null
  additional_notes?: string | null
  preferred_team_member?: string | null
  enrichment?: { summary?: string | null } | null
  question_research?: { summary?: string | null } | null
  // Web presence + social links (rendered when present).
  website?: string | null
  linkedin_url?: string | null
  twitter_handle?: string | null
  facebook_url?: string | null
  instagram_url?: string | null
  // Referral attribution surfaced on the timeline note.
  referral?: { name?: string | null; matched?: boolean } | null
}

export type IntakeNoteContext = {
  /**
   * When provided, the note body includes a follow-up "Work item created"
   * block linking to the new Karbon work item. Used by the API route
   * `POST /api/jotform/intake/[id]/karbon-work-item` so the timeline
   * gets a cross-link to the work item in addition to Karbon's
   * automatic "work item attached" feed entry.
   */
  workItem?: {
    title: string
    url: string
  } | null
  /**
   * Email of the teammate who triggered the action. Karbon requires
   * `AuthorEmailAddress` to attribute the note correctly; omit and
   * the helper falls back to a firm-wide service address derived
   * from `RESEND_FROM_EMAIL` (with a `noreply@` fallback).
   */
  authorEmail?: string | null
  /** URL into Motta Hub for the canonical intake row. */
  hubUrl?: string | null
  /**
   * Best-effort pin the note to the top of the entity timeline. Karbon's
   * public API does not officially document a pin field, so we send
   * `IsPinned: true` on the create payload and, if Karbon rejects it,
   * automatically retry the create without the flag so the note is still
   * posted. When the flag is silently accepted the note is pinned.
   */
  pinned?: boolean
}

export type PostIntakeNoteResult = {
  ok: boolean
  noteKey?: string
  error?: string
  skipped?: "no_credentials" | "no_entity"
}

// ── HTML helpers ─────────────────────────────────────────────────────

const escape = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const formatDateLong = (iso?: string | null): string => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function renderList(items: Array<string | null | undefined>): string {
  const cleaned = items.filter((x): x is string => Boolean(x && x.trim()))
  if (cleaned.length === 0) return ""
  return `<ul>${cleaned.map((i) => `<li>${escape(i)}</li>`).join("")}</ul>`
}

function renderKvList(rows: Array<{ label: string; value?: string | null }>): string {
  const lines = rows
    .filter((r) => r.value && r.value.trim())
    .map((r) => `<li><strong>${escape(r.label)}:</strong> ${escape(r.value!)}</li>`)
  if (lines.length === 0) return ""
  return `<ul>${lines.join("")}</ul>`
}

// ── Body builder ─────────────────────────────────────────────────────

function buildNoteBody(
  submission: IntakeNoteSubmission,
  ctx: IntakeNoteContext,
): string {
  const parts: string[] = []

  // Header — answers "what is this and when did it land?"
  const intakeDate = formatDateLong(submission.jotform_created_at)
  parts.push("<p>")
  parts.push(
    `A new intake form was submitted${intakeDate ? ` on <strong>${escape(intakeDate)}</strong>` : ""} via the Motta Hub website.`,
  )
  parts.push("</p>")

  if (ctx.workItem) {
    parts.push("<h3>Work item created</h3>")
    parts.push(
      `<p>A Karbon Work Item has been created on this contact: <a href="${escape(ctx.workItem.url)}">${escape(ctx.workItem.title)}</a></p>`,
    )
  }

  // Prospect identity / location
  parts.push("<h3>Prospect</h3>")
  parts.push(
    renderKvList([
      { label: "Full name", value: submission.submitter_full_name },
      { label: "Email", value: submission.submitter_email },
      { label: "Phone", value: submission.submitter_phone },
      {
        label: "Location",
        value: [submission.submitter_city, submission.submitter_state, submission.submitter_zip]
          .filter(Boolean)
          .join(", "),
      },
      {
        label: "Preferred team member",
        value: submission.preferred_team_member,
      },
    ]),
  )

  // Services
  const services = (submission.services_requested ?? []).filter(Boolean)
  const entityTypes = (submission.entity_types ?? []).filter(Boolean)
  if (
    submission.service_focus ||
    services.length > 0 ||
    submission.business_situation ||
    entityTypes.length > 0
  ) {
    parts.push("<h3>Services requested</h3>")
    parts.push(
      renderKvList([
        { label: "Service focus", value: submission.service_focus },
        { label: "Business situation", value: submission.business_situation },
        {
          label: "Entity types",
          value: entityTypes.length ? entityTypes.join(", ") : null,
        },
      ]),
    )
    if (services.length > 0) {
      parts.push("<p><strong>Specifically:</strong></p>")
      parts.push(renderList(services))
    }
  }

  // Business snapshot
  if (
    submission.business_name ||
    submission.business_state ||
    submission.business_summary ||
    submission.business_revenue_range ||
    submission.business_tax_classification
  ) {
    parts.push("<h3>Business</h3>")
    parts.push(
      renderKvList([
        { label: "Name", value: submission.business_name },
        { label: "State", value: submission.business_state },
        { label: "Revenue range", value: submission.business_revenue_range },
        { label: "Tax classification", value: submission.business_tax_classification },
      ]),
    )
    if (submission.business_summary) {
      parts.push("<p><strong>Summary:</strong></p>")
      parts.push(`<p>${escape(submission.business_summary).replace(/\n/g, "<br />")}</p>`)
    }
  }

  // Web presence / social links
  if (
    submission.website ||
    submission.linkedin_url ||
    submission.twitter_handle ||
    submission.facebook_url ||
    submission.instagram_url
  ) {
    parts.push("<h3>Web presence</h3>")
    parts.push(
      renderKvList([
        { label: "Website", value: submission.website },
        { label: "LinkedIn", value: submission.linkedin_url },
        { label: "X / Twitter", value: submission.twitter_handle },
        { label: "Facebook", value: submission.facebook_url },
        { label: "Instagram", value: submission.instagram_url },
      ]),
    )
  }

  // Referral attribution
  if (submission.referral?.name) {
    parts.push("<h3>Referred by</h3>")
    parts.push(
      `<p>${escape(submission.referral.name)}${submission.referral.matched ? "" : " (unmatched — pending review in Motta Hub)"}</p>`,
    )
  }

  // Questions / notes from the prospect themselves
  if (submission.questions_or_concerns) {
    parts.push("<h3>Questions from the prospect</h3>")
    parts.push(
      `<div style="background:#f5f5f5;padding:10px;border-radius:4px;">${escape(submission.questions_or_concerns).replace(/\n/g, "<br />")}</div>`,
    )
  }
  if (submission.additional_notes) {
    parts.push("<h3>Additional notes</h3>")
    parts.push(
      `<p>${escape(submission.additional_notes).replace(/\n/g, "<br />")}</p>`,
    )
  }

  // ALFRED enrichment (when available) — adds prospect-research and
  // a drafted answer to their questions to the timeline so the
  // partner gets the full briefing without leaving Karbon.
  if (submission.enrichment?.summary) {
    parts.push("<h3>ALFRED prospect research</h3>")
    parts.push(`<p>${escape(submission.enrichment.summary).replace(/\n/g, "<br />")}</p>`)
  }
  if (submission.question_research?.summary) {
    parts.push("<h3>ALFRED suggested response</h3>")
    parts.push(`<p>${escape(submission.question_research.summary).replace(/\n/g, "<br />")}</p>`)
  }

  // Cross-link to Motta Hub for the canonical record + threaded comments
  if (ctx.hubUrl) {
    parts.push("<hr />")
    parts.push(
      `<p><em>Synced from <a href="${escape(ctx.hubUrl)}">Motta Hub</a>.</em></p>`,
    )
  }

  return parts.join("\n")
}

// ── Public API ───────────────────────────────────────────────────────

function defaultHubUrlFor(submissionId: string): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://hub.motta.cpa"
  // Mirrors components/intake/intake-list.tsx's deep-link convention.
  return `${siteUrl}/sales/intake?submission=${submissionId}`
}

function defaultAuthorEmail(): string {
  // Falls back to RESEND_FROM_EMAIL so the note is at least attributed
  // to a real Motta address; Karbon will reject completely bogus
  // emails, but the firm's `noreply@` is a known-good account in
  // their tenant.
  return (
    process.env.RESEND_FROM_EMAIL ||
    "noreply@mottafinancial.com"
  )
}

export async function postIntakeNoteToKarbon(
  entity: IntakeNoteEntity,
  submission: IntakeNoteSubmission,
  context: IntakeNoteContext = {},
  credentialsOverride?: KarbonApiConfig,
): Promise<PostIntakeNoteResult> {
  if (!entity?.entityKey) {
    return { ok: false, skipped: "no_entity", error: "Missing Karbon entity key" }
  }

  const credentials = credentialsOverride ?? getKarbonCredentials()
  if (!credentials) {
    console.warn("[karbon-intake-note] Karbon credentials missing — skipping note push.")
    return { ok: false, skipped: "no_credentials", error: "Karbon credentials are not configured" }
  }

  const hubUrl = context.hubUrl ?? defaultHubUrlFor(submission.id)
  const authorEmail = context.authorEmail ?? defaultAuthorEmail()

  const subjectName = submission.submitter_full_name?.trim()
  const subject = context.workItem
    ? `Work Item Created — ${subjectName || "Prospect"}`
    : `Intake Form — ${subjectName || "Prospect"}`

  const body = buildNoteBody(submission, { ...context, hubUrl })

  const payload: Record<string, unknown> = {
    Subject: subject,
    Body: body,
    AuthorEmailAddress: authorEmail,
    Timelines: [{ EntityType: entity.entityType, EntityKey: entity.entityKey }],
  }
  if (submission.jotform_created_at) {
    payload.TodoDate = submission.jotform_created_at
  }
  if (context.pinned) {
    // Best-effort pin — see PostIntakeNoteResult/context.pinned doc above.
    payload.IsPinned = true
  }

  let { data, error } = await karbonFetch<{ NoteKey?: string }>(
    "/Notes",
    credentials,
    { method: "POST", body: payload },
  )

  // If Karbon rejected the request and we sent the unofficial IsPinned
  // flag, retry once without it so the note still lands on the timeline.
  if (error && context.pinned) {
    console.warn("[karbon-intake-note] POST /Notes with IsPinned failed — retrying without pin.")
    delete payload.IsPinned
    ;({ data, error } = await karbonFetch<{ NoteKey?: string }>(
      "/Notes",
      credentials,
      { method: "POST", body: payload },
    ))
  }

  if (error) {
    console.error("[karbon-intake-note] POST /Notes failed:", error)
    return { ok: false, error }
  }
  return { ok: true, noteKey: (data as any)?.NoteKey }
}
