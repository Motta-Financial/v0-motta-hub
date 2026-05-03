/**
 * Calendly API client — single source of truth for outbound calls.
 *
 * Centralizes token lifecycle, paginated fetches, and webhook signature
 * verification. Every route should funnel through this module so that
 * fixes (rate limiting, auth, telemetry) land in one place.
 *
 * Reference: https://developer.calendly.com/api-docs
 */
import crypto from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

const CALENDLY_API_BASE = "https://api.calendly.com"
const CALENDLY_AUTH_BASE = "https://auth.calendly.com"

/**
 * Full set of scopes the Motta Hub OAuth app is configured to request.
 * Mirrors the scopes enabled in the Calendly developer console so any
 * code path can sanity-check whether a connection has the required scope
 * before attempting an action that needs it.
 *
 * NOTE: Calendly doesn't accept `scope` as a query param on the authorize
 * URL — scopes are configured server-side on the OAuth app itself. This
 * list is purely for our own reference and connection-health UI.
 */
export const CALENDLY_REQUESTED_SCOPES = [
  // Scheduling
  "availability:read",
  "availability:write",
  "event_types:read",
  "event_types:write",
  "locations:read",
  "routing_forms:read",
  "shares:write",
  "scheduled_events:read",
  "scheduled_events:write",
  "scheduling_links:write",
  // User management
  "groups:read",
  "organizations:read",
  "organizations:write",
  "users:read",
  // Security & compliance
  "activity_log:read",
  "data_compliance:write",
  "outgoing_communications:read",
  // Webhooks
  "webhooks:read",
  "webhooks:write",
] as const

export type CalendlyScope = (typeof CALENDLY_REQUESTED_SCOPES)[number]

export interface CalendlyConnectionRow {
  id: string
  team_member_id: string
  calendly_user_uri: string
  calendly_user_uuid: string
  calendly_user_name: string | null
  calendly_user_email: string | null
  calendly_user_avatar: string | null
  calendly_user_timezone: string | null
  calendly_organization_uri: string | null
  access_token: string
  refresh_token: string
  token_type: string | null
  expires_at: string
  scope: string | null
  is_active: boolean | null
  last_synced_at: string | null
  sync_enabled: boolean | null
}

/* ─────────────────────────────────────────────────────────────────────────
 * Environment helpers
 * ─────────────────────────────────────────────────────────────────────── */

export function getCalendlyOAuthConfig(): {
  clientId: string
  clientSecret: string
  redirectUri: string
} {
  const clientId = process.env.CALENDLY_CLIENT_ID
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET
  const redirectUri =
    process.env.CALENDLY_REDIRECT_URI ||
    process.env.CALENDLY_REDIRECT_URL ||
    `${getAppBaseUrl()}/api/calendly/oauth/callback`

  if (!clientId || !clientSecret) {
    throw new Error(
      "Calendly OAuth not configured: CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET must be set",
    )
  }
  return { clientId, clientSecret, redirectUri }
}

export function getAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.AUTH0_BASE_URL ||
    "https://motta.cpa"
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * Token lifecycle
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * In-memory dedupe of in-flight refreshes per connection.
 *
 * Calendly invalidates a refresh_token after its *first* use and returns
 * a new one. If multiple parallel API calls (e.g. the dashboard's
 * diagnostics/user/event-types/scheduled-events fan-out) each trigger a
 * refresh independently, only one wins — the others get `invalid_grant`
 * and would otherwise mark the connection inactive, forcing the user
 * to reauthorize. Coalescing into a single in-flight Promise keeps a
 * single Vercel function instance honest.
 *
 * Cross-instance races are mitigated by re-reading the connection from
 * the DB inside `refreshAccessToken` before declaring failure.
 */
const refreshInFlight = new Map<string, Promise<string | null>>()

/**
 * Returns a valid access token for the given connection, refreshing it
 * proactively if it expires within `safetyWindowMs` (default 5 min).
 * On refresh failure `null` is returned so callers can degrade gracefully.
 */
