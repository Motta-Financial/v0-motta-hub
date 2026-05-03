import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  calendlyListAll,
  extractUuid,
  verifyWebhookSignature,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * Calendly webhook receiver.
 *
 * Handles every event emitted by the Webhooks v2 API. Payloads are
 * verified using the proper `t=...,v1=...` signature header before any
 * DB write occurs. When extra invitee data must be fetched, we use the
 * connection token belonging to the host of the event — *not* a static
 * `CALENDLY_ACCESS_TOKEN` — so multi-team-member orgs work correctly.
 *
 * Reference: https://developer.calendly.com/api-docs/ZG9jOjE2OTU3NzMx-webhook-signatures
 */

const WEBHOOK_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY

type WebhookEvent =
  | "invitee.created"
  | "invitee.canceled"
  | "invitee_no_show.created"
  | "invitee_no_show.deleted"
  | "routing_form_submission.created"

interface WebhookPayload {
  event: WebhookEvent | string
  created_at: string
  payload: Record<string, any>
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signatureHeader = request.headers.get("Calendly-Webhook-Signature")

  // In production we *require* a signing key. We only allow unsigned
  // webhooks in non-prod when the key is intentionally absent.
  if (WEBHOOK_SIGNING_KEY) {
    const result = verifyWebhookSignature(rawBody, signatureHeader, WEBHOOK_SIGNING_KEY)
    if (!result.valid) {
      console.error("[calendly] webhook signature invalid:", result.reason)
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[calendly] webhook signing key not configured in production")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  let parsed: WebhookPayload
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  console.log(`[calendly] webhook received: ${parsed.event}`)

  try {
    switch (parsed.event) {
      case "invitee.created":
        return NextResponse.json(await handleInviteeCreated(parsed.payload))
      case "invitee.canceled":
        return NextResponse.json(await handleInviteeCanceled(parsed.payload))
      case "invitee_no_show.created":
        return NextResponse.json(await handleNoShow(parsed.payload, true))
      case "invitee_no_show.deleted":
        return NextResponse.json(await handleNoShow(parsed.payload, false))
      case "routing_form_submission.created":
        return NextResponse.json(await handleRoutingFormSubmission(parsed.payload))
      default:
        console.log(`[calendly] ignoring unhandled event: ${parsed.event}`)
        return NextResponse.json({ success: true, action: "ignored", event: parsed.event })
    }
  } catch (err) {
    console.error("[calendly] webhook processing failed:", err)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: "active",
    supportedEvents: [
      "invitee.created",
      "invitee.canceled",
      "invitee_no_show.created",
      "invitee_no_show.deleted",
      "routing_form_submission.created",
    ],
    signaturesVerified: !!WEBHOOK_SIGNING_KEY,
  })
}

/* ─────────────────────────────────────────────────────────────────────────
 * Connection resolution
 * ───────────────────────────────────────────────────────────────────────
 * Webhooks deliver a partial event payload that contains a host URI
 * (`event_memberships[].user`). We use that to find the matching
 * connection so subsequent API calls are made with the correct token.
 */
async function findConnectionForEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
): Promise<CalendlyConnectionRow | null> {
  const memberships = event?.event_memberships || []
  const userUris = [event?.host_user, ...memberships.map((m: any) => m?.user)].filter(Boolean)

  for (const uri of userUris) {
    const { data } = await supabase
      .from("calendly_connections")
      .select("*")
      .eq("calendly_user_uri", uri)
      .eq("is_active", true)
      .maybeSingle()
    if (data) return data as CalendlyConnectionRow
  }
  return null
}

/* ─────────────────────────────────────────────────────────────────────────
 * Persistence helpers
 * ─────────────────────────────────────────────────────────────────────── */

