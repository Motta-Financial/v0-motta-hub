import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  calendlyListAll,
  extractUuid,
  verifyWebhookSignature,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"
import {
  extractPhoneFromInvitee,
  matchInviteeToContact,
  upsertAutoClientLink,
} from "@/lib/calendly-invitee-match"
import { runAlfredCalendlyTriage } from "@/lib/alfred/calendly-triage"
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import { mapCalendlyEventFields, mapCalendlyInviteeFields } from "@/lib/calendly-field-mapping"
import { notifyTeamOfNewBooking } from "@/lib/calendly/notify"
import { pushHubContactToKarbon } from "@/lib/karbon/client-sync"

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

  // Full field capture lives in the shared mapper so the webhook and the
  // polling sync stay identical. We override `status` with the value the
  // caller derived from the event type (created vs canceled) and add the
  // webhook-only host resolution + connection linkage on top.
  const { data, error } = await supabase
    .from("calendly_events")
    .upsert(
      {
        ...mapCalendlyEventFields(event),
        calendly_uuid: uuid,
        calendly_uri: event.uri,
        calendly_connection_id: connection?.id ?? null,
        team_member_id: connection?.team_member_id ?? null,
        status,
        // Host resolution: the webhook payload carries event_memberships
        // inline, so prefer that over the connection's owner identity.
        calendly_user_uri:
          event.event_memberships?.[0]?.user ?? connection?.calendly_user_uri ?? null,
        calendly_user_name:
          event.event_memberships?.[0]?.user_name ?? connection?.calendly_user_name ?? null,
        calendly_user_email:
          event.event_memberships?.[0]?.user_email ?? connection?.calendly_user_email ?? null,
        raw_data: event,
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
): Promise<{
  inviteeUuid: string | null
  deterministicMatch: { contactId: string | null; matchMethod: "email" | "name_phone" | "name" | null }
  wasNewContact: boolean
  invitee: any
}> {
  const uuid = extractUuid(invitee.uri)
  if (!uuid)
    return {
      inviteeUuid: null,
      deterministicMatch: { contactId: null, matchMethod: null },
      wasNewContact: false,
      invitee,
    }

  // Match invitee → CRM contact using email → name+phone → name. The
  // helper returns null when nothing matches, in which case the invitee
  // (and the meeting) stays unlinked exactly like before. When a match
  // *is* found we also write a `calendly_event_clients` row tagged as
  // an auto-link so the Team Calendar can render it as a "client" tag
  // alongside any manual tags users add later.
  const inviteePhone = extractPhoneFromInvitee(invitee)
  const match = await matchInviteeToContact(supabase, {
    email: invitee.email,
    name: invitee.name,
    phone: inviteePhone,
  })
  let contactId = match?.contactId ?? null
  let contactMatchMethod: "email" | "name_phone" | "name" | "auto_created" | null =
    match?.matchMethod ?? null

  // Hub-first: when nothing matched, auto-create a Master Hub Contact
  // for the invitee. Calendly bookings are one of the three canonical
  // intake channels (alongside Jotform and Zoom) — every booked
  // invitee should exist as a Hub contact even if a teammate has not
  // yet manually linked them. We tag the row with source=calendly and
  // is_prospect=true; pushing to Karbon happens fire-and-forget below.
  let wasNewContact = false
  if (!contactId && (invitee.email || invitee.name)) {
    try {
      const created = await findOrCreateHubContact(
        {
          email: invitee.email ?? null,
          fullName: invitee.name ?? null,
          phone: inviteePhone,
        },
        { source: "calendly", supabase, skipInternal: true },
      )
      if (created.contact_id) {
        contactId = created.contact_id
        wasNewContact = !!created.created
        contactMatchMethod = created.created ? "auto_created" : "email"
        console.log(
          `[calendly] hub auto-${created.created ? "created" : "matched"} contact ${created.contact_id}: ${created.reason}`,
        )

        // Fire-and-forget Karbon push for newly-created contacts only.
        // This ensures direct Calendly bookings (prospects who skipped
        // the intake form) still land in Karbon. Existing contacts
        // already have a Karbon key or will be linked manually.
        if (wasNewContact) {
          void pushHubContactToKarbon(contactId, { source: "Calendly Booking" }).catch((err) => {
            console.error("[calendly] karbon push failed (non-blocking):", err)
          })
        }
      }
    } catch (err) {
      console.error("[calendly] hub auto-create failed (non-blocking):", err)
    }
  }

  if (contactId && eventId) {
    await upsertAutoClientLink(supabase, {
      calendlyEventId: eventId,
      contactId,
      // `calendly_event_clients.match_method` is constrained to the
      // legacy enum; coerce auto_created → "email" since email was the
      // primary signal we used to build the new contact. Source-of-
      // truth for "this contact came from Calendly" lives on
      // contacts.source.
      matchMethod:
        contactMatchMethod === "auto_created"
          ? "email"
          : (contactMatchMethod ?? "email"),
    })
  }

  const { error } = await supabase.from("calendly_invitees").upsert(
    {
      ...mapCalendlyInviteeFields(invitee),
      calendly_uuid: uuid,
      calendly_uri: invitee.uri,
      calendly_event_id: eventId,
      calendly_event_uuid: eventUuid,
      contact_id: contactId,
      raw_data: invitee,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "calendly_uuid" },
  )
  if (error) console.error("[calendly] invitee upsert failed:", error)
  return {
    inviteeUuid: uuid,
    deterministicMatch: {
      contactId,
      matchMethod:
        contactMatchMethod === "auto_created" ? "email" : contactMatchMethod,
    },
    wasNewContact,
    invitee,
  }
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

  // Track every invitee we processed so ALFRED can run a triage pass
  // per invitee. The deterministic matcher already wrote a contact tag
  // (when it found one); ALFRED supplements with org / work / service
  // tags and can upgrade an unmatched invitee to a confident contact.
  const processed: Array<Awaited<ReturnType<typeof upsertInvitee>>> = []
  if (invitee?.uri) {
    processed.push(await upsertInvitee(supabase, invitee, saved.id, saved.calendly_uuid))
  } else if (connection) {
    const fetched = await calendlyListAll<any>(connection, supabase, `${event.uri}/invitees`, {
      query: { count: 100 },
    }).catch(() => [])
    for (const i of fetched) {
      processed.push(await upsertInvitee(supabase, i, saved.id, saved.calendly_uuid))
    }
  }

  // Run ALFRED triage for each invitee. We deliberately do NOT block
  // the webhook response on this — model latency on a slow link can
  // exceed Calendly's webhook timeout. Fire-and-forget with a top-level
  // try/catch inside the helper so any failure stays out of the
  // critical path. The audit row in calendly_alfred_triage_log is the
  // durable record either way.
  for (const p of processed) {
    if (!p?.inviteeUuid) continue
    void runAlfredCalendlyTriage(supabase, {
      calendlyEventId: saved.id,
      calendlyEventUuid: saved.calendly_uuid,
      calendlyInviteeUuid: p.inviteeUuid,
      eventName: event?.name ?? null,
      eventTypeName: event?.name ?? null,
      startTime: event?.start_time ?? null,
      invitee: {
        name: p.invitee?.name ?? null,
        email: p.invitee?.email ?? null,
        phone: extractPhoneFromInvitee(p.invitee),
        questionsAndAnswers: p.invitee?.questions_and_answers ?? null,
      },
      deterministicMatch: p.deterministicMatch,
    }).catch((err) => {
      console.error("[calendly] alfred triage failed (non-blocking):", err)
    })
  }

  await notifyTeamMembers(supabase, event, invitee, "created", connection)

  // Fire-and-forget ALFRED email to all team members (opt-out honored via
  // the meeting_booked email category). The email includes everything the
  // team needs at a glance: who booked, when, whether they're new or
  // existing, and a link to the Hub record. Dedupe happens inside
  // notifyTeamOfNewBooking via the team_notified_at column.
  const firstInvitee = processed[0]
  if (firstInvitee?.inviteeUuid) {
    void notifyTeamOfNewBooking({
      eventId: saved.id,
      eventUuid: saved.calendly_uuid,
      eventName: event?.name ?? "Meeting",
      startTime: event?.start_time ?? new Date().toISOString(),
      endTime: event?.end_time ?? new Date().toISOString(),
      joinUrl: event?.location?.join_url ?? null,
      hostName: connection?.calendly_user_name ?? null,
      inviteeName: firstInvitee.invitee?.name ?? "Unknown",
      inviteeEmail: firstInvitee.invitee?.email ?? "",
      inviteePhone: extractPhoneFromInvitee(firstInvitee.invitee),
      wasNewContact: firstInvitee.wasNewContact ?? false,
      contactId: firstInvitee.deterministicMatch?.contactId ?? null,
      karbonKey: null, // Karbon push is async; email goes out immediately
    }).catch((err) => {
      console.error("[calendly] team email failed (non-blocking):", err)
    })
  }

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

  // The no_show resource uri is the top-level `uri` on the no_show
  // payload; when un-marking we clear both the flag and the stored uri.
  const noShowUri = isNoShow ? (payload?.uri ?? null) : null

  const { error } = await supabase
    .from("calendly_invitees")
    .update({
      status: isNoShow ? "no_show" : "active",
      no_show: isNoShow,
      no_show_uri: noShowUri,
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