export async function getValidAccessToken(
  connection: CalendlyConnectionRow,
  supabase: SupabaseClient,
  safetyWindowMs = 5 * 60 * 1000,
): Promise<string | null> {
  const expiresAt = new Date(connection.expires_at).getTime()
  if (expiresAt - Date.now() > safetyWindowMs) {
    return connection.access_token
  }

  // Coalesce concurrent refreshes within this process.
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
 *
 * Calendly issues new refresh tokens on every refresh and invalidates
 * the previous one immediately. To survive cross-instance races we:
 *   1. Re-read the connection right before refresh in case another
 *      worker already rotated the token.
 *   2. On `invalid_grant`, re-read again — if `expires_at` advanced,
 *      a peer succeeded and we should use its token instead of
 *      flagging the connection inactive.
 *   3. Only mark `is_active=false` for definitive auth failures, not
 *      transient 5xx / network errors.
 */
export async function refreshAccessToken(
  connection: CalendlyConnectionRow,
  supabase: SupabaseClient,
): Promise<string | null> {
  const { clientId, clientSecret } = getCalendlyOAuthConfig()

  // Step 1: re-read in case a peer already refreshed.
  const { data: latest } = await supabase
    .from("calendly_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("id", connection.id)
    .maybeSingle()

  if (
    latest &&
    new Date(latest.expires_at).getTime() - Date.now() > 5 * 60 * 1000
  ) {
    // Another worker already produced a fresh token; mutate the in-memory
    // connection so subsequent calls in this request use the new value.
    connection.access_token = latest.access_token
    connection.refresh_token = latest.refresh_token
    connection.expires_at = latest.expires_at
    return latest.access_token
  }

  const refreshToken = latest?.refresh_token || connection.refresh_token

  const response = await fetch(`${CALENDLY_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")

    // Step 2: handle race — if a peer just rotated the token while we
    // were calling, the DB will now have a fresh expires_at. Use it.
    const { data: postRace } = await supabase
      .from("calendly_connections")
      .select("access_token, refresh_token, expires_at")
      .eq("id", connection.id)
      .maybeSingle()
    if (
      postRace &&
      new Date(postRace.expires_at).getTime() - Date.now() > 5 * 60 * 1000
    ) {
      connection.access_token = postRace.access_token
      connection.refresh_token = postRace.refresh_token
      connection.expires_at = postRace.expires_at
      return postRace.access_token
    }

    console.error(
      `[calendly] refresh failed for connection ${connection.id}:`,
      response.status,
      body,
    )

    // Only mark inactive for definitive auth failures. Transient errors
    // (network, 5xx, rate-limit) shouldn't force the user to reauth —
    // a future call (or cron run) can retry the existing refresh_token.
    const isPermanent =
      response.status === 400 ||
      response.status === 401 ||
      /invalid_grant|invalid_client|unauthorized_client|invalid_request/i.test(
        body,
      )

    const update: Record<string, unknown> = {
      last_sync_error: `Token refresh failed (${response.status}): ${body.slice(0, 200)}`,
      updated_at: new Date().toISOString(),
    }
    if (isPermanent) update.is_active = false

    await supabase.from("calendly_connections").update(update).eq("id", connection.id)
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

  await supabase
    .from("calendly_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || refreshToken,
      expires_at: expiresAtIso,
      token_type: tokens.token_type || connection.token_type,
      scope: tokens.scope ?? connection.scope,
      is_active: true,
      // Clear any stale failure breadcrumb now that we're healthy again.
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)

  // Mutate the in-memory connection so the rest of the request sees
  // the new token without re-reading the DB.
  connection.access_token = tokens.access_token
  connection.refresh_token = tokens.refresh_token || refreshToken
  connection.expires_at = expiresAtIso

  return tokens.access_token
}

/**
 * Exchanges an authorization code for the initial token pair.
 * Used by the OAuth callback handler.
 */
export async function exchangeAuthorizationCode(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  token_type?: string
  scope?: string
}> {
  const { clientId, clientSecret, redirectUri } = getCalendlyOAuthConfig()
  const response = await fetch(`${CALENDLY_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Token exchange failed: ${response.status} ${body}`)
  }
  return response.json()
}

/**
 * Revokes a token at Calendly's auth server. Used during disconnect so
 * the user's permission grant is fully torn down, not just our DB row.
 */
export async function revokeToken(token: string): Promise<void> {
  const { clientId, clientSecret } = getCalendlyOAuthConfig()
  await fetch(`${CALENDLY_AUTH_BASE}/oauth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
    }),
  }).catch((err) => {
    // Non-fatal: even if revoke fails Calendly we still want to delete
    // our local connection. Surface the error in logs only.
    console.error("[calendly] revoke failed (non-fatal):", err)
  })
}

/* ─────────────────────────────────────────────────────────────────────────
 * Authenticated requests
 * ─────────────────────────────────────────────────────────────────────── */

export interface CalendlyRequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH"
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  /** Treat 404 as null instead of throwing. */
  allowNotFound?: boolean
}

export class CalendlyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`Calendly API ${status} for ${path}: ${body.slice(0, 200)}`)
  }
}

