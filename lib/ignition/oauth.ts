/**
 * Ignition Reporting API OAuth client.
 *
 * Single source of truth for OAuth handshake, token lifecycle, and paginated
 * reads against https://developers.ignitionapp.com/external/api/v1.
 *
 * Ignition's OAuth flow is plain Authorization Code:
 *   1. Redirect user to  GET  /oauth2/authorize?client_id&redirect_uri&...
 *   2. Exchange code at  POST /oauth2/token (grant_type=authorization_code)
 *   3. Refresh later at  POST /oauth2/token (grant_type=refresh_token)
 *
 * Scope: the only public scope right now is `reporting` (read-only).
 *
 * The connection is practice-wide — once an admin authorizes the app, the
 * resulting access_token can read every reporting endpoint for the whole
 * Ignition practice. We therefore store exactly one row in
 * `ignition_connections` and treat it as a singleton.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { getAppBaseUrl } from "@/lib/calendly-api"

export const IGNITION_API_BASE = "https://developers.ignitionapp.com/external/api/v1"
export const IGNITION_AUTH_BASE = "https://developers.ignitionapp.com"

/**
 * Only scope currently published by Ignition. Listed here so the rest of the
 * codebase has a single constant to reference and so we can sanity-check that
 * a connection actually carries the scope it needs before issuing API calls.
 */
export const IGNITION_REQUESTED_SCOPES = ["reporting"] as const
export type IgnitionScope = (typeof IGNITION_REQUESTED_SCOPES)[number]

export interface IgnitionConnectionRow {
  id: string
  team_member_id: string | null
  access_token: string
  refresh_token: string
  token_type: string | null
  expires_at: string
  scope: string | null
  ignition_practice_id: string | null
  ignition_practice_name: string | null
  ignition_user_email: string | null
  ignition_user_name: string | null
  is_active: boolean | null
  sync_enabled: boolean | null
  last_synced_at: string | null
  last_sync_error: string | null
}

/* ─────────────────────────────────────────────────────────────────────────
 * Environment helpers
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Reads the Ignition OAuth credentials from the environment, falling back to
 * a redirect URI derived from the canonical app base URL when one is not set
 * explicitly. The IGNITION_REDIRECT_URI env var exists primarily so preview
 * deployments and local development can point at non-production callbacks.
 */
export function getIgnitionOAuthConfig(): {
  clientId: string
  clientSecret: string
  redirectUri: string
} {
  const clientId = process.env.IGNITION_CLIENT_ID
  const clientSecret = process.env.IGNITION_CLIENT_SECRET
  const redirectUri =
    process.env.IGNITION_REDIRECT_URI ||
    `${getAppBaseUrl()}/api/ignition/oauth/callback`

  if (!clientId || !clientSecret) {
    throw new Error(
      "Ignition OAuth not configured: IGNITION_CLIENT_ID and IGNITION_CLIENT_SECRET must be set",
    )
  }
  return { clientId, clientSecret, redirectUri }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Authorization Code flow
 * ─────────────────────────────────────────────────────────────────────── */

export interface IgnitionTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type?: string
  scope?: string
}

/**
 * Builds the authorize URL the user is redirected to in step 1 of OAuth.
 *
 * Ignition expects `scope` as a space-separated string on the query — even
 * though the developer console also lets you pre-configure scopes on the app
 * itself, including it explicitly here makes the consent screen show the
 * exact permissions the user is granting.
 */
export function buildAuthorizeUrl(params: { state: string }): string {
  const { clientId, redirectUri } = getIgnitionOAuthConfig()
  const url = new URL(`${IGNITION_AUTH_BASE}/oauth2/authorize`)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", IGNITION_REQUESTED_SCOPES.join(" "))
  url.searchParams.set("state", params.state)
  return url.toString()
}

/**
 * Exchanges the `code` returned to the callback URL for a usable token pair.
 * Throws with the raw response body on failure so the callback can surface
 * a precise diagnostic instead of a generic "auth failed".
 */