async function upsertEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  status: "active" | "canceled",
  connection: CalendlyConnectionRow | null,
) {
  const uuid = extractUuid(event.uri)
  if (!uuid) return null
  const location = event.location || {}

  const { data, error } = await supabase
    .from("calendly_events")
    .upsert(
      {
        calendly_uuid: uuid,
        calendly_uri: event.uri,
        calendly_connection_id: connection?.id ?? null,
        team_member_id: connection?.team_member_id ?? null,
        name: event.name,
        status,
        start_time: event.start_time,
        end_time: event.end_time,
        event_type_uuid: extractUuid(event.event_type),
        event_type_name: event.name,
        location_type: location.type,
        location: location.location,
        join_url: location.join_url,
        calendly_user_uri: event.event_memberships?.[0]?.user,
        calendly_user_name:
          event.event_memberships?.[0]?.user_name ?? connection?.calendly_user_name ?? null,
        calendly_user_email:
          event.event_memberships?.[0]?.user_email ?? connection?.calendly_user_email ?? null,
        canceled_at: event.cancellation?.canceled_at ?? null,
        canceler_type: event.cancellation?.canceler_type ?? null,
        canceler_name: event.cancellation?.canceled_by ?? null,
        cancel_reason: event.cancellation?.reason ?? null,
        raw_data: event,
        calendly_created_at: event.created_at,
        calendly_updated_at: event.updated_at,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "calendly_uuid" },
    )
    .select("id, calendly_uuid")
    .single()

  if (error) {
    console.error("[calendly] event upsert failed:", error)
    return null
  }
  return data
}

async function upsertInvitee(
  supabase: ReturnType<typeof createAdminClient>,
  invitee: any,
  eventId: string,
  eventUuid: string,
) {
  const uuid = extractUuid(invitee.uri)
  if (!uuid) return null

  let contactId: string | null = null
  if (invitee.email) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .or(`primary_email.ilike.${invitee.email},secondary_email.ilike.${invitee.email}`)
      .limit(1)
      .maybeSingle()
    contactId = contact?.id ?? null
  }

  const tracking = invitee.tracking || {}
  const { error } = await supabase.from("calendly_invitees").upsert(
    {
      calendly_uuid: uuid,
      calendly_uri: invitee.uri,
      calendly_event_id: eventId,
      calendly_event_uuid: eventUuid,
      name: invitee.name,
      email: invitee.email,
      timezone: invitee.timezone,
      status: invitee.status || "active",
      reschedule_url: invitee.reschedule_url,
      cancel_url: invitee.cancel_url,
      canceled_at: invitee.cancellation?.canceled_at ?? null,
      canceler_type: invitee.cancellation?.canceler_type ?? null,
      cancel_reason: invitee.cancellation?.reason ?? null,
      questions_answers: invitee.questions_and_answers ?? null,
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
    },
    { onConflict: "calendly_uuid" },
  )
  if (error) console.error("[calendly] invitee upsert failed:", error)
  return uuid
}

/**
 * Notifies the appropriate audience about a new/canceled meeting.
 * If we know which connection the event belongs to we notify that
 * specific team member by default; otherwise we fall back to broadcast.
 */