/**
 * Performs an authenticated request against the Calendly REST API,
 * automatically using a fresh access token from the connection. The
 * `path` should start with `/` (e.g. `/users/me`); fully-qualified
 * URIs returned by Calendly itself (which already include the host)
 * are also accepted as-is.
 */
export async function calendlyRequest<T = unknown>(
  connection: CalendlyConnectionRow,
  supabase: SupabaseClient,
  path: string,
  options: CalendlyRequestOptions = {},
): Promise<T | null> {
  const accessToken = await getValidAccessToken(connection, supabase)
  if (!accessToken) {
    throw new CalendlyApiError(401, "No valid access token", path)
  }

  const url = path.startsWith("http")
    ? new URL(path)
    : new URL(CALENDLY_API_BASE + (path.startsWith("/") ? path : `/${path}`))
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
    },
  }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)

  const response = await fetch(url.toString(), init)
  if (response.status === 204) return null
  if (response.status === 404 && options.allowNotFound) return null
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new CalendlyApiError(response.status, body, url.pathname)
  }
  // DELETE / 204 sometimes return empty bodies even with 200
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text) as T
}

interface CalendlyPaginatedResponse<T> {
  collection: T[]
  pagination: {
    count: number
    next_page?: string | null
    next_page_token?: string | null
    previous_page_token?: string | null
  }
}

/**
 * Walks every page of a Calendly list endpoint, returning the full
 * concatenated collection. Caller controls page size via `count` in
 * `query` (Calendly max = 100). Bounded by `maxPages` to prevent
 * runaway fetches if the API misbehaves.
 */
export async function calendlyListAll<T = unknown>(
  connection: CalendlyConnectionRow,
  supabase: SupabaseClient,
  path: string,
  options: CalendlyRequestOptions & { maxPages?: number } = {},
): Promise<T[]> {
  const maxPages = options.maxPages ?? 50
  const collected: T[] = []
  let nextUrl: string | null = null
  let pages = 0

  do {
    const page: CalendlyPaginatedResponse<T> | null = nextUrl
      ? await calendlyRequest<CalendlyPaginatedResponse<T>>(connection, supabase, nextUrl)
      : await calendlyRequest<CalendlyPaginatedResponse<T>>(connection, supabase, path, options)
    if (!page) break
    collected.push(...page.collection)
    nextUrl = page.pagination?.next_page || null
    pages += 1
  } while (nextUrl && pages < maxPages)

  return collected
}

/* ─────────────────────────────────────────────────────────────────────────
 * Webhook signatures
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Verifies a Calendly webhook signature. Calendly's signature header is
 * formatted as `t=<unixTimestamp>,v1=<hmacSha256>` where the HMAC is
 * computed over `<timestamp>.<body>` with the webhook signing key.
 *
 * @param tolerance Maximum allowed clock skew in seconds (default 5min)
 *
 * https://developer.calendly.com/api-docs/ZG9jOjE2OTU3NzMx-webhook-signatures
 */
export function verifyWebhookSignature(
  payload: string,
  header: string | null,
  signingKey: string | undefined,
  tolerance = 300,
): { valid: boolean; reason?: string } {
  if (!signingKey) {
    return { valid: false, reason: "No signing key configured" }
  }
  if (!header) return { valid: false, reason: "No signature header" }

  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const idx = p.indexOf("=")
      return idx === -1 ? [p.trim(), ""] : [p.slice(0, idx).trim(), p.slice(idx + 1).trim()]
    }),
  )
  const ts = parts.t
  const sig = parts.v1
  if (!ts || !sig) return { valid: false, reason: "Malformed signature header" }

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(`${ts}.${payload}`)
    .digest("hex")

  // timingSafeEqual throws if buffers differ in length, so guard first.
  const sigBuf = Buffer.from(sig, "hex")
  const expectedBuf = Buffer.from(expected, "hex")
  if (sigBuf.length !== expectedBuf.length) {
    return { valid: false, reason: "Signature length mismatch" }
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: "Signature mismatch" }
  }

  // Replay protection: reject signatures whose timestamp is too old.
  const ageSec = Math.abs(Date.now() / 1000 - Number(ts))
  if (Number.isNaN(ageSec) || ageSec > tolerance) {
    return { valid: false, reason: "Signature timestamp outside tolerance" }
  }

  return { valid: true }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Resource helpers (frequently-used wrappers)
 * ─────────────────────────────────────────────────────────────────────── */

export interface CalendlyMeUser {
  uri: string
  name: string
  email: string
  scheduling_url: string
  timezone: string
  avatar_url?: string
  current_organization: string
  created_at: string
  updated_at: string
}

