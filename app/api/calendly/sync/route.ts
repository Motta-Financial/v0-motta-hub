import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  calendlyListAll,
  calendlyRequest,
  extractUuid,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * Master Calendly sync.
 *
 * Iterates *every* active `calendly_connections` row, paginating through
 * every event_type, scheduled_event, and invitee for the configured
 * window, and upserts the results into our normalized tables. Each
 * connection uses its own OAuth tokens (refreshed on demand by the
 * shared library), so the sync works across an entire organization
 * with one team member per connection — no static access token
 * required.
 *
 * Behaviour summary:
 *  - GET  → returns the most recent sync_log row (status check)
 *  - POST → runs a sync; body parameters control time window
 *      • syncPast?: boolean (default false)
 *      • daysBack?: number (default 30 — only used when syncPast=true)
 *      • daysForward?: number (default 90)
 *      • syncEventTypes?: boolean (default true)
 *      • teamMemberId?: string (limit to a single connection)
 */

interface SyncBody {
  syncPast?: boolean
  daysBack?: number
  daysForward?: number
  syncEventTypes?: boolean
  teamMemberId?: string
}

export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: SyncBody = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const {
    syncPast = false,
    daysBack = 30,
    daysForward = 90,
    syncEventTypes = true,
    teamMemberId,
  } = body

  // Always log a sync attempt so silent failures are visible in the UI.
  const { data: syncLog } = await supabase
    .from("calendly_sync_log")
    .insert({
      sync_type: syncPast ? "full" : "incremental",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  // Load every active, sync-enabled connection (or just one if scoped).
  let connectionsQuery = supabase
    .from("calendly_connections")
    .select("*")
    .eq("is_active", true)
    .eq("sync_enabled", true)
  if (teamMemberId) connectionsQuery = connectionsQuery.eq("team_member_id", teamMemberId)
  const { data: connections, error: connErr } = await connectionsQuery
  if (connErr) {
    await closeLog(supabase, syncLog?.id, "failed", { errors: [connErr.message] })
    return NextResponse.json({ error: connErr.message }, { status: 500 })
  }
  if (!connections || connections.length === 0) {
    await closeLog(supabase, syncLog?.id, "completed", {
      events_synced: 0,
      invitees_synced: 0,
      event_types_synced: 0,
    })
    return NextResponse.json({
      success: true,
      message: "No active Calendly connections to sync",
      synced: { events: 0, invitees: 0, eventTypes: 0 },
    })
  }

  const now = new Date()
  const minStartTime = syncPast
    ? new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString()
    : now.toISOString()
  const maxStartTime = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString()

  let totalEvents = 0
  let totalInvitees = 0
  let totalEventTypes = 0
  const errors: string[] = []

  for (const connection of connections as CalendlyConnectionRow[]) {
    const tag = connection.calendly_user_email || connection.team_member_id
    try {
      if (syncEventTypes) {
        totalEventTypes += await syncEventTypesForConnection(connection, supabase, errors)
      }
      const { events, invitees } = await syncEventsForConnection(
        connection,
        supabase,
        minStartTime,
        maxStartTime,
        errors,
      )
      totalEvents += events
      totalInvitees += invitees

      await supabase
        .from("calendly_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", connection.id)
    } catch (err) {
      errors.push(`[${tag}] ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  await closeLog(
    supabase,
    syncLog?.id,
    errors.length > 0 ? "completed_with_errors" : "completed",
    {
      events_synced: totalEvents,
      invitees_synced: totalInvitees,
      event_types_synced: totalEventTypes,
      errors: errors.length > 0 ? errors : null,
    },
  )

  return NextResponse.json({
    success: true,
    synced: { events: totalEvents, invitees: totalInvitees, eventTypes: totalEventTypes },
    dateRange: { from: minStartTime, to: maxStartTime },
    connectionsProcessed: connections.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}

async function closeLog(
  supabase: ReturnType<typeof createAdminClient>,
  id: string | undefined,
  status: string,
  fields: Record<string, unknown>,
) {
  if (!id) return
  await supabase
    .from("calendly_sync_log")
    .update({ status, completed_at: new Date().toISOString(), ...fields })
    .eq("id", id)
}

async function syncEventTypesForConnection(
  connection: CalendlyConnectionRow,
  supabase: ReturnType<typeof createAdminClient>,
  errors: string[],
): Promise<number> {
  let synced = 0
  try {
    const eventTypes = await calendlyListAll<any>(connection, supabase, "/event_types", {
      query: { user: connection.calendly_user_uri, count: 100 },
    })
    for (const et of eventTypes) {
      const uuid = extractUuid(et.uri)
      if (!uuid) continue
      const { error } = await supabase.from("calendly_event_types").upsert(
        {
          calendly_uuid: uuid,
          calendly_uri: et.uri,
          name: et.name,
          slug: et.slug,
          description_plain: et.description_plain,
          description_html: et.description_html,
          duration_minutes: et.duration,
          kind: et.kind,
          type: et.type,
          pooling_type: et.pooling_type,
          active: et.active,
          booking_method: et.booking_method,
          color: et.color,
          scheduling_url: et.scheduling_url,
          secret: et.secret,
          calendly_user_uri: et.profile?.owner ?? connection.calendly_user_uri,
          raw_data: et,
          calendly_created_at: et.created_at,
          calendly_updated_at: et.updated_at,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendly_uuid" },
      )
      if (error) errors.push(`event_type ${et.name}: ${error.message}`)
      else synced += 1
    }
  } catch (err) {
    errors.push(
      `event_types fetch (${connection.calendly_user_email}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return synced
}

async function syncEventsForConnection(
  connection: CalendlyConnectionRow,
  supabase: ReturnType<typeof createAdminClient>,
  minStart: string,
  maxStart: string,
  errors: string[],
): Promise<{ events: number; invitees: number }> {
  let eventCount = 0
  let inviteeCount = 0

  // We sync both active + canceled events so the dashboard correctly
  // reflects cancellations that happen in Calendly outside our webhook.
  for (const status of ["active", "canceled"]) {
    let events: any[] = []
    try {
      events = await calendlyListAll<any>(connection, supabase, "/scheduled_events", {
        query: {
          user: connection.calendly_user_uri,
          min_start_time: minStart,
          max_start_time: maxStart,
          status,
          count: 100,
          sort: "start_time:asc",
        },
      })
    } catch (err) {
      errors.push(
        `events fetch ${status} (${connection.calendly_user_email}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      continue
    }

    for (const event of events) {
      const uuid = extractUuid(event.uri)
      if (!uuid) continue
      const location = event.location || {}

      const { data: savedEvent, error: evErr } = await supabase
        .from("calendly_events")
        .upsert(
          {
            calendly_uuid: uuid,
            calendly_uri: event.uri,
            calendly_connection_id: connection.id,
            team_member_id: connection.team_member_id,
            name: event.name,
            status: event.status,
            start_time: event.start_time,
            end_time: event.end_time,
            event_type_uuid: extractUuid(event.event_type),
            event_type_name: event.event_type_name || event.name,
            location_type: location.type,
            location: location.location,
            join_url: location.join_url,
            calendly_user_uri: connection.calendly_user_uri,
            calendly_user_name: connection.calendly_user_name,
            calendly_user_email: connection.calendly_user_email,
            canceled_at: event.cancellation?.canceled_at,
            canceler_type: event.cancellation?.canceler_type,
            canceler_name: event.cancellation?.canceler?.name,
            cancel_reason: event.cancellation?.reason,
            rescheduled: event.rescheduled || false,
            raw_data: event,
            calendly_created_at: event.created_at,
            calendly_updated_at: event.updated_at,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "calendly_uuid" },
        )
        .select("id")
        .single()

      if (evErr) {
        errors.push(`event ${uuid}: ${evErr.message}`)
        continue
      }
      eventCount += 1

      // Invitees are paginated separately — Calendly tops out at 100 per
      // page and a group event can exceed that.
      try {
        const invitees = await calendlyListAll<any>(connection, supabase, `${event.uri}/invitees`, {
          query: { count: 100 },
        })
        for (const invitee of invitees) {
          const inviteeUuid = extractUuid(invitee.uri)
          if (!inviteeUuid) continue

          // Best-effort link to existing CRM contact by email.
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

          const { error: invErr } = await supabase.from("calendly_invitees").upsert(
            {
              calendly_uuid: inviteeUuid,
              calendly_uri: invitee.uri,
              calendly_event_id: savedEvent?.id,
              calendly_event_uuid: uuid,
              email: invitee.email,
              name: invitee.name,
              status: invitee.status,
              timezone: invitee.timezone,
              reschedule_url: invitee.reschedule_url,
              cancel_url: invitee.cancel_url,
              canceled_at: invitee.cancellation?.canceled_at,
              canceler_type: invitee.cancellation?.canceler_type,
              cancel_reason: invitee.cancellation?.reason,
              questions_answers: invitee.questions_and_answers,
              utm_source: invitee.tracking?.utm_source,
              utm_medium: invitee.tracking?.utm_medium,
              utm_campaign: invitee.tracking?.utm_campaign,
              utm_term: invitee.tracking?.utm_term,
              utm_content: invitee.tracking?.utm_content,
              contact_id: contactId,
              raw_data: invitee,
              calendly_created_at: invitee.created_at,
              calendly_updated_at: invitee.updated_at,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "calendly_uuid" },
          )
          if (invErr) errors.push(`invitee ${invitee.email}: ${invErr.message}`)
          else inviteeCount += 1
        }
      } catch (err) {
        errors.push(
          `invitees ${uuid}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      // Mirror into the unified `meetings` table so other surfaces
      // (notifications, reporting) get a consistent view.
      await supabase.from("meetings").upsert(
        {
          calendly_event_id: uuid,
          title: event.name,
          scheduled_start: event.start_time,
          scheduled_end: event.end_time,
          status: event.status === "active" ? "scheduled" : "cancelled",
          location_type: location.type || "virtual",
          video_link: location.join_url,
          meeting_type: "client_meeting",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendly_event_id", ignoreDuplicates: false },
      )
    }
  }

  return { events: eventCount, invitees: inviteeCount }
}

/**
 * Diagnostic helper used by the UI: returns the most recent sync result
 * along with a count of active connections and a hint about whether
 * a full sync is overdue.
 */
export async function GET() {
  const supabase = createAdminClient()
  const [{ data: lastSync }, { count: connectionCount }] = await Promise.all([
    supabase
      .from("calendly_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("calendly_connections")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("sync_enabled", true),
  ])

  const stale =
    lastSync?.completed_at &&
    Date.now() - new Date(lastSync.completed_at).getTime() > 6 * 60 * 60 * 1000

  return NextResponse.json({ lastSync, connectionCount: connectionCount ?? 0, stale: !!stale })
}
