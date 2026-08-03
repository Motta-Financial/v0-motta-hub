import { formatAmount, intervalSuffix, type PaymentRequest } from "./types"

/**
 * Branded HTML for the "please pay" email sent to a client. Palette matches
 * the Hub transactional emails in lib/email.ts (olive/cream). No third-party
 * tool names are referenced (welcome-page rule).
 */
const BRAND = {
  primary: "#6B745D",
  primaryDark: "#5A6250",
  background: "#EAE6E1",
  surface: "#FFFFFF",
  textPrimary: "#1F2520",
  textMuted: "#6B7066",
  border: "#D8D3CB",
}

export function buildPayLinkEmailHtml(opts: {
  req: PaymentRequest
  payUrl: string
  firmName?: string
}): string {
  const { req, payUrl, firmName = "Motta Financial" } = opts
  const amount = formatAmount(req.amount_cents, req.currency)
  const cadence = req.billing_type === "recurring" ? intervalSuffix(req.recurring_interval) : ""
  const greetingName = req.recipient_name ? `Hi ${escapeHtml(req.recipient_name)},` : "Hello,"
  const memoBlock = req.memo
    ? `<p style="margin:0 0 16px;color:${BRAND.textMuted};font-size:14px;line-height:1.6">${escapeHtml(
        req.memo,
      )}</p>`
    : ""

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${BRAND.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.background};padding:32px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden">
        <tr><td style="background:${BRAND.primary};padding:20px 28px">
          <span style="color:#fff;font-size:18px;font-weight:600;letter-spacing:.2px">${escapeHtml(firmName)}</span>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 16px;color:${BRAND.textPrimary};font-size:16px">${greetingName}</p>
          <p style="margin:0 0 20px;color:${BRAND.textPrimary};font-size:15px;line-height:1.6">
            Here is your secure payment link for <strong>${escapeHtml(req.package_name)}</strong>.
          </p>
          ${memoBlock}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;width:100%;background:${BRAND.background};border-radius:10px">
            <tr><td style="padding:18px 20px">
              <span style="color:${BRAND.textMuted};font-size:13px;text-transform:uppercase;letter-spacing:.4px">Amount due</span><br/>
              <span style="color:${BRAND.textPrimary};font-size:28px;font-weight:700">${amount}<span style="font-size:15px;font-weight:500;color:${BRAND.textMuted}">${cadence}</span></span>
            </td></tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%"><tr><td align="center">
            <a href="${payUrl}" style="display:inline-block;background:${BRAND.primary};color:#fff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 32px;border-radius:8px">Pay securely</a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:${BRAND.textMuted};font-size:13px;line-height:1.6">
            Or paste this link into your browser:<br/>
            <a href="${payUrl}" style="color:${BRAND.primaryDark};word-break:break-all">${payUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid ${BRAND.border}">
          <p style="margin:0;color:${BRAND.textMuted};font-size:12px;line-height:1.5">
            Payments are processed securely. If you weren&apos;t expecting this email, you can safely ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function buildPayLinkEmailSubject(req: PaymentRequest): string {
  return `Payment request: ${req.package_name}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
