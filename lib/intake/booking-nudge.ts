/**
 * Booking nudge — one follow-up to prospects who never booked.
 *
 * The intake pipeline now hands every prospect a discovery-call link
 * and emails it to them. Most people still won't book on the first
 * pass: the historical rate was 8 of 130 within a week, and even with
 * the link in front of them a chunk will get distracted mid-task.
 *
 * This sweep sends exactly ONE reminder, 48 hours later, to prospects
 * who received a booking link and have no booking attributed to them.
 * Deliberately conservative:
 *
 *   • one nudge, ever — `booking_nudge_sent_at` is the guard. A drip
 *     sequence to someone who filled in a tax intake form reads as
 *     pressure, and the firm's reputation is worth more than the
 *     marginal booking.
 *   • skipped once `calendly_event_id` is set, so a prospect who books
 *     inside the window never hears from us.
 *   • skipped when a human has already moved the row off `new` —
 *     if a teammate has picked this up and called them, an automated
 *     "you haven't booked yet!" is actively unhelpful.
 *   • hard stop at MAX_AGE_DAYS so re-enabling the cron after an
 *     outage can't blast a month of stale prospects.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { sendEmail } from "@/lib/email"
import { getFirmConfig } from "@/lib/firm-settings"

const BRAND = {
  primary: "#6B745D",
  primaryDark: "#5A6250",
  surface: "#FFFFFF",
  background: "#EAE6E1",
  textPrimary: "#1F2520",
  textMuted: "#6B7066",
  border: "#D8D3CB",
} as const

/** Wait this long after the confirmation before nudging. */
const NUDGE_AFTER_HOURS = 48
/** Never nudge an intake older than this — see the outage note above. */
const MAX_AGE_DAYS = 14
/** Cap per run so one invocation can't fan out unboundedly. */
const MAX_PER_RUN = 50

export interface NudgeResult {
  scanned: number
  sent: number
  failed: number
  errors: string[]
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

export function buildNudgeHtml(
  args: { firstName: string | null; bookingUrl: string },
  firm: { name: string; publicSiteUrl: string },
): string {
  const greeting = args.firstName ? `Hi ${escapeHtml(args.firstName)},` : "Hi there,"
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Still want to talk?</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${BRAND.background};">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background:${BRAND.surface};border-radius:12px;overflow:hidden;border:1px solid ${BRAND.border};">
      <div style="background:${BRAND.primary};padding:20px 28px;">
        <div style="color:${BRAND.surface};font-size:18px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(firm.name.toUpperCase())}</div>
      </div>
      <div style="padding:32px 28px;">
        <p style="color:${BRAND.textPrimary};font-size:15px;line-height:1.6;margin:0 0 16px;">${greeting}</p>
        <p style="color:${BRAND.textPrimary};font-size:15px;line-height:1.6;margin:0 0 16px;">
          You reached out to ${escapeHtml(firm.name)} a couple of days ago and we
          haven't got a time on the calendar yet. The link below is still live
          whenever you're ready — it's 30 minutes on Zoom, free, and there's no
          prep needed on your end.
        </p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${escapeHtml(args.bookingUrl)}" style="display:inline-block;background:${BRAND.primary};color:${BRAND.surface};padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">
            Find a time &rarr;
          </a>
        </div>
        <p style="color:${BRAND.textMuted};font-size:13px;line-height:1.6;margin:0;">
          If your situation changed or the timing isn't right, no problem at all —
          just reply and let us know, and we'll leave you be.
        </p>
      </div>
      <div style="background:${BRAND.background};padding:16px 28px;border-top:1px solid ${BRAND.border};">
        <p style="font-size:11px;color:${BRAND.textMuted};margin:0;text-align:center;">
          ${escapeHtml(firm.name)} &middot; <a href="${escapeHtml(firm.publicSiteUrl)}" style="color:${BRAND.textMuted};">${escapeHtml(firm.publicSiteUrl.replace(/^https?:\/\//, ""))}</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`
}

export async function sweepBookingNudges(
  supabase: SupabaseClient,
): Promise<NudgeResult> {
  const result: NudgeResult = { scanned: 0, sent: 0, failed: 0, errors: [] }

  const now = Date.now()
  const dueBefore = new Date(now - NUDGE_AFTER_HOURS * 3600_000).toISOString()
  const notOlderThan = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString()

  const { data: rows, error } = await supabase
    .from("jotform_intake_submissions")
    .select(
      "id, submitter_full_name, submitter_email, booking_url, prospect_confirmation_sent_at, lead_status",
    )
    .not("prospect_confirmation_sent_at", "is", null)
    .lte("prospect_confirmation_sent_at", dueBefore)
    .gte("prospect_confirmation_sent_at", notOlderThan)
    .is("booking_nudge_sent_at", null)
    .is("calendly_event_id", null)
    .not("booking_url", "is", null)
    .not("submitter_email", "is", null)
    .limit(MAX_PER_RUN)

  if (error) {
    result.errors.push(error.message)
    return result
  }

  const firm = await getFirmConfig().catch(() => null)
  const resolved = {
    name: firm?.name ?? "Motta Financial",
    supportEmail: firm?.supportEmail ?? "Info@mottafinancial.com",
    publicSiteUrl: firm?.publicSiteUrl ?? "https://motta.cpa",
  }

  for (const row of rows ?? []) {
    result.scanned += 1

    // A teammate has already engaged this lead — an automated nudge
    // would talk over a live human conversation.
    if (row.lead_status && row.lead_status !== "new") continue

    const firstName =
      row.submitter_full_name?.trim().split(/\s+/)[0] ?? null

    try {
      const send = await sendEmail({
        to: row.submitter_email as string,
        subject: `Still want to talk? Your ${resolved.name} call link`,
        html: buildNudgeHtml(
          { firstName, bookingUrl: row.booking_url as string },
          resolved,
        ),
        replyTo: resolved.supportEmail,
      })

      if (send.success) {
        // Stamp only on a confirmed send, so a transport failure retries
        // on the next tick rather than silently consuming the one nudge.
        await supabase
          .from("jotform_intake_submissions")
          .update({ booking_nudge_sent_at: new Date().toISOString() })
          .eq("id", row.id)
        result.sent += 1
      } else {
        result.failed += 1
        result.errors.push(`${row.id}: ${(send as { error?: string }).error ?? "send failed"}`)
      }
    } catch (err) {
      result.failed += 1
      result.errors.push(`${row.id}: ${(err as Error).message}`)
    }
  }

  return result
}
