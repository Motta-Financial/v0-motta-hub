import { createAdminClient } from "@/lib/supabase/server"

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "ALFRED Ai <Info@mottafinancial.com>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"

// All email categories users can opt in/out of.
// Each `notification_type` value emitted via /api/notifications/send is mapped
// onto one of these categories by mapNotificationTypeToCategory().
export const EMAIL_CATEGORIES = {
  action_item: { label: "Action Items", description: "When you're assigned an action item or task" },
  mention: { label: "Mentions", description: "When someone @mentions you in a comment, message, or note" },
  debrief: { label: "Debriefs", description: "When a debrief is submitted that involves you" },
  work_item: { label: "Work Items", description: "When a Karbon work item is assigned to you or its status changes" },
  tommy_reminder: { label: "Tommy Awards Reminder", description: "Weekly Friday reminder to submit your Tommy Awards ballot" },
  tommy_recap: { label: "Tommy Awards Weekly Recap", description: "Weekly Monday recap of Tommy Awards results, written by ALFRED Ai" },
  meeting_summary: { label: "Meeting Summary", description: "Daily / weekly digest of upcoming and recent Calendly & Zoom meetings" },
  daily_briefing: { label: "Daily Briefing", description: "Weekday morning briefing from ALFRED Ai — debriefs, meetings, reminders, and news" },
  // ALFRED-authored alert when a new Jotform intake hits the Hub.
  // Defaults to ON like other operational categories so partners
  // don't miss prospect intros, but appears under the same email
  // preferences UI so anyone can opt out.
  intake: { label: "New Intake Submissions", description: "ALFRED Ai alert when a prospect submits an intake form" },
  // ALFRED-authored alert when a new meeting is booked via Calendly.
  // Defaults to ON so the firm stays informed of every new booking,
  // but lives under the standard email preferences UI so anyone can
  // opt out. Unlike the "meeting_summary" digest, this fires in
  // real-time on every `invitee.created` webhook.
  meeting_booked: { label: "New Meeting Booked", description: "ALFRED Ai alert when a prospect or client books a meeting via Calendly" },
  // ALFRED-authored reminder, sent shortly after a client/prospect meeting
  // ends, asking the host + internal attendees to submit a debrief. Defaults
  // ON (operational) but lives under the standard email preferences UI so
  // anyone can opt out. One email per meeting, deduped via
  // calendly_events/zoom_meetings.debrief_requested_at.
  meeting_debrief: { label: "Debrief Reminders", description: "ALFRED Ai reminder to submit a debrief after a client or prospect meeting" },
  // ALFRED-authored alert when a new edition of the Motta Alliance comic
  // book series is issued through the in-app uploader. Defaults to ON so
  // every teammate sees new lore drops, but lives under the standard
  // email preferences UI for anyone who'd rather opt out.
  motta_alliance: { label: "Motta Alliance Editions", description: "ALFRED Ai announcement when a new edition of the Motta Alliance comic series is published" },
  broadcast: { label: "Firm Announcements", description: "Custom announcement emails sent by partners or admins" },
  general: { label: "General Notifications", description: "Other in-app notifications not in a more specific category" },
} as const

export type EmailCategory = keyof typeof EMAIL_CATEGORIES

// Map free-form notification_type strings used historically across the app
// to the canonical EmailCategory. Unknown types fall through to "general".
export function mapNotificationTypeToCategory(notificationType?: string | null): EmailCategory {
  if (!notificationType) return "general"
  const t = notificationType.toLowerCase()
  if (t.includes("action") || t === "task" || t === "todo") return "action_item"
  if (t.includes("mention") || t === "comment_mention") return "mention"
  if (t.includes("debrief_request") || t.includes("debrief_reminder") || t.includes("debrief-reminder")) return "meeting_debrief"
  if (t.includes("debrief")) return "debrief"
  if (t.includes("work_item") || t.includes("workitem") || t === "assignment") return "work_item"
  if (t.includes("tommy_recap") || t.includes("tommy-recap")) return "tommy_recap"
  if (t.includes("tommy")) return "tommy_reminder"
  if (t.includes("daily_brief") || t.includes("daily-brief") || t.includes("morning_brief")) return "daily_briefing"
  if (t.includes("meeting_booked") || t.includes("calendly_booked") || t.includes("new_booking")) return "meeting_booked"
  if (t.includes("meeting") || t.includes("calendly") || t.includes("zoom")) return "meeting_summary"
  if (t.includes("broadcast") || t.includes("announcement")) return "broadcast"
  if (t.includes("intake") || t.includes("jotform_intake") || t.includes("prospect")) return "intake"
  if (t.includes("motta_alliance") || t.includes("alliance_issue")) return "motta_alliance"
  return "general"
}

/**
 * Shape of an email attachment we hand off to Resend. Mirrors Resend's
 * own `Attachment` type but typed loosely here so callers don't need to
 * import from `resend` directly. Two delivery modes:
 *   - `path`    — a public URL (e.g. a Vercel Blob URL). Resend fetches
 *                 the file and inlines it. Preferred for our flow because
 *                 the file already lives in Blob storage by the time we
 *                 send the email.
 *   - `content` — raw bytes (Buffer / base64 string). Used only when we
 *                 have the file in-memory and can't expose a public URL.
 */
export interface EmailAttachment {
  filename: string
  /** Public URL Resend will fetch (preferred). */
  path?: string
  /** Inline bytes for files that aren't hosted anywhere. */
  content?: Buffer | string
  contentType?: string
}

interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
  attachments?: EmailAttachment[]
}

async function getResendClient() {
  if (!process.env.RESEND_API_KEY) return null
  try {
    const { Resend } = await import("resend")
    return new Resend(process.env.RESEND_API_KEY)
  } catch {
    console.warn("[email] resend package not available")
    return null
  }
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments,
}: SendEmailParams) {
  const resend = await getResendClient()
  if (!resend) {
    console.warn("[email] Email service not configured -- skipping email send")
    return { success: false, error: "Email service not configured" }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      replyTo,
      // Resend expects `attachments` only when there's at least one. Pass
      // through verbatim — caller is responsible for sizing (Resend caps
      // the entire payload around 40MB combined).
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    })

    if (error) {
      console.error("[email] Resend error:", error)
      return { success: false, error: error.message }
    }

    return { success: true, id: data?.id }
  } catch (err) {
    console.error("[email] Failed to send:", err)
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" }
  }
}

/**
 * Send many emails in as few API calls as possible using Resend's batch
 * endpoint (`resend.batch.send`), which accepts up to 100 messages per call.
 *
 * Why this exists: firing one `sendEmail` per recipient (via Promise.all or a
 * sequential loop with sleeps) was both slow and rate-limit-prone. Batching
 * collapses an N-recipient fan-out into ceil(N/100) calls, which is the
 * efficient way to use a paid Resend plan.
 *
 * Each entry is its own message with its own `to`, so recipients are
 * individually addressed — they never see each other's addresses.
 *
 * NOTE: Resend's batch endpoint does NOT support attachments. Callers that
 * need attachments must use `sendEmail` per message instead (see
 * `sendCategoryEmail`).
 */
const RESEND_BATCH_LIMIT = 100

export async function sendBatchEmail(
  messages: Array<Omit<SendEmailParams, "attachments">>,
): Promise<{ sent: number; failed: number; ids: string[] }> {
  if (messages.length === 0) return { sent: 0, failed: 0, ids: [] }

  const resend = await getResendClient()
  if (!resend) {
    console.warn("[email] Email service not configured -- skipping batch send")
    return { sent: 0, failed: messages.length, ids: [] }
  }

  let sent = 0
  let failed = 0
  const ids: string[] = []

  for (let i = 0; i < messages.length; i += RESEND_BATCH_LIMIT) {
    const chunk = messages.slice(i, i + RESEND_BATCH_LIMIT)
    try {
      const { data, error } = await resend.batch.send(
        chunk.map((m) => ({
          from: FROM_EMAIL,
          to: Array.isArray(m.to) ? m.to : [m.to],
          subject: m.subject,
          html: m.html,
          replyTo: m.replyTo,
        })),
      )

      if (error) {
        console.error("[email] Resend batch error:", error)
        failed += chunk.length
        continue
      }

      // Resend returns { data: [{ id }, ...] } for the batch.
      const results = (data as { data?: Array<{ id?: string }> } | null)?.data ?? []
      sent += chunk.length
      for (const r of results) if (r?.id) ids.push(r.id)
    } catch (err) {
      console.error("[email] Failed to send batch chunk:", err)
      failed += chunk.length
    }
  }

  return { sent, failed, ids }
}

// Brand palette (Motta Hub)
const BRAND = {
  primary: "#6B745D", // Olive green
  primaryDark: "#5A6250",
  secondary: "#8E9B79", // Lighter green
  background: "#EAE6E1", // Cream
  surface: "#FFFFFF",
  textPrimary: "#1F2520",
  textMuted: "#6B7066",
  accent: "#C97B3F", // Warm orange accent (sparingly)
  border: "#D8D3CB",
}

/**
 * Format a free-form notes string for safe rendering inside an email
 * body. The two jobs here:
 *
 *   1. Escape HTML so anything a teammate types (especially "<", ">",
 *      "&", or stray quotes from copy-pasted snippets) renders as literal
 *      text instead of corrupting the email markup.
 *   2. Translate plain-text whitespace into HTML breaks. Email clients
 *      mostly ignore `white-space: pre-wrap` (Outlook in particular), so
 *      we emit explicit `<br>` tags instead:
 *        - Two or more consecutive newlines become a paragraph break
 *          (`<br><br>`), giving real visual spacing between paragraphs.
 *        - A single newline becomes one `<br>` so soft-wrapped lines from
 *          the meeting notes still break in the same places the author
 *          intended.
 *
 * Returns "" when input is falsy/whitespace so callers can guard with a
 * truthy check before rendering the surrounding container.
 */
export function formatNotesForEmail(notes?: string | null): string {
  if (!notes) return ""
  const trimmed = notes.replace(/\r\n?/g, "\n").trim()
  if (!trimmed) return ""

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")

  // Split into paragraphs at runs of 2+ newlines, then turn single
  // newlines within each paragraph into <br>. Joining paragraphs with
  // `<br><br>` keeps the markup flat (no nested <p> blocks fighting with
  // <table> layout inside Outlook).
  return trimmed
    .split(/\n{2,}/)
    .map((p) => escapeHtml(p).replace(/\n/g, "<br>"))
    .join("<br><br>")
}

