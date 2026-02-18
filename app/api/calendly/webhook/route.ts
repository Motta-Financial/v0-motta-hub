import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import crypto from "crypto"

const CALENDLY_ACCESS_TOKEN = process.env.CALENDLY_ACCESS_TOKEN

// Webhook signing key (optional but recommended for security)
const WEBHOOK_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY

// Verify webhook signature if signing key is configured
function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  if (!WEBHOOK_SIGNING_KEY || !signature) return true // Skip verification if not configured

  const expectedSignature = crypto.createHmac("sha256", WEBHOOK_SIGNING_KEY).update(payload).digest("hex")

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
}

// Extract UUID from Calendly URI
function extractUuid(uri: string): string {
  return uri.split("/").pop() || ""
}

// Fetch invitees for an event from Calendly API
async function fetchInvitees(eventUri: string) {
  try {
    const response = await fetch(`${eventUri}/invitees`, {
      headers: {
        Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) return []

    const data = await response.json()
    return data.collection || []
  } catch (error) {
    console.error("Error fetching invitees:", error)
    return []
  }
}

// Create notifications for all team members about a new meeting
async function notifyTeamMembers(event: any, invitee: any, eventType: "created" | "canceled") {
  try {
    const supabase = createAdminClient()
    // Get all team members
    const { data: teamMembers, error: teamError } = await supabase
      .from("team_members")
      .select("id, name, email")
      .eq("status", "active")

    if (teamError || !teamMembers?.length) {
      console.error("Error fetching team members:", teamError)
      return
    }

    const inviteeName = invitee?.name || invitee?.email || "A client"
    const eventName = event.name || "Meeting"
    const startTime = new Date(event.start_time).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })

    let title: string
    let message: string
    let notificationType: string

    if (eventType === "created") {
      title = "New Meeting Scheduled"
      message = `${inviteeName} booked a ${eventName} for ${startTime}`
      notificationType = "meeting_scheduled"
    } else {
      title = "Meeting Canceled"
      message = `${inviteeName} canceled their ${eventName} scheduled for ${startTime}`
      notificationType = "meeting_canceled"
    }

    // Create notification for each team member
    const notifications = teamMembers.map((member) => ({
      team_member_id: member.id,
      notification_type: notificationType,
      title,
      message,
      related_entity_type: "calendly_event",
      related_entity_id: event.calendly_uuid || extractUuid(event.uri),
      metadata: {
        event_name: eventName,
        invitee_name: inviteeName,
        invitee_email: invitee?.email,
        start_time: event.start_time,
        end_time: event.end_time,
        join_url: event.location?.join_url,
        calendly_event_uri: event.uri,
      },
      is_read: false,
      created_at: new Date().toISOString(),
    }))

    const { error: notifError } = await supabase.from("notifications").insert(notifications)

    if (notifError) {
      console.error("Error creating meeting notifications:", notifError)
    } else {
      console.log(`Created ${notifications.length} notifications for ${eventType} event`)
    }
  } catch (error) {
    console.error("Error in notifyTeamMembers:", error)
  }
}

