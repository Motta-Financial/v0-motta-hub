/**
 * Calendly booking notifications
 *
 * ALFRED-authored emails sent to all active team members when a new meeting
 * is booked via Calendly. Mirrors the proven pattern in lib/jotform/notify.ts.
 *
 * The email is "brief-grade": it tells the team everything they need to walk
 * into the meeting prepared —
 *   - whether the invitee is a NEW prospect or an EXISTING client
 *   - an ALFRED-written summary that synthesizes the booking note + the
 *     client's standing in the Hub
 *   - the meeting logistics (when / host / join link)
 *   - for existing clients: a snapshot of open Karbon work items, active
 *     Ignition proposals, lifetime revenue, owner/manager, and a deep link
 *     to their Hub profile
 *   - the raw note the invitee left, if any
 */

import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/server"
import { sendCategoryEmail } from "@/lib/email"
import { getClientProfile, type ClientProfileSummary } from "@/lib/clients/profile"
import { getAIConfig, logAIUsage } from "@/lib/ai/config"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"

/** Hard cap on the AI research call so a slow model never delays the email
 *  indefinitely. The email send is already fire-and-forget, but we still
 *  bound the wait so the row gets marked notified promptly. */
const RESEARCH_TIMEOUT_MS = 12_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendlyQA {
  question: string
  answer: string
  position?: number
}

export interface CalendlyBookingNotifyPayload {
  /** calendly_events.id (internal Hub PK) */
  eventId: number
  /** calendly_events.calendly_uuid */
  eventUuid: string
  /** Event name from Calendly (e.g. "Tax Consultation") */
  eventName: string
  /** ISO timestamp of meeting start */
  startTime: string
  /** ISO timestamp of meeting end */
  endTime: string
  /** Zoom/Google Meet join URL if available */
  joinUrl?: string | null
  /** Host name (from calendly_user_name or team_member) */
  hostName?: string | null
  /** Invitee name */
  inviteeName: string
  /** Invitee email */
  inviteeEmail: string
  /** Invitee phone (if provided) */
  inviteePhone?: string | null
  /** Whether this invitee was newly created in the Hub (vs matched existing) */
  wasNewContact: boolean
  /** Hub contact ID if linked */
  contactId?: string | null
  /** Karbon client key if linked */
  karbonKey?: string | null
  /** The free-text Q&A the invitee filled in on the Calendly booking form */
  questionsAndAnswers?: CalendlyQA[] | null
}

/** Open work item shape we surface inline in the email. */
interface OpenWorkItem {
  id: string | null
  title: string | null
  workType: string | null
  status: string | null
  dueDate: string | null
  assigneeName: string | null
  /** Direct Karbon URL for the work item, if synced */
  karbonUrl: string | null
}

/** Active proposal shape we surface inline in the email. */
interface ActiveProposal {
  status: string | null
  totalValue: number
  recurringTotal: number
  recurringFrequency: string | null
  /** Signed/PDF URL of the Ignition proposal, if available */
  signedUrl: string | null
}