// Debrief notification email template
// Debrief notification email template - organized into clear sections:
// 1. Project Details (submitter, date, work item, clients, service lines)
// 2. Meeting Notes (notes, related services, action items, research topics)
// 3. Project Finance (pricing adjustments, payment structure)
// 4. Attachments (Vercel Blob URLs uploaded with the debrief)
export function buildDebriefEmailHtml({
  authorName,
  clientName,
  workItemTitle,
  debriefDate,
  notes,
  actionItems,
  services,
  researchTopics,
  feeAdjustment,
  feeAdjustmentReason,
  followUpDate,
  primaryContact,
  relatedClients,
  relatedWorkItems,
  attachments,
  debriefUrl,
  logoUrl,
}: {
  authorName: string
  clientName: string
  workItemTitle?: string | null
  debriefDate: string
  notes?: string
  actionItems?: Array<{
    description: string
    assignee_name: string
    due_date?: string | null
    priority: string
  }>
  services?: string[]
  researchTopics?: string
  feeAdjustment?: string
  feeAdjustmentReason?: string
  followUpDate?: string
  // The contact/organization the debrief is canonically tagged to. Rendered
  // as its own labeled row above "Related Clients" so partners can see at a
  // glance who the debrief is FOR vs. who else it touches.
  primaryContact?: {
    name: string
    type?: "contact" | "organization" | string
    karbonUrl?: string | null
  } | null
  relatedClients?: Array<{
    name: string
    type?: "contact" | "organization" | string
    karbonUrl?: string | null
  }>
  relatedWorkItems?: Array<{
    title: string
    workType?: string | null
    karbonUrl?: string | null
  }>
  /**
   * Files uploaded with the debrief. Rendered as a labeled list with
   * download links (the same Vercel Blob URLs we persisted on the
   * debrief row). Files themselves are also attached to the email via
   * Resend's `attachments` API on the send call.
   */
  attachments?: Array<{
    name: string
    url: string
    size_bytes?: number | null
    content_type?: string | null
  }>
  debriefUrl: string
  logoUrl?: string
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_BASE_URL || "https://hub.motta.cpa"
  const resolvedLogoUrl = logoUrl || `${siteUrl}/images/alfred-logo.png`

  // Helper to render a Karbon deep link
  const renderKarbonLink = (label: string, url?: string | null) => {
    if (!url) {
      return `<span style="color: #333;">${label}</span>`
    }
    return `<a href="${url}" style="color: #2563eb; text-decoration: underline;">${label}</a>`
  }

  const workItemLinks = (relatedWorkItems || []).filter((w) => w.title)
  const clientLinks = (relatedClients || []).filter((c) => c.name)

  // ========================================
  // SECTION 1: Project Details
  // ========================================
  const projectDetailsRows: string[] = []

  // Submitted By
  projectDetailsRows.push(`
    <tr>
      <td style="padding: 8px 12px; font-size: 13px; color: #666; width: 140px; vertical-align: top;">Submitted By</td>
      <td style="padding: 8px 12px; font-size: 14px; color: #1a1a1a;">${authorName}</td>
    </tr>
  `)

  // Date of Meeting
  projectDetailsRows.push(`
    <tr>
      <td style="padding: 8px 12px; font-size: 13px; color: #666; vertical-align: top;">Date of Meeting</td>
      <td style="padding: 8px 12px; font-size: 14px; color: #1a1a1a;">${debriefDate}</td>
    </tr>
  `)

  // Karbon Work Item(s)
  if (workItemLinks.length > 0) {
    const workItemsHtml = workItemLinks
      .map((w) => renderKarbonLink(w.title, w.karbonUrl))
      .join("<br />")
    projectDetailsRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 13px; color: #666; vertical-align: top;">Karbon Work Item</td>
        <td style="padding: 8px 12px; font-size: 14px;">${workItemsHtml}</td>
      </tr>
    `)
  }

  // Primary Contact — the debrief is tagged TO this person/org. Rendered
  // as its own row so it stands apart from the "also-mentioned" related
  // clients below. Caller is expected to have already de-duped the primary
  // out of `relatedClients`.
  if (primaryContact?.name) {
    const typeLabel =
      primaryContact.type === "organization"
        ? " (Organization)"
        : primaryContact.type === "contact"
          ? " (Contact)"
          : ""
    projectDetailsRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 13px; color: #666; vertical-align: top;">Primary Contact</td>
        <td style="padding: 8px 12px; font-size: 14px; font-weight: 600;">${renderKarbonLink(primaryContact.name, primaryContact.karbonUrl)}${typeLabel ? `<span style="color: #999; font-size: 12px; font-weight: 400;">${typeLabel}</span>` : ""}</td>
      </tr>
    `)
  }

  // Related Clients (hyperlinked to Client Profile in Karbon).
  // Header label is "Other Related Clients" only when a primary is present,
  // to make the relationship between the two rows obvious.
  if (clientLinks.length > 0) {
    const relatedLabel = primaryContact?.name ? "Other Related Clients" : "Related Clients"
    const clientsHtml = clientLinks
      .map((c) => {
        const typeLabel = c.type === "organization" ? " (Organization)" : c.type === "contact" ? " (Contact)" : ""
        return `${renderKarbonLink(c.name, c.karbonUrl)}${typeLabel ? `<span style="color: #999; font-size: 12px;">${typeLabel}</span>` : ""}`
      })
      .join("<br />")
    projectDetailsRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 13px; color: #666; vertical-align: top;">${relatedLabel}</td>
        <td style="padding: 8px 12px; font-size: 14px;">${clientsHtml}</td>
      </tr>
    `)
  }

  // Service Lines
  if (services && services.length > 0) {
    projectDetailsRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 13px; color: #666; vertical-align: top;">Service Lines</td>
        <td style="padding: 8px 12px; font-size: 14px; color: #1a1a1a;">${services.join(", ")}</td>
      </tr>
    `)
  }

  // Follow-up Date
  if (followUpDate) {
    projectDetailsRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 13px; color: #666; vertical-align: top;">Follow-Up Date</td>
        <td style="padding: 8px 12px; font-size: 14px; color: #1a1a1a;">${followUpDate}</td>
      </tr>
    `)
  }

  const projectDetailsHtml = `
    <div style="margin-bottom: 24px;">
      <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Project Details</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>
          ${projectDetailsRows.join("")}
        </tbody>
      </table>
    </div>
  `

  // ========================================
  // SECTION 2: Meeting Notes
  // ========================================
  const meetingNotesSections: string[] = []

  // Notes — formatted with explicit <br> paragraph breaks because most
  // email clients (Outlook especially) ignore CSS `white-space: pre-wrap`.
  // formatNotesForEmail() also HTML-escapes the input so anything the
  // teammate typed renders as text instead of corrupting markup.
  const notesHtml = formatNotesForEmail(notes)
  if (notesHtml) {
    meetingNotesSections.push(`
      <div style="margin-bottom: 16px;">
        <h3 style="color: #666; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Notes</h3>
        <div style="background: #f9fafb; border-radius: 6px; padding: 12px 16px; font-size: 14px; color: #333; line-height: 1.55;">${notesHtml}</div>
      </div>
    `)
  }

  // Action Items
  if (actionItems && actionItems.length > 0) {
    const actionItemsTableHtml = `
      <div style="margin-bottom: 16px;">
        <h3 style="color: #666; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Action Items</h3>
        <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 6px; overflow: hidden;">
          <thead>
            <tr style="background: #e5e5e5;">
              <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666;">Task</th>
              <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666;">Assignee</th>
              <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666;">Due</th>
              <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666;">Priority</th>
            </tr>
          </thead>
          <tbody>
            ${actionItems
              .map(
                (item) => `
              <tr style="border-bottom: 1px solid #e5e5e5;">
                <td style="padding: 10px 12px; font-size: 14px; color: #1a1a1a;">${item.description}</td>
                <td style="padding: 10px 12px; font-size: 14px; color: #333;">${item.assignee_name || "-"}</td>
                <td style="padding: 10px 12px; font-size: 14px; color: #333;">${item.due_date || "-"}</td>
                <td style="padding: 10px 12px; font-size: 14px;">
                  <span style="
                    display: inline-block;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    background: ${item.priority === "high" ? "#fee2e2" : item.priority === "medium" ? "#fef3c7" : "#dcfce7"};
                    color: ${item.priority === "high" ? "#991b1b" : item.priority === "medium" ? "#92400e" : "#166534"};
                  ">${item.priority}</span>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `
    meetingNotesSections.push(actionItemsTableHtml)
  }

  // Research Topics — same paragraph-aware formatter so multi-paragraph
  // research notes don't collapse into a single wall of text.
  const researchTopicsHtml = formatNotesForEmail(researchTopics)
  if (researchTopicsHtml) {
    meetingNotesSections.push(`
      <div style="margin-bottom: 16px;">
        <h3 style="color: #666; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Research Topics</h3>
        <div style="background: #fef3c7; border-radius: 6px; padding: 12px 16px; font-size: 14px; color: #92400e; line-height: 1.55;">${researchTopicsHtml}</div>
      </div>
    `)
  }

  const meetingNotesHtml =
    meetingNotesSections.length > 0
      ? `
    <div style="margin-bottom: 24px;">
      <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Meeting Notes</h2>
      ${meetingNotesSections.join("")}
    </div>
  `
      : ""

  // ========================================
  // SECTION 3: Project Finance
  // ========================================
  const projectFinanceHtml = feeAdjustment
    ? `
    <div style="margin-bottom: 24px;">
      <h2 style="color: ${BRAND.textPrimary}; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid ${BRAND.border};">Project Finance</h2>
      <div style="background: #f0fdf4; border-radius: 6px; padding: 16px; border-left: 4px solid #22c55e;">
        <h3 style="color: #166534; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Pricing Adjustment / Payment Structure</h3>
        <p style="font-size: 14px; color: ${BRAND.textPrimary}; margin: 0 0 8px;">${feeAdjustment}</p>
        ${
          feeAdjustmentReason
            ? `<p style="font-size: 13px; color: ${BRAND.textMuted}; margin: 0;"><strong>Reason:</strong> ${feeAdjustmentReason}</p>`
            : ""
        }
      </div>
    </div>
  `
    : ""

  // ========================================
  // SECTION 4: Attachments
  // ========================================
  // Two-purpose render: clickable filename list inside the email body
  // (so a teammate can re-download even after Resend strips the binary
  // attachments from the archive copy) plus a one-line size suffix so the
  // recipient knows what they're clicking before fetching from Blob.
  // The actual files are also passed to Resend as `attachments` on the
  // send call so they arrive as real mail attachments, not just links.
  const visibleAttachments = (attachments || []).filter((a) => a?.name && a?.url)
  const formatBytes = (n?: number | null): string => {
    if (!n || n <= 0) return ""
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }
  const attachmentsHtml =
    visibleAttachments.length > 0
      ? `
    <div style="margin-bottom: 24px;">
      <h2 style="color: ${BRAND.textPrimary}; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid ${BRAND.border};">Attachments</h2>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${visibleAttachments
          .map((a) => {
            const size = formatBytes(a.size_bytes)
            return `
              <li style="padding: 10px 12px; background: #f9fafb; border-radius: 6px; margin-bottom: 6px; font-size: 14px;">
                <a href="${a.url}" style="color: #2563eb; text-decoration: underline; font-weight: 500;">${a.name}</a>
                ${size ? `<span style="color: ${BRAND.textMuted}; font-size: 12px; margin-left: 8px;">${size}</span>` : ""}
              </li>
            `
          })
          .join("")}
      </ul>
      <p style="font-size: 11px; color: ${BRAND.textMuted}; margin: 8px 0 0;">
        Files are also attached to this email.
      </p>
    </div>
  `
      : ""

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Debrief Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: ${BRAND.background};">
  <div style="max-width: 680px; margin: 0 auto; padding: 24px 16px;">
    <div style="background: ${BRAND.surface}; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04); border: 1px solid ${BRAND.border};">
      <!-- Header with logo + brand bar -->
      <div style="background: ${BRAND.primary}; padding: 18px 28px;">
        <table width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="vertical-align: middle;">
              <img src="${resolvedLogoUrl}" alt="ALFRED AI" width="40" height="40" style="display: block; border: 0; border-radius: 6px; background: ${BRAND.surface}; padding: 4px;" />
            </td>
            <td style="vertical-align: middle; padding-left: 14px;">
              <div style="color: ${BRAND.surface}; font-size: 18px; font-weight: 700; letter-spacing: 0.04em;">MOTTA HUB</div>
              <div style="color: rgba(255,255,255,0.8); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px;">Powered by ALFRED AI</div>
            </td>
            <td style="vertical-align: middle; text-align: right;">
              <span style="display: inline-block; background: rgba(255,255,255,0.15); color: ${BRAND.surface}; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 10px; border-radius: 999px;">Debrief</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Body -->
      <div style="padding: 32px;">
        <h1 style="color: ${BRAND.textPrimary}; font-size: 22px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.01em;">New Debrief Submitted</h1>
        <p style="color: ${BRAND.textMuted}; font-size: 13px; margin: 0 0 18px;">${debriefDate}</p>

        <div style="background: ${BRAND.background}; border-radius: 8px; padding: 14px 16px; border-left: 3px solid ${BRAND.primary}; margin-bottom: 24px;">
          <p style="font-size: 14px; color: ${BRAND.textPrimary}; margin: 0; line-height: 1.5;">
            <strong style="color: ${BRAND.primaryDark};">${authorName}</strong> submitted a debrief for <strong style="color: ${BRAND.primaryDark};">${clientName}</strong>${workItemTitle ? ` &mdash; <em>${workItemTitle}</em>` : ""}.
          </p>
        </div>

        ${projectDetailsHtml}
        ${meetingNotesHtml}
        ${projectFinanceHtml}
        ${attachmentsHtml}

        <!-- CTA -->
        <div style="margin-top: 32px; text-align: center;">
          <a href="${debriefUrl}" style="display: inline-block; background: ${BRAND.primary}; color: ${BRAND.surface}; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">View Full Debrief in MOTTA HUB &rarr;</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="background: ${BRAND.background}; padding: 16px 28px; border-top: 1px solid ${BRAND.border};">
        <p style="font-size: 11px; color: ${BRAND.textMuted}; margin: 0; text-align: center; letter-spacing: 0.02em;">
          This is an automated notification from MOTTA HUB. Please do not reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`
}

// ============================================================
// Prospect notification email (mirrors debrief template shape so the
// inbox visually groups Hub-authored team broadcasts together).
// Used when a teammate submits the internal Prospect Form
// (/api/prospects). Broadcast firm-wide with the same UNCONDITIONAL
// pattern as debriefs — partners need to know about new prospects.
// ============================================================
export function buildProspectEmailHtml({
  authorName,
  prospectName,
  prospectType,
  serviceFocus,
  servicesRequested,
  entityTypes,
  personal,
  business,
  socials,
  referral,
  enrichmentSummary,
  workItem,
  internalNotes,
  attachmentCount,
  prospectUrl,
  logoUrl,
}: {
  authorName: string
  prospectName: string
  // "individual" | "business" | "both" — drives the summary banner copy.
  prospectType?: "individual" | "business" | "both" | null
  serviceFocus?: string | null
  servicesRequested?: string[]
  entityTypes?: string[]
  // Contact info for the prospect-as-person. Phone/email/location are
  // optional; we only render rows for what was actually provided so
  // the email doesn't have a wall of "—" placeholders.
  personal?: {
    email?: string | null
    phone?: string | null
    location?: string | null
  } | null
  // Business details — same "render only what's present" rule.
  business?: {
    name?: string | null
    situation?: string | null
    email?: string | null
    phone?: string | null
    state?: string | null
    taxClassification?: string | null
    revenueRange?: string | null
    employees?: string | null
    accountingSystem?: string | null
    summary?: string | null
  } | null
  // Web presence + social links (rendered only when provided). Maps to
  // the same fields pushed to the Hub contact + Karbon BusinessCard.
  socials?: {
    website?: string | null
    linkedin?: string | null
    twitter?: string | null
    facebook?: string | null
    instagram?: string | null
  } | null
  // Who referred the prospect, when present. `contactUrl` deep-links
  // into the referrer's Hub profile when the referrer was matched.
  referral?: {
    name?: string | null
    contactUrl?: string | null
    matched?: boolean
  } | null
  // ALFRED's drafted prospect summary / enrichment from website + socials.
  enrichmentSummary?: string | null
  // Optional Karbon work item created alongside the prospect.
  workItem?: {
    title?: string | null
    url?: string | null
  } | null
  internalNotes?: string | null
  attachmentCount?: number
  prospectUrl: string
  logoUrl?: string
}) {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_BASE_URL ||
    "https://hub.motta.cpa"
  const resolvedLogoUrl = logoUrl || `${siteUrl}/images/alfred-logo.png`
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  // -- helpers --------------------------------------------------------
  const row = (label: string, valueHtml: string) => `
    <tr>
      <td style="padding: 8px 12px; font-size: 13px; color: #666; width: 160px; vertical-align: top;">${label}</td>
      <td style="padding: 8px 12px; font-size: 14px; color: #1a1a1a;">${valueHtml}</td>
    </tr>`

  const typeLabel =
    prospectType === "individual"
      ? "Individual"
      : prospectType === "business"
        ? "Business"
        : prospectType === "both"
          ? "Individual & Business (Business Owner)"
          : null

  // -- 1. Prospect details (always present) ---------------------------
  const detailRows: string[] = []
  detailRows.push(row("Submitted By", authorName))
  detailRows.push(row("Submitted On", today))
  if (typeLabel) detailRows.push(row("Prospect Type", typeLabel))
  if (serviceFocus) detailRows.push(row("Service Focus", serviceFocus))
  if (servicesRequested && servicesRequested.length > 0) {
    detailRows.push(row("Services Requested", servicesRequested.join(", ")))
  }
  if (entityTypes && entityTypes.length > 0) {
    detailRows.push(row("Entity Types", entityTypes.join(", ")))
  }

  const detailsSection = `
    <div style="margin-bottom: 24px;">
      <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Prospect Details</h2>
      <table style="width: 100%; border-collapse: collapse;"><tbody>${detailRows.join("")}</tbody></table>
    </div>`

  // -- 2. Personal contact (conditional) ------------------------------
  let personalSection = ""
  if (personal && (personal.email || personal.phone || personal.location)) {
    const rows: string[] = []
    if (personal.email)
      rows.push(
        row(
          "Email",
          `<a href="mailto:${personal.email}" style="color: #2563eb; text-decoration: underline;">${personal.email}</a>`,
        ),
      )
    if (personal.phone) rows.push(row("Phone", personal.phone))
    if (personal.location) rows.push(row("Location", personal.location))
    personalSection = `
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Contact</h2>
        <table style="width: 100%; border-collapse: collapse;"><tbody>${rows.join("")}</tbody></table>
      </div>`
  }

  // -- 3. Business (conditional) --------------------------------------
  let businessSection = ""
  if (business && (business.name || business.email || business.phone || business.summary)) {
    const rows: string[] = []
    if (business.name) rows.push(row("Business Name", `<strong>${business.name}</strong>`))
    if (business.situation) rows.push(row("Situation", business.situation))
    if (business.email)
      rows.push(
        row(
          "Business Email",
          `<a href="mailto:${business.email}" style="color: #2563eb; text-decoration: underline;">${business.email}</a>`,
        ),
      )
    if (business.phone) rows.push(row("Business Phone", business.phone))
    if (business.state) rows.push(row("Business State", business.state))
    if (business.taxClassification) rows.push(row("Tax Classification", business.taxClassification))
    if (business.revenueRange) rows.push(row("Revenue Range", business.revenueRange))
    if (business.employees) rows.push(row("Employees", business.employees))
    if (business.accountingSystem) rows.push(row("Accounting System", business.accountingSystem))
    let summaryHtml = ""
    if (business.summary) {
      summaryHtml = `
        <div style="margin-top: 12px;">
          <h3 style="color: #666; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Business Summary</h3>
          <div style="background: #f9fafb; border-radius: 6px; padding: 12px 16px; font-size: 14px; color: #333; white-space: pre-wrap; line-height: 1.5;">${business.summary}</div>
        </div>`
    }
    businessSection = `
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Business</h2>
        <table style="width: 100%; border-collapse: collapse;"><tbody>${rows.join("")}</tbody></table>
        ${summaryHtml}
      </div>`
  }

  // -- 3b. Web presence / socials (conditional) -----------------------
  let socialsSection = ""
  if (
    socials &&
    (socials.website || socials.linkedin || socials.twitter || socials.facebook || socials.instagram)
  ) {
    const link = (href: string, text: string) =>
      `<a href="${href.startsWith("http") ? href : `https://${href}`}" style="color: #2563eb; text-decoration: underline;">${text}</a>`
    const rows: string[] = []
    if (socials.website) rows.push(row("Website", link(socials.website, socials.website)))
    if (socials.linkedin) rows.push(row("LinkedIn", link(socials.linkedin, socials.linkedin)))
    if (socials.twitter) rows.push(row("X / Twitter", link(socials.twitter, socials.twitter)))
    if (socials.facebook) rows.push(row("Facebook", link(socials.facebook, socials.facebook)))
    if (socials.instagram) rows.push(row("Instagram", link(socials.instagram, socials.instagram)))
    socialsSection = `
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Web Presence</h2>
        <table style="width: 100%; border-collapse: collapse;"><tbody>${rows.join("")}</tbody></table>
      </div>`
  }

  // -- 3c. Referral (conditional) -------------------------------------
  let referralSection = ""
  if (referral && referral.name && referral.name.trim()) {
    const valueHtml = referral.contactUrl
      ? `<a href="${referral.contactUrl}" style="color: #2563eb; text-decoration: underline;">${referral.name}</a>${referral.matched ? "" : " <span style=\"color:#92400e;\">(unmatched — review)</span>"}`
      : `${referral.name}${referral.matched ? "" : " <span style=\"color:#92400e;\">(unmatched — review)</span>"}`
    referralSection = `
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Referred By</h2>
        <table style="width: 100%; border-collapse: collapse;"><tbody>${row("Referrer", valueHtml)}</tbody></table>
      </div>`
  }

  // -- 3d. ALFRED enrichment summary (conditional) --------------------
  let enrichmentSection = ""
  if (enrichmentSummary && enrichmentSummary.trim()) {
    enrichmentSection = `
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">ALFRED Prospect Summary</h2>
        <div style="background: ${BRAND.background}; border-radius: 6px; padding: 14px 16px; font-size: 14px; color: #333; white-space: pre-wrap; line-height: 1.6; border-left: 3px solid ${BRAND.primary};">${enrichmentSummary}</div>
      </div>`
  }

  // -- 3e. Karbon work item (conditional) -----------------------------
  let workItemSection = ""
  if (workItem && workItem.title) {
    const titleHtml = workItem.url
      ? `<a href="${workItem.url}" style="color: #2563eb; text-decoration: underline;">${workItem.title}</a>`
      : workItem.title
    workItemSection = `
      <div style="margin-bottom: 24px; padding: 12px 16px; background: #ecfdf5; border-left: 4px solid #10b981; border-radius: 6px; font-size: 13px; color: #065f46;">
        Karbon work item created: <strong>${titleHtml}</strong>
      </div>`
  }

  // -- 4. Internal notes (conditional) --------------------------------
  let notesSection = ""
  if (internalNotes && internalNotes.trim()) {
    notesSection = `
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1a1a1a; font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e5e5;">Internal Notes</h2>
        <div style="background: #f9fafb; border-radius: 6px; padding: 12px 16px; font-size: 14px; color: #333; white-space: pre-wrap; line-height: 1.5;">${internalNotes}</div>
      </div>`
  }

  // -- 5. Attachments hint (conditional) ------------------------------
  // We don't embed the actual files in the email -- they live behind
  // an auth-gated /attachments route -- so we just nudge the team to
  // open the detail page when there are any.
  const attachmentHint =
    attachmentCount && attachmentCount > 0
      ? `
      <div style="margin-bottom: 24px; padding: 12px 16px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; font-size: 13px; color: #92400e;">
        ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} included — view them on the prospect&apos;s page.
      </div>`
      : ""

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>New Prospect</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: ${BRAND.background};">
  <div style="max-width: 680px; margin: 0 auto; padding: 24px 16px;">
    <div style="background: ${BRAND.surface}; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04); border: 1px solid ${BRAND.border};">
      <!-- Header bar -->
      <div style="background: ${BRAND.primary}; padding: 18px 28px;">
        <table width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="vertical-align: middle;">
              <img src="${resolvedLogoUrl}" alt="ALFRED AI" width="40" height="40" style="display: block; border: 0; border-radius: 6px; background: ${BRAND.surface}; padding: 4px;" />
            </td>
            <td style="vertical-align: middle; padding-left: 14px;">
              <div style="color: ${BRAND.surface}; font-size: 18px; font-weight: 700; letter-spacing: 0.04em;">MOTTA HUB</div>
              <div style="color: rgba(255,255,255,0.8); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px;">Powered by ALFRED AI</div>
            </td>
            <td style="vertical-align: middle; text-align: right;">
              <span style="display: inline-block; background: rgba(255,255,255,0.15); color: ${BRAND.surface}; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 10px; border-radius: 999px;">Prospect</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Body -->
      <div style="padding: 32px;">
        <h1 style="color: ${BRAND.textPrimary}; font-size: 22px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.01em;">New Prospect Submitted</h1>
        <p style="color: ${BRAND.textMuted}; font-size: 13px; margin: 0 0 18px;">${today}</p>

        <div style="background: ${BRAND.background}; border-radius: 8px; padding: 14px 16px; border-left: 3px solid ${BRAND.primary}; margin-bottom: 24px;">
          <p style="font-size: 14px; color: ${BRAND.textPrimary}; margin: 0; line-height: 1.5;">
            <strong style="color: ${BRAND.primaryDark};">${authorName}</strong> added a new prospect &mdash; <strong style="color: ${BRAND.primaryDark};">${prospectName}</strong>.
          </p>
        </div>

        ${detailsSection}
        ${personalSection}
        ${businessSection}
        ${socialsSection}
        ${referralSection}
        ${enrichmentSection}
        ${workItemSection}
        ${notesSection}
        ${attachmentHint}

        <div style="margin-top: 32px; text-align: center;">
          <a href="${prospectUrl}" style="display: inline-block; background: ${BRAND.primary}; color: ${BRAND.surface}; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">View Prospect in MOTTA HUB &rarr;</a>
        </div>
      </div>

      <div style="background: ${BRAND.background}; padding: 16px 28px; border-top: 1px solid ${BRAND.border};">
        <p style="font-size: 11px; color: ${BRAND.textMuted}; margin: 0; text-align: center; letter-spacing: 0.02em;">
          This is an automated notification from MOTTA HUB. Please do not reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`
}

