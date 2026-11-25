import { NextResponse, after } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  calendlyListAll,
  extractUuid,
  verifyWebhookSignature,
} from "@/lib/calendly-api"
import { extractPhoneFromInvitee } from "@/lib/calendly-invitee-match"
import { runAlfredCalendlyTriage } from "@/lib/alfred/calendly-triage"
import { mapCalendlyEventFields, mapCalendlyInviteeFields } from "@/lib/calendly-field-mapping"
import {
  attributeBookingToIntake,
  loadHostDirectory,
  normalizeInviteeWebhookPayload,
  resolveEventHost,
  resolveInviteeContact,
  runBookingFollowUps,
  type ResolvedHost,
} from "@/lib/calendly/booking-pipeline"
import { syncHubMeetings } from "@/lib/meetings/sync-hub-meetings"
import { firmConfigSync } from "@/lib/firm-settings"

/**
 * Calendly webhook receiver.
 *
 * Handles every event emitted by the Webhooks v2 API. Payloads are
 * verified using the proper `t=...,v1=...` signature header before any
 * DB write occurs. When extra invitee data must be fetched, we use the
 * connection token belonging to the host of the event — *not* a static
 * `CALENDLY_ACCESS_TOKEN` — so multi-team-member orgs work correctly.
 *
 * The subscription is ORGANIZATION-scoped, so a delivery arrives for a
 * booking on ANY teammate's calendar — including teammates who never
 * connected Calendly to the Hub. Nothing here may assume the host has a
 * connection row; see `resolveEventHost`.
 *
 * Everything that follows a booking (contact, intake attribution, the
 * firm-wide email, the Karbon lead status) is shared with the polling
 * sync through `lib/calendly/booking-pipeline.ts`, which also sweeps up
 * any booking this handler misses.
 *
 * Reference: https://developer.calendly.com/api-docs/ZG9jOjE2OTU3NzMx-webhook-signatures
 */

export const runtime = "nodejs"
// The response returns in well under a second; the budget is for the
// `after()` work — ALFRED triage, the research pass behind the team
// email, and the Karbon follow-up.
export const maxDuration = 300

const WEBHOOK_SIGNING_KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY

/**
 * A delivery we understood well enough to know it can never be processed
 * (unrecognised shape). Recorded on the ledger and acknowledged with a
 * 200 — a retry of the same bytes would fail the same way.
 */
class UnprocessablePayloadError extends Error {}

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
    // v2 payloads carry the event under `scheduled_event` (and as a bare
    // URI string in `event`); the legacy shape nests it under `event`.
    const eventUri =
      p?.scheduled_event?.uri ??
      (typeof p?.event === "string" ? p.event : p?.event?.uri) ??
      p?.invitee?.event ??
      null
    const { data: ledger, error: ledgerErr } = await supabase
      .from("calendly_webhook_events")
      .insert({
        event_type: parsed.event,
        calendly_event_uuid: extractUuid(eventUri) ?? null,
        signature_valid: !!WEBHOOK_SIGNING_KEY,
        dedupe_key: dedupeKey,
        payload: parsed,
      })
      .select("id")
      .single()
    if (ledgerErr) {
      if (ledgerErr.code === "23505" && dedupeKey) {
        // 23505 = unique violation on dedupe_key → we have seen this exact
        // occurrence before. Only skip it if that attempt SUCCEEDED: a
        // delivery whose first attempt errored is exactly what Calendly's
        // retry is for, and swallowing it would lose the booking.
        const { data: prior } = await supabase
          .from("calendly_webhook_events")
          .select("id, received_at, processed_at, processing_error")
          .eq("dedupe_key", dedupeKey)
          .maybeSingle()
        const failed = !!prior?.processing_error
        // Neither finished nor errored after two minutes: the first
        // attempt died mid-flight (function timeout / crash).
        const stalled =
          !!prior &&
          !prior.processed_at &&
          !prior.processing_error &&
          Date.now() - new Date(prior.received_at as string).getTime() > 2 * 60_000
        if (!prior || !(failed || stalled)) {
          // Processed, or still in flight (org + user subscriptions
          // deliver the same occurrence milliseconds apart) — either
          // way this copy has nothing to add.
          return NextResponse.json({ success: true, action: "duplicate_ignored" })
        }
        ledgerId = prior.id
        console.log(
          `[calendly] reprocessing delivery whose first attempt ${failed ? `failed: ${prior.processing_error}` : "stalled"}`,
        )
      } else {
        // Ledger write failing must not drop the webhook — process anyway.
        console.error("[calendly] webhook ledger insert failed:", ledgerErr)
      }
    } else {
      ledgerId = ledger?.id ?? null
    }
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
        .update({ processed_at: new Date().toISOString(), processing_error: null })
        .eq("id", ledgerId)
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[calendly] webhook processing failed:", err)
    if (ledgerId) {
      await supabase
        .from("calendly_webhook_events")
        .update({ processing_error: message })
        .eq("id", ledgerId)
    }
    if (err instanceof UnprocessablePayloadError) {
      // Acknowledge: retrying identical bytes cannot succeed. The ledger
      // row keeps the payload and the reason for whoever investigates.
      return NextResponse.json({ success: false, error: message })
    }
    // Anything else may be transient (database, network) — a 5xx asks
    // Calendly to redeliver, and the ledger lets that retry through.
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
 * Persistence helpers
 * ─────────────────────────────────────────────────────────────────────── */

