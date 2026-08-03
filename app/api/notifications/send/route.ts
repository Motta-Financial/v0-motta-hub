import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildNotificationEmailHtml,
  mapNotificationTypeToCategory,
  resolveRecipientsForCategory,
  sendBatchEmail,
} from "@/lib/email"

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const {
      type,
      title,
      message,
      recipients,
      entity_type,
      entity_id,
      action_url,
      // When true, ALWAYS send the email regardless of user preferences
      // (used for system-critical alerts). Defaults to false.
      force_email = false,
      // When true, skip email entirely and only create the in-app row.
      skip_email = false,
    } = body

    if (!recipients || recipients.length === 0) {
      return NextResponse.json({ error: "No recipients specified" }, { status: 400 })
    }

    const notificationType = type || "general"

    // 1. Create in-app notifications for each recipient
    const notifications = recipients.map((recipientId: string) => ({
      team_member_id: recipientId,
      notification_type: notificationType,
      title,
      message,
      entity_type: entity_type || null,
      entity_id: entity_id || null,
      action_url: action_url || null,
      is_read: false,
    }))

    const { data, error } = await supabase.from("notifications").insert(notifications).select()
    if (error) throw error

    // 2. Email recipients (preference-aware unless explicitly forced/skipped)
    let emailsSent = 0
    let emailsSkipped = 0
    if (!skip_email) {
      const category = mapNotificationTypeToCategory(notificationType)

      // Resolve recipients respecting per-user opt-out (or get raw emails for forced)
      let toResolve: { team_member_id: string; email: string; full_name: string }[]
      if (force_email) {
        const { data: members } = await supabase
          .from("team_members")
          .select("id, full_name, email, is_active")
          .in("id", recipients)
        toResolve = (members || [])
          .filter((m) => m.is_active && m.email)
          .map((m) => ({ team_member_id: m.id, email: m.email, full_name: m.full_name }))
      } else {
        toResolve = await resolveRecipientsForCategory(recipients, category)
      }

      emailsSkipped = recipients.length - toResolve.length

      // Build one personalized message per recipient (tailored greeting/CTA)
      // and send them all in a single Resend batch call instead of N parallel
      // sends. Each message is individually addressed.
      const messages = toResolve.map((r) => ({
        to: r.email,
        subject: title || "New notification from MOTTA HUB",
        html: buildNotificationEmailHtml({
          recipientName: r.full_name?.split(" ")[0] || "there",
          title: title || "New notification",
          message: message || "",
          actionUrl: action_url || undefined,
        }),
      }))
      const { sent } = await sendBatchEmail(messages)
      emailsSent = sent
    }

    return NextResponse.json({
      success: true,
      notifications_sent: data?.length || 0,
      emails_sent: emailsSent,
      emails_skipped: emailsSkipped,
    })
  } catch (error) {
    console.error("[notifications/send] Error:", error)
    return NextResponse.json({ error: "Failed to send notifications" }, { status: 500 })
  }
}