// ============================================================
// Preference-aware email helpers (used by /api/notifications/send,
// cron jobs, and admin broadcast).
// ============================================================

export interface RecipientResolution {
  team_member_id: string
  email: string
  full_name: string
}

/**
 * Given a list of team_member ids and an email category, returns the recipients
 * who currently have that category enabled (or have no preference row -> default ON).
 * Filters out inactive members and members without an email address.
 */
export async function resolveRecipientsForCategory(
  teamMemberIds: string[],
  category: EmailCategory,
): Promise<RecipientResolution[]> {
  if (!teamMemberIds.length) return []
  const supabase = createAdminClient()

  const { data: members, error: membersErr } = await supabase
    .from("team_members")
    .select("id, full_name, email, is_active")
    .in("id", teamMemberIds)
  if (membersErr) {
    console.error("[email] resolveRecipientsForCategory members error:", membersErr)
    return []
  }

  const { data: prefs, error: prefsErr } = await supabase
    .from("notification_preferences")
    .select("team_member_id, email_enabled")
    .in("team_member_id", teamMemberIds)
    .eq("category", category)
  if (prefsErr) {
    console.error("[email] resolveRecipientsForCategory prefs error:", prefsErr)
  }

  const prefMap = new Map<string, boolean>()
  for (const p of prefs ?? []) prefMap.set(p.team_member_id, p.email_enabled)

  const result: RecipientResolution[] = []
  for (const m of members ?? []) {
    if (!m.is_active) continue
    if (!m.email) continue
    // Default to enabled when no preference row exists.
    const enabled = prefMap.has(m.id) ? prefMap.get(m.id) : true
    if (!enabled) continue
    result.push({ team_member_id: m.id, email: m.email, full_name: m.full_name })
  }
  return result
}

