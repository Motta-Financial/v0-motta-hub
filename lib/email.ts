import { createAdminClient } from "@/lib/supabase/server"

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "ALFRED Ai <Info@mottafinancial.com>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"

// All email categories users can opt in/out of.
// Each `notification_type` value emitted via /api/notifications/send is mapped
// onto one of these categories by mapNotificationTypeToCategory().
export const EMAIL_CATEGORIES = {
  action_item: { label: "Action Items", description: "When you're assigned an action item or task" },
  mention: { label: "Mentions", description: "When someone @mentions you in a comment, message, or note" },
  debrief: { label: "Debriefs", description: "When a debrief is submitted that involves you" },
  work_item: { label: "Work Items", description: "When a Karbon work item is assigned to you or its status changes" },
  tommy_reminder: { label: "Tommy Awards Reminder", description: "Weekly Friday reminder to submit your Tommy Awards ballot" },
  meeting_summary: { label: "Meeting Summary", description: "Daily / weekly digest of upcoming and recent Calendly & Zoom meetings" },
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
  if (t.includes("debrief")) return "debrief"
  if (t.includes("work_item") || t.includes("workitem") || t === "assignment") return "work_item"
  if (t.includes("tommy")) return "tommy_reminder"
  if (t.includes("meeting") || t.includes("calendly") || t.includes("zoom")) return "meeting_summary"
  if (t.includes("broadcast") || t.includes("announcement")) return "broadcast"
  return "general"
}

interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
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

export async function sendEmail({ to, subject, html, replyTo }: SendEmailParams) {
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

// Debrief notification email template
export function buildDebriefEmailHtml({
  authorName,
  clientName,
  debriefDate,
  notes,
  actionItems,
  services,
  researchTopics,
  feeAdjustment,
  debriefUrl,
}: {
  authorName: string
  clientName: string
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
  debriefUrl: string
}) {
  const actionItemsHtml =
    actionItems && actionItems.length > 0
      ? `
    <div style="margin-top: 20px;">
      <h3 style="color: #1a1a1a; font-size: 16px; margin-bottom: 12px;">Action Items</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="text-align: left; padding: 8px 12px; font-size: 13px; color: #666;">Description</th>
            <th style="text-align: left; padding: 8px 12px; font-size: 13px; color: #666;">Assignee</th>
            <th style="text-align: left; padding: 8px 12px; font-size: 13px; color: #666;">Due</th>
            <th style="text-align: left; padding: 8px 12px; font-size: 13px; color: #666;">Priority</th>
          </tr>
        </thead>
        <tbody>
          ${actionItems
            .map(
              (item) => `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 8px 12px; font-size: 14px;">${item.description}</td>
              <td style="padding: 8px 12px; font-size: 14px;">${item.assignee_name || "-"}</td>
              <td style="padding: 8px 12px; font-size: 14px;">${item.due_date || "-"}</td>
              <td style="padding: 8px 12px; font-size: 14px;">
                <span style="
                  display: inline-block;
                  padding: 2px 8px;
                  border-radius: 4px;
                  font-size: 12px;
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
      : ""

  const servicesHtml =
    services && services.length > 0
      ? `
    <div style="margin-top: 16px;">
      <h3 style="color: #1a1a1a; font-size: 16px; margin-bottom: 8px;">Related Services</h3>
      <p style="font-size: 14px; color: #333;">${services.join(", ")}</p>
    </div>
  `
      : ""

  const notesHtml = notes
    ? `
    <div style="margin-top: 16px;">
      <h3 style="color: #1a1a1a; font-size: 16px; margin-bottom: 8px;">Notes</h3>
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; font-size: 14px; color: #333; white-space: pre-wrap;">${notes}</div>
    </div>
  `
    : ""

  const feeHtml = feeAdjustment
    ? `
    <div style="margin-top: 16px;">
      <h3 style="color: #1a1a1a; font-size: 16px; margin-bottom: 8px;">Fee Adjustments</h3>
      <p style="font-size: 14px; color: #333;">${feeAdjustment}</p>
    </div>
  `
    : ""

  const researchHtml = researchTopics
    ? `
    <div style="margin-top: 16px;">
      <h3 style="color: #1a1a1a; font-size: 16px; margin-bottom: 8px;">Research Topics</h3>
      <p style="font-size: 14px; color: #333;">${researchTopics}</p>
    </div>
  `
    : ""

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
  <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
    <div style="background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <!-- Header -->
      <div style="background: #1a1a1a; padding: 24px 32px;">
        <h1 style="color: #fff; font-size: 20px; margin: 0;">New Debrief Submitted</h1>
        <p style="color: #a3a3a3; font-size: 14px; margin: 8px 0 0;">MOTTA HUB</p>
      </div>

      <!-- Body -->
      <div style="padding: 32px;">
        <div style="margin-bottom: 24px;">
          <p style="font-size: 15px; color: #333; margin: 0;">
            <strong>${authorName}</strong> submitted a debrief for <strong>${clientName}</strong> on ${debriefDate}.
          </p>
        </div>

        ${notesHtml}
        ${actionItemsHtml}
        ${servicesHtml}
        ${feeHtml}
        ${researchHtml}

        <!-- CTA -->
        <div style="margin-top: 28px; text-align: center;">
          <a href="${debriefUrl}" style="
            display: inline-block;
            background: #1a1a1a;
            color: #fff;
            padding: 12px 32px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 14px;
            font-weight: 600;
          ">View Debrief in MOTTA HUB</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="background: #f9fafb; padding: 16px 32px; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #999; margin: 0; text-align: center;">
          This is an automated notification from MOTTA HUB. Do not reply to this email.
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

interface RecipientResolution {
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
}): Promise<{ attempted: number; sent: number; skipped: number }> {
  const recipients = await resolveRecipientsForCategory(opts.teamMemberIds, opts.category)
  const attempted = opts.teamMemberIds.length
  if (recipients.length === 0) {
    return { attempted, sent: 0, skipped: attempted }
  }

  const result = await sendEmail({
    to: recipients.map((r) => r.email),
    subject: opts.subject,
    html: opts.html,
    replyTo: opts.replyTo,
  })

  return {
    attempted,
    sent: result.success ? recipients.length : 0,
    skipped: attempted - (result.success ? recipients.length : 0),
  }
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
 * Tommy Awards weekly Friday ballot reminder.
 */
export function buildTommyReminderHtml(opts: {
  recipientName: string
  weekLabel: string
  ballotUrl: string
}) {
  const body = `<p style="margin:0 0 16px;">Hi ${opts.recipientName},</p>
    <p style="margin:0 0 16px;">It's Tommy Awards day! Take a moment to recognize the teammates who best represented Tom Brady this week — going the extra mile, client wins, and being a great teammate.</p>
    <div style="background:#f9fafb;border-left:4px solid #c62828;padding:12px 16px;border-radius:4px;margin:0 0 20px;">
      <strong>Voting for: ${opts.weekLabel}</strong>
    </div>
    <div style="text-align:center;">
      <a href="${opts.ballotUrl}"
         style="display:inline-block;background:#c62828;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">
        Submit Your Ballot
      </a>
    </div>`
  return baseEmailWrapper("Tommy Awards — Cast Your Vote", body)
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
