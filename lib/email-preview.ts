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

// Brand palette (mirror of lib/email.ts BRAND, inlined to keep this file
// free of server-only imports).
const PREVIEW_BRAND = {
  accent: "#C97B3F",
  border: "#D8D3CB",
  textPrimary: "#1F2520",
  textMuted: "#6B7066",
}

// Plain-text -> safe HTML with paragraph-aware breaks. Mirror of
// formatNotesForEmail() in lib/email.ts so the live preview matches the
// real send exactly.
function formatNotesForEmailPreview(notes?: string | null): string {
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
  return trimmed
    .split(/\n{2,}/)
    .map((p) => escapeHtml(p).replace(/\n/g, "<br>"))
    .join("<br><br>")
}

/**
 * Firm-wide announcement ("BREAKING NEWS") preview. Mirror of
 * buildAnnouncementHtml() in lib/email.ts.
 */
export function buildAnnouncementHtml(opts: {
  topic: string
  announcement: string
  actionItems?: string | null
  attachments?: Array<{ url: string; name: string; size_bytes?: number }> | null
  fromName?: string | null
}) {
  const topicHtml = formatNotesForEmailPreview(opts.topic) || "Firm Announcement"
  const announcementHtml = formatNotesForEmailPreview(opts.announcement)
  const actionItemsHtml = formatNotesForEmailPreview(opts.actionItems)
  const authoredBy = opts.fromName ? opts.fromName : "ALFRED Ai"
  const attachments = opts.attachments || []

  const sections: string[] = []

  sections.push(`
    <div style="display:inline-block;background:${PREVIEW_BRAND.accent};color:#fff;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:6px 14px;border-radius:6px;margin-bottom:20px;">
      Breaking News
    </div>
  `)

  sections.push(`
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${PREVIEW_BRAND.textMuted};margin-bottom:6px;">Topic</div>
      <div style="font-size:20px;font-weight:700;color:${PREVIEW_BRAND.textPrimary};line-height:1.35;">${topicHtml}</div>
    </div>
  `)

  sections.push(`
    <div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${PREVIEW_BRAND.textMuted};margin-bottom:8px;">Announcement</div>
      <div style="background:#f9fafb;border:1px solid ${PREVIEW_BRAND.border};border-radius:8px;padding:16px 18px;font-size:15px;color:${PREVIEW_BRAND.textPrimary};line-height:1.6;">${announcementHtml || "<em style='color:#999;'>Your announcement will appear here</em>"}</div>
    </div>
  `)

  if (actionItemsHtml) {
    sections.push(`
      <div style="margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${PREVIEW_BRAND.textMuted};margin-bottom:8px;">Action Items</div>
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
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${PREVIEW_BRAND.textMuted};margin-bottom:8px;">Attachments</div>
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