/**
 * Sends a category-aware notification email to a list of team_member ids.
 * Skips delivery for users who have opted out of this category.
 * Returns counts of attempted vs. actually sent.
 */
export async function sendCategoryEmail(opts: {
  category: EmailCategory
  teamMemberIds: string[]
  subject: string
  html: string
  replyTo?: string
  /**
   * Optional file attachments passed straight through to Resend on the
   * single send call. Used by the Friday Tommy recap to attach the
   * generated PDF so partners get a portable record they can forward
   * to clients / save to OneDrive without bouncing back to the Hub.
   */
  attachments?: EmailAttachment[]
}): Promise<{ attempted: number; sent: number; skipped: number }> {
  const recipients = await resolveRecipientsForCategory(opts.teamMemberIds, opts.category)
  const attempted = opts.teamMemberIds.length
  if (recipients.length === 0) {
    return { attempted, sent: 0, skipped: attempted }
  }

  let sent = 0

  if (opts.attachments && opts.attachments.length > 0) {
    // Resend's batch endpoint can't carry attachments, so send one message
    // per recipient. Still individually addressed (no shared `to` list), so
    // recipients never see each other's addresses.
    const results = await Promise.all(
      recipients.map((r) =>
        sendEmail({
          to: r.email,
          subject: opts.subject,
          html: opts.html,
          replyTo: opts.replyTo,
          attachments: opts.attachments,
        }).then((res) => res.success),
      ),
    )
    sent = results.filter(Boolean).length
  } else {
    // No attachments -> collapse the whole fan-out into one batch call.
    const { sent: batchSent } = await sendBatchEmail(
      recipients.map((r) => ({
        to: r.email,
        subject: opts.subject,
        html: opts.html,
        replyTo: opts.replyTo,
      })),
    )
    sent = batchSent
  }

  return {
    attempted,
    sent,
    skipped: attempted - sent,
  }
}

/**
 * Like `sendCategoryEmail`, but the HTML body is built PER recipient via a
 * callback — used by digests (e.g. the Daily Briefing) that personalize the
 * greeting. Respects per-user category opt-out and sends every message in a
 * single batch call instead of a sequential loop with sleeps.
 */
export async function sendCategoryEmailPersonalized(opts: {
  category: EmailCategory
  teamMemberIds: string[]
  subject: string | ((r: RecipientResolution) => string)
  buildHtml: (r: RecipientResolution) => string
  replyTo?: string
}): Promise<{ attempted: number; sent: number; skipped: number }> {
  const recipients = await resolveRecipientsForCategory(opts.teamMemberIds, opts.category)
  const attempted = opts.teamMemberIds.length
  if (recipients.length === 0) {
    return { attempted, sent: 0, skipped: attempted }
  }

  const { sent } = await sendBatchEmail(
    recipients.map((r) => ({
      to: r.email,
      subject: typeof opts.subject === "function" ? opts.subject(r) : opts.subject,
      html: opts.buildHtml(r),
      replyTo: opts.replyTo,
    })),
  )

  return { attempted, sent, skipped: attempted - sent }
}

// ============================================================
// Shared HTML wrapper + additional templates
// ============================================================

