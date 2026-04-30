// Client-safe email HTML preview helpers.
// These are duplicates of the templates in lib/email.ts but free of server-only
// imports, so they can be used inside React client components for live preview.

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

export function buildBroadcastHtml(opts: {
  subject: string
  bodyHtml: string
  fromName: string
}) {
  const body = `<div style="margin-bottom:24px;color:#666;font-size:13px;">From: ${opts.fromName}</div>
    <div style="font-size:15px;color:#1a1a1a;">${opts.bodyHtml}</div>`
  return baseEmailWrapper(opts.subject, body, `Sent by ${opts.fromName} via MOTTA HUB.`)
}
