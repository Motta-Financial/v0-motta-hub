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