function baseEmailWrapper(headerTitle: string, bodyHtml: string, footerNote?: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#1a1a1a;padding:24px 32px;">
        <h1 style="color:#fff;font-size:20px;margin:0;">${headerTitle}</h1>
        <p style="color:#a3a3a3;font-size:14px;margin:8px 0 0;">MOTTA HUB</p>
      </div>
      <div style="padding:32px;color:#1a1a1a;font-size:15px;line-height:1.6;">${bodyHtml}</div>
      <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #eee;">
        <p style="font-size:12px;color:#999;margin:0;text-align:center;">
          ${footerNote || "This is an automated notification from MOTTA HUB. Manage your email preferences in settings."}
        </p>
      </div>
    </div>
  </div>
</body>
</html>`
}

/**
 * Generic in-app notification email — used as the default template by
 * /api/notifications/send when no specialized template fits.
 */
export function buildNotificationEmailHtml(opts: {
  recipientName?: string
  title: string
  message: string
  actionUrl?: string
  actionLabel?: string
}) {
  const greet = opts.recipientName ? `<p style="margin:0 0 16px;">Hi ${opts.recipientName},</p>` : ""
  const cta = opts.actionUrl
    ? `<div style="margin-top:24px;text-align:center;">
        <a href="${opts.actionUrl.startsWith("http") ? opts.actionUrl : APP_URL + opts.actionUrl}"
           style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
          ${opts.actionLabel || "View in MOTTA HUB"}
        </a>
      </div>`
    : ""
  const body = `${greet}
    <h2 style="font-size:18px;margin:0 0 12px;">${opts.title}</h2>
    <div style="white-space:pre-wrap;color:#333;">${opts.message}</div>
    ${cta}`
  return baseEmailWrapper(opts.title, body)
}

/**
 * Post-meeting debrief request, authored by ALFRED Ai and sent by the
 * hourly debrief-reminder cron once a client/prospect meeting has ended.
 * Mirrors the look of Calendly's own "meeting ended" automation but keeps
 * the firm in control of the form. The CTA opens the prefilled
 * `/debriefs/new` form so the host only has to fill in substance.
 */
export function buildDebriefRequestHtml(opts: {
  recipientName?: string
  meetingName: string
  /** Pretty, timezone-aware meeting time, already formatted by the caller. */
  meetingTime: string
  /** "Zoom" | "Phone call" | "In person" — human label for the modality. */
  meetingTypeLabel: string
  /** Display name of the client/prospect this meeting was tagged to. */
  clientName?: string | null
  /** Absolute URL to the prefilled debrief form. */
  debriefUrl: string
}) {
  const greet = opts.recipientName ? `<p style="margin:0 0 16px;">Hi ${opts.recipientName},</p>` : ""
  const clientRow = opts.clientName
    ? `<tr>
         <td style="padding:6px 0;color:${BRAND.textMuted};font-size:13px;width:120px;">Client</td>
         <td style="padding:6px 0;color:${BRAND.textPrimary};font-size:13px;font-weight:600;">${opts.clientName}</td>
       </tr>`
    : ""

  const body = `${greet}
    <h2 style="font-size:18px;margin:0 0 12px;color:${BRAND.textPrimary};">How did the meeting go?</h2>
    <p style="margin:0 0 18px;color:${BRAND.textMuted};font-size:14px;line-height:1.6;">
      Your meeting has wrapped up. Take a minute to log a debrief so the rest of the team stays in the loop and any follow-ups get captured.
    </p>
    <div style="background:#F9FAFB;border:1px solid ${BRAND.border};border-radius:8px;padding:14px 18px;margin:0 0 22px;">
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;">
        <tr>
          <td style="padding:6px 0;color:${BRAND.textMuted};font-size:13px;width:120px;">Meeting</td>
          <td style="padding:6px 0;color:${BRAND.textPrimary};font-size:13px;font-weight:600;">${opts.meetingName}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${BRAND.textMuted};font-size:13px;">When</td>
          <td style="padding:6px 0;color:${BRAND.textPrimary};font-size:13px;">${opts.meetingTime}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${BRAND.textMuted};font-size:13px;">Type</td>
          <td style="padding:6px 0;color:${BRAND.textPrimary};font-size:13px;">${opts.meetingTypeLabel}</td>
        </tr>
        ${clientRow}
      </table>
    </div>
    <div style="text-align:center;">
      <a href="${opts.debriefUrl}"
         style="display:inline-block;background:${BRAND.primary};color:#fff;padding:13px 34px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
        Submit Debrief
      </a>
    </div>
    <p style="margin:20px 0 0;color:${BRAND.textMuted};font-size:12px;text-align:center;">
      The form is pre-filled with this meeting's details — you just add the substance.
    </p>`
  return baseEmailWrapper("Submit your meeting debrief", body)
}

/**
 * Tommy Awards weekly ballot reminder. Sent Thursday afternoons (Eastern
 * Time) so voters have Thursday evening + Friday morning to submit their
 * ballots before the Friday-noon firm-wide recap.
 */
export function buildTommyReminderHtml(opts: {
  recipientName: string
  weekLabel: string
  ballotUrl: string
}) {
  const body = `<p style="margin:0 0 16px;">Hi ${opts.recipientName},</p>
    <p style="margin:0 0 16px;">It's almost Tommy Awards time — take a moment this evening or tomorrow morning to recognize the teammates who best represented Tom Brady this week. Going the extra mile, client wins, and being a great teammate all count.</p>
    <div style="background:#f9fafb;border-left:4px solid #c62828;padding:12px 16px;border-radius:4px;margin:0 0 20px;">
      <strong>Voting for: ${opts.weekLabel}</strong>
    </div>
    <div style="text-align:center;">
      <a href="${opts.ballotUrl}"
         style="display:inline-block;background:#c62828;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">
        Submit Your Ballot
      </a>
    </div>
    <p style="margin:20px 0 0;color:${BRAND.textMuted};font-size:13px;text-align:center;">
      Ballots close at 12:00 PM Eastern on Friday — the recap goes out right after.
    </p>`
  return baseEmailWrapper("Tommy Awards — Cast Your Vote", body)
}

/**
 * Tommy Awards weekly recap. Sent Friday at 12:00 PM Eastern Time.
 *
 * Uses the shared MOTTA HUB email wrapper (header/footer) so it matches the
 * reminder and every other transactional email in the firm. Keeps the
 * functional medal colors (gold / silver / bronze) for the top-three
 * podium and the red Tommy accent for the CTA.
 */
export function buildTommyRecapHtml(opts: {
  weekLabel: string
  aiSummary: string
  // `rank` is the dense rank computed by the cron — tied finishers share
  // a rank, and the medal/circle color is keyed off the rank rather than
  // the array index so two people tied for 1st both display gold.
  topThree: Array<{
    name: string
    totalPoints: number
    first: number
    second: number
    third: number
    rank: number
  }>
  totalBallots: number
  leaderboardUrl: string
  /** Optional weekly F1-podium hero image (Vercel Blob URL). */
  podiumImageUrl?: string | null
}) {
  // Functional medal palette — these are NOT brand colors, they communicate
  // 1st/2nd/3rd place at a glance and shouldn't be repainted with the Motta
  // olive palette without breaking that visual language.
  const MEDAL_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"] as const

  const podiumHtml =
    opts.topThree.length > 0
      ? opts.topThree
          .map((winner) => {
            // Clamp to the bronze color for any rank > 3 (shouldn't
            // happen because the cron filters to rank ≤ 3, but keeps the
            // template robust if an out-of-range entry sneaks in).
            const medalIndex = Math.min(Math.max(winner.rank - 1, 0), MEDAL_COLORS.length - 1)
            const medal = MEDAL_COLORS[medalIndex]
            return `
              <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;margin:0 0 12px;">
                <tr>
                  <td style="width:48px;vertical-align:middle;padding-right:14px;">
                    <div style="background:${medal};color:#1a1a1a;font-size:18px;font-weight:700;width:44px;height:44px;border-radius:50%;text-align:center;line-height:44px;">${winner.rank}</div>
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:16px;font-weight:600;color:${BRAND.textPrimary};">${winner.name}</div>
                    <div style="font-size:13px;color:${BRAND.textMuted};margin-top:2px;">
                      ${winner.totalPoints} pts &middot; ${winner.first} first &middot; ${winner.second} second &middot; ${winner.third} third
                    </div>
                  </td>
                </tr>
              </table>`
          })
          .join("")
      : `<p style="color:${BRAND.textMuted};font-size:14px;margin:0;">No votes recorded this week.</p>`

  // Split ALFRED's summary on blank lines so we can render each paragraph
  // in its own block with explicit <br><br> separators — email clients
  // strip whitespace and ignore CSS `white-space:pre-wrap` inconsistently,
  // so explicit <br> tags are the only reliable way to preserve paragraph
  // breaks across Gmail / Outlook / Apple Mail.
  const summaryParagraphs = (opts.aiSummary || "")
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const summaryHtml =
    summaryParagraphs.length > 0
      ? summaryParagraphs
          .map(
            (p) =>
              `<p style="margin:0;font-size:15px;color:${BRAND.textPrimary};line-height:1.7;">${p.replace(
                /\n/g,
                "<br>",
              )}</p>`,
          )
          .join("<br><br>")
      : `<p style="margin:0;font-size:15px;color:${BRAND.textPrimary};line-height:1.7;">${opts.aiSummary}</p>`

  // Optional F1-podium hero image — placed BEFORE the narrative so the
  // visual sets the comic-book tone before ALFRED's prose lands.
  const podiumImageHtml = opts.podiumImageUrl
    ? `
        <div style="margin:0 0 24px;text-align:center;">
          <img src="${opts.podiumImageUrl}"
               alt="Tommy Awards podium — week of ${opts.weekLabel}"
               style="display:block;width:100%;max-width:560px;height:auto;border-radius:10px;border:1px solid ${BRAND.border};margin:0 auto;" />
        </div>`
    : ""

  const body = `
    <p style="margin:0 0 8px;color:${BRAND.textMuted};font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">
      Week of ${opts.weekLabel}
    </p>
    <h2 style="margin:0 0 20px;font-size:20px;color:${BRAND.textPrimary};">This Week's Tommy Awards</h2>

    ${podiumImageHtml}

    <div style="background:${BRAND.background};border-left:4px solid ${BRAND.primary};padding:18px 20px;border-radius:6px;margin:0 0 28px;">
      <div style="font-size:12px;font-weight:600;color:${BRAND.primary};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">
        From ALFRED Ai
      </div>
      ${summaryHtml}
    </div>

    <h3 style="font-size:16px;color:${BRAND.textPrimary};margin:0 0 16px;">Top 3 Finishers</h3>
    ${podiumHtml}

    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;margin:24px 0 0;background:${BRAND.background};border-radius:6px;">
      <tr>
        <td style="padding:14px 18px;font-size:13px;color:${BRAND.textMuted};">Total Ballots Submitted</td>
        <td style="padding:14px 18px;font-size:13px;color:${BRAND.textPrimary};font-weight:600;text-align:right;">${opts.totalBallots}</td>
      </tr>
    </table>

    <div style="margin-top:28px;text-align:center;">
      <a href="${opts.leaderboardUrl}"
         style="display:inline-block;background:#c62828;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
        View Full Leaderboard
      </a>
    </div>`

  return baseEmailWrapper("Tommy Awards Weekly Recap", body)
}

/**
 * Daily / weekly meeting digest combining Calendly + Zoom.
 */
export function buildMeetingDigestHtml(opts: {
  recipientName: string
  rangeLabel: string
  upcoming: Array<{ when: string; title: string; with?: string; source: string; url?: string }>
  recent: Array<{ when: string; title: string; with?: string; source: string }>
}) {
  const renderRow = (m: { when: string; title: string; with?: string; source: string; url?: string }) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:10px 12px;font-size:13px;color:#666;white-space:nowrap;">${m.when}</td>
      <td style="padding:10px 12px;font-size:14px;">
        ${m.url ? `<a href="${m.url}" style="color:#1a1a1a;font-weight:600;">${m.title}</a>` : `<span style="font-weight:600;">${m.title}</span>`}
        ${m.with ? `<div style="color:#666;font-size:12px;margin-top:2px;">with ${m.with}</div>` : ""}
      </td>
      <td style="padding:10px 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">${m.source}</td>
    </tr>`

  const upcomingHtml = opts.upcoming.length
    ? `<h3 style="font-size:15px;margin:24px 0 8px;">Upcoming</h3>
       <table style="width:100%;border-collapse:collapse;">${opts.upcoming.map(renderRow).join("")}</table>`
    : `<h3 style="font-size:15px;margin:24px 0 8px;">Upcoming</h3>
       <p style="color:#888;font-size:14px;">No meetings scheduled.</p>`

  const recentHtml = opts.recent.length
    ? `<h3 style="font-size:15px;margin:24px 0 8px;">Recent</h3>
       <table style="width:100%;border-collapse:collapse;">${opts.recent.map(renderRow).join("")}</table>`
    : ""

  const body = `<p style="margin:0 0 8px;">Hi ${opts.recipientName},</p>
    <p style="margin:0 0 16px;color:#666;">Your meeting digest for <strong>${opts.rangeLabel}</strong>.</p>
    ${upcomingHtml}
    ${recentHtml}
    <div style="margin-top:24px;text-align:center;">
      <a href="${APP_URL}/calendar"
         style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
        Open Calendar
      </a>
    </div>`
  return baseEmailWrapper("Your Meeting Digest", body)
}

