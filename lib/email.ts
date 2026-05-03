const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "ALFRED Ai <Info@mottafinancial.com>"

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

// Debrief notification email template
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
  debriefUrl: string
  logoUrl?: string
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_BASE_URL || "https://mottahub-motta.vercel.app"
  const resolvedLogoUrl = logoUrl || `${siteUrl}/images/alfred-logo.png`

  const actionItemsHtml =
    actionItems && actionItems.length > 0
      ? `
    <div style="margin-top: 24px;">
      <h3 style="color: ${BRAND.textPrimary}; font-size: 15px; margin: 0 0 12px; font-weight: 600; letter-spacing: 0.02em;">ACTION ITEMS</h3>
      <table style="width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid ${BRAND.border}; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: ${BRAND.background};">
            <th style="text-align: left; padding: 10px 12px; font-size: 12px; color: ${BRAND.textMuted}; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">Description</th>
            <th style="text-align: left; padding: 10px 12px; font-size: 12px; color: ${BRAND.textMuted}; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">Assignee</th>
            <th style="text-align: left; padding: 10px 12px; font-size: 12px; color: ${BRAND.textMuted}; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">Due</th>
            <th style="text-align: left; padding: 10px 12px; font-size: 12px; color: ${BRAND.textMuted}; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">Priority</th>
          </tr>
        </thead>
        <tbody>
          ${actionItems
            .map(
              (item, idx) => `
            <tr style="${idx > 0 ? `border-top: 1px solid ${BRAND.border};` : ""}">
              <td style="padding: 12px; font-size: 14px; color: ${BRAND.textPrimary}; border-top: ${idx > 0 ? `1px solid ${BRAND.border}` : "none"};">${item.description}</td>
              <td style="padding: 12px; font-size: 14px; color: ${BRAND.textPrimary}; border-top: ${idx > 0 ? `1px solid ${BRAND.border}` : "none"};">${item.assignee_name || "-"}</td>
              <td style="padding: 12px; font-size: 14px; color: ${BRAND.textPrimary}; border-top: ${idx > 0 ? `1px solid ${BRAND.border}` : "none"};">${item.due_date || "-"}</td>
              <td style="padding: 12px; font-size: 14px; border-top: ${idx > 0 ? `1px solid ${BRAND.border}` : "none"};">
                <span style="
                  display: inline-block;
                  padding: 3px 10px;
                  border-radius: 999px;
                  font-size: 11px;
                  font-weight: 600;
                  letter-spacing: 0.04em;
                  text-transform: uppercase;
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
    <div style="margin-top: 20px;">
      <h3 style="color: ${BRAND.textPrimary}; font-size: 15px; margin: 0 0 8px; font-weight: 600; letter-spacing: 0.02em;">RELATED SERVICES</h3>
      <p style="font-size: 14px; color: ${BRAND.textPrimary}; margin: 0; line-height: 1.5;">${services.join(", ")}</p>
    </div>
  `
      : ""

  const notesHtml = notes
    ? `
    <div style="margin-top: 20px;">
      <h3 style="color: ${BRAND.textPrimary}; font-size: 15px; margin: 0 0 8px; font-weight: 600; letter-spacing: 0.02em;">NOTES</h3>
      <div style="background: ${BRAND.background}; border-left: 3px solid ${BRAND.primary}; border-radius: 6px; padding: 14px 16px; font-size: 14px; color: ${BRAND.textPrimary}; white-space: pre-wrap; line-height: 1.5;">${notes}</div>
    </div>
  `
    : ""

  const feeHtml = feeAdjustment
    ? `
    <div style="margin-top: 20px;">
      <h3 style="color: ${BRAND.textPrimary}; font-size: 15px; margin: 0 0 8px; font-weight: 600; letter-spacing: 0.02em;">FEE ADJUSTMENTS</h3>
      <p style="font-size: 14px; color: ${BRAND.textPrimary}; margin: 0; line-height: 1.5;">${feeAdjustment}</p>
    </div>
  `
    : ""

  const researchHtml = researchTopics
    ? `
    <div style="margin-top: 20px;">
      <h3 style="color: ${BRAND.textPrimary}; font-size: 15px; margin: 0 0 8px; font-weight: 600; letter-spacing: 0.02em;">RESEARCH TOPICS</h3>
      <p style="font-size: 14px; color: ${BRAND.textPrimary}; margin: 0; line-height: 1.5;">${researchTopics}</p>
    </div>
  `
    : ""

  const workItemHtml = workItemTitle
    ? `
    <div style="margin-top: 16px; display: inline-block; background: ${BRAND.background}; border: 1px solid ${BRAND.border}; border-radius: 6px; padding: 6px 12px;">
      <span style="font-size: 11px; color: ${BRAND.textMuted}; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; margin-right: 6px;">Work Item</span>
      <span style="font-size: 13px; color: ${BRAND.textPrimary}; font-weight: 500;">${workItemTitle}</span>
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
  <div style="max-width: 640px; margin: 0 auto; padding: 24px 16px;">
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
      <div style="padding: 28px;">
        <h1 style="color: ${BRAND.textPrimary}; font-size: 22px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.01em;">New Debrief Submitted</h1>
        <p style="color: ${BRAND.textMuted}; font-size: 13px; margin: 0 0 18px;">${debriefDate}</p>

        <div style="background: ${BRAND.background}; border-radius: 8px; padding: 14px 16px; border-left: 3px solid ${BRAND.primary};">
          <p style="font-size: 14px; color: ${BRAND.textPrimary}; margin: 0; line-height: 1.5;">
            <strong style="color: ${BRAND.primaryDark};">${authorName}</strong> submitted a debrief for <strong style="color: ${BRAND.primaryDark};">${clientName}</strong>.
          </p>
        </div>

        ${workItemHtml}
        ${notesHtml}
        ${actionItemsHtml}
        ${servicesHtml}
        ${feeHtml}
        ${researchHtml}

        <!-- CTA -->
        <div style="margin-top: 32px; text-align: center;">
          <a href="${debriefUrl}" style="
            display: inline-block;
            background: ${BRAND.primary};
            color: ${BRAND.surface};
            padding: 12px 28px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.02em;
          ">View Debrief in Motta Hub &rarr;</a>
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
