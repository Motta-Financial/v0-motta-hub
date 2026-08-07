/**
 * Client-facing intake confirmation — the email the PROSPECT gets.
 *
 * Until now `/api/public/intake` sent nothing at all to the person who
 * filled in the form; the only email was the internal team alert in
 * `lib/jotform/notify.ts`. The prospect saw a "we'll be in touch"
 * screen and then heard nothing until a teammate got round to them.
 *
 * This is the second half of the booking step: the wizard offers the
 * Calendly link immediately, and this email carries the SAME link so a
 * prospect who closed the tab, or who submitted from a phone mid-task,
 * can still book without waiting for a human.
 *
 * Deliberately NOT routed through `sendCategoryEmail` — that helper
 * resolves recipients against `team_members` and honors per-teammate
 * category opt-outs, neither of which applies to an external prospect.
 * We call `sendEmail` directly with a single address.
 *
 * Dedupe lives on the row: callers must check
 * `prospect_confirmation_sent_at IS NULL` before invoking, mirroring
 * how `notified_at` guards the team email.
 */

import { sendEmail } from "@/lib/email"
import { getFirmConfig } from "@/lib/firm-settings"

// Same palette as lib/jotform/notify.ts and lib/email.ts so the
// prospect's first email from the firm looks like every later one.
const BRAND = {
  primary: "#6B745D",
  primaryDark: "#5A6250",
  surface: "#FFFFFF",
  background: "#EAE6E1",
  textPrimary: "#1F2520",
  textMuted: "#6B7066",
  border: "#D8D3CB",
} as const

export interface ProspectConfirmationContext {
  firstName: string | null
  email: string
  /** Prefilled Calendly URL from `resolveDiscoveryBookingUrl`. */
  bookingUrl: string
  /** Set when we routed to a specific teammate's calendar. */
  hostName: string | null
  /** Echoed back so they can see we captured it correctly. */
  serviceFocus: string | null
}

function escapeHtml(input: string | null | undefined): string {
  if (!input) return ""
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function buildProspectConfirmationHtml(
  ctx: ProspectConfirmationContext,
  firm: { name: string; supportEmail: string; publicSiteUrl: string },
): string {
  const greeting = ctx.firstName ? `Hi ${escapeHtml(ctx.firstName)},` : "Hi there,"

  // When the prospect asked for someone specific, say so — it confirms
  // we read the form and makes the calendar they land on make sense.
  const hostLine = ctx.hostName
    ? `You asked to speak with <strong>${escapeHtml(ctx.hostName)}</strong>, so the link below goes straight to their calendar.`
    : `Pick any time that works — the link below shows live availability across our team.`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Book your discovery call</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${BRAND.background};">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background:${BRAND.surface};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);border:1px solid ${BRAND.border};">
      <div style="background:${BRAND.primary};padding:20px 28px;">
        <div style="color:${BRAND.surface};font-size:18px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(firm.name.toUpperCase())}</div>
      </div>

      <div style="padding:32px 28px;">
        <h1 style="color:${BRAND.textPrimary};font-size:22px;margin:0 0 16px;font-weight:700;letter-spacing:-0.01em;">
          Thanks — we've got your information
        </h1>

        <p style="color:${BRAND.textPrimary};font-size:15px;line-height:1.6;margin:0 0 16px;">${greeting}</p>

        <p style="color:${BRAND.textPrimary};font-size:15px;line-height:1.6;margin:0 0 16px;">
          Thanks for reaching out to ${escapeHtml(firm.name)}. The next step is a
          30-minute discovery call over Zoom — no charge, no obligation. We'll
          talk through where things stand${ctx.serviceFocus ? ` with your ${escapeHtml(ctx.serviceFocus.toLowerCase())} situation` : ""},
          answer your questions, and tell you plainly whether we're the right fit.
        </p>

        <p style="color:${BRAND.textPrimary};font-size:15px;line-height:1.6;margin:0 0 24px;">${hostLine}</p>

        <div style="text-align:center;margin:0 0 24px;">
          <a href="${escapeHtml(ctx.bookingUrl)}"
             style="display:inline-block;background:${BRAND.primary};color:${BRAND.surface};padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0.02em;">
            Book your discovery call &rarr;
          </a>
        </div>

        <p style="color:${BRAND.textMuted};font-size:13px;line-height:1.6;margin:0 0 8px;">
          If the button doesn't work, paste this into your browser:<br />
          <a href="${escapeHtml(ctx.bookingUrl)}" style="color:${BRAND.primaryDark};word-break:break-all;">${escapeHtml(ctx.bookingUrl)}</a>
        </p>

        <p style="color:${BRAND.textMuted};font-size:13px;line-height:1.6;margin:16px 0 0;">
          Prefer to talk it through first? Just reply to this email — it reaches our team directly.
        </p>
      </div>

      <div style="background:${BRAND.background};padding:16px 28px;border-top:1px solid ${BRAND.border};">
        <p style="font-size:11px;color:${BRAND.textMuted};margin:0;text-align:center;letter-spacing:0.02em;">
          ${escapeHtml(firm.name)} &middot; <a href="${escapeHtml(firm.publicSiteUrl)}" style="color:${BRAND.textMuted};">${escapeHtml(firm.publicSiteUrl.replace(/^https?:\/\//, ""))}</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`
}

/**
 * Send the confirmation. Returns whether it actually went out so the
 * caller only stamps `prospect_confirmation_sent_at` on success —
 * `sendEmail` reports transport failures by returning `success: false`
 * rather than throwing, so a naive unconditional stamp would silently
 * burn the one chance to reach the prospect.
 */
export async function sendProspectIntakeConfirmation(
  ctx: ProspectConfirmationContext,
): Promise<{ sent: boolean; error?: string }> {
  if (!ctx.email) return { sent: false, error: "no email address" }
  if (!ctx.bookingUrl) return { sent: false, error: "no booking url" }

  const firm = await getFirmConfig().catch(() => null)
  const resolved = {
    name: firm?.name ?? "Motta Financial",
    supportEmail: firm?.supportEmail ?? "Info@mottafinancial.com",
    publicSiteUrl: firm?.publicSiteUrl ?? "https://motta.cpa",
  }

  const result = await sendEmail({
    to: ctx.email,
    subject: `Book your discovery call with ${resolved.name}`,
    html: buildProspectConfirmationHtml(ctx, resolved),
    // Replies land in the firm inbox, not on a no-reply address — a
    // prospect answering this email is a live lead, not a bounce.
    replyTo: resolved.supportEmail,
  })

  return {
    sent: result.success === true,
    error: result.success ? undefined : (result as { error?: string }).error,
  }
}