/**
 * ALFRED Ai's weekday morning briefing.
 *
 * Combines five sections in a single MOTTA HUB-themed email:
 *   1. Today's executive summary (AI-generated, witty British butler tone)
 *   2. Recent debriefs since last briefing (with deep links into the hub)
 *   3. Upcoming client meetings for the next 7 days
 *   4. Team reminders — holidays, tax deadlines, Tommy Awards Thursdays
 *   5. Topical news links — markets and tax/IRS
 *
 * Sender identity (ALFRED Ai) is set at the transport layer via
 * RESEND_FROM_EMAIL; this builder only paints the body. Keeping the
 * wrapper consistent means daily briefings render identically to debrief,
 * Tommy, and meeting-digest emails in every inbox we test against.
 */
export function buildDailyBriefingHtml(opts: {
  recipientName: string
  dateLabel: string
  /** "Mon, Jan 13 - Sun, Jan 19" range covered by the upcoming-meetings section. */
  weekRangeLabel: string
  /** AI-generated witty butler exec summary. Plain text — wrapped by us. */
  executiveSummary: string
  recentDebriefs: Array<{
    clientName: string
    authorName: string
    workItemTitle?: string | null
    debriefDate: string
    url: string
  }>
  upcomingMeetings: Array<{
    when: string
    title: string
    hostName?: string
    source: string
    url?: string
    with?: string
  }>
  teamReminders: Array<{
    relativeLabel: string
    dateLabel: string
    kind: "holiday" | "tax" | "tommy" | "firm" | "other"
    label: string
    notes?: string
  }>
  marketNews: Array<{ title: string; url: string; source: string }>
  taxNews: Array<{ title: string; url: string; source: string }>
  techNews: Array<{ title: string; url: string; source: string }>
  /** Recent updates/commits to Motta Hub for the appendix. */
  hubUpdates?: Array<{
    message: string
    author: string
    date: string
    url: string
  }>
  /** New intake form submissions from yesterday. */
  newIntakeForms?: Array<{
    name: string
    businessName?: string | null
    services: string[]
    url: string
  }>
  /** New feedback submissions from yesterday. */
  newFeedback?: Array<{
    name: string
    rating?: number | null
    comment?: string | null
    url: string
  }>
  /** Proposals accepted yesterday. */
  newProposalsAccepted?: Array<{
    clientName: string
    title?: string | null
    value?: number | null
    url: string
  }>
  /** Total value of proposals accepted yesterday. */
  proposalsTotalValue?: number
  /** Witty butler closing line. */
  signOff: string
  hubUrl: string
}) {
  const {
    recipientName,
    dateLabel,
    weekRangeLabel,
    executiveSummary,
    recentDebriefs,
    upcomingMeetings,
    teamReminders,
    marketNews,
    taxNews,
    techNews,
    hubUpdates,
    newIntakeForms,
    newFeedback,
    newProposalsAccepted,
    proposalsTotalValue,
    signOff,
    hubUrl,
  } = opts

  // ── Section: Executive summary (AI-written) ────────────────────────────
  const summaryHtml = `
    <div style="background:${BRAND.background};border-left:4px solid ${BRAND.primary};padding:16px 20px;border-radius:6px;margin:0 0 24px;">
      <p style="margin:0 0 8px;color:${BRAND.textMuted};font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">
        From the desk of ALFRED
      </p>
      <div style="color:${BRAND.textPrimary};font-size:14px;line-height:1.65;white-space:pre-wrap;">${escapeBriefingText(
        executiveSummary,
      )}</div>
    </div>`

  // ── Section: Recent debriefs (since last briefing) ─────────────────────
  const debriefsHtml = recentDebriefs.length
    ? `<table style="width:100%;border-collapse:collapse;">
        ${recentDebriefs
          .map(
            (d) => `
              <tr style="border-bottom:1px solid ${BRAND.border};">
                <td style="padding:10px 12px;font-size:14px;vertical-align:top;">
                  <a href="${d.url}" style="color:${BRAND.textPrimary};font-weight:600;text-decoration:none;">${escapeHtml(
                    d.workItemTitle || d.clientName,
                  )}</a>
                  <div style="color:${BRAND.textMuted};font-size:12px;margin-top:2px;">
                    ${escapeHtml(d.clientName)} &middot; submitted by ${escapeHtml(d.authorName)} &middot; ${escapeHtml(d.debriefDate)}
                  </div>
                </td>
                <td style="padding:10px 12px;font-size:12px;color:${BRAND.primary};white-space:nowrap;text-align:right;vertical-align:top;">
                  <a href="${d.url}" style="color:${BRAND.primary};text-decoration:none;font-weight:600;">View &rarr;</a>
                </td>
              </tr>`,
          )
          .join("")}
      </table>`
    : `<p style="color:${BRAND.textMuted};font-size:14px;margin:0;">No debriefs were submitted yesterday — a quiet day on the field.</p>`

  // ── Section: Upcoming meetings ─────────────────────────────────────────
  const meetingsHtml = upcomingMeetings.length
    ? `<table style="width:100%;border-collapse:collapse;">
        ${upcomingMeetings
          .map(
            (m) => `
              <tr style="border-bottom:1px solid ${BRAND.border};">
                <td style="padding:10px 12px;font-size:13px;color:${BRAND.textMuted};white-space:nowrap;vertical-align:top;">${escapeHtml(m.when)}</td>
                <td style="padding:10px 12px;font-size:14px;vertical-align:top;">
                  ${
                    m.url
                      ? `<a href="${m.url}" style="color:${BRAND.textPrimary};font-weight:600;text-decoration:none;">${escapeHtml(m.title)}</a>`
                      : `<span style="font-weight:600;">${escapeHtml(m.title)}</span>`
                  }
                  ${
                    m.hostName || m.with
                      ? `<div style="color:${BRAND.textMuted};font-size:12px;margin-top:2px;">${
                          m.hostName ? `Host: ${escapeHtml(m.hostName)}` : ""
                        }${m.hostName && m.with ? " &middot; " : ""}${m.with ? `with ${escapeHtml(m.with)}` : ""}</div>`
                      : ""
                  }
                </td>
                <td style="padding:10px 12px;font-size:11px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.06em;text-align:right;vertical-align:top;">${escapeHtml(m.source)}</td>
              </tr>`,
          )
          .join("")}
      </table>`
    : `<p style="color:${BRAND.textMuted};font-size:14px;margin:0;">No client meetings on the firm's schedule for the week ahead.</p>`

  // ── Section: Team reminders ────────────────────────────────────────────
  const reminderBadge = (kind: string) => {
    const map: Record<string, { bg: string; fg: string; label: string }> = {
      holiday: { bg: "#FEF3E7", fg: "#A35219", label: "Holiday" },
      tax: { bg: "#EAE6E1", fg: "#5A6250", label: "Tax" },
      tommy: { bg: "#FBE9E9", fg: "#A11F1F", label: "Tommy" },
      firm: { bg: "#EAE6E1", fg: "#5A6250", label: "Firm" },
      other: { bg: "#EAE6E1", fg: "#5A6250", label: "Reminder" },
    }
    const cfg = map[kind] || map.other
    return `<span style="display:inline-block;background:${cfg.bg};color:${cfg.fg};font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 8px;border-radius:10px;">${cfg.label}</span>`
  }

  const remindersHtml = teamReminders.length
    ? `<table style="width:100%;border-collapse:collapse;">
        ${teamReminders
          .map(
            (r) => `
              <tr style="border-bottom:1px solid ${BRAND.border};">
                <td style="padding:10px 12px;font-size:13px;white-space:nowrap;vertical-align:top;width:120px;">
                  <div style="color:${BRAND.textPrimary};font-weight:600;">${escapeHtml(r.relativeLabel)}</div>
                  <div style="color:${BRAND.textMuted};font-size:11px;margin-top:2px;">${escapeHtml(r.dateLabel)}</div>
                </td>
                <td style="padding:10px 12px;font-size:14px;vertical-align:top;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-weight:600;color:${BRAND.textPrimary};">${escapeHtml(r.label)}</span>
                    ${reminderBadge(r.kind)}
                  </div>
                  ${
                    r.notes
                      ? `<div style="color:${BRAND.textMuted};font-size:12px;margin-top:4px;line-height:1.5;">${escapeHtml(r.notes)}</div>`
                      : ""
                  }
                </td>
              </tr>`,
          )
          .join("")}
      </table>`
    : `<p style="color:${BRAND.textMuted};font-size:14px;margin:0;">Nothing on the firm's calendar this week — a rare and welcome lull.</p>`

  // ── Section: News ──────────────────────────────────────────────────────
  const renderNewsList = (items: Array<{ title: string; url: string; source: string }>) =>
    items.length
      ? `<ul style="list-style:none;padding:0;margin:0;">
          ${items
            .map(
              (n) => `
                <li style="padding:8px 0;border-bottom:1px solid ${BRAND.border};">
                  <a href="${n.url}" style="color:${BRAND.textPrimary};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(n.title)}</a>
                  <div style="color:${BRAND.textMuted};font-size:12px;margin-top:2px;">${escapeHtml(n.source)}</div>
                </li>`,
            )
            .join("")}
        </ul>`
      : `<p style="color:${BRAND.textMuted};font-size:13px;margin:0;">No notable headlines surfaced this morning.</p>`

const newsHtml = `
  <div style="display:block;margin-top:8px;">
  <div style="margin:0 0 16px;">
  <h4 style="font-size:13px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;font-weight:700;">Markets</h4>
  ${renderNewsList(marketNews)}
  </div>
  <div style="margin:0 0 16px;">
  <h4 style="font-size:13px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.08em;margin:16px 0 8px;font-weight:700;">Tax &amp; IRS</h4>
  ${renderNewsList(taxNews)}
  </div>
  <div>
  <h4 style="font-size:13px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.08em;margin:16px 0 8px;font-weight:700;">Tech &amp; AI</h4>
  ${renderNewsList(techNews)}
  </div>
  </div>`

  // ── Section: Hub Updates (Appendix) ─────���──────────────────────────────
  const hubUpdatesHtml = hubUpdates && hubUpdates.length > 0
    ? `<table style="width:100%;border-collapse:collapse;">
        ${hubUpdates
          .map(
            (u) => `
              <tr style="border-bottom:1px solid ${BRAND.border};">
                <td style="padding:10px 12px;font-size:13px;color:${BRAND.textMuted};white-space:nowrap;vertical-align:top;width:100px;">${escapeHtml(u.date)}</td>
                <td style="padding:10px 12px;font-size:14px;vertical-align:top;">
                  <a href="${u.url}" style="color:${BRAND.textPrimary};font-weight:600;text-decoration:none;">${escapeHtml(u.message.split("\n")[0])}</a>
                  <div style="color:${BRAND.textMuted};font-size:12px;margin-top:2px;">by ${escapeHtml(u.author)}</div>
                </td>
              </tr>`,
          )
          .join("")}
      </table>`
    : `<p style="color:${BRAND.textMuted};font-size:14px;margin:0;">No updates were shipped yesterday — the Hub rests quietly.</p>`

  // ── Section: Business Metrics (Appendix) ──────���────────────────────────
  const hasBusinessMetrics =
    (newIntakeForms && newIntakeForms.length > 0) ||
    (newFeedback && newFeedback.length > 0) ||
    (newProposalsAccepted && newProposalsAccepted.length > 0)

  const formatCurrency = (val: number | null | undefined) =>
    val != null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(val)
      : ""

  const businessMetricsHtml = hasBusinessMetrics
    ? `<div style="background:${BRAND.background};border-radius:8px;padding:16px 20px;">
        ${newProposalsAccepted && newProposalsAccepted.length > 0
          ? `<div style="margin-bottom:16px;">
              <p style="margin:0 0 8px;color:${BRAND.textPrimary};font-size:14px;font-weight:600;">
                Proposals Accepted ${proposalsTotalValue ? `&mdash; ${formatCurrency(proposalsTotalValue)} total` : ""}
              </p>
              <ul style="margin:0;padding:0 0 0 20px;color:${BRAND.textPrimary};font-size:13px;line-height:1.6;">
                ${newProposalsAccepted.map((p) => `<li style="margin:4px 0;">
                  <a href="${p.url}" style="color:${BRAND.primary};text-decoration:none;font-weight:500;">${escapeHtml(p.clientName)}</a>
                  ${p.title ? ` &mdash; ${escapeHtml(p.title)}` : ""}
                  ${p.value ? ` (${formatCurrency(p.value)})` : ""}
                </li>`).join("")}
              </ul>
            </div>`
          : ""
        }
        ${newIntakeForms && newIntakeForms.length > 0
          ? `<div style="margin-bottom:16px;">
              <p style="margin:0 0 8px;color:${BRAND.textPrimary};font-size:14px;font-weight:600;">
                New Intake Forms (${newIntakeForms.length})
              </p>
              <ul style="margin:0;padding:0 0 0 20px;color:${BRAND.textPrimary};font-size:13px;line-height:1.6;">
                ${newIntakeForms.map((i) => `<li style="margin:4px 0;">
                  <a href="${i.url}" style="color:${BRAND.primary};text-decoration:none;font-weight:500;">${escapeHtml(i.name)}</a>
                  ${i.businessName ? ` (${escapeHtml(i.businessName)})` : ""}
                  ${i.services.length > 0 ? ` &mdash; interested in ${escapeHtml(i.services.slice(0, 2).join(", "))}${i.services.length > 2 ? "..." : ""}` : ""}
                </li>`).join("")}
              </ul>
            </div>`
          : ""
        }
        ${newFeedback && newFeedback.length > 0
          ? `<div>
              <p style="margin:0 0 8px;color:${BRAND.textPrimary};font-size:14px;font-weight:600;">
                New Client Feedback (${newFeedback.length})
              </p>
              <ul style="margin:0;padding:0 0 0 20px;color:${BRAND.textPrimary};font-size:13px;line-height:1.6;">
                ${newFeedback.map((f) => `<li style="margin:4px 0;">
                  <a href="${f.url}" style="color:${BRAND.primary};text-decoration:none;font-weight:500;">${escapeHtml(f.name)}</a>
                  ${f.rating != null ? ` &mdash; rated ${f.rating}/5` : ""}
                  ${f.comment ? ` &ldquo;${escapeHtml(f.comment.slice(0, 60))}${f.comment.length > 60 ? "..." : ""}&rdquo;` : ""}
                </li>`).join("")}
              </ul>
            </div>`
          : ""
        }
      </div>`
    : ""

  // ── Compose ────────────────���───────��───────────────────────────────────
  const sectionHeader = (title: string, subtitle?: string) => `
    <div style="margin:32px 0 12px;">
      <h3 style="font-size:16px;color:${BRAND.textPrimary};margin:0;font-weight:700;letter-spacing:-0.01em;">${escapeHtml(title)}</h3>
      ${subtitle ? `<p style="color:${BRAND.textMuted};font-size:12px;margin:2px 0 0;">${escapeHtml(subtitle)}</p>` : ""}
    </div>`

  const body = `
    <p style="margin:0 0 4px;color:${BRAND.textMuted};font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${escapeHtml(dateLabel)}</p>
    <h2 style="margin:0 0 20px;font-size:22px;color:${BRAND.textPrimary};letter-spacing:-0.01em;">Good morning, ${escapeHtml(recipientName)}.</h2>

    ${summaryHtml}

${sectionHeader("Recent Debriefs")}
  ${debriefsHtml}

    ${sectionHeader("Client Meetings This Week", weekRangeLabel)}
    ${meetingsHtml}

    ${sectionHeader("Team Reminders")}
    ${remindersHtml}

    ${sectionHeader("In the News")}
    ${newsHtml}

    ${(hubUpdates && hubUpdates.length > 0) || hasBusinessMetrics ? `
    <div style="margin:48px 0 0;padding-top:24px;border-top:2px solid ${BRAND.border};">
      <p style="margin:0 0 4px;color:${BRAND.textMuted};font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">Appendix</p>
      ${hasBusinessMetrics ? `
        ${sectionHeader("Recent Wins", "New leads, feedback, and closed deals since last briefing")}
        ${businessMetricsHtml}
      ` : ""}
      ${hubUpdates && hubUpdates.length > 0 ? `
        ${sectionHeader("What's New in the Hub", "Your platform is always improving")}
        ${hubUpdatesHtml}
      ` : ""}
    </div>` : ""}

    <div style="margin:32px 0 8px;text-align:center;">
      <a href="${hubUrl}"
         style="display:inline-block;background:${BRAND.primary};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.02em;">
        Open the Hub
      </a>
    </div>

    <p style="margin:24px 0 0;color:${BRAND.textMuted};font-size:13px;font-style:italic;line-height:1.6;">
      ${escapeHtml(signOff)}
    </p>
    <p style="margin:8px 0 0;color:${BRAND.textPrimary};font-size:13px;font-weight:600;">
      &mdash; ALFRED Ai
    </p>`

  return baseEmailWrapper("Daily Briefing", body)
}

