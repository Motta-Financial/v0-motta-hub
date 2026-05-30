// Zoom Server-to-Server (S2S) OAuth helper — account-wide access.
//
// This is DISTINCT from `lib/zoom-auth.ts`, which handles per-user
// OAuth (each team member installs the Hub and we store their
// access/refresh tokens in `zoom_connections`). S2S uses a single
// app credential (`grant_type=account_credentials`) to mint an
// account-scoped admin token that can enumerate EVERY user's meetings
// and recordings — including users who never personally connected.
//
// Env (separate app from ZOOM_CLIENT_ID/SECRET — see ZOOM_S2S_* vars):
//   - ZOOM_S2S_CLIENT_ID
//   - ZOOM_S2S_CLIENT_SECRET
//   - ZOOM_S2S_ACCOUNT_ID
//
// Public API:
//   - isS2SConfigured(): all three env vars present
//   - getS2SAccessToken(): mint (and module-cache) an admin token
//   - s2sFetch(url, init?): call a Zoom API URL with the S2S token,
//     re-minting once on a 401 and retrying
//   - listAllZoomUsers(): paginate every user in the account

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token"
const ZOOM_API_BASE = "https://api.zoom.us/v2"

export function isS2SConfigured(): boolean {
  return Boolean(
    process.env.ZOOM_S2S_CLIENT_ID &&
      process.env.ZOOM_S2S_CLIENT_SECRET &&
      process.env.ZOOM_S2S_ACCOUNT_ID,
  )
}

// Module-level token cache. S2S tokens last ~1h; we re-mint a minute
// early to avoid edge-of-expiry 401s. Safe for serverless: a cold
// start simply mints a fresh token.
let cachedToken: { token: string; expiresAt: number } | null = null

export async function getS2SAccessToken(forceRefresh = false): Promise<string> {
  if (!isS2SConfigured()) {
    throw new Error(
      "Zoom S2S is not configured. Set ZOOM_S2S_CLIENT_ID, ZOOM_S2S_CLIENT_SECRET, ZOOM_S2S_ACCOUNT_ID.",
    )
  }

  const now = Date.now()
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token
  }

  const clientId = process.env.ZOOM_S2S_CLIENT_ID!
  const clientSecret = process.env.ZOOM_S2S_CLIENT_SECRET!
  const accountId = process.env.ZOOM_S2S_ACCOUNT_ID!
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")

  const res = await fetch(
    `${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Zoom S2S token mint failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  }
  return cachedToken.token
}

/**
 * Call a Zoom API endpoint with the account-wide S2S token. Re-mints
 * the token once on a 401 and retries. Other statuses pass through.
 */
export async function s2sFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getS2SAccessToken()
  const build = (t: string): HeadersInit => ({
    ...(init.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${t}`,
  })

  let res = await fetch(url, { ...init, headers: build(token) })
  if (res.status === 401) {
    const fresh = await getS2SAccessToken(true)
    res = await fetch(url, { ...init, headers: build(fresh) })
  }
  return res
}

export interface ZoomAccountUser {
  id: string
  email: string
  first_name?: string
  last_name?: string
  display_name?: string
  type?: number
  status?: string
}

/**
 * Enumerate every user in the Zoom account (active by default). Walks
 * all pages. Requires the `user:read:list_users:admin` scope.
 */
export async function listAllZoomUsers(
  status: "active" | "inactive" | "pending" = "active",
): Promise<ZoomAccountUser[]> {
  const users: ZoomAccountUser[] = []
  let nextToken: string | null = null

  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ page_size: "300", status })
    if (nextToken) params.set("next_page_token", nextToken)

    const res = await s2sFetch(`${ZOOM_API_BASE}/users?${params.toString()}`)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Zoom list users failed (${res.status}): ${body.slice(0, 200)}`)
    }

    const data = (await res.json()) as {
      users?: ZoomAccountUser[]
      next_page_token?: string
    }
    if (data.users?.length) users.push(...data.users)
    nextToken = data.next_page_token || null
    if (!nextToken) break
  }

  return users
}
