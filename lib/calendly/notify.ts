/**
 * Calendly booking notifications
 *
 * The firm-wide "New Meeting Booked" email. Clients and prospects can book
 * on ANY teammate's Calendly, so every booking is announced to the whole
 * team — the right people can only get involved in a meeting they know
 * about. Mirrors the intake email in lib/jotform/notify.ts.
 *
 * The email is "brief-grade": it tells the team everything needed to walk
 * into the meeting prepared —
 *   - whose calendar it landed on, when, and how to join
 *   - whether the invitee is a NEW prospect, a known prospect, or an
 *     EXISTING client
 *   - ALFRED's researched brief: who they are, why they booked, their
 *     history with the firm, what to prepare, what is still unknown
 *     (lib/calendly/research.ts — Hub history + intake on file + web)
 *   - the teammates already connected to this client
 *   - what the invitee wrote on the booking form
 *   - the intake / prospect form on file, if any
 *   - for existing clients: open Karbon work, proposals, revenue
 *
 * One email per booking, ever. The send is claimed atomically on
 * `calendly_events.team_notified_at`, so the real-time webhook, Calendly's
 * own retries and the cron backstop can all call this for the same booking
 * and exactly one of them sends.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { resolveRecipientsForCategory, sendCategoryEmail } from "@/lib/email"
import { firmConfigSync } from "@/lib/firm-settings"
import {
  gatherMeetingResearch,
  writeMeetingBrief,
  type BookingForResearch,
  type BookingQA,
  type MeetingBrief,
  type MeetingResearch,
  type Relationship,
} from "@/lib/calendly/research"

const APP_URL = () => firmConfigSync().hubUrl
const FIRM_TZ = () => firmConfigSync().timezone || "America/New_York"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyBookingOptions {
  /** `calendly_events.id` (internal Hub uuid). */
  eventId: string
  /**
   * True when THIS booking created the Hub contact. The webhook knows; the
   * cron backstop leaves it undefined and it is inferred from the contact.
   */
  wasNewContact?: boolean
}

export interface NotifyBookingResult {
  sent: boolean
  recipientCount: number
  /** Why nothing was sent, when `sent` is false. */
  reason?:
    | "already_notified"
    | "event_not_found"
    | "not_active"
    | "no_invitee"
    | "no_recipients"
    | "send_failed"
    | "error"
}

/** The slice of a `calendly_events` row the email needs. */
interface BookingEventRow {
  id: string
  calendly_uuid: string | null
  name: string | null
  status: string | null
  start_time: string | null
  end_time: string | null
  location_type: string | null
  location: string | null
  join_url: string | null
  team_member_id: string | null
  calendly_user_name: string | null
  calendly_user_email: string | null
  event_memberships: Array<{ user?: string; user_name?: string; user_email?: string }> | null
  calendly_created_at: string | null
}

interface BookingInviteeRow {
  calendly_uri: string | null
  name: string | null
  email: string | null
  status: string | null
  questions_answers: Array<{ question?: string; answer?: string }> | null
  text_reminder_number: string | null
  contact_id: string | null
  old_invitee_uri: string | null
  calendly_created_at: string | null
}

/** Everything the HTML builder needs — no database access past this point. */
export interface MeetingBookedEmailModel {
  eventName: string
  startTime: string | null
  endTime: string | null
  joinUrl: string | null
  locationLabel: string | null
  hostName: string | null
  coHostNames: string[]
  inviteeName: string
  inviteeEmail: string | null
  inviteePhone: string | null
  contactId: string | null
  rescheduled: boolean
  /** Start of the meeting this one replaces, when it is a reschedule. */
  previousStartTime: string | null
  research: MeetingResearch
  brief: MeetingBrief
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Only http(s) links are ever put in an href — everything else is dropped. */
function safeUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim()
  return /^https?:\/\//i.test(u) ? u : null
}

/** "Wed, Dec 9, 2:00 PM EST" in the FIRM's timezone (the server runs in UTC). */
function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: FIRM_TZ(),
  })
}

function formatTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: FIRM_TZ(),
  })
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: FIRM_TZ(),
  })
}

