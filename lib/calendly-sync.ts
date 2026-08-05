import { createAdminClient } from "@/lib/supabase/server"
import {
  CalendlyApiError,
  calendlyListAll,
  calendlyRequest,
  ensureOrgWebhookSubscription,
  ensureWebhookSubscription,
  extractUuid,
  fetchMe,
  getAppBaseUrl,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"
import {
  extractPhoneFromInvitee,
  matchInviteeToContact,
  upsertAutoClientLink,
} from "@/lib/calendly-invitee-match"
import { mapCalendlyEventFields, mapCalendlyInviteeFields } from "@/lib/calendly-field-mapping"
import { syncHubMeetings } from "@/lib/meetings/sync-hub-meetings"

/**
 * Reusable Calendly sync engine.
 *
 * Lives outside the Next.js route file so server-side surfaces (cron
 * handlers, manual triggers from other endpoints) can invoke it without
 * round-tripping through HTTP and re-tripping the Supabase auth
 * middleware that protects the user-facing API.
 */

export interface SyncBody {
  syncPast?: boolean
  daysBack?: number
  daysForward?: number
  syncEventTypes?: boolean
  teamMemberId?: string
}

export interface SyncResult {
  success: boolean
  message?: string
  synced: {
    events: number
    invitees: number
    eventTypes: number
    orgEvents: number
    routingForms: number
    routingFormSubmissions: number
  }
  webhookHealth?: { orgSubscribed: boolean; userSubscriptions: number; error?: string }
  dateRange?: { from: string; to: string }
  connectionsProcessed: number
  errors?: string[]
}

type AdminSupabase = ReturnType<typeof createAdminClient>

/**
 * Iterates every active `calendly_connections` row, paginating through
 * every event_type, scheduled_event, and invitee for the configured
 * window, and upserts the results into our normalized tables. Each
 * connection uses its own OAuth tokens (refreshed on demand by the
 * shared library), so the sync works across an entire organization
 * with one team member per connection — no static access token
 * required.
 *
 * Beyond the per-connection pass, each run also:
 *   · self-heals webhook subscriptions (org-scope preferred) so the
 *     real-time path can never silently die again;
 *   · runs an org-wide catch-all so bookings hosted by team members
 *     whose OAuth connection lapsed still land in Supabase;
 *   · syncs routing forms + submissions;
 *   · refreshes the unified Hub `meetings` mirror.
 */
export async function runCalendlySync(body: SyncBody = {}): Promise<SyncResult> {
  const supabase = createAdminClient()
  const {
    syncPast = false,
    daysBack = 30,
    daysForward = 90,
    syncEventTypes = true,
    teamMemberId,
  } = body

  const { data: syncLog } = await supabase
    .from("calendly_sync_log")
    .insert({
      sync_type: syncPast ? "full" : "incremental",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  let connectionsQuery = supabase
    .from("calendly_connections")
    .select("*")
    .eq("is_active", true)
    .eq("sync_enabled", true)
  if (teamMemberId) connectionsQuery = connectionsQuery.eq("team_member_id", teamMemberId)
  const { data: connections, error: connErr } = await connectionsQuery

  if (connErr) {
    await closeLog(supabase, syncLog?.id, "failed", { errors: [connErr.message] })
    return {
      success: false,
      message: connErr.message,
      synced: emptyCounts(),
      connectionsProcessed: 0,
      errors: [connErr.message],
    }
  }

  if (!connections || connections.length === 0) {
    await closeLog(supabase, syncLog?.id, "completed", {
      events_synced: 0,
      invitees_synced: 0,
      event_types_synced: 0,
    })
    return {
      success: true,
      message: "No active Calendly connections to sync",
      synced: emptyCounts(),
      connectionsProcessed: 0,
    }
  }

  const activeConnections = connections as CalendlyConnectionRow[]
  const errors: string[] = []

  // Webhook self-healing runs FIRST so the real-time path comes back to
  // life even if the rest of the sync errors out. This is what repairs
  // subscriptions registered without (or with a rotated) signing key —
  // the failure mode that silently 401'd every delivery.
  const webhookHealth = await ensureWebhookHealth(supabase, activeConnections, errors)

  const now = new Date()
  const minStartTime = syncPast
    ? new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString()
    : now.toISOString()
  const maxStartTime = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString()

  let totalEvents = 0
  let totalInvitees = 0
  let totalEventTypes = 0

  for (const connection of activeConnections) {
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

      // Surface the most recent error per-connection so the diagnostics
      // UI can display "your last sync had a problem" without forcing the
      // user to dig through the global sync log.
      const connErrors = errors.filter((e) => e.includes(`(${tag})`))
      await supabase
        .from("calendly_connections")
        .update({
          last_synced_at: new Date().toISOString(),
          last_sync_error: connErrors.length ? connErrors.join("\n") : null,
        })
        .eq("id", connection.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`[${tag}] ${msg}`)
      await supabase
        .from("calendly_connections")
        .update({ last_sync_error: msg })
        .eq("id", connection.id)
    }
  }

  // Org-wide catch-all: bookings hosted by team members WITHOUT an
  // active connection (expired token, never connected) are invisible to
  // the per-connection loops above but still belong in the Hub. Any
  // active connection in the same org can list them.
  let orgEvents = 0
  if (!teamMemberId) {
    orgEvents = await syncOrgWideEvents(
      supabase,
      activeConnections,
      minStartTime,
      maxStartTime,
      errors,
    )
  }

  // Routing forms + submissions (org-level resources, one pass per run).
  const routing = await syncRoutingForms(supabase, activeConnections, errors)

  await closeLog(
    supabase,
    syncLog?.id,
    errors.length > 0 ? "completed_with_errors" : "completed",
    {
      events_synced: totalEvents,
      invitees_synced: totalInvitees,
      event_types_synced: totalEventTypes,
      errors: errors.length > 0 ? errors : null,
      details: {
        org_events: orgEvents,
        routing_forms: routing.forms,
        routing_form_submissions: routing.submissions,
        webhook_health: webhookHealth,
      },
    },
  )

  // Refresh the unified Hub Meetings table off the freshly-synced Calendly
  // (and already-synced Zoom) records. Non-fatal: a failure here must not
  // fail the Calendly sync, so we swallow and log.
  try {
    await syncHubMeetings(supabase)
  } catch (err) {
    console.error("[calendly-sync] hub meetings refresh failed:", err)
  }

  // Apply client-provided intake/Calendly data to Hub contacts
  // (migration 384, superset of 383's state propagation): missing
  // email/phone/state fill automatically; values that CONFLICT with the
  // Hub record are queued in contact_update_suggestions for staff review
  // at /admin/contact-updates. Non-fatal.
  try {
    const { data: leadSync, error: leadErr } = await supabase.rpc(
      "sync_lead_contact_updates",
    )
    if (leadErr) {
      console.error("[calendly-sync] lead contact sync failed (non-fatal):", leadErr.message)
    } else if (leadSync?.[0]) {
      console.log("[calendly-sync] lead contact sync:", leadSync[0])
    }
  } catch (err) {
    console.error("[calendly-sync] lead contact sync crashed (non-fatal):", err)
  }

  return {
    success: true,
    synced: {
      events: totalEvents,
      invitees: totalInvitees,
      eventTypes: totalEventTypes,
      orgEvents,
      routingForms: routing.forms,
      routingFormSubmissions: routing.submissions,
    },
    webhookHealth,
    dateRange: { from: minStartTime, to: maxStartTime },
    connectionsProcessed: activeConnections.length,
    errors: errors.length > 0 ? errors : undefined,
  }
}

function emptyCounts(): SyncResult["synced"] {
  return {
    events: 0,
    invitees: 0,
    eventTypes: 0,
    orgEvents: 0,
    routingForms: 0,
    routingFormSubmissions: 0,
  }
}

async function closeLog(
  supabase: AdminSupabase,
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

/* ─────────────────────────────────────────────────────────────────────────
 * Webhook self-healing
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Keeps exactly one healthy delivery path alive, preferring a single
 * ORG-scope subscription (covers every host in the org and is the only
 * scope Calendly allows for routing-form events). Falls back to per-user
 * subscriptions when no connection has the role to create org webhooks.
 *
 * When the org subscription is healthy, redundant user-scope
 * subscriptions pointing at our callback are deleted — otherwise every
 * booking would be delivered twice (the receiver's dedupe ledger would
 * absorb it, but there's no reason to pay double deliveries).
 */
async function ensureWebhookHealth(
  supabase: AdminSupabase,
  connections: CalendlyConnectionRow[],
  errors: string[],
): Promise<{ orgSubscribed: boolean; userSubscriptions: number; error?: string }> {
  try {
    const org = await ensureOrgWebhookSubscription(supabase)

    if (org.webhook) {
      // Prune redundant user-scope subscriptions at our callback.
      for (const conn of connections) {
        try {
          await ensureNoUserScopeSubscription(conn, supabase)
        } catch (err) {
          // Non-fatal: worst case the dedupe ledger absorbs dual delivery.
          console.error(
            `[calendly-sync] user-scope webhook prune failed (${conn.calendly_user_email}):`,
            err,
          )
        }
      }
      return { orgSubscribed: true, userSubscriptions: 0 }
    }

    // No org-capable connection — fall back to per-user subscriptions so
    // at least each connected host's bookings arrive in real time.
    let userSubs = 0
    for (const conn of connections) {
      const res = await ensureWebhookSubscription(conn, supabase, { scope: "user" })
      if (res.webhook) userSubs += 1
      else if (res.error) errors.push(`webhook (${conn.calendly_user_email}): ${res.error}`)
    }
    return { orgSubscribed: false, userSubscriptions: userSubs, error: org.error }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`webhook health: ${msg}`)
    return { orgSubscribed: false, userSubscriptions: 0, error: msg }
  }
}

/** Deletes any user-scope subscription for `connection` that points at our callback. */
async function ensureNoUserScopeSubscription(
  connection: CalendlyConnectionRow,
  supabase: AdminSupabase,
) {
  const callbackUrl = `${getAppBaseUrl()}/api/calendly/webhook`
  const me = await fetchMe(connection, supabase)
  if (!me) return
  const list = await calendlyRequest<{ collection: any[] }>(
    connection,
    supabase,
    "/webhook_subscriptions",
    { query: { scope: "user", user: me.uri, organization: me.current_organization, count: 100 } },
  )
  for (const sub of list?.collection ?? []) {
    if (sub.callback_url !== callbackUrl || sub.state !== "active") continue
    await calendlyRequest(connection, supabase, sub.uri, {
      method: "DELETE",
      allowNotFound: true,
    })
    await supabase
      .from("calendly_webhook_subscriptions")
      .delete()
      .eq("calendly_webhook_uri", sub.uri)
    console.log(
      `[calendly-sync] removed redundant user-scope webhook for ${connection.calendly_user_email}`,
    )
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Event types
 * ─────────────────────────────────────────────────────────────────────── */

async function syncEventTypesForConnection(
  connection: CalendlyConnectionRow,
  supabase: AdminSupabase,
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
          // Full Event Type coverage (migration 379): booking form
          // questions, locations, positioning and admin metadata.
          admin_managed: et.admin_managed ?? null,
          custom_questions: Array.isArray(et.custom_questions) ? et.custom_questions : null,
          deleted_at: et.deleted_at ?? null,
          duration_options: Array.isArray(et.duration_options) ? et.duration_options : null,
          internal_note: et.internal_note ?? null,
          is_paid: et.is_paid ?? null,
          locale: et.locale ?? null,
          locations: Array.isArray(et.locations) ? et.locations : null,
          position: typeof et.position === "number" ? et.position : null,
          profile_type: et.profile?.type ?? null,
          profile_name: et.profile?.name ?? null,
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

/* ─────────────────────────────────────────────────────────────────────────
 * Scheduled events + invitees
 * ─────────────────────────────────────────────────────────────────────── */

interface KnownEventState {
  calendlyUpdatedAt: string | null
  hasInvitees: boolean
}

/**
 * Loads what we already know about a batch of Calendly event uuids so the
 * per-event loop can skip the expensive invitee round-trip for events
 * that haven't changed since the last run. This is the difference between
 * ~2 API calls per event per 30-minute run and ~2 API calls per CHANGED
 * event — on a steady-state book of ~230 events that removes hundreds of
 * Calendly requests per run.
 */
async function loadKnownEventStates(
  supabase: AdminSupabase,
  uuids: string[],
): Promise<Map<string, KnownEventState>> {
  const known = new Map<string, KnownEventState>()
  for (let i = 0; i < uuids.length; i += 100) {
    const batch = uuids.slice(i, i + 100)
    const [{ data: events }, { data: invitees }] = await Promise.all([
      supabase
        .from("calendly_events")
        .select("calendly_uuid, calendly_updated_at")
        .in("calendly_uuid", batch),
      supabase
        .from("calendly_invitees")
        .select("calendly_event_uuid")
        .in("calendly_event_uuid", batch),
    ])
    const withInvitees = new Set((invitees ?? []).map((r: any) => r.calendly_event_uuid))
    for (const row of events ?? []) {
      known.set(row.calendly_uuid, {
        calendlyUpdatedAt: row.calendly_updated_at,
        hasInvitees: withInvitees.has(row.calendly_uuid),
      })
    }
  }
  return known
}

/**
 * Upserts one scheduled event + (when needed) its invitees.
 *
 * `attribution` controls connection/team-member linkage: per-connection
 * sync attributes the event to the owning connection; the org-wide
 * catch-all passes nulls and lets the host identity come from
 * `event_memberships` (mapped by the shared field mapper + overrides).
 */
async function processScheduledEvent(
  connection: CalendlyConnectionRow,
  supabase: AdminSupabase,
  event: any,
  known: Map<string, KnownEventState>,
  errors: string[],
  attribution: {
    connectionId: string | null
    teamMemberId: string | null
    userUri: string | null
    userName: string | null
    userEmail: string | null
  },
): Promise<{ eventSaved: boolean; invitees: number }> {
  const uuid = extractUuid(event.uri)
  if (!uuid) return { eventSaved: false, invitees: 0 }

  const prior = known.get(uuid)
  const unchanged =
    !!prior &&
    !!prior.calendlyUpdatedAt &&
    !!event.updated_at &&
    new Date(prior.calendlyUpdatedAt).getTime() === new Date(event.updated_at).getTime() &&
    prior.hasInvitees

  const { data: savedEvent, error: evErr } = await supabase
    .from("calendly_events")
    .upsert(
      {
        // Shared full-capture mapper (identical to the webhook). The
        // sync provides `status` directly from the list query and the
        // host identity from the attribution the caller resolved.
        ...mapCalendlyEventFields(event),
        calendly_uuid: uuid,
        calendly_uri: event.uri,
        // Attribution columns are only written when the caller resolved
        // them — the org-wide catch-all passes nulls for events it can't
        // attribute, and overwriting would erase attribution recorded
        // back when the host's connection was still active.
        ...(attribution.connectionId ? { calendly_connection_id: attribution.connectionId } : {}),
        ...(attribution.teamMemberId ? { team_member_id: attribution.teamMemberId } : {}),
        ...(attribution.userUri ? { calendly_user_uri: attribution.userUri } : {}),
        ...(attribution.userName ? { calendly_user_name: attribution.userName } : {}),
        ...(attribution.userEmail ? { calendly_user_email: attribution.userEmail } : {}),
        status: event.status,
        raw_data: event,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "calendly_uuid" },
    )
    .select("id")
    .single()

  if (evErr) {
    errors.push(`event ${uuid}: ${evErr.message}`)
    return { eventSaved: false, invitees: 0 }
  }

  // Unchanged event with invitees already on file → the Calendly-side
  // invitee list cannot have changed (any invitee mutation bumps the
  // event's updated_at), so skip the round-trip and the re-matching.
  if (unchanged) return { eventSaved: true, invitees: 0 }

  let inviteeCount = 0
  // Invitees are paginated separately — Calendly tops out at 100 per
  // page and a group event can exceed that.
  try {
    const invitees = await calendlyListAll<any>(
      connection,
      supabase,
      `${event.uri}/invitees`,
      { query: { count: 100 } },
    )
    for (const invitee of invitees) {
      const inviteeUuid = extractUuid(invitee.uri)
      if (!inviteeUuid) continue

      // Best-effort link to existing CRM contact using email →
      // name+phone → unique-name fallback. When a match is found we
      // also persist a `calendly_event_clients` auto-link so the
      // Team Calendar can render the meeting as belonging to the
      // matched client without a separate manual tagging step.
      const match = await matchInviteeToContact(supabase, {
        email: invitee.email,
        name: invitee.name,
        phone: extractPhoneFromInvitee(invitee),
      })
      const contactId = match?.contactId ?? null
      if (match?.contactId && savedEvent?.id) {
        await upsertAutoClientLink(supabase, {
          calendlyEventId: savedEvent.id,
          contactId: match.contactId,
          matchMethod: match.matchMethod,
        })
      }

      const { error: invErr } = await supabase.from("calendly_invitees").upsert(
        {
          ...mapCalendlyInviteeFields(invitee),
          calendly_uuid: inviteeUuid,
          calendly_uri: invitee.uri,
          calendly_event_id: savedEvent?.id,
          calendly_event_uuid: uuid,
          contact_id: contactId,
          raw_data: invitee,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendly_uuid" },
      )
      if (invErr) errors.push(`invitee ${invitee.email}: ${invErr.message}`)
      else inviteeCount += 1
    }
  } catch (err) {
    errors.push(`invitees ${uuid}: ${err instanceof Error ? err.message : String(err)}`)
  }

  return { eventSaved: true, invitees: inviteeCount }
}

async function syncEventsForConnection(
  connection: CalendlyConnectionRow,
  supabase: AdminSupabase,
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

    const known = await loadKnownEventStates(
      supabase,
      events.map((e) => extractUuid(e.uri)).filter(Boolean) as string[],
    )

    for (const event of events) {
      const result = await processScheduledEvent(connection, supabase, event, known, errors, {
        connectionId: connection.id,
        teamMemberId: connection.team_member_id,
        userUri: connection.calendly_user_uri,
        userName: connection.calendly_user_name,
        userEmail: connection.calendly_user_email,
      })
      if (result.eventSaved) eventCount += 1
      inviteeCount += result.invitees
    }
  }

  return { events: eventCount, invitees: inviteeCount }
}

/**
 * Connections eligible to read ORG-level resources, best guess first.
 *
 * Calendly only lets organization owners/admins list org-wide scheduled
 * events and routing forms; regular members get 403. We can't read a
 * user's role directly from the connection row, but the connection that
 * successfully created the org-scope webhook subscription has already
 * PROVEN it holds an admin role — so it goes first, and the rest are
 * fallbacks tried on 403.
 */
async function orgLensCandidates(
  supabase: AdminSupabase,
  connections: CalendlyConnectionRow[],
): Promise<CalendlyConnectionRow[]> {
  const candidates = connections.filter((c) => c.calendly_organization_uri)
  if (candidates.length <= 1) return candidates

  const { data } = await supabase
    .from("calendly_webhook_subscriptions")
    .select("connection_id")
    .eq("scope", "organization")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const provenAdminId = data?.connection_id
  if (!provenAdminId) return candidates
  return [
    ...candidates.filter((c) => c.id === provenAdminId),
    ...candidates.filter((c) => c.id !== provenAdminId),
  ]
}

/** True for Calendly "Permission Denied" — the lens lacks the org role. */
function isPermissionDenied(err: unknown): boolean {
  return err instanceof CalendlyApiError && err.status === 403
}

/**
 * Org-wide catch-all pass: lists the organization's scheduled events with
 * an org-admin connection and ingests any event whose host has NO active
 * connection of their own (expired token / never connected). Those
 * bookings were previously invisible to the Hub until the host
 * reauthorized — real bookings from real clients, silently missing.
 */
async function syncOrgWideEvents(
  supabase: AdminSupabase,
  connections: CalendlyConnectionRow[],
  minStart: string,
  maxStart: string,
  errors: string[],
): Promise<number> {
  const candidates = await orgLensCandidates(supabase, connections)
  if (candidates.length === 0) return 0

  const coveredUserUris = new Set(connections.map((c) => c.calendly_user_uri))
  let ingested = 0

  // Uncovered hosts can still be Hub team members (their OAuth token
  // lapsed) — resolve by email so their meetings keep proper attribution.
  const teamMemberByEmail = new Map<string, string>()
  const { data: teamMembers } = await supabase
    .from("team_members")
    .select("id, email")
    .eq("status", "active")
  for (const tm of teamMembers ?? []) {
    if (tm.email) teamMemberByEmail.set(String(tm.email).toLowerCase(), tm.id)
  }

  // Once a lens proves usable it serves both statuses; a 403 rotates to
  // the next candidate instead of surfacing as a per-run error.
  let lens: CalendlyConnectionRow | null = null

  for (const status of ["active", "canceled"]) {
    let events: any[] | null = null
    let usedLens: CalendlyConnectionRow | null = lens
    let nonPermissionError = false
    const pool: CalendlyConnectionRow[] = lens ? [lens] : candidates
    for (const candidate of pool) {
      try {
        events = await calendlyListAll<any>(candidate, supabase, "/scheduled_events", {
          query: {
            organization: candidate.calendly_organization_uri,
            min_start_time: minStart,
            max_start_time: maxStart,
            status,
            count: 100,
            sort: "start_time:asc",
          },
        })
        lens = candidate
        usedLens = candidate
        break
      } catch (err) {
        if (isPermissionDenied(err)) continue
        nonPermissionError = true
        errors.push(
          `org events fetch ${status} (${candidate.calendly_user_email}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        break
      }
    }
    if (events === null || usedLens === null) {
      if (!lens && !nonPermissionError) {
        // Every candidate 403'd — org-wide reads are impossible until an
        // org owner/admin connects. Not an error worth paging on: log
        // once and let the per-connection sync carry the load.
        console.log(
          "[calendly-sync] org catch-all skipped: no connection with org-admin role",
        )
        return ingested
      }
      continue
    }

    const uncovered = events.filter((event) => {
      const memberships: any[] = event?.event_memberships ?? []
      return (
        memberships.length > 0 && !memberships.some((m) => coveredUserUris.has(m?.user))
      )
    })
    if (uncovered.length === 0) continue

    const known = await loadKnownEventStates(
      supabase,
      uncovered.map((e) => extractUuid(e.uri)).filter(Boolean) as string[],
    )

    for (const event of uncovered) {
      const host = event.event_memberships?.[0] ?? {}
      const hostEmail = host.user_email ? String(host.user_email).toLowerCase() : null
      const result = await processScheduledEvent(usedLens, supabase, event, known, errors, {
        connectionId: null,
        teamMemberId: hostEmail ? (teamMemberByEmail.get(hostEmail) ?? null) : null,
        userUri: host.user ?? null,
        userName: host.user_name ?? null,
        userEmail: host.user_email ?? null,
      })
      if (result.eventSaved) ingested += 1
    }
  }

  return ingested
}

/* ─────────────────────────────────────────────────────────────────────────
 * Routing forms + submissions
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Syncs routing form definitions and their submissions (org-level
 * resources) into `calendly_routing_forms` / `_submissions`. Submissions
 * are linked back to the Hub contact through the invitee that the
 * submission produced (calendly_invitees.routing_form_submission_uri),
 * so routing answers become queryable per client.
 */
async function syncRoutingForms(
  supabase: AdminSupabase,
  connections: CalendlyConnectionRow[],
  errors: string[],
): Promise<{ forms: number; submissions: number }> {
  const candidates = await orgLensCandidates(supabase, connections)
  if (candidates.length === 0) return { forms: 0, submissions: 0 }

  let forms = 0
  let submissions = 0

  // Same 403-rotation as the org-wide event pass: routing forms are an
  // org-level read that only owner/admin connections can perform.
  let lens: CalendlyConnectionRow | null = null
  let formList: any[] | null = null
  for (const candidate of candidates) {
    try {
      formList = await calendlyListAll<any>(candidate, supabase, "/routing_forms", {
        query: { organization: candidate.calendly_organization_uri, count: 100 },
      })
      lens = candidate
      break
    } catch (err) {
      if (isPermissionDenied(err)) continue
      errors.push(
        `routing_forms fetch (${candidate.calendly_user_email}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return { forms: 0, submissions: 0 }
    }
  }
  if (!lens || formList === null) {
    console.log(
      "[calendly-sync] routing forms skipped: no connection with org-admin role",
    )
    return { forms: 0, submissions: 0 }
  }

  for (const form of formList) {
    const formUuid = extractUuid(form.uri)
    if (!formUuid) continue

    const { data: savedForm, error: formErr } = await supabase
      .from("calendly_routing_forms")
      .upsert(
        {
          calendly_uuid: formUuid,
          calendly_uri: form.uri,
          organization_uri: form.organization ?? lens.calendly_organization_uri,
          name: form.name ?? null,
          status: form.status ?? null,
          questions: Array.isArray(form.questions) ? form.questions : null,
          raw_data: form,
          calendly_created_at: form.created_at ?? null,
          calendly_updated_at: form.updated_at ?? null,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendly_uuid" },
      )
      .select("id")
      .single()

    if (formErr) {
      errors.push(`routing_form ${form.name ?? formUuid}: ${formErr.message}`)
      continue
    }
    forms += 1

    let subs: any[] = []
    try {
      subs = await calendlyListAll<any>(lens, supabase, "/routing_form_submissions", {
        query: { form: form.uri, count: 100 },
      })
    } catch (err) {
      errors.push(
        `routing_form_submissions ${formUuid}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      continue
    }

    for (const sub of subs) {
      const subUuid = extractUuid(sub.uri)
      if (!subUuid) continue

      // Link the submission to a Hub contact through the invitee it
      // produced, when the visitor completed the booking it routed to.
      let contactId: string | null = null
      if (sub.submitter) {
        const { data: invitee } = await supabase
          .from("calendly_invitees")
          .select("contact_id")
          .eq("routing_form_submission_uri", sub.uri)
          .not("contact_id", "is", null)
          .limit(1)
          .maybeSingle()
        contactId = invitee?.contact_id ?? null
      }

      const { error: subErr } = await supabase.from("calendly_routing_form_submissions").upsert(
        {
          calendly_uuid: subUuid,
          calendly_uri: sub.uri,
          routing_form_uri: sub.routing_form ?? form.uri,
          routing_form_id: savedForm?.id ?? null,
          submitter_uri: sub.submitter ?? null,
          submitter_type: sub.submitter_type ?? null,
          questions_and_answers: sub.questions_and_answers ?? null,
          tracking: sub.tracking ?? null,
          result: sub.result ?? null,
          contact_id: contactId,
          raw_data: sub,
          calendly_created_at: sub.created_at ?? null,
          calendly_updated_at: sub.updated_at ?? null,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendly_uuid" },
      )
      if (subErr) errors.push(`routing_submission ${subUuid}: ${subErr.message}`)
      else submissions += 1
    }
  }

  return { forms, submissions }
}
