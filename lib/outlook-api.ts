/**
 * Microsoft Graph / Outlook API client — single source of truth for
 * outbound calls. Mirrors lib/calendly-api.ts: centralizes token
 * lifecycle, authenticated requests, and webhook (subscription) helpers
 * so every route funnels through one place.
 *
 * Reference: https://learn.microsoft.com/en-us/graph/use-the-api
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { firmConfigSync } from "@/lib/firm-settings"
import { decryptToken, encryptToken } from "@/lib/outlook-token-cipher"

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"

/**
 * Delegated Graph scopes the Hub requests. `offline_access` is required
 * to receive a refresh_token; the rest are read-only by design — the
 * Hub never sends mail or writes calendar events on a user's behalf.
 */
export const MICROSOFT_REQUESTED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Calendars.Read",
] as const

export interface OutlookConnectionRow {
  id: string
  team_member_id: string
  outlook_user_id: string
  outlook_email: string | null
  outlook_display_name: string | null
  access_token: string
  refresh_token: string
  token_type: string | null
  expires_at: string
  scope: string | null
  is_active: boolean | null
  last_synced_at: string | null
  sync_enabled: boolean | null
  last_sync_error: string | null
  webhook_subscribed: boolean | null
  webhook_subscription_id: string | null
  emails_synced_count: number | null
  events_synced_count: number | null
}

/* ─────────────────────────────────────────────────────────────────────────
 * Environment helpers
 * ─────────────────────────────────────────────────────────────────────── */

export function getMicrosoftOAuthConfig(): {
  clientId: string
  clientSecret: string
  tenantId: string
  redirectUri: string
} {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  const tenantId = process.env.MICROSOFT_TENANT_ID || "common"
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI || `${getAppBaseUrl()}/api/outlook/oauth/callback`

  if (!clientId || !clientSecret) {
    throw new Error(
      "Outlook OAuth not configured: MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set",
    )
  }
  return { clientId, clientSecret, tenantId, redirectUri }
}

export function getAppBaseUrl(): string {
  return firmConfigSync().hubUrl
}

function authorityBase(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`
}

/* ─────────────────────────────────────────────────────────────────────────
 * Token lifecycle
 * ─────────────────────────────────────────────────────────────────────── */

const refreshInFlight = new Map<string, Promise<string | null>>()

/**
 * Returns a valid, decrypted access token for the given connection,
 * refreshing it proactively if it expires within `safetyWindowMs`
 * (default 5 min). On refresh failure `null` is returned so callers can
 * degrade gracefully.
 */
export async function getValidAccessToken(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
  safetyWindowMs = 5 * 60 * 1000,
): Promise<string | null> {
  const expiresAt = new Date(connection.expires_at).getTime()
  if (expiresAt - Date.now() > safetyWindowMs) {
    return decryptToken(connection.access_token)
  }

  let pending = refreshInFlight.get(connection.id)
  if (!pending) {
    pending = refreshAccessToken(connection, supabase).finally(() => {
      refreshInFlight.delete(connection.id)
    })
    refreshInFlight.set(connection.id, pending)
  }
  return pending
}

/**
 * Force-refreshes a connection's access_token using its refresh_token.
 * Microsoft rotates refresh tokens on most (not guaranteed every) refresh,
 * so we always persist whatever comes back.
 */
export async function refreshAccessToken(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
): Promise<string | null> {
  const { clientId, clientSecret, tenantId } = getMicrosoftOAuthConfig()

  // Re-read in case a peer already refreshed.
  const { data: latest } = await supabase
    .from("outlook_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("id", connection.id)
    .maybeSingle()

  if (latest && new Date(latest.expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
    connection.access_token = latest.access_token
    connection.refresh_token = latest.refresh_token
    connection.expires_at = latest.expires_at
    return decryptToken(latest.access_token)
  }

  const refreshToken = decryptToken(latest?.refresh_token || connection.refresh_token)

  const response = await fetch(`${authorityBase(tenantId)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      scope: MICROSOFT_REQUESTED_SCOPES.join(" "),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")

    const { data: postRace } = await supabase
      .from("outlook_connections")
      .select("access_token, refresh_token, expires_at")
      .eq("id", connection.id)
      .maybeSingle()
    if (postRace && new Date(postRace.expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
      connection.access_token = postRace.access_token
      connection.refresh_token = postRace.refresh_token
      connection.expires_at = postRace.expires_at
      return decryptToken(postRace.access_token)
    }

    console.error(`[outlook] refresh failed for connection ${connection.id}:`, response.status, body)

    const isPermanent =
      response.status === 400 ||
      response.status === 401 ||
      /invalid_grant|invalid_client|unauthorized_client/i.test(body)

    const update: Record<string, unknown> = {
      last_sync_error: `Token refresh failed (${response.status}): ${body.slice(0, 200)}`,
      updated_at: new Date().toISOString(),
    }
    if (isPermanent) update.is_active = false

    await supabase.from("outlook_connections").update(update).eq("id", connection.id)
    return null
  }

  const tokens = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type?: string
    scope?: string
  }
  const expiresAtIso = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const encryptedAccess = encryptToken(tokens.access_token)
  const encryptedRefresh = encryptToken(tokens.refresh_token || refreshToken)

  await supabase
    .from("outlook_connections")
    .update({
      access_token: encryptedAccess,
      refresh_token: encryptedRefresh,
      expires_at: expiresAtIso,
      token_type: tokens.token_type || connection.token_type,
      scope: tokens.scope ?? connection.scope,
      is_active: true,
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)

  connection.access_token = encryptedAccess
  connection.refresh_token = encryptedRefresh
  connection.expires_at = expiresAtIso

  return tokens.access_token
}

/**
 * Exchanges an authorization code for the initial token pair. Used by
 * the OAuth callback handler.
 */
export async function exchangeAuthorizationCode(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  token_type?: string
  scope?: string
}> {
  const { clientId, clientSecret, tenantId, redirectUri } = getMicrosoftOAuthConfig()
  const response = await fetch(`${authorityBase(tenantId)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      scope: MICROSOFT_REQUESTED_SCOPES.join(" "),
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Token exchange failed: ${response.status} ${body}`)
  }
  const json = await response.json()
  if (!json.refresh_token) {
    throw new Error(
      "Microsoft did not return a refresh_token. Ensure the app registration requests offline_access and the account isn't a personal MSA blocked by tenant policy.",
    )
  }
  return json
}