function durationLabel(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000)
  if (!Number.isFinite(mins) || mins <= 0) return null
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function locationLabel(event: BookingEventRow): string | null {
  const type = (event.location_type ?? "").toLowerCase()
  if (type.includes("zoom")) return "Zoom"
  if (type.includes("google")) return "Google Meet"
  if (type.includes("teams") || type.includes("microsoft")) return "Microsoft Teams"
  if (type.includes("outbound_call")) return "Phone — we call them"
  if (type.includes("inbound_call")) return "Phone — they call us"
  if (type === "physical") return event.location ? `In person — ${event.location}` : "In person"
  if (event.join_url) return "Video call"
  return event.location ?? null
}

const RELATIONSHIP_BADGE: Record<Relationship, { label: string; bg: string; fg: string; word: string }> = {
  new_prospect: { label: "NEW PROSPECT", bg: "#FEF3C7", fg: "#92400E", word: "New prospect" },
  prospect: { label: "PROSPECT", bg: "#DBEAFE", fg: "#1E40AF", word: "Prospect" },
  existing_client: { label: "EXISTING CLIENT", bg: "#D1FAE5", fg: "#065F46", word: "Client" },
}

// ---------------------------------------------------------------------------
// Email builder (pure — exported for previews and checks)
// ---------------------------------------------------------------------------

function section(title: string, innerHtml: string): string {
  return `
    <h3 style="margin:24px 0 8px;font-size:14px;font-weight:700;color:#111827;">${escapeHtml(title)}</h3>
    ${innerHtml}`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(text)}</p>`
}

function bulletList(items: string[]): string {
  if (items.length === 0) return ""
  return `<ul style="margin:0 0 8px;padding-left:20px;">${items
    .map((i) => `<li style="margin:0 0 4px;font-size:14px;line-height:1.55;color:#374151;">${escapeHtml(i)}</li>`)
    .join("")}</ul>`
}

function statRow(label: string, valueHtml: string): string {
  return `<tr><td style="padding:4px 0;font-size:13px;color:#6B7280;vertical-align:top;width:42%;">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:13px;color:#111827;font-weight:600;text-align:right;">${valueHtml}</td></tr>`
}

export function buildMeetingBookedSubject(m: MeetingBookedEmailModel): string {
  const word = RELATIONSHIP_BADGE[m.research.relationship].word
  const lead = m.rescheduled ? "Meeting Rescheduled" : "New Meeting Booked"
  const withHost = m.hostName ? ` with ${m.hostName}` : ""
  return `${lead}: ${m.inviteeName} (${word}) — ${m.eventName}${withHost}`
}