type AdminSupabase = ReturnType<typeof createAdminClient>

async function upsertEvent(
  supabase: AdminSupabase,
  event: any,
  status: "active" | "canceled",
  host: ResolvedHost,
) {
  const uuid = extractUuid(event.uri)
  if (!uuid) return null

  // Full field capture lives in the shared mapper so the webhook and the
  // polling sync stay identical. We override `status` with the value the
  // caller derived and add the host attribution on top.
  //
  // Attribution columns are written ONLY when resolved. This is an
  // upsert on `calendly_uuid`, so an unconditional `null` would erase
  // the teammate link the sync had already worked out — and a booking on
  // a calendar with no Hub connection would fall off the Team Calendar's
  // host filter every time Calendly sent an update for it.
  const { data, error } = await supabase
    .from("calendly_events")
    .upsert(
      {
        ...mapCalendlyEventFields(event),
        calendly_uuid: uuid,
        calendly_uri: event.uri,
        ...(host.connection ? { calendly_connection_id: host.connection.id } : {}),
        ...(host.teamMemberId ? { team_member_id: host.teamMemberId } : {}),
        ...(host.userUri ? { calendly_user_uri: host.userUri } : {}),
        ...(host.userName ? { calendly_user_name: host.userName } : {}),
        ...(host.userEmail ? { calendly_user_email: host.userEmail } : {}),
        status,
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
  return data as { id: string; calendly_uuid: string }
}

interface ProcessedInvitee {
  inviteeUuid: string | null
  deterministicMatch: { contactId: string | null; matchMethod: "email" | "name_phone" | "name" | null }
  wasNewContact: boolean
  invitee: any
}

async function upsertInvitee(
  supabase: AdminSupabase,
  invitee: any,
  eventId: string,
  eventUuid: string,
  options: { resolveContact: boolean },
): Promise<ProcessedInvitee> {
  const uuid = extractUuid(invitee.uri)
  if (!uuid)
    return {
      inviteeUuid: null,
      deterministicMatch: { contactId: null, matchMethod: null },
      wasNewContact: false,
      invitee,
    }

  // Match invitee → CRM contact (email → name+phone → name), creating a
  // Hub contact on a miss, tagging the meeting with that client and
  // opening the deal. Shared with the cron backstop so a booking the
  // webhook misses ends up in exactly the same state.
  //
  // A cancellation does not create anything: it only needs to find the
  // contact it was already linked to.
  const resolved = options.resolveContact
    ? await resolveInviteeContact(
        supabase,
        {
          email: invitee.email ?? null,
          name: invitee.name ?? null,
          phone: extractPhoneFromInvitee(invitee),
        },
        eventId,
        { defer: (task) => after(task) },
      )
    : { contactId: null, matchMethod: null, wasNewContact: false }

  const { error } = await supabase.from("calendly_invitees").upsert(
    {
      ...mapCalendlyInviteeFields(invitee),
      calendly_uuid: uuid,
      calendly_uri: invitee.uri,
      calendly_event_id: eventId,
      calendly_event_uuid: eventUuid,
      // Never blank an existing link when we chose not to (re)resolve.
      ...(options.resolveContact ? { contact_id: resolved.contactId } : {}),
      raw_data: invitee,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "calendly_uuid" },
  )
  if (error) console.error("[calendly] invitee upsert failed:", error)
  return {
    inviteeUuid: uuid,
    deterministicMatch: { contactId: resolved.contactId, matchMethod: resolved.matchMethod },
    wasNewContact: resolved.wasNewContact,
    invitee,
  }
}

/**
 * In-app notification for a new / cancelled meeting. Goes to the host
 * when we know which teammate that is; otherwise it is broadcast.
 */
async function notifyTeamMembers(
  supabase: AdminSupabase,
  event: any,
  invitee: any,
  kind: "created" | "rescheduled" | "canceled",
  host: ResolvedHost,
  /** `calendly_events.id` — the row the notification points at. */
  eventRowId: string,
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
        // The server runs in UTC; show the firm's own clock.
        timeZone: firmConfigSync().timezone || "America/New_York",
      })
    : ""

  const title =
    kind === "created"
      ? "New Meeting Scheduled"
      : kind === "rescheduled"
        ? "Meeting Rescheduled"
        : "Meeting Canceled"
  const message =
    kind === "created"
      ? `${inviteeName} booked a ${eventName} for ${startTime}`
      : kind === "rescheduled"
        ? `${inviteeName} moved their ${eventName} to ${startTime}`
        : `${inviteeName} canceled their ${eventName} scheduled for ${startTime}`
  const notificationType = kind === "canceled" ? "meeting_canceled" : "meeting_scheduled"

  let recipients: { id: string }[] = []
  if (host.teamMemberId) {
    recipients = [{ id: host.teamMemberId }]
  } else {
    const { data: members } = await supabase
      .from("team_members")
      .select("id")
      .eq("status", "active")
    recipients = members ?? []
  }
  if (recipients.length === 0) return

  // Column names follow the `notifications` table as every other writer
  // uses it (entity_type / entity_id / action_url). This insert used to
  // send `related_entity_type`, `related_entity_id` and `metadata`, none
  // of which exist, so it could only ever fail.
  const rows = recipients.map((member) => ({
    team_member_id: member.id,
    notification_type: notificationType,
    title,
    message,
    entity_type: "calendly_event",
    entity_id: eventRowId,
    action_url: "/meetings/calendar",
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
  supabase: AdminSupabase,
  event: any,
  savedEventId: string,
  status: "active" | "canceled",
  hostTeamMemberId: string | null,
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
      // Same rule as the event row: never overwrite a known host with null.
      ...(hostTeamMemberId ? { host_id: hostTeamMemberId } : {}),
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

/* ─────────────────────────────────────────────────────────────────────────
 * Event handlers
 * ─────────────────────────────────────────────────────────────────────── */

/** Calendly reports the event's own status; trust it over the hook name. */
function eventStatus(scheduledEvent: any): "active" | "canceled" {
  return scheduledEvent?.status === "canceled" ? "canceled" : "active"
}

async function handleInviteeCreated(payload: any) {
  const booking = normalizeInviteeWebhookPayload(payload)
  if (!booking) {
    throw new UnprocessablePayloadError("invitee.created payload has no scheduled event")
  }
  const { scheduledEvent, invitee } = booking
  const supabase = createAdminClient()

  const host = resolveEventHost(scheduledEvent, await loadHostDirectory(supabase))
  const status = eventStatus(scheduledEvent)

  const saved = await upsertEvent(supabase, scheduledEvent, status, host)
  // Throwing (→ 500) asks Calendly to redeliver; the ledger lets the
  // retry through because this attempt is recorded as failed.
  if (!saved) throw new Error("calendly_events upsert failed")

  await mirrorMeetingRealtime(supabase, scheduledEvent, saved.id, status, host.teamMemberId)

  // v2 payloads always carry the invitee inline. If one ever doesn't, we
  // hydrate with the token of a connected host.
  const processed: ProcessedInvitee[] = []
  if (invitee) {
    processed.push(
      await upsertInvitee(supabase, invitee, saved.id, saved.calendly_uuid, { resolveContact: true }),
    )
  } else if (host.connection) {
    const fetched = await calendlyListAll<any>(
      host.connection,
      supabase,
      `${scheduledEvent.uri}/invitees`,
      { query: { count: 100 } },
    ).catch(() => [])
    for (const i of fetched) {
      processed.push(
        await upsertInvitee(supabase, i, saved.id, saved.calendly_uuid, { resolveContact: true }),
      )
    }
  }

  // Close the intake → booking loop before any of the async work below,
  // so the conversion is recorded even if a later step times out.
  let intakeSubmissionId: string | null = null
  for (const p of processed) {
    if (!p?.invitee) continue
    const attributed = await attributeBookingToIntake(
      supabase,
      p.invitee.tracking,
      saved.id,
      scheduledEvent.created_at ?? null,
    )
    intakeSubmissionId = intakeSubmissionId ?? attributed
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
        eventName: scheduledEvent?.name ?? null,
        eventTypeName: scheduledEvent?.name ?? null,
        startTime: scheduledEvent?.start_time ?? null,
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

  const first = processed[0]
  // A reschedule arrives as a brand-new invitee that points back at the
  // one it replaces.
  const isReschedule = !!first?.invitee?.old_invitee
  if (status === "active") {
    await notifyTeamMembers(
      supabase,
      scheduledEvent,
      first?.invitee ?? invitee,
      isReschedule ? "rescheduled" : "created",
      host,
      saved.id,
    )
  }

  // Off the response path: the firm-wide ALFRED email (opt-out honoured
  // via the `meeting_booked` category) and the Karbon lead-status
  // update. Both are idempotent — the email claims `team_notified_at`
  // atomically — so the cron backstop can safely overlap with this.
  if (first?.inviteeUuid && status === "active") {
    after(() =>
      runBookingFollowUps(supabase, {
        eventId: saved.id,
        contactId: first.deterministicMatch.contactId,
        intakeSubmissionId,
        wasNewContact: first.wasNewContact,
      }).catch((err) => {
        console.error("[calendly] booking follow-ups failed (non-blocking):", err)
      }),
    )
  }

  return { success: true, action: "invitee_created" }
}

async function handleInviteeCanceled(payload: any) {
  const booking = normalizeInviteeWebhookPayload(payload)
  if (!booking) {
    throw new UnprocessablePayloadError("invitee.canceled payload has no scheduled event")
  }
  const { scheduledEvent, invitee } = booking
  const supabase = createAdminClient()

  const host = resolveEventHost(scheduledEvent, await loadHostDirectory(supabase))
  // One invitee leaving a group event does not cancel the event — take
  // the event's status from Calendly rather than from the hook name.
  const status = eventStatus(scheduledEvent)

  const saved = await upsertEvent(supabase, scheduledEvent, status, host)
  if (!saved) throw new Error("calendly_events upsert failed")

  if (invitee) {
    await upsertInvitee(supabase, invitee, saved.id, saved.calendly_uuid, { resolveContact: false })
  }
  await mirrorMeetingRealtime(supabase, scheduledEvent, saved.id, status, host.teamMemberId)

  // The cancelled half of a reschedule is not a cancellation worth
  // announcing — the new booking's own notification says it moved.
  if (!invitee?.rescheduled) {
    await notifyTeamMembers(supabase, scheduledEvent, invitee, "canceled", host, saved.id)
  }
  return { success: true, action: invitee?.rescheduled ? "invitee_rescheduled" : "invitee_canceled" }
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
    // `entity_id` is a uuid column and Calendly's submission id is not
    // one, so only the type is recorded; the submission itself is in
    // `calendly_routing_form_submissions` (written above).
    const { error } = await supabase.from("notifications").insert({
      team_member_id: members[0].id,
      notification_type: "routing_form_submission",
      title: "Routing form submitted",
      message: `New Calendly routing form submission received`,
      entity_type: "calendly_routing_form",
      is_read: false,
      created_at: new Date().toISOString(),
    })
    if (error) console.error("[calendly] routing form notification insert failed:", error)
  }
  return { success: true, action: "routing_form_submission_saved" }
}