/* ─────────────────────────────────────────────────────────────────────────
 * Authenticated requests
 * ─────────────────────────────────────────────────────────────────────── */

export interface GraphRequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH"
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  allowNotFound?: boolean
  /** Extra headers, e.g. Prefer: outlook.timezone. */
  headers?: Record<string, string>
}

export class GraphApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`Graph API ${status} for ${path}: ${body.slice(0, 200)}`)
  }
}

/**
 * Performs an authenticated request against Microsoft Graph, automatically
 * using a fresh access token from the connection. `path` should start with
 * `/` (e.g. `/me`); fully-qualified URIs (Graph's own `@odata.nextLink`)
 * are also accepted as-is.
 */
export async function graphRequest<T = unknown>(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
  path: string,
  options: GraphRequestOptions = {},
): Promise<T | null> {
  const accessToken = await getValidAccessToken(connection, supabase)
  if (!accessToken) {
    throw new GraphApiError(401, "No valid access token", path)
  }

  const url = path.startsWith("http") ? new URL(path) : new URL(GRAPH_API_BASE + path)
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
    }
  }

  const init: RequestInit = {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)

  const response = await fetch(url.toString(), init)
  if (response.status === 204) return null
  if (response.status === 404 && options.allowNotFound) return null
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new GraphApiError(response.status, body, url.pathname)
  }
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text) as T
}

/* ─────────────────────────────────────────────────────────────────────────
 * Domain calls
 * ─────────────────────────────────────────────────────────────────────── */

export interface GraphMeUser {
  id: string
  displayName: string | null
  mail: string | null
  userPrincipalName: string
}

export async function fetchMe(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
): Promise<GraphMeUser | null> {
  return graphRequest<GraphMeUser>(connection, supabase, "/me", {
    query: { $select: "id,displayName,mail,userPrincipalName" },
  })
}

export interface GraphMessage {
  id: string
  subject: string | null
  receivedDateTime: string
  bodyPreview: string | null
  from: { emailAddress?: { name?: string | null; address?: string | null } } | null
}

export async function fetchRecentMessages(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
  top = 10,
): Promise<GraphMessage[]> {
  const result = await graphRequest<{ value: GraphMessage[] }>(
    connection,
    supabase,
    "/me/mailFolders/inbox/messages",
    {
      query: {
        $top: top,
        $orderby: "receivedDateTime desc",
        $select: "id,subject,receivedDateTime,bodyPreview,from",
      },
    },
  )
  return result?.value ?? []
}

export interface GraphEvent {
  id: string
  subject: string | null
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  location: { displayName?: string | null } | null
  attendees: unknown[] | null
}