export function buildMeetingBookedEmailHtml(m: MeetingBookedEmailModel): string {
  const app = APP_URL()
  const { research, brief } = m
  const badge = RELATIONSHIP_BADGE[research.relationship]
  const clientUrl = m.contactId ? `${app}/clients/${encodeURIComponent(m.contactId)}` : null
  const calendarUrl = `${app}/meetings/calendar`
  const joinUrl = safeUrl(m.joinUrl)

  // ── When / where ────────────────────────────────────────────────────
  const duration = durationLabel(m.startTime, m.endTime)
  const whenLine = `${formatDateTime(m.startTime)}${m.endTime ? ` – ${formatTime(m.endTime)}` : ""}${duration ? ` (${duration})` : ""}`
  const previousLine =
    m.rescheduled && m.previousStartTime
      ? `<p style="margin:0 0 4px;font-size:13px;color:#92400E;"><strong>Moved from:</strong> ${escapeHtml(formatDateTime(m.previousStartTime))}</p>`
      : ""

  // ── ALFRED's brief ──────────────────────────────────────────────────
  const briefParts: string[] = [
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(brief.summary)}</p>`,
  ]
  const briefField = (label: string, value: string | null) => {
    if (!value) return
    briefParts.push(
      `<p style="margin:12px 0 2px;font-size:11px;font-weight:700;color:#6B745D;letter-spacing:0.4px;">${escapeHtml(label.toUpperCase())}</p>` +
        `<p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(value)}</p>`,
    )
  }
  briefField("Who they are", brief.whoTheyAre)
  briefField("Why they booked", brief.whyTheyBooked)
  briefField("History with Motta", brief.historyWithFirm)
  if (brief.prepPoints.length) {
    briefParts.push(
      `<p style="margin:12px 0 4px;font-size:11px;font-weight:700;color:#6B745D;letter-spacing:0.4px;">BEFORE THE MEETING</p>` +
        bulletList(brief.prepPoints),
    )
  }
  if (brief.openQuestions.length) {
    briefParts.push(
      `<p style="margin:12px 0 4px;font-size:11px;font-weight:700;color:#6B745D;letter-spacing:0.4px;">WORTH ASKING</p>` +
        bulletList(brief.openQuestions),
    )
  }
  const briefBlock = `
    <div style="background:#F5F6F2;border-left:3px solid #6B745D;border-radius:0 6px 6px 0;padding:14px 16px;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#6B745D;letter-spacing:0.5px;">ALFRED&#39;S BRIEF</p>
      ${briefParts.join("")}
    </div>`

  // ── Teammates already connected to this client ──────────────────────
  const teamBlock = research.connectedTeam.length
    ? section(
        "Who's connected to this client",
        `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${research.connectedTeam
          .map(
            (t) =>
              `<tr><td style="padding:4px 0;font-size:13px;color:#111827;font-weight:600;width:42%;vertical-align:top;">${escapeHtml(t.name)}</td><td style="padding:4px 0;font-size:13px;color:#6B7280;">${escapeHtml(t.roles.join(" · "))}</td></tr>`,
          )
          .join("")}</table>
         <p style="margin:6px 0 0;font-size:12px;color:#6B7280;">If you should be in this meeting, coordinate with ${escapeHtml(m.hostName ?? "the host")}.</p>`,
      )
    : ""

  // ── What they wrote on the booking form ─────────────────────────────
  const noteBlock = research.bookingNote
    ? section(
        "What they wrote when booking",
        `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:12px 14px;">
           <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;white-space:pre-line;">${escapeHtml(research.bookingNote)}</p>
         </div>`,
      )
    : ""

  // ── Intake / prospect form on file ──────────────────────────────────
  let intakeBlock = ""
  const intake = research.intake
  if (intake) {
    const rows: string[] = []
    if (intake.servicesRequested.length) rows.push(statRow("Services requested", escapeHtml(intake.servicesRequested.join(", "))))
    if (intake.businessName) {
      rows.push(statRow("Business", escapeHtml(`${intake.businessName}${intake.businessState ? ` (${intake.businessState})` : ""}`)))
    }
    if (intake.businessTaxClassification) rows.push(statRow("Tax classification", escapeHtml(intake.businessTaxClassification)))
    if (intake.businessRevenueRange) rows.push(statRow("Revenue range", escapeHtml(intake.businessRevenueRange)))
    if (intake.behindOnFilings) rows.push(statRow("Behind on filings", escapeHtml(intake.behindOnFilings)))
    if (intake.pendingTaxNotices) rows.push(statRow("Open tax notices", escapeHtml(intake.pendingTaxNotices)))
    if (intake.currentCpaStatus) rows.push(statRow("Current CPA", escapeHtml(intake.currentCpaStatus)))
    if (intake.referralSource) rows.push(statRow("Referred by", escapeHtml(intake.referralSource)))
    if (intake.feeEstimate) {
      rows.push(statRow("ALFRED fee estimate", escapeHtml(`${money(intake.feeEstimate.low)} – ${money(intake.feeEstimate.high)}`)))
    }
    const karbonUrl = safeUrl(intake.karbonWorkItemUrl)
    if (intake.karbonWorkItemTitle) {
      rows.push(
        statRow(
          "Karbon work item",
          karbonUrl
            ? `<a href="${escapeHtml(karbonUrl)}" style="color:#2563EB;text-decoration:none;">${escapeHtml(intake.karbonWorkItemTitle)}</a>`
            : escapeHtml(intake.karbonWorkItemTitle),
        ),
      )
    }
    const questions = intake.questionsOrConcerns
      ? `<p style="margin:10px 0 2px;font-size:12px;font-weight:600;color:#6B7280;">${intake.source === "intake_form" ? "Their questions" : "Meeting context"}</p>
         <p style="margin:0;font-size:13px;line-height:1.55;color:#374151;white-space:pre-line;">${escapeHtml(intake.questionsOrConcerns.slice(0, 900))}</p>`
      : ""
    const formUrl =
      intake.source === "intake_form"
        ? intake.searchKey
          ? `${app}/sales/intake?search=${encodeURIComponent(intake.searchKey)}`
          : `${app}/sales/intake`
        : `${app}/prospects/${encodeURIComponent(intake.id)}`
    intakeBlock = section(
      `${intake.source === "intake_form" ? "Intake form on file" : "Prospect record on file"} · ${formatDate(intake.submittedAt)}`,
      `${rows.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.join("")}</table>` : ""}
       ${questions}
       <p style="margin:8px 0 0;font-size:13px;"><a href="${escapeHtml(formUrl)}" style="color:#2563EB;text-decoration:none;">Open the full ${intake.source === "intake_form" ? "intake" : "prospect record"} in Motta Hub &rarr;</a></p>`,
    )
  }

  // ── Client snapshot (anyone with history in the Hub) ────────────────
  let clientBlock = ""
  const cp = research.profile
  if (cp && research.relationship !== "new_prospect") {
    const rows: string[] = []
    if (cp.clientOwnerName) rows.push(statRow("Owner", escapeHtml(cp.clientOwnerName)))
    if (cp.clientManagerName) rows.push(statRow("Manager", escapeHtml(cp.clientManagerName)))
    if (research.linkedBusinesses.length) {
      rows.push(
        statRow(
          research.linkedBusinesses.length === 1 ? "Business" : "Businesses",
          research.linkedBusinesses
            .map(
              (b) =>
                `<a href="${app}/clients/${encodeURIComponent(b.id)}" style="color:#2563EB;text-decoration:none;">${escapeHtml(b.name)}</a>${b.role ? ` <span style="font-weight:400;color:#6B7280;">(${escapeHtml(b.role)})</span>` : ""}`,
            )
            .join("<br>"),
        ),
      )
    }
    rows.push(
      statRow("Open work items", escapeHtml(String(cp.openWorkItems) + (cp.overdueWorkItems > 0 ? ` (${cp.overdueWorkItems} overdue)` : ""))),
    )
    if (cp.activeProposals > 0 || research.activeProposals.length > 0) {
      rows.push(
        statRow("Active proposals", escapeHtml(String(cp.activeProposals) + (cp.proposalsTotalValue > 0 ? ` · ${money(cp.proposalsTotalValue)}` : ""))),
      )
    }
    if (cp.lifetimeRevenue > 0) rows.push(statRow("Lifetime revenue", escapeHtml(money(cp.lifetimeRevenue))))
    if (cp.invoicesOutstanding > 0) rows.push(statRow("Outstanding", escapeHtml(money(cp.invoicesOutstanding))))
    if (cp.lastMeetingAt) rows.push(statRow("Last meeting", escapeHtml(formatDate(cp.lastMeetingAt))))

    // Each work item title opens the work item in Karbon. (The Hub has
    // no per-work-item page to deep-link to — the client page linked at
    // the bottom of the email lists them all.)
    const workItemsList = research.openWorkItems.length
      ? `<p style="margin:14px 0 8px;font-size:13px;font-weight:600;color:#111827;">Open Karbon work items</p>
         ${research.openWorkItems
           .map((w) => {
             const title = escapeHtml(w.title || "Untitled work item")
             const karbonUrl = safeUrl(w.karbonUrl)
             const titleHtml = karbonUrl
               ? `<a href="${escapeHtml(karbonUrl)}" style="color:#2563EB;text-decoration:none;">${title}</a>`
               : title
             const meta = [w.workType, w.status, w.dueDate ? `due ${formatDate(w.dueDate)}` : null, w.assigneeName]
               .filter(Boolean)
               .map((v) => escapeHtml(String(v)))
               .join(" · ")
             return `<div style="padding:8px 10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:5px;margin-bottom:6px;">
                  <p style="margin:0;font-size:13px;color:#111827;font-weight:600;">${titleHtml}</p>
                  <p style="margin:2px 0 0;font-size:12px;color:#6B7280;">${meta}</p>
                </div>`
           })
           .join("")}`
      : ""

    const proposalsList = research.activeProposals.length
      ? `<p style="margin:14px 0 8px;font-size:13px;font-weight:600;color:#111827;">Open proposals</p>
         ${research.activeProposals
           .map((pr) => {
             const valueLabel = `${money(pr.totalValue)}${pr.recurringTotal > 0 ? ` · ${money(pr.recurringTotal)}/${pr.recurringFrequency || "yr"}` : ""}`
             const href = safeUrl(pr.signedUrl) ?? `${app}/sales/proposals`
             return `<div style="padding:8px 10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:5px;margin-bottom:6px;">
                  <p style="margin:0;font-size:13px;color:#111827;font-weight:600;"><a href="${escapeHtml(href)}" style="color:#2563EB;text-decoration:none;">${escapeHtml(valueLabel)}</a></p>
                  <p style="margin:2px 0 0;font-size:12px;color:#6B7280;">${escapeHtml(pr.status || "—")}</p>
                </div>`
           })
           .join("")}`
      : ""

    clientBlock = section(
      "Client snapshot",
      `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.join("")}</table>
       ${workItemsList}
       ${proposalsList}`,
    )
  } else if (research.relationship === "new_prospect") {
    clientBlock = `
      <div style="background:#FEF3C7;border-radius:6px;padding:12px 14px;margin:24px 0 0;">
        <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">${
          m.contactId
            ? "No existing Hub record matched this invitee, so ALFRED created a new contact and is pushing it to Karbon. Review and enrich the record from the Hub."
            : "No Hub record is linked to this invitee yet."
        }</p>
      </div>`
  }

  // ── Earlier meetings ────────────────────────────────────────────────
  const pastBlock = research.pastMeetings.length
    ? section(
        "Earlier meetings",
        bulletList(
          research.pastMeetings.map(
            (pm) =>
              `${formatDate(pm.startTime)} — ${pm.name ?? "Meeting"}${pm.hostName ? ` with ${pm.hostName}` : ""}${pm.status === "canceled" ? " (canceled)" : ""}`,
          ),
        ),
      )
    : ""

  // ── Research sources ────────────────────────────────────────────────
  const linkedSources = research.web.sources
    .map((s) => ({ url: safeUrl(s.url), title: s.title }))
    .filter((s): s is { url: string; title: string } => !!s.url)
  let sourcesBlock = ""
  if (linkedSources.length) {
    sourcesBlock = section(
      "Web research",
      `<ul style="margin:0;padding-left:20px;">${linkedSources
        .map(
          (s) =>
            `<li style="margin:0 0 4px;font-size:13px;line-height:1.5;"><a href="${escapeHtml(s.url)}" style="color:#2563EB;text-decoration:none;">${escapeHtml(s.title.slice(0, 110))}</a></li>`,
        )
        .join("")}</ul>
       <p style="margin:6px 0 0;font-size:12px;color:#6B7280;">Public search results — confirm they describe the right business before relying on them.</p>`,
    )
  } else if (research.web.status === "skipped_no_business") {
    sourcesBlock = `<p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;">Web research was not run: there is no business name or company email domain on file to search on.</p>`
  }

  // ── Calls to action ─────────────────────────────────────────────────
  const button = (href: string, label: string, bg: string) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;background:${bg};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:0 8px 8px 0;">${escapeHtml(label)}</a>`
  const buttons = [
    clientUrl ? button(clientUrl, "View client in Hub", "#6B745D") : "",
    button(calendarUrl, "Open Team Calendar", clientUrl ? "#4B5563" : "#6B745D"),
    joinUrl ? button(joinUrl, "Join meeting", "#2563EB") : "",
  ].join("")

  const hostLine = m.hostName
    ? `${escapeHtml(m.hostName)}&#39;s calendar`
    : "A calendar not yet linked to a Hub teammate"
  const coHostLine = m.coHostNames.length
    ? `<p style="margin:2px 0 0;font-size:12px;color:#6B7280;">Also hosting: ${escapeHtml(m.coHostNames.join(", "))}</p>`
    : ""

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6B745D 0%,#8E9B79 100%);padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${m.rescheduled ? "Meeting Rescheduled" : "New Meeting Booked"}</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">via Calendly</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px 32px;">
              <div style="margin-bottom:16px;">
                <span style="display:inline-block;background:${badge.bg};color:${badge.fg};padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.3px;">${badge.label}</span>
              </div>

              <!-- Who booked -->
              <p style="margin:0 0 2px;font-size:20px;font-weight:700;color:#111827;">${
                clientUrl
                  ? `<a href="${escapeHtml(clientUrl)}" style="color:#111827;text-decoration:none;">${escapeHtml(m.inviteeName)}</a>`
                  : escapeHtml(m.inviteeName)
              }</p>
              <p style="margin:0 0 16px;font-size:13px;color:#6B7280;">${[m.inviteeEmail, m.inviteePhone]
                .filter(Boolean)
                .map((v) => escapeHtml(String(v)))
                .join(" · ")}</p>

              <!-- Whose calendar + when -->
              <div style="background:#EEF1EA;border:1px solid #D5DBC9;border-radius:8px;padding:12px 16px;margin:0 0 20px;">
                <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6B745D;letter-spacing:0.5px;">BOOKED ON</p>
                <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${hostLine}</p>
                ${coHostLine}
                <p style="margin:10px 0 2px;font-size:14px;font-weight:600;color:#111827;">${escapeHtml(m.eventName)}</p>
                <p style="margin:0 0 4px;font-size:14px;color:#374151;">${escapeHtml(whenLine)}</p>
                ${previousLine}
                ${m.locationLabel ? `<p style="margin:0;font-size:13px;color:#6B7280;">${escapeHtml(m.locationLabel)}</p>` : ""}
              </div>

              ${briefBlock}
              ${teamBlock}
              ${noteBlock}
              ${intakeBlock}
              ${clientBlock}
              ${pastBlock}
              ${sourcesBlock}

              <p style="margin:28px 0 0;">${buttons}</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#F9FAFB;padding:16px 32px;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">
                Sent by ALFRED Ai to the whole team for every new Calendly booking &middot; <a href="${app}/settings/notifications" style="color:#6B7280;">Manage email preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()
}

