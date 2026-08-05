import { type NextRequest, NextResponse, after } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import {
  CalendlyApiError,
  calendlyRequest,
  createEventInvitee,
  extractUuid,
  getEventTypeAvailableTimes,
  type CalendlyConnectionRow,
  type CreateEventInviteeRequest,
} from "@/lib/calendly-api"
import { mapCalendlyEventFields, mapCalendlyInviteeFields } from "@/lib/calendly-field-mapping"
import {
  extractPhoneFromInvitee,
  matchInviteeToContact,
  upsertAutoClientLink,
} from "@/lib/calendly-invitee-match"
import { findOrCreateDeal } from "@/lib/deals/find-or-create-deal"
import { syncHubMeetings } from "@/lib/meetings/sync-hub-meetings"

/**
 * Scheduling API — book meetings for clients directly from the Hub.
 *
 * Calendly's Scheduling API removes the redirect/iframe hop: staff can
 * pick a slot and book on a client's behalf without leaving the Hub.
 *
 *   GET  ?eventType=<uri|uuid>&start_time=&end_time=&teamMemberId=
 *        → available start times (Calendly caps the window at 31 days)
 *   POST { eventTypeUri|eventTypeUuid, startTime, invitee{...}, ... }
 *        → books the meeting AND persists it to Supabase immediately,
 *          so Hub surfaces reflect the booking without waiting for the
 *          webhook round-trip or the 30-minute cron.
 *
 * https://developer.calendly.com/api-docs/p3ghrxrwbl8kqe-create-event-invitee-scheduling-api
 */

async function resolveConnection(
  requestedTeamMemberId: string | null,
): Promise<
  | { connection: CalendlyConnectionRow; admin: ReturnType<typeof createAdminClient> }
  | { error: string; status: number }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await getAuthenticatedUser(supabase)
  if (!user) return { error: "Unauthorized", status: 401 }

  let teamMemberId = requestedTeamMemberId
  if (!teamMemberId) {
    const { data: tm } = await supabase
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .single()
    teamMemberId = tm?.id ?? null
  }
  if (!teamMemberId) return { error: "Team member not found", status: 404 }

  const admin = createAdminClient()
  const { data: connection } = await admin
    .from("calendly_connections")
    .select("*")
    .eq("team_member_id", teamMemberId)
    .eq("is_active", true)
    .maybeSingle()
  if (!connection) {
    return { error: "Calendly not connected for this team member", status: 404 }
  }
  return { connection: connection as CalendlyConnectionRow, admin }
}