/** Everything we gather about an existing client to enrich the email. */
interface ClientContext {
  profile: ClientProfileSummary | null
  openWorkItems: OpenWorkItem[]
  activeProposals: ActiveProposal[]
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDateTime(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
}

function formatDate(isoString: string | null): string {
  if (!isoString) return "—"
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Pull the meeting note out of the invitee's Q&A. Calendly stores every
 * booking-form answer here; the "what do you want to discuss" field is the
 * one partners care about, but we keep all of them as context.
 */
function extractMeetingNote(qa: CalendlyQA[] | null | undefined): string | null {
  if (!Array.isArray(qa) || qa.length === 0) return null
  const lines = qa
    .filter((item) => item?.answer && String(item.answer).trim())
    .map((item) => {
      const q = String(item.question || "").trim()
      const a = String(item.answer).trim()
      return q ? `${q}: ${a}` : a
    })
  return lines.length ? lines.join("\n") : null
}

// ---------------------------------------------------------------------------
// Client context gathering (existing clients only)
// ---------------------------------------------------------------------------

/**
 * Gather the rich Hub context for an existing client: the cached profile
 * summary plus the actual lists of open work items and active proposals so
 * the email can show them line-by-line. Never throws — returns empty lists
 * on any failure so the email still goes out.
 */
async function gatherClientContext(contactId: string): Promise<ClientContext> {
  const supabase = createAdminClient()

  // The profile summary handles the contact-vs-organization resolution and
  // gives us aggregates (counts, lifetime revenue, owner/manager, next due).
  let profile: ClientProfileSummary | null = null
  try {
    profile = await getClientProfile(contactId)
  } catch (err) {
    console.error("[calendly/notify] getClientProfile failed:", err)
  }

  // The profile summary doesn't carry the individual line items, so pull the
  // open work items + active proposals directly. We key by contact_id here
  // because Calendly bookings always resolve to a contact; the profile's
  // aggregate counts already cover the organization roll-up if there is one.
  const [{ data: workItems }, { data: proposals }] = await Promise.all([
    supabase
      .from("work_items")
      .select("id, title, work_type, primary_status, status, completed_date, due_date, assignee_name, karbon_url")
      .eq("contact_id", contactId),
    supabase
      .from("ignition_proposals")
      .select("status, total_value, recurring_total, recurring_frequency, signed_url")
      .eq("contact_id", contactId),
  ])

  const openWorkItems: OpenWorkItem[] = (workItems || [])
    .filter((w) => !w.completed_date && (w.primary_status?.toLowerCase() !== "completed"))
    .sort((a, b) => {
      // Soonest due date first; undated items last.
      if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : 1
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    })
    .slice(0, 6)
    .map((w) => ({
      id: w.id,
      title: w.title,
      workType: w.work_type,
      status: w.primary_status || w.status,
      dueDate: w.due_date,
      assigneeName: w.assignee_name,
      karbonUrl: w.karbon_url,
    }))

  const activeProposals: ActiveProposal[] = (proposals || [])
    .filter((p) => /accepted|active|in_progress|signed|draft|sent|awaiting/i.test(p.status || ""))
    .slice(0, 6)
    .map((p) => ({
      status: p.status,
      totalValue: Number(p.total_value) || 0,
      recurringTotal: Number(p.recurring_total) || 0,
      recurringFrequency: p.recurring_frequency,
      signedUrl: p.signed_url,
    }))

  return { profile, openWorkItems, activeProposals }
}

// ---------------------------------------------------------------------------
// ALFRED research summary
// ---------------------------------------------------------------------------

/**
 * Ask ALFRED to write a short, partner-ready brief synthesizing (a) the note
 * the invitee left about what they want to discuss and (b) the client's
 * standing in the Hub. Returns a deterministic fallback string if the AI
 * gateway is unavailable so the email always has a summary.
 */
async function researchMeeting(
  payload: CalendlyBookingNotifyPayload,
  meetingNote: string | null,
  context: ClientContext | null,
): Promise<string> {
  const p = context?.profile

  const contextLines: string[] = []
  if (payload.wasNewContact) {
    contextLines.push(
      "This invitee is a NEW prospect — they booked directly via Calendly without going through the intake form. There is no prior history in the Hub.",
    )
  } else if (p) {
    contextLines.push(`Existing ${p.clientKind === "organization" ? "organization" : "client"}: ${p.displayName ?? payload.inviteeName}.`)
    if (p.clientType) contextLines.push(`Type: ${p.clientType}.`)
    if (p.isProspect) contextLines.push("Currently flagged as a prospect (not yet a paying client).")
    if (p.clientOwnerName) contextLines.push(`Owner: ${p.clientOwnerName}.`)
    if (p.clientManagerName) contextLines.push(`Manager: ${p.clientManagerName}.`)
    if (p.openWorkItems > 0) contextLines.push(`${p.openWorkItems} open work item(s); ${p.overdueWorkItems} overdue.`)
    if (p.nextDueWorkItemTitle) contextLines.push(`Next due work item: "${p.nextDueWorkItemTitle}" on ${formatDate(p.nextDueDate)}.`)
    if (p.activeWorkTypes?.length) contextLines.push(`Active work types: ${p.activeWorkTypes.join(", ")}.`)
    if (p.activeProposals > 0) contextLines.push(`${p.activeProposals} active proposal(s) worth ${money(p.proposalsTotalValue)}.`)
    if (p.lifetimeRevenue > 0) contextLines.push(`Lifetime revenue: ${money(p.lifetimeRevenue)}.`)
    if (p.invoicesOutstanding > 0) contextLines.push(`Outstanding balance: ${money(p.invoicesOutstanding)}.`)
    if (p.lastMeetingAt) contextLines.push(`Last meeting: ${formatDate(p.lastMeetingAt)}.`)
    if (p.lastDebriefNotes) contextLines.push(`Last debrief notes: ${p.lastDebriefNotes}`)
  }

  const promptLines = [
    "You are ALFRED Ai, the firm's assistant at Motta Financial. A meeting was just booked through Calendly. Write a tight 2-4 sentence brief for the team so they can walk in prepared.",
    "Lead with what the invitee wants to discuss (from their note, if any). Then connect it to their standing in the Hub. Be concrete and neutral — never invent facts. If there's no note and no history, say plainly that no agenda was provided and this is a fresh contact.",
    "No headings, no bullet lists — just plain sentences.",
    "",
    `Meeting: ${payload.eventName}`,
    `Invitee: ${payload.inviteeName} (${payload.inviteeEmail})`,
    `When: ${formatDateTime(payload.startTime)}`,
    payload.hostName ? `Host: ${payload.hostName}` : "",
    "",
    "Invitee's booking note:",
    meetingNote ? meetingNote : "(none provided)",
    "",
    "Hub context:",
    contextLines.length ? contextLines.join("\n") : "(no additional context)",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const aiConfig = await getAIConfig("meeting_research")
    if (!aiConfig.isActive) {
      return buildFallbackSummary(payload, meetingNote, context)
    }

    const startTime = Date.now()
    const result = await Promise.race<Awaited<ReturnType<typeof generateText>> | null>([
      generateText({
        model: aiConfig.model,
        prompt: aiConfig.systemPrompt ? `${aiConfig.systemPrompt}\n\n${promptLines}` : promptLines,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RESEARCH_TIMEOUT_MS)),
    ])

    if (result?.text) {
      logAIUsage({
        useCase: "meeting_research",
        model: aiConfig.model,
        promptTokens: result.usage?.inputTokens,
        completionTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
        latencyMs: Date.now() - startTime,
        success: true,
        metadata: { eventId: payload.eventId, wasNewContact: payload.wasNewContact },
      })
      return result.text.trim()
    }

    return buildFallbackSummary(payload, meetingNote, context)
  } catch (err) {
    console.error("[calendly/notify] researchMeeting failed:", err)
    logAIUsage({
      useCase: "meeting_research",
      model: "fallback",
      success: false,
      errorMessage: (err as Error).message,
    })
    return buildFallbackSummary(payload, meetingNote, context)
  }
}

/** Deterministic, non-AI summary used when the gateway is unavailable. */
function buildFallbackSummary(
  payload: CalendlyBookingNotifyPayload,
  meetingNote: string | null,
  context: ClientContext | null,
): string {
  const parts: string[] = []
  if (payload.wasNewContact) {
    parts.push(`${payload.inviteeName} is a new prospect who booked directly via Calendly.`)
  } else if (context?.profile?.displayName) {
    parts.push(`${context.profile.displayName} is an existing ${context.profile.clientKind === "organization" ? "organization" : "client"} in the Hub.`)
    if (context.profile.openWorkItems > 0) parts.push(`${context.profile.openWorkItems} open work item(s).`)
    if (context.profile.activeProposals > 0) parts.push(`${context.profile.activeProposals} active proposal(s).`)
  } else {
    parts.push(`${payload.inviteeName} booked a meeting.`)
  }
  parts.push(meetingNote ? `They noted: "${meetingNote.slice(0, 240)}".` : "No agenda note was provided.")
  return parts.join(" ")
}

// ---------------------------------------------------------------------------
// Email builder
// ---------------------------------------------------------------------------

function buildMeetingBookedEmailHtml(
  p: CalendlyBookingNotifyPayload,
  summary: string,
  meetingNote: string | null,
  context: ClientContext | null,
): string {
  const startFormatted = formatDateTime(p.startTime)
  const endFormatted = formatDateTime(p.endTime)

  const hubLink = p.contactId ? `${APP_URL}/clients/${p.contactId}` : `${APP_URL}/clients/meetings/calendly`

  const contactStatusBadge = p.wasNewContact
    ? `<span style="display:inline-block;background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.3px;">NEW PROSPECT</span>`
    : `<span style="display:inline-block;background:#D1FAE5;color:#065F46;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.3px;">EXISTING CLIENT</span>`

  // ALFRED summary block (always present)
  const summaryBlock = `
    <div style="background:#F5F6F2;border-left:3px solid #6B745D;border-radius:0 6px 6px 0;padding:14px 16px;margin:0 0 24px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6B745D;letter-spacing:0.5px;">ALFRED&apos;S BRIEF</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(summary)}</p>
    </div>`

  // Meeting note block (only if the invitee left one)
  const noteBlock = meetingNote
    ? `
      <h3 style="margin:0 0 8px;font-size:14px;color:#111827;">What they want to discuss</h3>
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:12px 14px;margin:0 0 24px;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;white-space:pre-line;">${escapeHtml(meetingNote)}</p>
      </div>`
    : ""

  // Existing-client snapshot
  let clientBlock = ""
  if (!p.wasNewContact && context?.profile) {
    const cp = context.profile
    const statRows: string[] = []
    const stat = (label: string, value: string) =>
      `<tr><td style="padding:4px 0;font-size:13px;color:#6B7280;">${label}</td><td style="padding:4px 0;font-size:13px;color:#111827;font-weight:600;text-align:right;">${value}</td></tr>`

    if (cp.clientOwnerName) statRows.push(stat("Owner", escapeHtml(cp.clientOwnerName)))
    if (cp.clientManagerName) statRows.push(stat("Manager", escapeHtml(cp.clientManagerName)))
    statRows.push(stat("Open work items", String(cp.openWorkItems) + (cp.overdueWorkItems > 0 ? ` (${cp.overdueWorkItems} overdue)` : "")))
    statRows.push(stat("Active proposals", String(cp.activeProposals) + (cp.proposalsTotalValue > 0 ? ` · ${money(cp.proposalsTotalValue)}` : "")))
    if (cp.lifetimeRevenue > 0) statRows.push(stat("Lifetime revenue", money(cp.lifetimeRevenue)))
    if (cp.invoicesOutstanding > 0) statRows.push(stat("Outstanding", money(cp.invoicesOutstanding)))
    if (cp.lastMeetingAt) statRows.push(stat("Last meeting", formatDate(cp.lastMeetingAt)))

    // Open work items list. Each title deep-links to the Hub work item page;
    // when a Karbon URL is synced we add a secondary "Karbon" link.
    const workItemsList = context.openWorkItems.length
      ? `<div style="margin:16px 0 0;">
           <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#111827;">Open Karbon Work Items</p>
           ${context.openWorkItems
             .map((w) => {
               const title = escapeHtml(w.title || "Untitled work item")
               const titleHtml = w.id
                 ? `<a href="${APP_URL}/work-items/${encodeURIComponent(w.id)}" style="color:#2563EB;text-decoration:none;">${title}</a>`
                 : title
               const meta = [w.workType, w.status, w.dueDate ? `due ${formatDate(w.dueDate)}` : null, w.assigneeName]
                 .filter(Boolean)
                 .map((v) => escapeHtml(String(v)))
                 .join(" · ")
               const karbonLink = w.karbonUrl
                 ? ` · <a href="${escapeHtml(w.karbonUrl)}" style="color:#6B7280;text-decoration:underline;">Karbon</a>`
                 : ""
               return `<div style="padding:8px 10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:5px;margin-bottom:6px;">
                    <p style="margin:0;font-size:13px;color:#111827;font-weight:600;">${titleHtml}</p>
                    <p style="margin:2px 0 0;font-size:12px;color:#6B7280;">${meta}${karbonLink}</p>
                  </div>`
             })
             .join("")}
         </div>`
      : ""

    // Active proposals list. Each links to the Ignition proposal itself
    // (signed_url) when available, otherwise to the Hub proposals list.
    const proposalsList = context.activeProposals.length
      ? `<div style="margin:16px 0 0;">
           <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#111827;">Open Proposals</p>
           ${context.activeProposals
             .map((pr) => {
               const valueLabel = `${money(pr.totalValue)}${pr.recurringTotal > 0 ? ` · ${money(pr.recurringTotal)}/${escapeHtml(pr.recurringFrequency || "yr")}` : ""}`
               const href = pr.signedUrl || `${APP_URL}/sales/proposals`
               return `<div style="padding:8px 10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:5px;margin-bottom:6px;">
                    <p style="margin:0;font-size:13px;color:#111827;font-weight:600;"><a href="${escapeHtml(href)}" style="color:#2563EB;text-decoration:none;">${valueLabel}</a></p>
                    <p style="margin:2px 0 0;font-size:12px;color:#6B7280;">${escapeHtml(pr.status || "—")}</p>
                  </div>`
             })
             .join("")}
         </div>`
      : ""

    clientBlock = `
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">
      <h3 style="margin:0 0 12px;font-size:16px;color:#111827;">Client Snapshot</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${statRows.join("")}
      </table>
      ${workItemsList}
      ${proposalsList}`
  } else if (p.wasNewContact) {
    clientBlock = `
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">
      <div style="background:#FEF3C7;border-radius:6px;padding:12px 14px;">
        <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">No existing Hub record matched this invitee, so ALFRED created a new contact and is pushing it to Karbon automatically. Review and enrich the record from the Hub.</p>
      </div>`
  }

  const joinSection = p.joinUrl
    ? `<p style="margin:20px 0 0;">
        <a href="${p.joinUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Join Meeting</a>
      </p>`
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
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">New Meeting Booked</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">via Calendly</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <!-- Contact badge -->
              <div style="margin-bottom:20px;">
                ${contactStatusBadge}
              </div>

              ${summaryBlock}

              <!-- Calendar owner: make it unmistakable whose calendar this landed on -->
              <div style="background:#EEF1EA;border:1px solid #D5DBC9;border-radius:8px;padding:12px 16px;margin:0 0 20px;">
                <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6B745D;letter-spacing:0.5px;">BOOKED ON</p>
                <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${p.hostName ? `${escapeHtml(p.hostName)}&apos;s calendar` : "An unassigned calendar"}</p>
              </div>

              <!-- Meeting details -->
              <h2 style="margin:0 0 8px;font-size:18px;color:#111827;">${escapeHtml(p.eventName)}</h2>
              <p style="margin:0 0 4px;font-size:14px;color:#6B7280;">
                <strong>When:</strong> ${startFormatted} – ${endFormatted}
              </p>
              ${p.hostName ? `<p style="margin:0 0 4px;font-size:14px;color:#6B7280;"><strong>Calendar owner:</strong> ${escapeHtml(p.hostName)}</p>` : ""}

              <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">

              <!-- Related client -->
              <h3 style="margin:0 0 12px;font-size:16px;color:#111827;">Related Client</h3>
              <p style="margin:0 0 4px;font-size:14px;color:#374151;">
                ${
                  p.contactId
                    ? `<a href="${hubLink}" style="color:#2563EB;text-decoration:none;font-weight:700;">${escapeHtml(p.inviteeName)}</a>`
                    : `<strong>${escapeHtml(p.inviteeName)}</strong>`
                }
              </p>
              <p style="margin:0 0 4px;font-size:14px;color:#6B7280;">${escapeHtml(p.inviteeEmail)}</p>
              ${p.inviteePhone ? `<p style="margin:0 0 4px;font-size:14px;color:#6B7280;">${escapeHtml(p.inviteePhone)}</p>` : ""}
              ${
                p.contactId
                  ? `<p style="margin:8px 0 0;font-size:13px;"><a href="${hubLink}" style="color:#2563EB;text-decoration:none;">View client in Motta Hub &rarr;</a></p>`
                  : ""
              }

              <div style="margin:24px 0 0;"></div>
              ${noteBlock}

              ${clientBlock}

              ${joinSection}

              <!-- CTA -->
              <p style="margin:24px 0 0;">
                <a href="${hubLink}" style="display:inline-block;background:#6B745D;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">${p.contactId ? "View Client in Hub" : "View in Hub"}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#F9FAFB;padding:16px 32px;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">
                Sent by ALFRED Ai &middot; <a href="${APP_URL}/settings/notifications" style="color:#6B7280;">Manage email preferences</a>
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
// Broadcast
// ---------------------------------------------------------------------------

/**
 * Sends an ALFRED-branded "New Meeting Booked" email to all active team
 * members who haven't opted out of the `meeting_booked` category. Then marks
 * the event as notified to prevent duplicate sends on webhook retries.
 *
 * This is fire-and-forget: errors are logged but don't throw.
 */
export async function notifyTeamOfNewBooking(
  payload: CalendlyBookingNotifyPayload,
): Promise<{ sent: boolean; recipientCount: number }> {
  const supabase = await createAdminClient()

  // Double-check the event hasn't already been notified (idempotence guard)
  const { data: existing } = await supabase
    .from("calendly_events")
    .select("team_notified_at")
    .eq("id", payload.eventId)
    .single()

  if (existing?.team_notified_at) {
    console.log(`[calendly/notify] Event ${payload.eventId} already notified at ${existing.team_notified_at}, skipping`)
    return { sent: false, recipientCount: 0 }
  }

  // Gather enrichment: client context (existing clients only) + the meeting
  // note, then have ALFRED synthesize a brief. All best-effort.
  const meetingNote = extractMeetingNote(payload.questionsAndAnswers)
  let context: ClientContext | null = null
  if (!payload.wasNewContact && payload.contactId) {
    context = await gatherClientContext(payload.contactId)
  }
  const summary = await researchMeeting(payload, meetingNote, context)

  // Fetch all active team members for the category email
  const { data: teamMembers, error: tmErr } = await supabase
    .from("team_members")
    .select("id")
    .eq("status", "active")

  if (tmErr || !teamMembers?.length) {
    console.error("[calendly/notify] Failed to fetch team members:", tmErr)
    return { sent: false, recipientCount: 0 }
  }

  const teamMemberIds = teamMembers.map((tm) => tm.id)
  const html = buildMeetingBookedEmailHtml(payload, summary, meetingNote, context)
  const statusWord = payload.wasNewContact ? "New prospect" : "Client"
  const subject = `New Meeting Booked: ${payload.inviteeName} (${statusWord}) — ${payload.eventName}`

  try {
    const result = await sendCategoryEmail({
      category: "meeting_booked",
      teamMemberIds,
      subject,
      html,
    })

    // Mark event as notified
    await supabase
      .from("calendly_events")
      .update({ team_notified_at: new Date().toISOString() })
      .eq("id", payload.eventId)

    console.log(`[calendly/notify] Sent meeting_booked email to ${result.sent} recipients for event ${payload.eventId}`)
    return { sent: true, recipientCount: result.sent }
  } catch (err) {
    console.error("[calendly/notify] Failed to send category email:", err)
    return { sent: false, recipientCount: 0 }
  }
}