// ---------------------------------------------------------------------------
// Loading the booking
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Seams for the offline check (scripts/436-…): the claim / release logic
 * is the part that guarantees one email per booking, and it has to be
 * exercisable without a database, a mail provider or a model.
 */
export interface NotifyBookingDeps {
  supabase?: AdminClient
  resolveRecipients?: typeof resolveRecipientsForCategory
  send?: typeof sendCategoryEmail
  gather?: typeof gatherMeetingResearch
  write?: typeof writeMeetingBrief
}

const EVENT_COLUMNS =
  "id, calendly_uuid, name, status, start_time, end_time, location_type, location, join_url, team_member_id, calendly_user_name, calendly_user_email, event_memberships, calendly_created_at"

const INVITEE_COLUMNS =
  "calendly_uri, name, email, status, questions_answers, text_reminder_number, contact_id, old_invitee_uri, calendly_created_at"

/** Phone from the SMS-reminder number, else a "phone" question on the booking form. */
function phoneFromInvitee(invitee: BookingInviteeRow): string | null {
  const reminder = (invitee.text_reminder_number ?? "").trim()
  if (reminder) return reminder
  for (const item of invitee.questions_answers ?? []) {
    const q = String(item?.question ?? "").toLowerCase()
    if (q.includes("phone") || q.includes("mobile") || q.includes("cell")) {
      const a = String(item?.answer ?? "").trim()
      if (a) return a
    }
  }
  return null
}