function toEventTypeUri(input: string): string {
  return input.startsWith("http")
    ? input
    : `https://api.calendly.com/event_types/${input}`
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const eventType = sp.get("eventType")
    if (!eventType) {
      return NextResponse.json({ error: "eventType required" }, { status: 400 })
    }

    const resolved = await resolveConnection(sp.get("teamMemberId"))
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const startTime = sp.get("start_time") || new Date().toISOString()
    const endTime =
      sp.get("end_time") ||
      new Date(new Date(startTime).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()

    const times = await getEventTypeAvailableTimes(
      resolved.connection,
      resolved.admin,
      toEventTypeUri(eventType),
      startTime,
      endTime,
    )
    return NextResponse.json({ availableTimes: times, window: { startTime, endTime } })
  } catch (err: any) {
    console.error("[calendly] /book GET error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to fetch available times" },
      { status: err instanceof CalendlyApiError ? err.status : 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const eventTypeInput = body.eventTypeUri || body.eventTypeUuid
    const startTime = body.startTime
    const invitee = body.invitee || {}
    if (!eventTypeInput || !startTime || !invitee.email) {
      return NextResponse.json(
        { error: "eventTypeUri (or eventTypeUuid), startTime, and invitee.email are required" },
        { status: 400 },
      )
    }

    const resolved = await resolveConnection(body.teamMemberId ?? null)
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const { connection, admin } = resolved

    const payload: CreateEventInviteeRequest = {
      event_type: toEventTypeUri(eventTypeInput),
      start_time: startTime,
      invitee: {
        email: invitee.email,
        ...(invitee.name ? { name: invitee.name } : {}),
        ...(invitee.firstName ? { first_name: invitee.firstName } : {}),
        ...(invitee.lastName ? { last_name: invitee.lastName } : {}),
        ...(invitee.timezone ? { timezone: invitee.timezone } : {}),
        ...(invitee.phone ? { text_reminder_number: invitee.phone } : {}),
      },
      ...(body.location ? { location: body.location } : {}),
      ...(Array.isArray(body.guests) && body.guests.length ? { event_guests: body.guests } : {}),
      ...(Array.isArray(body.questionsAndAnswers) && body.questionsAndAnswers.length
        ? { questions_and_answers: body.questionsAndAnswers }
        : {}),
      ...(body.tracking ? { tracking: body.tracking } : {}),
    }

    const created = await createEventInvitee(connection, admin, payload)
    if (!created) {
      return NextResponse.json({ error: "Calendly returned no invitee" }, { status: 502 })
    }

    // Persist immediately — don't make the UI wait for the webhook (which
    // still fires and runs the full pipeline: team email, ALFRED triage,
    // Karbon push; the webhook ledger + team_notified_at dedupe keep any
    // overlap harmless).
    const persisted = await persistBooking(admin, connection, created, body.contactId ?? null)

    return NextResponse.json({
      success: true,
      invitee: {
        uri: created.uri,
        email: created.email,
        name: created.name,
        status: created.status,
        rescheduleUrl: created.reschedule_url,
        cancelUrl: created.cancel_url,
      },
      eventUri: created.event,
      ...persisted,
    })
  } catch (err: any) {
    if (err instanceof CalendlyApiError) {
      // Surface actionable Scheduling API failures: 400 invalid fields,
      // 404 slot/event type gone (slot was taken between fetch and book).
      const friendly =
        err.status === 404
          ? "That time slot is no longer available — refresh availability and pick another."
          : err.message
      return NextResponse.json({ error: friendly, calendlyStatus: err.status }, { status: err.status })
    }
    console.error("[calendly] /book POST error:", err)
    return NextResponse.json({ error: err?.message || "Booking failed" }, { status: 500 })
  }
}

/**
 * Writes the freshly-booked event + invitee into the normalized Calendly
 * tables and mirrors the unified meeting row, reusing the exact mappers
 * the webhook and cron use so all three ingest paths stay identical.
 */
async function persistBooking(
  admin: ReturnType<typeof createAdminClient>,
  connection: CalendlyConnectionRow,
  createdInvitee: any,
  explicitContactId: string | null,
): Promise<{ calendlyEventId?: string; contactId?: string | null }> {
  try {
    const eventUri: string | null = createdInvitee.event ?? null
    const eventUuid = extractUuid(eventUri)
    if (!eventUri || !eventUuid) return {}

    const eventRes = await calendlyRequest<{ resource: any }>(connection, admin, eventUri)
    const event = eventRes?.resource
    if (!event) return {}

    const { data: savedEvent, error: evErr } = await admin
      .from("calendly_events")
      .upsert(
        {
          ...mapCalendlyEventFields(event),
          calendly_uuid: eventUuid,
          calendly_uri: event.uri,
          calendly_connection_id: connection.id,
          team_member_id: connection.team_member_id,
          status: event.status ?? "active",
          calendly_user_uri: connection.calendly_user_uri,
          calendly_user_name: connection.calendly_user_name,
          calendly_user_email: connection.calendly_user_email,
          raw_data: event,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendly_uuid" },
      )
      .select("id")
      .single()
    if (evErr || !savedEvent) {
      console.error("[calendly] /book event persist failed:", evErr)
      return {}
    }

    // Contact: honor an explicitly-supplied Hub contact (staff booked for
    // a known client), else fall back to the deterministic matcher.
    let contactId = explicitContactId
    if (!contactId) {
      const match = await matchInviteeToContact(admin, {
        email: createdInvitee.email,
        name: createdInvitee.name,
        phone: extractPhoneFromInvitee(createdInvitee),
      })
      contactId = match?.contactId ?? null
    }

    const inviteeUuid = extractUuid(createdInvitee.uri)
    if (inviteeUuid) {
      await admin.from("calendly_invitees").upsert(
        {
          ...mapCalendlyInviteeFields(createdInvitee),
          calendly_uuid: inviteeUuid,
          calendly_uri: createdInvitee.uri,
          calendly_event_id: savedEvent.id,
          calendly_event_uuid: eventUuid,
          contact_id: contactId,
          raw_data: createdInvitee,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendly_uuid" },
      )
    }

    if (contactId) {
      await upsertAutoClientLink(admin, {
        calendlyEventId: savedEvent.id,
        contactId,
        matchMethod: "email",
      })
      try {
        await findOrCreateDeal(
          {
            contactId,
            title: createdInvitee.name ?? createdInvitee.email ?? "Calendly Prospect",
            source: "calendly",
          },
          { supabase: admin },
        )
      } catch (err) {
        console.error("[calendly] /book deal create failed (non-blocking):", err)
      }
    }

    const location = event.location || {}
    await admin.from("meetings").upsert(
      {
        calendly_event_id: savedEvent.id,
        title: event.name ?? "Meeting",
        scheduled_start: event.start_time ?? null,
        scheduled_end: event.end_time ?? null,
        status: "scheduled",
        location_type: location.type || "virtual",
        video_link: location.join_url ?? null,
        meeting_type: "client_meeting",
        host_id: connection.team_member_id ?? null,
        contact_id: contactId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "calendly_event_id", ignoreDuplicates: false },
    )

    after(() =>
      syncHubMeetings(admin)
        .then(() => undefined)
        .catch((err) => {
          console.error("[calendly] /book hub meetings refresh failed:", err)
        }),
    )

    return { calendlyEventId: savedEvent.id, contactId }
  } catch (err) {
    // Persistence is best-effort: the booking already exists at Calendly
    // and the webhook/cron will ingest it; never fail the API response.
    console.error("[calendly] /book persist failed (booking succeeded):", err)
    return {}
  }
}