export async function exchangeAuthorizationCode(code: string): Promise<IgnitionTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getIgnitionOAuthConfig()
  const response = await fetch(`${IGNITION_AUTH_BASE}/oauth2/token`, {
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
    throw new Error(`Ignition token exchange failed: ${response.status} ${body}`)
  }
  return response.json()
}

/* ─────────────────────────────────────────────────────────────────────────
 * Refresh flow with cross-instance race safety
 *
 * Ignition (like most OAuth servers) invalidates the previous refresh_token
 * the moment a new pair is issued. If two workers refresh at the same time,
 * only one wins; the loser will get `invalid_grant`. We coalesce in-process
 * and re-read from the DB to detect peer wins.
 * ─────────────────────────────────────────────────────────────────────── */

const refreshInFlight = new Map<string, Promise<string | null>>()

/**
 * Returns a usable access token, refreshing it proactively if it's within
 * `safetyWindowMs` of expiry. Returns null when the refresh definitively
 * fails so callers can surface a "reconnect required" state.
 */
export async function getValidAccessToken(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  safetyWindowMs = 5 * 60 * 1000,
): Promise<string | null> {
  const expiresAt = new Date(connection.expires_at).getTime()
  if (expiresAt - Date.now() > safetyWindowMs) {
    return connection.access_token
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
 * Force-refreshes the connection's access token using its refresh token.
 *
 * Safety sequence:
 *   1. Re-read from DB to detect peer refreshes that already won.
 *   2. POST /oauth2/token with grant_type=refresh_token.
 *   3. On `invalid_grant`, re-read once more — if expires_at advanced,
 *      a peer wrote a fresh token between steps 1 and 2 and we should
 *      use that instead of marking the connection inactive.
 *   4. Only flag is_active=false on definitive auth failures.
 */
export async function refreshAccessToken(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
): Promise<string | null> {
  const { clientId, clientSecret } = getIgnitionOAuthConfig()

  const { data: latest } = await supabase
    .from("ignition_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("id", connection.id)
    .maybeSingle()

  if (
    latest &&
    new Date(latest.expires_at).getTime() - Date.now() > 5 * 60 * 1000
  ) {
    connection.access_token = latest.access_token
    connection.refresh_token = latest.refresh_token
    connection.expires_at = latest.expires_at
    return latest.access_token
  }

  const refreshToken = latest?.refresh_token || connection.refresh_token

  const response = await fetch(`${IGNITION_AUTH_BASE}/oauth2/token`, {
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
    const bodyText = await response.text().catch(() => "")
    const isInvalidGrant = response.status === 400 && /invalid_grant/i.test(bodyText)

    if (isInvalidGrant) {
      // Peer-refresh race detection.
      const { data: postFail } = await supabase
        .from("ignition_connections")
        .select("access_token, expires_at")
        .eq("id", connection.id)
        .maybeSingle()
      if (
        postFail &&
        new Date(postFail.expires_at).getTime() > new Date(connection.expires_at).getTime()
      ) {
        return postFail.access_token
      }

      await supabase
        .from("ignition_connections")
        .update({
          is_active: false,
          last_sync_error: `Refresh failed (${response.status}): ${bodyText.slice(0, 200)}`,
        })
        .eq("id", connection.id)
      return null
    }

    // Transient: don't disable the connection, just leave the existing token
    // in place and let the next caller try again.
    console.error("[ignition] refresh transient failure:", response.status, bodyText)
    return connection.access_token
  }

  const tokens = (await response.json()) as IgnitionTokenResponse
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const { error: updateError } = await supabase
    .from("ignition_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type ?? connection.token_type,
      scope: tokens.scope ?? connection.scope,
      expires_at: expiresAt,
      is_active: true,
      last_sync_error: null,
    })
    .eq("id", connection.id)

  if (updateError) {
    console.error("[ignition] failed to persist refreshed token:", updateError)
    // Token is valid, just not yet persisted — return it so the in-flight
    // request succeeds. The next call will re-refresh harmlessly.
  }

  // Update in-memory connection so callers in the same request see fresh values.
  connection.access_token = tokens.access_token
  connection.refresh_token = tokens.refresh_token
  connection.expires_at = expiresAt
  return tokens.access_token
}

/* ─────────────────────────────────────────────────────────────────────────
 * Revoke / disconnect
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Best-effort token revocation. Ignition follows RFC 7009 at /oauth2/revoke;
 * failures are logged and swallowed because we always want disconnect to
 * succeed locally even if the remote revoke call doesn't.
 */
export async function revokeToken(accessToken: string): Promise<void> {
  try {
    const { clientId, clientSecret } = getIgnitionOAuthConfig()
    await fetch(`${IGNITION_AUTH_BASE}/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: accessToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
  } catch (err) {
    console.error("[ignition] revoke failed:", err)
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Paginated read helper
 *
 * All reporting endpoints share the same shape:
 *   GET /reporting/<resource>?limit=&cursor=
 *   → { data: [...], meta: { pagination: { has_more, next_cursor } } }
 *
 * The 1,000 req/hour practice-level rate limit is enforced at the gateway,
 * so we surface 429s by reading the standard headers and waiting until the
 * reset window before retrying once. Anything beyond that is the caller's
 * problem.
 * ─────────────────────────────────────────────────────────────────────── */

export interface IgnitionPage<T> {
  data: T[]
  meta?: {
    pagination?: {
      has_more?: boolean
      next_cursor?: string | null
      limit?: number
    }
  }
}

/**
 * Issues a single authenticated GET against the Ignition reporting API.
 * On 401 it triggers exactly one token refresh and retries; on 429 it
 * waits for X-RateLimit-Reset and retries once.
 */
export async function ignitionFetch<T = unknown>(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getValidAccessToken(connection, supabase)
  if (!token) {
    throw new Error("ignition_no_token")
  }

  const url = path.startsWith("http") ? path : `${IGNITION_API_BASE}${path}`
  const doFetch = (bearer: string) =>
    fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
        Authorization: `Bearer ${bearer}`,
      },
    })

  let response = await doFetch(token)

  if (response.status === 401) {
    const fresh = await refreshAccessToken(connection, supabase)
    if (!fresh) throw new Error("ignition_token_refresh_failed")
    response = await doFetch(fresh)
  }

  if (response.status === 429) {
    const resetHeader = response.headers.get("x-ratelimit-reset")
    const resetMs = resetHeader ? Number(resetHeader) * 1000 - Date.now() : 60_000
    await new Promise((r) => setTimeout(r, Math.max(1000, Math.min(resetMs, 60_000))))
    response = await doFetch((await getValidAccessToken(connection, supabase)) ?? token)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Ignition ${response.status} ${path}: ${body.slice(0, 300)}`)
  }
  return response.json()
}

/**
 * Async-iterator over every page of a reporting endpoint. Yields one page at
 * a time so callers can stream large datasets without loading the full result
 * into memory.
 *
 * Example:
 *   for await (const page of ignitionPaginate(conn, sb, "/reporting/clients")) {
 *     await upsertBatch(page.data)
 *   }
 */
export async function* ignitionPaginate<T = unknown>(
  connection: IgnitionConnectionRow,
  supabase: SupabaseClient,
  path: string,
  options: { limit?: number } = {},
): AsyncGenerator<IgnitionPage<T>> {
  const limit = options.limit ?? 100
  let cursor: string | null = null

  // Mirror the existing loop body cap from Calendly's sync helpers to avoid
  // runaway pagination if the API ever returns has_more=true forever.
  const MAX_PAGES = 1000
  for (let i = 0; i < MAX_PAGES; i++) {
    const sep: string = path.includes("?") ? "&" : "?"
    const cursorParam: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    const page: IgnitionPage<T> = await ignitionFetch<IgnitionPage<T>>(
      connection,
      supabase,
      `${path}${sep}limit=${limit}${cursorParam}`,
    )
    yield page
    if (!page.meta?.pagination?.has_more) return
    cursor = page.meta.pagination.next_cursor ?? null
    if (!cursor) return
  }
  throw new Error(`Pagination cap reached for ${path}`)
}