async function resolveHostNames(
  supabase: AdminClient,
  event: BookingEventRow,
): Promise<{ hostName: string | null; coHostNames: string[] }> {
  const memberships = Array.isArray(event.event_memberships) ? event.event_memberships : []

  // The Hub teammate is the canonical name when the host is linked.
  let hostName: string | null = null
  if (event.team_member_id) {
    const { data } = await supabase
      .from("team_members")
      .select("full_name")
      .eq("id", event.team_member_id)
      .maybeSingle()
    hostName = (data?.full_name as string | null) ?? null
  }
  hostName = hostName ?? event.calendly_user_name ?? memberships[0]?.user_name ?? event.calendly_user_email ?? null

  const coHostNames = memberships
    .map((m) => (m?.user_name ?? "").trim())
    .filter((n) => n && n.toLowerCase() !== (hostName ?? "").toLowerCase())
  return { hostName, coHostNames: Array.from(new Set(coHostNames)) }
}

/** For a reschedule: when the meeting this one replaces was scheduled. */
async function previousStartTime(supabase: AdminClient, oldInviteeUri: string | null): Promise<string | null> {
  if (!oldInviteeUri) return null
  try {
    const { data: oldInvitee } = await supabase
      .from("calendly_invitees")
      .select("calendly_event_id")
      .eq("calendly_uri", oldInviteeUri)
      .maybeSingle()
    if (!oldInvitee?.calendly_event_id) return null
    const { data: oldEvent } = await supabase
      .from("calendly_events")
      .select("start_time")
      .eq("id", oldInvitee.calendly_event_id)
      .maybeSingle()
    return (oldEvent?.start_time as string | null) ?? null
  } catch {
    return null
  }
}

