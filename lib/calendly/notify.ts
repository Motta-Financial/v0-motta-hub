/**
 * Calendly booking notifications
 *
 * ALFRED-authored emails sent to all active team members when a new meeting
 * is booked via Calendly. Mirrors the proven pattern in lib/jotform/notify.ts.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { sendCategoryEmail } from "@/lib/email"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Email builder
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

function buildMeetingBookedEmailHtml(p: CalendlyBookingNotifyPayload): string {
  const startFormatted = formatDateTime(p.startTime)
  const endFormatted = formatDateTime(p.endTime)

  const hubLink = p.contactId
    ? `${APP_URL}/clients/${p.contactId}`
    : `${APP_URL}/meetings/calendly`

  const contactStatusBadge = p.wasNewContact
    ? `<span style="display:inline-block;background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">NEW PROSPECT</span>`
    : `<span style="display:inline-block;background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">EXISTING CLIENT</span>`

  const karbonSection = p.karbonKey
    ? `<p style="margin:8px 0;font-size:14px;color:#6B7280;">Karbon record linked</p>`
    : p.wasNewContact
      ? `<p style="margin:8px 0;font-size:14px;color:#F59E0B;">Karbon record creation in progress...</p>`
      : ""

  const joinSection = p.joinUrl
    ? `<p style="margin:16px 0;">
        <a href="${p.joinUrl}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Join Meeting</a>
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
        <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
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
              <div style="margin-bottom:24px;">
                ${contactStatusBadge}
              </div>

              <!-- Meeting details -->
              <h2 style="margin:0 0 8px;font-size:18px;color:#111827;">${p.eventName}</h2>
              <p style="margin:0 0 4px;font-size:14px;color:#6B7280;">
                <strong>When:</strong> ${startFormatted} - ${endFormatted}
              </p>
              ${p.hostName ? `<p style="margin:0 0 4px;font-size:14px;color:#6B7280;"><strong>Host:</strong> ${p.hostName}</p>` : ""}

              <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">

              <!-- Invitee details -->
              <h3 style="margin:0 0 12px;font-size:16px;color:#111827;">Invitee</h3>
              <p style="margin:0 0 4px;font-size:14px;color:#374151;"><strong>${p.inviteeName}</strong></p>
              <p style="margin:0 0 4px;font-size:14px;color:#6B7280;">${p.inviteeEmail}</p>
              ${p.inviteePhone ? `<p style="margin:0 0 4px;font-size:14px;color:#6B7280;">${p.inviteePhone}</p>` : ""}
              ${karbonSection}

              ${joinSection}

              <!-- CTA -->
              <p style="margin:24px 0 0;">
                <a href="${hubLink}" style="display:inline-block;background:#6B745D;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View in Hub</a>
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
  const html = buildMeetingBookedEmailHtml(payload)
  const subject = `New Meeting Booked: ${payload.inviteeName} - ${payload.eventName}`

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