/**
 * Encodes a small set of HTML-significant characters so user-controlled
 * strings (client names, debrief titles, news headlines) can't break the
 * surrounding markup or smuggle inline scripts into the email body.
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Same as escapeHtml but preserves paragraph breaks so the AI-generated
 * butler intro reads as multi-paragraph prose. We rely on the wrapping
 * div's `white-space:pre-wrap` to render the newlines.
 */
function escapeBriefingText(value: string): string {
  // Strip stray markdown emphasis the model occasionally emits despite the
  // "no markdown" instruction — em/asterisks inside an HTML email render
  // literally and look broken.
  const cleaned = value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
  return escapeHtml(cleaned)
}

/**
 * Motta Alliance — new-edition announcement email.
 *
 * Sent by ALFRED Ai when a teammate uploads a new issue of the in-house
 * comic-book series via the Motta Alliance page. Visually matches the
 * Tommy Recap and Daily Briefing emails (same shared wrapper, same
 * "From ALFRED Ai" callout banner) so the firm's broadcast emails read
 * as one consistent voice. The actual PDF is delivered as a real Resend
 * attachment by the caller — this template just builds the HTML body.
 *
 * Inputs:
 *   - issueLabel:   "Issue 3", "Vol. 2", etc. Shown as a small eyebrow.
 *   - title / arc:  Headline + optional arc subtitle (e.g. "Taxverse 2026").
 *   - tagline:      The comic's own one-liner from the cover.
 *   - characters:   Featured cast — rendered as chips under the summary.
 *   - aiSummary:    Claude's plain-text story-arc preview. Rendered with
 *                   paragraph-aware <br>'s so multi-paragraph narration
 *                   doesn't collapse into a single wall of text in Outlook.
 *   - submittedBy:  Display name of the teammate who shipped the issue.
 *   - galleryUrl:   Deep link back to the Motta Alliance page.
 *   - pdfUrl:       Public Blob URL — used for the "Read in browser" CTA
 *                   when the recipient prefers viewing in a tab over the
 *                   attached PDF.
 *   - pdfFilename:  Visible filename of the attachment (e.g.
 *                   "Motta-Alliance--issue-3-foo.pdf") — used in the
 *                   "Attached:" footer so the email body and the actual
 *                   Resend attachment line up.
 */
