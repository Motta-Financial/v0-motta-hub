import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { type, title, message, recipients, entity_type, entity_id, action_url } = body

    if (!recipients || recipients.length === 0) {
      return NextResponse.json({ error: "No recipients specified" }, { status: 400 })
    }

    // Create notifications for each recipient
    const notifications = recipients.map((recipientId: string) => ({
      team_member_id: recipientId,
      notification_type: type || "general",
      title: title,
      message: message,
      entity_type: entity_type || null,
      entity_id: entity_id || null,
      action_url: action_url || null,
      is_read: false,
    }))

    const { data, error } = await supabase.from("notifications").insert(notifications).select()

    if (error) throw error

    // TODO: Optionally send email notifications here
    // This could integrate with a service like Resend, SendGrid, etc.

    return NextResponse.json({
      success: true,
      notifications_sent: data?.length || 0,
    })
  } catch (error) {
    console.error("Error sending notifications:", error)
    return NextResponse.json({ error: "Failed to send notifications" }, { status: 500 })
  }
}
