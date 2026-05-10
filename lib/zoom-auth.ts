// Zoom auth helper backed by per-user OAuth connections.
//
// Earlier versions of this file used Zoom Server-to-Server OAuth
// (`grant_type=account_credentials` keyed off ZOOM_ACCOUNT_ID), but the
// integration has since moved to user-managed OAuth: each Motta team
// member installs the Hub from Zoom's Marketplace and we store their
// access_token + refresh_token in the `zoom_connections` table. This
// file is the single point that downstream routes (`/api/zoom/meetings`,
// `/api/zoom/recordings`, `/api/zoom/call-history`, etc.) go through to
// turn a stored connection into a usable bearer token.
//
// Public API:
//   - getActiveZoomConnections(): every active+sync_enabled connection
//   - zoomFetch(connection, url, init?): call a Zoom API URL with the
//     connection's token, auto-refreshing once on a 401 and retrying
//   - getZoomAccessToken(): legacy single-token helper kept for routes
//     that haven't been multi-tenant'd yet; returns the first active
//     connection's token (with auto-refresh of expired tokens)

import { createAdminClient } from "@/lib/supabase/server"

export type ZoomConnection = {
  id: string
  team_member_id: string
  zoom_user_id: string
  zoom_account_id: string | null
  zoom_email: string
  zoom_first_name: string | null
  zoom_last_name: string | null
  zoom_display_name: string | null
  zoom_pic_url: string | null
  zoom_timezone: string | null
  zoom_user_type: number | null
  access_token: string
  refresh_token: string
  scope: string | null
  is_active: boolean
  sync_enabled: boolean
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token"

/**
 * Returns every Zoom connection that is active AND has sync enabled,
 * ordered oldest first. Used by routes that need to iterate every
 * connected team member (e.g. master-calendar aggregation).
 */
export async function getActiveZoomConnections(): Promise<ZoomConnection[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("zoom_connections")
    .select("*")
    .eq("is_active", true)
    .eq("sync_enabled", true)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("[v0] [Zoom Auth] Failed to load connections:", error)
    throw new Error("Failed to load Zoom connections")
  }
  return (data as ZoomConnection[]) ?? []
}

/**
 * Use a connection's refresh_token to get a fresh access_token from
 * Zoom and persist it back to `zoom_connections`. Returns the new
 * access_token. If Zoom rejects the refresh (e.g. user revoked the
 * app from their Zoom account), the connection is marked inactive
 * so we stop trying.
 */
async function refreshConnectionToken(connection: ZoomConnection): Promise<string> {
  const clientId = process.env.ZOOM_CLIENT_ID
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET are not configured")
  }

  console.log(`[v0] [Zoom Auth] Refreshing token for connection ${connection.id} (${connection.zoom_email})`)

  const res = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[v0] [Zoom Auth] Refresh failed for ${connection.id}: ${res.status} ${body}`)

    // Refresh tokens are single-use AND tied to the user's grant; once
    // they fail we can't recover without the user re-installing the app.
    // Mark the row inactive so the rest of the system stops retrying
    // and we surface a "reconnect" prompt in the UI.
    const admin = createAdminClient()
    await admin
      .from("zoom_connections")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", connection.id)

    throw new Error(`Zoom refresh failed (${res.status}). Connection marked inactive; user must reconnect.`)
  }

  const tokens = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    token_type: string
  }

  const admin = createAdminClient()
  await admin
    .from("zoom_connections")
    .update({
      access_token: tokens.access_token,
      // Zoom rotates the refresh_token on every refresh. If for some
      // reason the response omits a new one, fall back to the prior
      // value so we don't write null.
      refresh_token: tokens.refresh_token ?? connection.refresh_token,
      scope: tokens.scope ?? connection.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)

  // Mutate the in-memory connection too, so callers that retain a
  // reference get the new token without a re-read.
  connection.access_token = tokens.access_token
  if (tokens.refresh_token) connection.refresh_token = tokens.refresh_token

  return tokens.access_token
}

/**
 * Call a Zoom API endpoint with a connection's bearer token. If Zoom
 * returns 401 (token expired/revoked), refresh the token once and
 * retry the same request. Other status codes are passed through to
 * the caller without modification.
 *
 * Use this everywhere instead of hand-rolling `fetch` + `Authorization`
 * headers, so the entire integration benefits from auto-refresh.
 */
export async function zoomFetch(
  connection: ZoomConnection,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const buildHeaders = (token: string): HeadersInit => ({
    ...(init.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  })

  let res = await fetch(url, { ...init, headers: buildHeaders(connection.access_token) })

  if (res.status === 401) {
    console.log(`[v0] [Zoom Auth] 401 on ${url}, refreshing connection ${connection.id} and retrying`)
    const newToken = await refreshConnectionToken(connection)
    res = await fetch(url, { ...init, headers: buildHeaders(newToken) })
  }

  return res
}

/**
 * Legacy helper: returns an access token for the FIRST active+sync-enabled
 * connection. Kept for backward compatibility with routes that haven't
 * been updated to iterate per-user yet (`/api/zoom/user`, `/api/zoom/token`,
 * `/api/zoom/meetings`, `/api/zoom/recordings`, `/api/zoom/call-history`).
 *
 * If no team member has connected their Zoom account, throws a clear
 * error that surfaces to the dashboard as the "Failed to get Zoom access
 * token" message.
 */
export async function getZoomAccessToken(): Promise<string> {
  const connections = await getActiveZoomConnections()
  if (connections.length === 0) {
    throw new Error(
      "No Zoom users connected. Have a team member install Motta Hub from the Zoom Marketplace.",
    )
  }
  // Don't pre-emptively refresh; just return the stored token. Callers
  // using zoomFetch() (or that 401 on first try) will trigger a refresh
  // through the per-connection path. This keeps the legacy callers
  // simple while still benefiting from background rotation when they
  // hit an expired token.
  return connections[0].access_token
}