// Sync event to Supabase
async function syncEventToSupabase(event: any, status: "active" | "canceled" = "active") {
  const supabase = createAdminClient()
  const calendlyUuid = extractUuid(event.uri)

  // Extract location info
  let locationType = null
  let location = null
  let joinUrl = null

  if (event.location) {
    locationType = event.location.type
    location = event.location.location
    joinUrl = event.location.join_url
  }

  const eventData = {
    calendly_uuid: calendlyUuid,
    calendly_uri: event.uri,
    name: event.name,
    status: status,
    start_time: event.start_time,
    end_time: event.end_time,
    event_type_uuid: event.event_type ? extractUuid(event.event_type) : null,
    event_type_name: event.name,
    location_type: locationType,
    location: location,
    join_url: joinUrl,
    calendly_user_uri: event.event_memberships?.[0]?.user,
    calendly_user_name: event.event_memberships?.[0]?.user_name,
    calendly_user_email: event.event_memberships?.[0]?.user_email,
    canceled_at: event.cancellation?.canceled_at || null,
    canceler_type: event.cancellation?.canceler_type || null,
    canceler_name: event.cancellation?.canceled_by || null,
    cancel_reason: event.cancellation?.reason || null,
    raw_data: event,
    calendly_created_at: event.created_at,
    calendly_updated_at: event.updated_at,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Upsert the event
  const { data: savedEvent, error: eventError } = await supabase
    .from("calendly_events")
    .upsert(eventData, { onConflict: "calendly_uuid" })
    .select()
    .single()

  if (eventError) {
    console.error("Error saving event:", eventError)
    return null
  }

  return savedEvent
}

// Sync invitee to Supabase
async function syncInviteeToSupabase(invitee: any, calendlyEventId: string, calendlyEventUuid: string) {
  const supabase = createAdminClient()
  const inviteeUuid = extractUuid(invitee.uri)

  // Try to find matching contact by email
  let contactId = null
  if (invitee.email) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .or(`primary_email.ilike.${invitee.email},secondary_email.ilike.${invitee.email}`)
      .limit(1)
      .maybeSingle()

    if (contact) {
      contactId = contact.id
    }
  }

  // Extract UTM parameters
  const tracking = invitee.tracking || {}

  const inviteeData = {
    calendly_uuid: inviteeUuid,
    calendly_uri: invitee.uri,
    calendly_event_id: calendlyEventId,
    calendly_event_uuid: calendlyEventUuid,
    name: invitee.name,
    email: invitee.email,
    timezone: invitee.timezone,
    status: invitee.status || "active",
    reschedule_url: invitee.reschedule_url,
    cancel_url: invitee.cancel_url,
    canceled_at: invitee.cancellation?.canceled_at || null,
    canceler_type: invitee.cancellation?.canceler_type || null,
    cancel_reason: invitee.cancellation?.reason || null,
    questions_answers: invitee.questions_and_answers || null,
    utm_source: tracking.utm_source,
    utm_medium: tracking.utm_medium,
    utm_campaign: tracking.utm_campaign,
    utm_term: tracking.utm_term,
    utm_content: tracking.utm_content,
    contact_id: contactId,
    raw_data: invitee,
    calendly_created_at: invitee.created_at,
    calendly_updated_at: invitee.updated_at,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from("calendly_invitees").upsert(inviteeData, { onConflict: "calendly_uuid" })

  if (error) {
    console.error("Error saving invitee:", error)
  }

  return inviteeData
}

// Handle invitee.created event
async function handleInviteeCreated(payload: any) {
  const { event, invitee } = payload

  // Sync the event first
  const savedEvent = await syncEventToSupabase(event, "active")

  if (savedEvent) {
    // Sync the invitee
    await syncInviteeToSupabase(invitee, savedEvent.id, savedEvent.calendly_uuid)

    // Notify all team members
    await notifyTeamMembers(event, invitee, "created")
  }

  return { success: true, action: "invitee_created" }
}

// Handle invitee.canceled event
async function handleInviteeCanceled(payload: any) {
  const { event, invitee } = payload

  // Update the event status
  const savedEvent = await syncEventToSupabase(event, "canceled")

  if (savedEvent) {
    // Update invitee status
    await syncInviteeToSupabase(invitee, savedEvent.id, savedEvent.calendly_uuid)

    // Notify all team members
    await notifyTeamMembers(event, invitee, "canceled")
  }

  return { success: true, action: "invitee_canceled" }
}

// POST handler for webhook events
export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get("Calendly-Webhook-Signature")

    // Verify signature if configured
    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    const payload = JSON.parse(rawBody)
    const eventType = payload.event

    console.log(`Received Calendly webhook: ${eventType}`)

    let result

    switch (eventType) {
      case "invitee.created":
        result = await handleInviteeCreated(payload.payload)
        break
      case "invitee.canceled":
        result = await handleInviteeCanceled(payload.payload)
        break
      default:
        console.log(`Unhandled event type: ${eventType}`)
        result = { success: true, action: "ignored", eventType }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

// GET handler to check webhook status
export async function GET() {
  return NextResponse.json({
    status: "active",
    supportedEvents: ["invitee.created", "invitee.canceled"],
    message: "Calendly webhook endpoint is ready",
  })
}