export function buildMottaAllianceIssueHtml(opts: {
  issueLabel: string
  title: string
  arc?: string | null
  tagline?: string | null
  characters?: string[]
  aiSummary: string
  submittedBy?: string | null
  galleryUrl: string
  pdfUrl: string
  pdfFilename: string
}) {
  // Comic-book palette — matches the in-app /motta-alliance page and
  // the printed-cover art in /lib/motta-alliance/hero-profiles.ts.
  // Inlined here (rather than reusing BRAND from the rest of the file)
  // because this is the ONE email template that has to feel like a
  // comic-book splash instead of a corporate notification.
  const COMIC = {
    inkBlack: "#0A0E08",
    panelBlack: "#0F140C",
    panelEdge: "#1F2A1B",
    cream: "#F4EFE8",
    paper: "#D5D0C8",
    mute: "#9B968D",
    allianceGreen: "#A8C566",
    allianceGreenDark: "#6B8E3D",
    amber: "#E6A85C",
    border: "rgba(168,197,102,0.35)",
  }

  const summaryHtml = formatNotesForEmail(opts.aiSummary)
  const characterChips =
    (opts.characters || []).length > 0
      ? `<div style="margin:18px 0 0;">
          ${(opts.characters || [])
            .map(
              (c) =>
                `<span style="display:inline-block;background:rgba(168,197,102,0.10);color:${COMIC.allianceGreen};font-size:11px;font-weight:700;padding:5px 11px;border-radius:3px;margin:0 6px 6px 0;border:1px solid ${COMIC.border};letter-spacing:0.04em;text-transform:uppercase;">${c}</span>`,
            )
            .join("")}
        </div>`
      : ""

  // Cover splash — the full-bleed banner at the top of the email body
  // that visually echoes a comic-book splash page. Uses bold uppercase
  // italic display type with a heavy text-shadow so it survives the
  // Outlook / Gmail / Apple Mail render path (no @font-face required).
  const splash = `
    <div style="position:relative;background:${COMIC.panelBlack};border:1px solid ${COMIC.border};border-radius:10px;overflow:hidden;margin:0 0 28px;">
      <div style="background:linear-gradient(135deg, rgba(168,197,102,0.18) 0%, transparent 55%), linear-gradient(315deg, rgba(230,168,92,0.10) 0%, transparent 55%);padding:34px 28px;text-align:center;">
        <div style="display:inline-block;border:1px solid ${COMIC.allianceGreen};color:${COMIC.allianceGreen};font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;padding:5px 12px;border-radius:3px;margin-bottom:14px;">
          Motta Financial Alliance &middot; New Edition
        </div>
        <div style="color:${COMIC.paper};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;margin:0 0 8px;">
          ${opts.issueLabel}${opts.arc ? ` &middot; ${opts.arc}` : ""}
        </div>
        <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:34px;font-weight:900;font-style:italic;line-height:0.95;letter-spacing:-0.01em;color:${COMIC.cream};text-transform:uppercase;text-shadow:0 2px 0 rgba(0,0,0,0.6), 0 0 24px rgba(168,197,102,0.25);">
          ${opts.title}
        </h1>
        ${
          opts.tagline
            ? `<p style="margin:14px 0 0;font-size:13px;font-style:italic;color:${COMIC.paper};line-height:1.5;max-width:480px;margin-left:auto;margin-right:auto;">&ldquo;${opts.tagline}&rdquo;</p>`
            : ""
        }
      </div>
    </div>
  `

  const body = `
    ${splash}

    <div style="background:${COMIC.panelBlack};border:1px solid ${COMIC.border};border-left:4px solid ${COMIC.allianceGreen};padding:20px 22px;border-radius:8px;margin:0 0 26px;">
      <div style="font-size:11px;font-weight:700;color:${COMIC.allianceGreen};text-transform:uppercase;letter-spacing:0.2em;margin-bottom:10px;">
        From ALFRED Ai &middot; Story Preview
      </div>
      <div style="font-size:15px;color:${COMIC.cream};line-height:1.7;">${summaryHtml}</div>
      ${characterChips}
    </div>

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${opts.pdfUrl}"
         style="display:inline-block;background:${COMIC.allianceGreen};color:${COMIC.inkBlack};padding:13px 30px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;margin:0 4px 8px;">
        Read the Full Issue
      </a>
      <a href="${opts.galleryUrl}"
         style="display:inline-block;background:transparent;color:${COMIC.allianceGreen};padding:12px 29px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;border:1px solid ${COMIC.allianceGreen};margin:0 4px 8px;">
        Open the Vault
      </a>
    </div>

    <p style="margin:22px 0 0;color:${COMIC.mute};font-size:12px;text-align:center;line-height:1.6;">
      Attached: <strong style="color:${COMIC.paper};">${opts.pdfFilename}</strong>
      ${opts.submittedBy ? `<br>Issued by ${opts.submittedBy}.` : ""}
    </p>
  `

  return baseComicEmailWrapper(
    `${opts.issueLabel}: ${opts.title}`,
    body,
    "A new edition of the Motta Alliance — sent by ALFRED Ai via MOTTA HUB.",
  )
}

/**
 * Comic-book-themed variant of the standard email wrapper. Used only
 * for Motta Alliance edition announcements so the rest of the firm's
 * transactional email stays clean and professional. Dark ink-black
 * background, alliance-green header rule, lotus-cream body card.
 */
function baseComicEmailWrapper(headerTitle: string, bodyHtml: string, footerNote?: string) {
  return `<!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0A0E08;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
  <div style="background:#0F140C;border-radius:14px;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);border:1px solid rgba(168,197,102,0.25);">
  <div style="background:#0A0E08;padding:24px 32px;border-bottom:2px solid #A8C566;">
  <div style="color:#A8C566;font-size:10px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;margin-bottom:8px;">
  Motta Hub &middot; The Alliance
  </div>
  <h1 style="color:#F4EFE8;font-size:22px;margin:0;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-0.005em;line-height:1.1;text-shadow:0 1px 0 rgba(0,0,0,0.6);">${headerTitle}</h1>
  </div>
  <div style="padding:32px;color:#F4EFE8;font-size:15px;line-height:1.6;">${bodyHtml}</div>
  <div style="background:#0A0E08;padding:18px 32px;border-top:1px solid rgba(168,197,102,0.20);">
  <p style="font-size:11px;color:#9B968D;margin:0;text-align:center;letter-spacing:0.05em;">
  ${footerNote || "This is an automated notification from MOTTA HUB. Manage your email preferences in settings."}
  </p>
  </div>
  </div>
  </div>
  </body>
  </html>`
}

/**
 * Broadcast / announcement email sent from the admin tool.
 * `bodyHtml` is the rich message body — already-rendered HTML.
 */
export function buildBroadcastHtml(opts: {
  subject: string
  bodyHtml: string
  fromName: string
}) {
  const body = `<div style="margin-bottom:24px;color:#666;font-size:13px;">From: ${opts.fromName}</div>
    <div style="font-size:15px;color:#1a1a1a;">${opts.bodyHtml}</div>`
  return baseEmailWrapper(opts.subject, body, `Sent by ${opts.fromName} via MOTTA HUB.`)
}

/**
 * Firm-wide announcement ("BREAKING NEWS") email, authored by ALFRED Ai.
 *
 * Four clearly-separated sections with real visual breaks:
 *   TOPIC        — the headline / subject of the announcement
 *   ANNOUNCEMENT — the body (multi-paragraph aware via formatNotesForEmail)
 *   ACTION ITEMS — optional follow-ups (also multi-paragraph aware)
 *   ATTACHMENTS  — optional file links
 *
 * The email "from" identity is controlled by FROM_EMAIL ("ALFRED Ai <…>"),
 * so the message always appears to come from ALFRED. The subject line is
 * built by the caller as "BREAKING NEWS: <Topic>".
 */
export function buildAnnouncementHtml(opts: {
  topic: string
  announcement: string
  actionItems?: string | null
  attachments?: Array<{ url: string; name: string; size_bytes?: number }> | null
  fromName?: string | null
}) {
  const topicHtml = formatNotesForEmail(opts.topic) || "Firm Announcement"
  const announcementHtml = formatNotesForEmail(opts.announcement)
  const actionItemsHtml = formatNotesForEmail(opts.actionItems)
  const authoredBy = opts.fromName ? opts.fromName : "ALFRED Ai"
  const attachments = opts.attachments || []

  const sections: string[] = []

  // BREAKING NEWS banner
  sections.push(`
    <div style="display:inline-block;background:${BRAND.accent};color:#fff;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:6px 14px;border-radius:6px;margin-bottom:20px;">
      Breaking News
    </div>
  `)

  // TOPIC
  sections.push(`
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.textMuted};margin-bottom:6px;">Topic</div>
      <div style="font-size:20px;font-weight:700;color:${BRAND.textPrimary};line-height:1.35;">${topicHtml}</div>
    </div>
  `)

  // ANNOUNCEMENT
  sections.push(`
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.textMuted};margin-bottom:8px;">Announcement</div>
      <div style="background:#f9fafb;border:1px solid ${BRAND.border};border-radius:8px;padding:16px 18px;font-size:15px;color:${BRAND.textPrimary};line-height:1.6;">${announcementHtml || "<em style='color:#999;'>No details provided.</em>"}</div>
    </div>
  `)

  // ACTION ITEMS (optional)
  if (actionItemsHtml) {
    sections.push(`
      <div style="margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.textMuted};margin-bottom:8px;">Action Items</div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px 18px;font-size:15px;color:#92400e;line-height:1.6;">${actionItemsHtml}</div>
      </div>
    `)
  }

  // ATTACHMENTS (optional)
  if (attachments.length > 0) {
    const formatBytes = (b?: number) => {
      if (!b) return ""
      if (b < 1024) return ` (${b} B)`
      if (b < 1024 * 1024) return ` (${(b / 1024).toFixed(1)} KB)`
      return ` (${(b / (1024 * 1024)).toFixed(1)} MB)`
    }
    const attachmentLinks = attachments
      .map(
        (a) =>
          `<a href="${a.url}" style="color:#2563EB;text-decoration:none;display:block;margin-bottom:6px;">📎 ${a.name}${formatBytes(a.size_bytes)}</a>`,
      )
      .join("")
    sections.push(`
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.textMuted};margin-bottom:8px;">Attachments</div>
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.7;">${attachmentLinks}</div>
      </div>
    `)
  }

  return baseEmailWrapper(
    `BREAKING NEWS`,
    sections.join(""),
    `Firm announcement delivered by ${authoredBy} via MOTTA HUB.`,
  )
}

/**
 * Password-reset / invite email. Used by both the self-service "Forgot
 * password?" flow on the login screen and the admin "Send Password Reset"
 * action in User Auth Manager.
 *
 * `actionUrl` should be a /auth/confirm?token_hash=...&type=recovery URL
 * generated server-side via supabase.auth.admin.generateLink().
 */
export function buildPasswordResetEmailHtml(opts: {
  recipientName?: string
  actionUrl: string
  mode: "reset" | "invite"
  expiresInHours?: number
}) {
  const { recipientName, actionUrl, mode, expiresInHours = 1 } = opts
  const isInvite = mode === "invite"
  const headline = isInvite ? "Welcome to Motta Hub" : "Reset your password"
  const ctaLabel = isInvite ? "Set Up Your Password" : "Reset My Password"
  const intro = isInvite
    ? `You've been invited to join Motta Hub. Click the button below to set a password and access the portal.`
    : `We received a request to reset the password on your Motta Hub account. Click the button below to choose a new one.`
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,"

  const body = `
    <p style="margin:0 0 16px;color:${BRAND.textPrimary};">${greeting}</p>
    <p style="margin:0 0 20px;color:${BRAND.textPrimary};line-height:1.6;">${intro}</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${actionUrl}"
         style="display:inline-block;background:${BRAND.primary};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0.02em;">
        ${ctaLabel}
      </a>
    </div>
    <p style="margin:0 0 12px;color:${BRAND.textMuted};font-size:13px;line-height:1.6;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 24px;font-size:12px;word-break:break-all;">
      <a href="${actionUrl}" style="color:${BRAND.primary};">${actionUrl}</a>
    </p>
    <div style="border-top:1px solid ${BRAND.border};padding-top:16px;margin-top:24px;">
      <p style="margin:0 0 8px;color:${BRAND.textMuted};font-size:12px;line-height:1.5;">
        <strong>This link will expire in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}</strong> for your security.
      </p>
      ${
        isInvite
          ? ""
          : `<p style="margin:0;color:${BRAND.textMuted};font-size:12px;line-height:1.5;">
              If you didn't request a password reset, you can safely ignore this email — your password won't change.
            </p>`
      }
    </div>
  `
  return baseEmailWrapper(
    headline,
    body,
    isInvite
      ? "You're receiving this because someone at Motta Financial invited you to Motta Hub."
      : "This email was sent to confirm a password reset on your Motta Hub account.",
  )
}