export async function fetchUpcomingEvents(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
  top = 10,
): Promise<GraphEvent[]> {
  const nowIso = new Date().toISOString()
  const result = await graphRequest<{ value: GraphEvent[] }>(connection, supabase, "/me/calendarView", {
    query: {
      startDateTime: nowIso,
      endDateTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      $top: top,
      $orderby: "start/dateTime",
      $select: "id,subject,start,end,location,attendees",
    },
    headers: { Prefer: 'outlook.timezone="UTC"' },
  })
  return result?.value ?? []
}

/**
 * Counts total messages in the inbox and total calendar events, for the
 * "Emails synced" / "Calendar events synced" stat tiles. Uses
 * $count so we don't have to page through every item.
 */
export async function fetchSyncCounts(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
): Promise<{ emails: number; events: number }> {
  const [inbox, events] = await Promise.all([
    graphRequest<{ totalItemCount: number }>(connection, supabase, "/me/mailFolders/inbox", {
      query: { $select: "totalItemCount" },
    }),
    graphRequest<{ "@odata.count": number; value: unknown[] }>(connection, supabase, "/me/events", {
      query: { $count: "true", $top: 1 },
      headers: { ConsistencyLevel: "eventual" },
    }),
  ])
  return {
    emails: inbox?.totalItemCount ?? 0,
    events: events?.["@odata.count"] ?? 0,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Webhook subscriptions (Graph change notifications)
 * ─────────────────────────────────────────────────────────────────────── */

/** Graph caps message/event subscriptions at 4230 minutes (~2.94 days). */
const SUBSCRIPTION_LIFETIME_MINUTES = 4230

export interface GraphSubscriptionResult {
  subscriptionIds: string[]
  error?: string
}

/**
 * Creates change-notification subscriptions for the inbox and the
 * calendar so the Hub can react to new mail / event changes in near
 * real time instead of relying solely on polling. Notifications land at
 * /api/outlook/webhook, which is validated inline by Graph during
 * creation (a validationToken echo, handled by that route).
 */
export async function ensureWebhookSubscription(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
): Promise<GraphSubscriptionResult> {
  const notificationUrl = `${getAppBaseUrl()}/api/outlook/webhook`
  const clientState = connection.team_member_id
  const expirationDateTime = new Date(
    Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000,
  ).toISOString()

  const resources = [
    { resource: "/me/mailFolders('inbox')/messages", changeType: "created" },
    { resource: "/me/events", changeType: "created,updated,deleted" },
  ]

  const subscriptionIds: string[] = []
  let error: string | undefined

  for (const res of resources) {
    try {
      const created = await graphRequest<{ id: string }>(connection, supabase, "/subscriptions", {
        method: "POST",
        body: {
          changeType: res.changeType,
          notificationUrl,
          resource: res.resource,
          expirationDateTime,
          clientState,
        },
      })
      if (created?.id) subscriptionIds.push(created.id)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      console.error(`[outlook] webhook subscribe failed for ${res.resource}:`, error)
    }
  }

  await supabase
    .from("outlook_connections")
    .update({
      webhook_subscribed: subscriptionIds.length > 0,
      webhook_subscription_id: subscriptionIds.length ? JSON.stringify(subscriptionIds) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)

  return { subscriptionIds, error: subscriptionIds.length === 0 ? error : undefined }
}

/**
 * Best-effort deletion of any active subscriptions for this connection.
 * Non-fatal — a subscription simply expires on its own within ~3 days
 * if this fails.
 */
export async function removeWebhookSubscriptions(
  connection: OutlookConnectionRow,
  supabase: SupabaseClient,
): Promise<void> {
  if (!connection.webhook_subscription_id) return
  let ids: string[] = []
  try {
    ids = JSON.parse(connection.webhook_subscription_id)
  } catch {
    ids = [connection.webhook_subscription_id]
  }
  await Promise.all(
    ids.map((id) =>
      graphRequest(connection, supabase, `/subscriptions/${id}`, {
        method: "DELETE",
        allowNotFound: true,
      }).catch((err) => {
        console.error(`[outlook] failed to delete subscription ${id} (non-fatal):`, err)
      }),
    ),
  )
}

/**
 * Convenience: load a connection row by team_member_id.
 */
export async function getConnectionForTeamMember(
  supabase: SupabaseClient,
  teamMemberId: string,
): Promise<OutlookConnectionRow | null> {
  const { data } = await supabase
    .from("outlook_connections")
    .select("*")
    .eq("team_member_id", teamMemberId)
    .maybeSingle()
  return (data as OutlookConnectionRow | null) ?? null
}
