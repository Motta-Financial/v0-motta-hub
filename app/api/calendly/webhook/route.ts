import { NextResponse, after } from "next/server"
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
import { findOrCreateDeal } from "@/lib/deals/find-or-create-deal"
import { advanceDealStage } from "@/lib/deals/advance-stage"
import { mapCalendlyEventFields, mapCalendlyInviteeFields } from "@/lib/calendly-field-mapping"
import { notifyTeamOfNewBooking } from "@/lib/calendly/notify"
import { pushHubContactToKarbon } from "@/lib/karbon/client-sync"
import { syncHubMeetings } from "@/lib/meetings/sync-hub-meetings"

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

  // Delivery ledger: record EVERY delivery before processing. The
  // dedupe key collapses Calendly's retries and org+user dual delivery
  // into a single processed row, so side-effects (team emails, ALFRED
  // triage, Karbon pushes) can never double-fire. This ledger is also
  // the only durable proof that deliveries are arriving at all — its
  // multi-month emptiness is how a signing-key mismatch silently killed
  // the real-time path without anyone noticing.
  const supabase = createAdminClient()
  const dedupeKey = buildDedupeKey(parsed)
  let ledgerId: string | null = null
  {
    const p = parsed.payload ?? {}
    const { data: ledger, error: ledgerErr } = await supabase
      .from("calendly_webhook_events")
      .insert({
        event_type: parsed.event,
        calendly_event_uuid:
          extractUuid(p?.event?.uri ?? p?.invitee?.event ?? null) ?? null,
        signature_valid: !!WEBHOOK_SIGNING_KEY,
        dedupe_key: dedupeKey,
        payload: parsed,
      })
      .select("id")
      .single()
    if (ledgerErr) {
      // 23505 = unique violation on dedupe_key → this exact delivery was
      // already processed (retry or dual subscription). Acknowledge it.
      if (ledgerErr.code === "23505") {
        return NextResponse.json({ success: true, action: "duplicate_ignored" })
      }
      // Ledger write failing must not drop the webhook — process anyway.
      console.error("[calendly] webhook ledger insert failed:", ledgerErr)
    }
    ledgerId = ledger?.id ?? null
  }

  try {
    let result: Record<string, unknown>
    switch (parsed.event) {
      case "invitee.created":
        result = await handleInviteeCreated(parsed.payload)
        break
      case "invitee.canceled":
        result = await handleInviteeCanceled(parsed.payload)
        break
      case "invitee_no_show.created":
        result = await handleNoShow(parsed.payload, true)
        break
      case "invitee_no_show.deleted":
        result = await handleNoShow(parsed.payload, false)
        break
      case "routing_form_submission.created":
        result = await handleRoutingFormSubmission(parsed.payload)
        break
      default:
        console.log(`[calendly] ignoring unhandled event: ${parsed.event}`)
        result = { success: true, action: "ignored", event: parsed.event }
    }

    if (ledgerId) {
      await supabase
        .from("calendly_webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", ledgerId)
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error("[calendly] webhook processing failed:", err)
    if (ledgerId) {
      await supabase
        .from("calendly_webhook_events")
        .update({
          processing_error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", ledgerId)
    }
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

/**
 * Stable identity for one logical webhook occurrence. Anchored on the
 * most specific resource URI in the payload plus the emission timestamp,
 * so a Calendly retry (same occurrence) collides while a genuine repeat
 * event (e.g. no-show marked, cleared, marked again) does not.
 */
function buildDedupeKey(parsed: WebhookPayload): string | null {
  const p = parsed.payload ?? {}
  const anchor = p?.invitee?.uri ?? p?.uri ?? p?.event?.uri ?? null
  if (!anchor) return null
  return `${parsed.event}:${anchor}:${parsed.created_at ?? ""}`
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
          const newContactId = contactId
          after(() =>
            pushHubContactToKarbon(newContactId, { source: "Calendly Booking" }).catch((err) => {
              console.error("[calendly] karbon push failed (non-blocking):", err)
            }),
          )
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

    // Open (or reuse) the contact's single open Deal. A Calendly booking
    // is one of the three canonical ways a prospect enters the Hub, so
    // the meeting we just linked should hang off an opportunity. The
    // Calendly→Zoom bridge + hub-meetings sync attach the actual meeting
    // row to this deal. Best-effort: never block webhook processing.
    try {
      const deal = await findOrCreateDeal(
        {
          contactId,
          title: invitee.name ?? invitee.email ?? "Calendly Prospect",
          source: "calendly",
        },
        { supabase },
      )
      // A booking is the definition of `meeting_scheduled`. Monotonic, so
      // a second booking on an already-debriefed deal is a no-op rather
      // than a regression.
      const moved = await advanceDealStage(supabase, deal.deal_id, "meeting_scheduled")
      if (moved.advanced) {
        console.log(`[calendly] deal ${deal.deal_id} stage ${moved.reason}`)
      }
    } catch (err) {
      console.error("[calendly] deal create failed (non-blocking):", err)
    }
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

/**
 * Mirrors the booking into the unified `meetings` table immediately —
 * keyed by the INTERNAL calendly_events.id, matching the convention of
 * lib/meetings/sync-hub-meetings.ts — and schedules the full Hub
 * Meetings pass (client links, deals, Zoom bridge) off the critical
 * path. Before this, a new booking didn't reach Hub surfaces until the
 * next 30-minute cron tick.
 */
async function mirrorMeetingRealtime(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  savedEventId: string,
  status: "active" | "canceled",
  connection: CalendlyConnectionRow | null,
) {
  const location = event?.location || {}
  const { error } = await supabase.from("meetings").upsert(
    {
      calendly_event_id: savedEventId,
      title: event?.name ?? "Meeting",
      scheduled_start: event?.start_time ?? null,
      scheduled_end: event?.end_time ?? null,
      status: status === "active" ? "scheduled" : "cancelled",
      cancelled_at: status === "canceled" ? (event?.cancellation?.canceled_at ?? new Date().toISOString()) : null,
      cancellation_reason: status === "canceled" ? (event?.cancellation?.reason ?? null) : null,
      location_type: location.type || "virtual",
      video_link: location.join_url ?? null,
      meeting_type: "client_meeting",
      host_id: connection?.team_member_id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "calendly_event_id", ignoreDuplicates: false },
  )
  if (error) console.error("[calendly] meetings mirror failed:", error)

  after(() =>
    syncHubMeetings(supabase)
      .then(() => undefined)
      .catch((err) => {
        console.error("[calendly] hub meetings refresh failed (non-blocking):", err)
      }),
  )
}

/**
 * Attribute a booking back to the intake submission that produced it.
 *
 * The intake pipeline hands each prospect a Calendly link carrying
 * `salesforce_uuid=<jotform_intake_submissions.id>` (see
 * lib/intake/booking-link.ts). Calendly round-trips that value into
 * `invitee.tracking`, so a booking made from an intake link tells us
 * exactly which intake it came from — no email-matching heuristics.
 *
 * Without this the only link between the two halves of the funnel was
 * an implicit join on contact_id, which broke whenever a prospect
 * booked with a different address than they typed on the form.
 *
 * First booking wins: `.is("calendly_event_id", null)` means a
 * reschedule or a second meeting never overwrites the original
 * conversion event.
 */
async function attributeBookingToIntake(
  supabase: ReturnType<typeof createAdminClient>,
  invitee: any,
  calendlyEventId: string,
  startTime: string | null,
): Promise<void> {
  const raw = invitee?.tracking?.salesforce_uuid
  if (typeof raw !== "string") return
  const submissionRowId = raw.trim()
  // Guard the shape before it reaches Postgres: a non-uuid value in a
  // uuid comparison is a 22P02 error, not a no-op.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionRowId)) {
    return
  }

  const { error } = await supabase
    .from("jotform_intake_submissions")
    .update({
      calendly_event_id: calendlyEventId,
      first_booked_at: startTime ?? new Date().toISOString(),
    })
    .eq("id", submissionRowId)
    .is("calendly_event_id", null)

  if (error) {
    console.error("[calendly] intake attribution failed:", error.message)
  } else {
    console.log(`[calendly] attributed booking to intake ${submissionRowId}`)
  }
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

  await mirrorMeetingRealtime(supabase, event, saved.id, "active", connection)

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

  // Close the intake → booking loop before any of the async work below,
  // so the conversion is recorded even if a later step times out.
  for (const p of processed) {
    if (!p?.invitee) continue
    await attributeBookingToIntake(
      supabase,
      p.invitee,
      saved.id,
      event?.start_time ?? null,
    )
  }

  // Run ALFRED triage for each invitee. We deliberately do NOT block
  // the webhook response on this — model latency on a slow link can
  // exceed Calendly's webhook timeout. Fire-and-forget with a top-level
  // try/catch inside the helper so any failure stays out of the
  // critical path. The audit row in calendly_alfred_triage_log is the
  // durable record either way.
  for (const p of processed) {
    if (!p?.inviteeUuid) continue
    after(() =>
      runAlfredCalendlyTriage(supabase, {
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
      }),
    )
  }

  await notifyTeamMembers(supabase, event, invitee, "created", connection)

  // Fire-and-forget ALFRED email to all team members (opt-out honored via
  // the meeting_booked email category). The email includes everything the
  // team needs at a glance: who booked, when, whether they're new or
  // existing, and a link to the Hub record. Dedupe happens inside
  // notifyTeamOfNewBooking via the team_notified_at column.
  const firstInvitee = processed[0]
  if (firstInvitee?.inviteeUuid) {
    after(() =>
      notifyTeamOfNewBooking({
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
        questionsAndAnswers: firstInvitee.invitee?.questions_and_answers ?? null,
      }).catch((err) => {
        console.error("[calendly] team email failed (non-blocking):", err)
      }),
    )
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
  if (saved) {
    await mirrorMeetingRealtime(supabase, event, saved.id, "canceled", connection)
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

  // Deliberately do NOT touch raw_data here: the no-show webhook payload
  // is a tiny stub, and overwriting the stored invitee snapshot with it
  // would destroy questions_and_answers/tracking/payment data that other
  // code paths rely on. no_show_uri preserves the no-show resource.
  const { error } = await supabase
    .from("calendly_invitees")
    .update({
      status: isNoShow ? "no_show" : "active",
      no_show: isNoShow,
      no_show_uri: noShowUri,
      updated_at: new Date().toISOString(),
    })
    .eq("calendly_uuid", inviteeUuid)
  if (error) console.error("[calendly] no-show update failed:", error)
  return { success: true, action: isNoShow ? "no_show_marked" : "no_show_cleared" }
}

/**
 * Routing form submissions now land in a real table
 * (`calendly_routing_form_submissions`, migration 385) instead of only a
 * notification blob. The parent form row is stubbed if the cron sync
 * hasn't ingested the form definition yet — the next sync pass fills in
 * name/questions. The ops notification is preserved.
 */
async function handleRoutingFormSubmission(payload: any) {
  const supabase = createAdminClient()
  const subUuid = extractUuid(payload?.uri)

  if (subUuid) {
    // Ensure a parent form row exists so the FK link is usable now.
    let routingFormId: string | null = null
    const formUri = payload?.routing_form ?? null
    const formUuid = extractUuid(formUri)
    if (formUuid && formUri) {
      const { data: formRow } = await supabase
        .from("calendly_routing_forms")
        .upsert(
          {
            calendly_uuid: formUuid,
            calendly_uri: formUri,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "calendly_uuid" },
        )
        .select("id")
        .single()
      routingFormId = formRow?.id ?? null
    }

    const { error } = await supabase.from("calendly_routing_form_submissions").upsert(
      {
        calendly_uuid: subUuid,
        calendly_uri: payload.uri,
        routing_form_uri: formUri,
        routing_form_id: routingFormId,
        submitter_uri: payload?.submitter ?? null,
        submitter_type: payload?.submitter_type ?? null,
        questions_and_answers: payload?.questions_and_answers ?? null,
        tracking: payload?.tracking ?? null,
        result: payload?.result ?? null,
        raw_data: payload,
        calendly_created_at: payload?.created_at ?? null,
        calendly_updated_at: payload?.updated_at ?? null,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "calendly_uuid" },
    )
    if (error) console.error("[calendly] routing submission upsert failed:", error)
  }

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
      related_entity_id: subUuid ?? null,
      metadata: payload,
      is_read: false,
      created_at: new Date().toISOString(),
    })
  }
  return { success: true, action: "routing_form_submission_saved" }
}