async function notifyTeamMembers(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  invitee: any,
  kind: "created" | "canceled",
  connection: CalendlyConnectionRow | null,
) {
  const inviteeName = invitee?.name || invitee?.email || "A client"
  const eventName = event?.name || "Meeting"
  const startTime = event?.start_time
    ? new Date(event.start_time).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : ""

  const isCreated = kind === "created"
  const title = isCreated ? "New Meeting Scheduled" : "Meeting Canceled"
  const message = isCreated
    ? `${inviteeName} booked a ${eventName} for ${startTime}`
    : `${inviteeName} canceled their ${eventName} scheduled for ${startTime}`
  const notificationType = isCreated ? "meeting_scheduled" : "meeting_canceled"

  // Determine recipients: the connected host first, plus any other admins.
  let recipients: { id: string }[] = []
  if (connection?.team_member_id) {
    recipients = [{ id: connection.team_member_id }]
  } else {
    const { data: members } = await supabase
      .from("team_members")
      .select("id")
      .eq("status", "active")
    recipients = members ?? []
  }
  if (recipients.length === 0) return

  const rows = recipients.map((member) => ({
    team_member_id: member.id,
    notification_type: notificationType,
    title,
    message,
    related_entity_type: "calendly_event",
    related_entity_id: extractUuid(event.uri),
    metadata: {
      event_name: eventName,
      invitee_name: inviteeName,
      invitee_email: invitee?.email,
      start_time: event?.start_time,
      end_time: event?.end_time,
      join_url: event?.location?.join_url,
      calendly_event_uri: event?.uri,
    },
    is_read: false,
    created_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from("notifications").insert(rows)
  if (error) console.error("[calendly] notification insert failed:", error)
}

/* ─────────────────────────────────────────────────────────────────────────
 * Event handlers
 * ─────────────────────────────────────────────────────────────────────── */

async function handleInviteeCreated(payload: any) {
  const { event, invitee } = payload
  const supabase = createAdminClient()
  const connection = await findConnectionForEvent(supabase, event)

  // Webhook payloads usually include the invitee inline; if they don't
  // we hydrate using the connection's token.
  const saved = await upsertEvent(supabase, event, "active", connection)
  if (!saved) return { success: false, error: "event upsert failed" }

  if (invitee?.uri) {
    await upsertInvitee(supabase, invitee, saved.id, saved.calendly_uuid)
  } else if (connection) {
    const fetched = await calendlyListAll<any>(connection, supabase, `${event.uri}/invitees`, {
      query: { count: 100 },
    }).catch(() => [])
    for (const i of fetched) await upsertInvitee(supabase, i, saved.id, saved.calendly_uuid)
  }

  await notifyTeamMembers(supabase, event, invitee, "created", connection)
  return { success: true, action: "invitee_created" }
}

async function handleInviteeCanceled(payload: any) {
  const { event, invitee } = payload
  const supabase = createAdminClient()
  const connection = await findConnectionForEvent(supabase, event)
  const saved = await upsertEvent(supabase, event, "canceled", connection)
  if (saved && invitee?.uri) {
    await upsertInvitee(supabase, invitee, saved.id, saved.calendly_uuid)
  }
  await notifyTeamMembers(supabase, event, invitee, "canceled", connection)
  return { success: true, action: "invitee_canceled" }
}

/**
 * No-show events fire when an organizer marks an invitee as no-show
 * (or undoes that mark). We persist this on the invitee row so
 * downstream reporting can distinguish missed meetings.
 */
async function handleNoShow(payload: any, isNoShow: boolean) {
  const supabase = createAdminClient()
  const inviteeUri = payload?.invitee?.uri || payload?.uri
  const inviteeUuid = extractUuid(inviteeUri)
  if (!inviteeUuid) return { success: false, error: "missing invitee uri" }

  const { error } = await supabase
    .from("calendly_invitees")
    .update({
      status: isNoShow ? "no_show" : "active",
      raw_data: payload,
      updated_at: new Date().toISOString(),
    })
    .eq("calendly_uuid", inviteeUuid)
  if (error) console.error("[calendly] no-show update failed:", error)
  return { success: true, action: isNoShow ? "no_show_marked" : "no_show_cleared" }
}

/**
 * Routing form submissions: we don't yet have a dedicated table, so we
 * write a notification with the raw payload. This gives ops visibility
 * while preserving the data for later modeling.
 */
async function handleRoutingFormSubmission(payload: any) {
  const supabase = createAdminClient()
  const { data: members } = await supabase
    .from("team_members")
    .select("id")
    .eq("status", "active")
    .limit(1)

  if (members && members.length > 0) {
    await supabase.from("notifications").insert({
      team_member_id: members[0].id,
      notification_type: "routing_form_submission",
      title: "Routing form submitted",
      message: `New Calendly routing form submission received`,
      related_entity_type: "calendly_routing_form",
      related_entity_id: extractUuid(payload?.uri) ?? null,
      metadata: payload,
      is_read: false,
      created_at: new Date().toISOString(),
    })
  }
  return { success: true, action: "routing_form_submission_logged" }
}