/**
 * Did this booking create the contact? True when the contact came in
 * through Calendly and was created at (or just before) the booking.
 */
async function inferWasNewContact(
  supabase: AdminClient,
  contactId: string | null,
  bookedAt: string | null,
): Promise<boolean> {
  if (!contactId) return true
  try {
    const { data } = await supabase
      .from("contacts")
      .select("created_at, source")
      .eq("id", contactId)
      .maybeSingle()
    if (!data?.created_at || data.source !== "calendly") return false
    const created = new Date(data.created_at as string).getTime()
    const booked = bookedAt ? new Date(bookedAt).getTime() : Date.now()
    return created >= booked - 10 * 60_000
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

/**
 * Sends the "New Meeting Booked" email to every active team member who
 * hasn't opted out of the `meeting_booked` category.
 *
 * Safe to call more than once for the same booking, and from more than one
 * place at once: the send is claimed with a single conditional UPDATE on
 * `team_notified_at`, so exactly one caller proceeds. If the mail provider
 * accepts nothing, the claim is released so a later sweep can retry.
 *
 * Never throws.
 */
export async function notifyTeamOfNewBooking(
  options: NotifyBookingOptions,
  deps: NotifyBookingDeps = {},
): Promise<NotifyBookingResult> {
  const supabase = deps.supabase ?? createAdminClient()
  const resolveRecipients = deps.resolveRecipients ?? resolveRecipientsForCategory
  const send = deps.send ?? sendCategoryEmail
  const gather = deps.gather ?? gatherMeetingResearch
  const write = deps.write ?? writeMeetingBrief
  let claimed = false

  const release = async () => {
    if (!claimed) return
    claimed = false
    const { error } = await supabase
      .from("calendly_events")
      .update({ team_notified_at: null })
      .eq("id", options.eventId)
    if (error) console.error("[calendly/notify] failed to release claim:", error.message)
  }

  try {
    // ── Atomic claim ──────────────────────────────────────────────────
    // `WHERE team_notified_at IS NULL` makes this a compare-and-set: of
    // any number of concurrent callers, Postgres lets exactly one through.
    const { data: claimedRows, error: claimErr } = await supabase
      .from("calendly_events")
      .update({ team_notified_at: new Date().toISOString() })
      .eq("id", options.eventId)
      .is("team_notified_at", null)
      .select(EVENT_COLUMNS)

    if (claimErr) {
      console.error("[calendly/notify] claim failed:", claimErr.message)
      return { sent: false, recipientCount: 0, reason: "error" }
    }
    const event = (claimedRows?.[0] as unknown as BookingEventRow | undefined) ?? null
    if (!event) {
      const { data: exists } = await supabase
        .from("calendly_events")
        .select("id")
        .eq("id", options.eventId)
        .maybeSingle()
      return { sent: false, recipientCount: 0, reason: exists ? "already_notified" : "event_not_found" }
    }
    claimed = true

    // A cancelled meeting is not news. Keep the claim so nothing re-sends.
    if (event.status && event.status !== "active") {
      return { sent: false, recipientCount: 0, reason: "not_active" }
    }

    // ── The invitee ───────────────────────────────────────────────────
    const { data: inviteeRows } = await supabase
      .from("calendly_invitees")
      .select(INVITEE_COLUMNS)
      .eq("calendly_event_id", event.id)
      .order("calendly_created_at", { ascending: true })
    const invitees = (inviteeRows ?? []) as unknown as BookingInviteeRow[]
    const invitee = invitees.find((i) => (i.status ?? "active") === "active") ?? invitees[0] ?? null
    if (!invitee) {
      // The event landed before its invitee did — let a later pass retry.
      await release()
      return { sent: false, recipientCount: 0, reason: "no_invitee" }
    }

    const rescheduled = !!invitee.old_invitee_uri
    const wasNewContact =
      options.wasNewContact ??
      (await inferWasNewContact(supabase, invitee.contact_id, event.calendly_created_at))

    const questionsAndAnswers: BookingQA[] = (invitee.questions_answers ?? [])
      .map((qa) => ({ question: String(qa?.question ?? ""), answer: String(qa?.answer ?? "") }))
      .filter((qa) => qa.answer.trim())

    const { hostName, coHostNames } = await resolveHostNames(supabase, event)

    const booking: BookingForResearch = {
      eventId: event.id,
      eventName: event.name ?? "Meeting",
      startTime: event.start_time,
      hostName,
      inviteeName: invitee.name?.trim() || invitee.email || "Unknown invitee",
      inviteeEmail: invitee.email,
      inviteePhone: phoneFromInvitee(invitee),
      questionsAndAnswers,
      contactId: invitee.contact_id,
      wasNewContact,
      rescheduled,
    }

    // ── Recipients first: no point researching for an empty audience ──
    // Same audience as the new-intake email (lib/jotform/notify.ts):
    // every active teammate with a mailbox, minus service accounts —
    // ALFRED doesn't need to email itself.
    const { data: teamMembers, error: tmErr } = await supabase
      .from("team_members")
      .select("id")
      .eq("is_active", true)
      .eq("is_service_account", false)
      .not("email", "is", null)
    if (tmErr || !teamMembers?.length) {
      console.error("[calendly/notify] failed to fetch team members:", tmErr)
      await release()
      return { sent: false, recipientCount: 0, reason: "error" }
    }
    const teamMemberIds = teamMembers.map((tm) => tm.id as string)
    const eligible = await resolveRecipients(teamMemberIds, "meeting_booked")
    if (eligible.length === 0) {
      // Everyone opted out — nothing to retry, keep the claim.
      return { sent: false, recipientCount: 0, reason: "no_recipients" }
    }

    // ── Research + brief (best-effort; both degrade, neither throws) ──
    const research = await gather(supabase, booking)
    const brief = await write(booking, research)

    const model: MeetingBookedEmailModel = {
      eventName: booking.eventName,
      startTime: event.start_time,
      endTime: event.end_time,
      joinUrl: event.join_url,
      locationLabel: locationLabel(event),
      hostName,
      coHostNames,
      inviteeName: booking.inviteeName,
      inviteeEmail: booking.inviteeEmail,
      inviteePhone: booking.inviteePhone,
      contactId: booking.contactId,
      rescheduled,
      previousStartTime: rescheduled ? await previousStartTime(supabase, invitee.old_invitee_uri) : null,
      research,
      brief,
    }

    const result = await send({
      category: "meeting_booked",
      teamMemberIds,
      subject: buildMeetingBookedSubject(model),
      html: buildMeetingBookedEmailHtml(model),
    })

    if (result.sent === 0) {
      // The provider accepted nothing (outage / rate limit). Release so
      // the cron backstop tries again instead of losing this booking.
      await release()
      console.error(`[calendly/notify] 0 of ${eligible.length} delivered for event ${event.id} — will retry`)
      return { sent: false, recipientCount: 0, reason: "send_failed" }
    }

    console.log(
      `[calendly/notify] meeting_booked sent to ${result.sent}/${eligible.length} for event ${event.id} (${research.relationship}, brief=${brief.model}, web=${research.web.status})`,
    )
    return { sent: true, recipientCount: result.sent }
  } catch (err) {
    console.error("[calendly/notify] notifyTeamOfNewBooking failed:", err)
    await release()
    return { sent: false, recipientCount: 0, reason: "error" }
  }
}