export async function fetchMe(
  connection: CalendlyConnectionRow,
  supabase: SupabaseClient,
): Promise<CalendlyMeUser | null> {
  const r = await calendlyRequest<{ resource: CalendlyMeUser }>(connection, supabase, "/users/me")
  return r?.resource ?? null
}

export function extractUuid(uri: string | null | undefined): string | null {
  if (!uri) return null
  const last = uri.split("/").pop() || ""
  return last || null
}

/**
 * Convenience: load a connection row by team_member_id and ensure it's
 * usable. Returns null if not found, inactive, or token un-refreshable.
 */
export async function getActiveConnectionForTeamMember(
  supabase: SupabaseClient,
  teamMemberId: string,
): Promise<CalendlyConnectionRow | null> {
  const { data } = await supabase
    .from("calendly_connections")
    .select("*")
    .eq("team_member_id", teamMemberId)
    .eq("is_active", true)
    .maybeSingle()
  return (data as CalendlyConnectionRow | null) ?? null
}

/* ─────────────────────────────────────────────────────────────────────────
 * Webhook lifecycle
 * ───────────────────────────────────────────────────────────────────────
 * Centralized so the OAuth callback and the manual /webhook/subscribe
 * endpoint can share identical logic. Idempotent: re-running with the
 * same scope is a no-op when an active subscription already points at
 * our callback URL.
 */

export const DEFAULT_WEBHOOK_EVENTS = [
  "invitee.created",
  "invitee.canceled",
  "invitee_no_show.created",
  "invitee_no_show.deleted",
  "routing_form_submission.created",
] as const

export interface EnsureWebhookResult {
  webhook: { uri: string; callback_url: string; state: string; events?: string[] } | null
  callbackUrl: string
  reused: boolean
  error?: string
}

/**
 * Ensures a Calendly webhook subscription exists for `connection`,
 * persisting the subscription URI to the connection row so the rest
 * of the app can rely on the cached state.
 *
 * `scope` defaults to "user" — Calendly only allows one webhook per
 * (callback_url, scope, user, organization) tuple.
 */
export async function ensureWebhookSubscription(
  connection: CalendlyConnectionRow,
  supabase: SupabaseClient,
  options: {
    scope?: "user" | "organization"
    events?: readonly string[]
  } = {},
): Promise<EnsureWebhookResult> {
  const scope = options.scope ?? "user"
  const events = options.events ?? DEFAULT_WEBHOOK_EVENTS
  const callbackUrl = `${getAppBaseUrl()}/api/calendly/webhook`

  try {
    const me = await fetchMe(connection, supabase)
    if (!me) {
      return {
        webhook: null,
        callbackUrl,
        reused: false,
        error: "Token invalid; cannot subscribe webhook",
      }
    }

    // Look for an existing matching subscription. Calendly returns
    // 422 on duplicate (callback_url, scope, user, organization).
    const list = await calendlyRequest<{ collection: any[] }>(
      connection,
      supabase,
      "/webhook_subscriptions",
      {
        query: {
          scope,
          user: scope === "user" ? me.uri : undefined,
          organization: me.current_organization,
          count: 100,
        },
      },
    )
    const existing = (list?.collection || []).find(
      (w) => w.callback_url === callbackUrl && w.state === "active",
    )

    let webhook = existing
    let reused = !!existing

    if (!existing) {
      const created = await calendlyRequest<{ resource: any }>(
        connection,
        supabase,
        "/webhook_subscriptions",
        {
          method: "POST",
          body: {
            url: callbackUrl,
            events,
            scope,
            ...(scope === "user"
              ? { user: me.uri, organization: me.current_organization }
              : { organization: me.current_organization }),
            ...(process.env.CALENDLY_WEBHOOK_SIGNING_KEY
              ? { signing_key: process.env.CALENDLY_WEBHOOK_SIGNING_KEY }
              : {}),
          },
        },
      )
      webhook = created?.resource ?? null
    }

    // Persist cached state so /diagnostics doesn't have to roundtrip.
    await supabase
      .from("calendly_connections")
      .update({
        webhook_subscribed: !!webhook,
        webhook_subscription_uri: webhook?.uri ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id)

    return { webhook, callbackUrl, reused }
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error("[calendly] ensureWebhookSubscription failed:", message)
    // Cache the failure so the dashboard can show a precise error.
    await supabase
      .from("calendly_connections")
      .update({
        webhook_subscribed: false,
        last_sync_error: `Webhook subscribe failed: ${message.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id)
    return { webhook: null, callbackUrl, reused: false, error: message }
  }
}
