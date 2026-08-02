/**
 * ProConnect API Client
 *
 * Thin wrapper around the ProConnect APIs. Handles authentication,
 * request formatting, and response parsing. All endpoints return
 * the full response body for dynamic field capture.
 *
 * Service URLs:
 * - Client Service: https://client.accountant.intuit.com
 * - Engagement Service: https://engagement.accountant.intuit.com
 * - Data Service: https://protaxdata.api.intuit.com
 */

import { getAccessToken, getRealmId } from "./oauth"

const CLIENT_SERVICE_URL = "https://client.accountant.intuit.com"
const ENGAGEMENT_SERVICE_URL = "https://engagement.accountant.intuit.com"

// Return type codes → form type mapping
export const RETURN_TYPE_MAP: Record<string, string> = {
  IND: "1040",
  COR: "1120",
  PAR: "1065",
  SCO: "1120S",
  FID: "1041",
  EXM: "990",
}

interface ApiResponse<T> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

// ─── Global rate limiter ──────────────────────────────────────────────────
// ProConnect enforces a confirmed ~5 TPS limit per realm; bursting above it
// returns 429. Every outbound request reserves the next time slot before it
// fires, so the whole process stays at or below ~4 req/s no matter how many
// callers run concurrently. This is the single choke point for all
// ProConnect traffic (clients, engagements, custom statuses).
const MIN_REQUEST_INTERVAL_MS = 250 // 1000ms / 250ms = 4 requests/second
let nextRequestSlot = 0

async function acquireRateLimitSlot(): Promise<void> {
  const now = Date.now()
  // Reserve a slot at least MIN_REQUEST_INTERVAL_MS after the previous one.
  // Read-then-write is atomic here (JS is single-threaded and there is no
  // await between them), so concurrent callers each get a distinct slot.
  const slot = Math.max(now, nextRequestSlot)
  nextRequestSlot = slot + MIN_REQUEST_INTERVAL_MS
  const wait = slot - now
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

/**
 * Make an authenticated request to a ProConnect API
 */
async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE"
    body?: unknown
    params?: Record<string, string>
  } = {}
): Promise<ApiResponse<T>> {
  const { method = "GET", body, params } = options

  const accessToken = await getAccessToken()
  const realmId = getRealmId()

  let url = `${baseUrl}${path}`
  if (params) {
    const searchParams = new URLSearchParams(params)
    url += `?${searchParams.toString()}`
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "intuit_product": "ITO",
    "intuit_realmid": realmId,
  }

  if (body) {
    headers["Content-Type"] = "application/json"
  }

  try {
    // Throttle to ~4 req/s (see acquireRateLimitSlot) before every fetch so
    // a full import can never burst past ProConnect's rate limit. Retries
    // route back through here, so they are rate-limited too.
    await acquireRateLimitSlot()

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `${response.status} ${response.statusText}: ${errorText}`,
      }
    }

    const data = await response.json()
    return {
      ok: true,
      status: response.status,
      data,
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Client Service Endpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all clients from ProConnect
 * GET /v1/clients
 */
export async function fetchClients(): Promise<ApiResponse<unknown[]>> {
  const response = await apiRequest<{ clients: unknown[] }>(
    CLIENT_SERVICE_URL,
    "/v1/clients"
  )

  if (!response.ok || !response.data) {
    return { ...response, data: null }
  }

  // API returns { clients: [...] }
  const clients = response.data.clients || response.data
  return {
    ok: true,
    status: response.status,
    data: Array.isArray(clients) ? clients : [clients],
    error: null,
  }
}

/**
 * @deprecated ProConnect's client service has no single-client GET —
 * `GET /v1/clients/{id}` returns a bare Tomcat 404 (this failed every
 * Client webhook from launch through 2026-07). Use `fetchClients()` and
 * filter by id instead (see `syncSingleClient` in ./sync.ts).
 */
export async function fetchClient(
  clientId: string
): Promise<ApiResponse<unknown>> {
  return apiRequest<unknown>(CLIENT_SERVICE_URL, `/v1/clients/${clientId}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// Engagement Service Endpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch engagements for a client and tax year
 * GET /v2/engagements?source=ITO&period={year}&oiiClientId={clientId}&include-efiles=true
 */
export async function fetchEngagements(
  oiiClientId: string,
  taxYear: number
): Promise<ApiResponse<unknown[]>> {
  const response = await apiRequest<{ engagements: unknown[] }>(
    ENGAGEMENT_SERVICE_URL,
    "/v2/engagements",
    {
      params: {
        source: "ITO",
        period: taxYear.toString(),
        oiiClientId,
        // No-op on the list endpoints — see fetchEngagement below. Kept
        // because it costs nothing and would start working if Intuit ever
        // honours it here.
        "include-efiles": "true",
      },
    }
  )

  if (!response.ok || !response.data) {
    return { ...response, data: null }
  }

  // API may return { engagements: [...] } or just an array
  const engagements = response.data.engagements || response.data
  return {
    ok: true,
    status: response.status,
    data: Array.isArray(engagements) ? engagements : [engagements],
    error: null,
  }
}

/**
 * Fetch ALL engagements for a tax year in a single call.
 * GET /v2/engagements?source=ITO&period={year}&include-efiles=true
 *
 * The engagement service returns every engagement for the firm's realm
 * when oiiClientId is omitted, which makes a full-firm sync ~1 request
 * per tax year instead of one request per (client, year) pair. This is
 * the same strategy as the proconnect-sync-engagements Edge Function.
 */
export async function fetchAllEngagementsForYear(
  taxYear: number
): Promise<ApiResponse<unknown[]>> {
  const response = await apiRequest<{ engagements: unknown[] }>(
    ENGAGEMENT_SERVICE_URL,
    "/v2/engagements",
    {
      params: {
        source: "ITO",
        period: taxYear.toString(),
        // No-op here — see fetchEngagement below. Kept for the same reason
        // as in fetchEngagements.
        "include-efiles": "true",
      },
    }
  )

  if (!response.ok || !response.data) {
    return { ...response, data: null }
  }

  const engagements = response.data.engagements || response.data
  return {
    ok: true,
    status: response.status,
    data: Array.isArray(engagements) ? engagements : [engagements],
    error: null,
  }
}

/**
 * Fetch ONE engagement by id.
 * GET /v2/engagements/{engagementId}?source=ITO&include-efiles=true
 *
 * This is the only endpoint that returns e-file status. The bulk list
 * endpoints above emit `taxFiling` with an empty `filings` array on every
 * engagement — 908 of 908 in our realm — regardless of `include-efiles`.
 * The single GET returns the real per-jurisdiction `filings[]`, each with
 * its own `filingStatuses[]` history (confirmed against a live engagement
 * that reported 2 filings, 2026-07-28).
 *
 * The cost of that is one request per engagement instead of one per tax
 * year, against a ~4 req/s throttle. Callers must therefore scope what
 * they hydrate — see hydrateStaleEfileStatuses in ./sync.ts. Do not put
 * this in a loop over every engagement inside a request handler.
 *
 * `include-efiles=true` is not required here — a raw curl with `source=ITO`
 * alone returned `filings: 2` on engagement 229f3018 (2026-07-27). It is
 * passed anyway: harmless, and it keeps both engagement calls honest about
 * what they are asking for.
 */
export async function fetchEngagement(
  engagementId: string
): Promise<ApiResponse<unknown>> {
  const response = await apiRequest<Record<string, unknown>>(
    ENGAGEMENT_SERVICE_URL,
    `/v2/engagements/${encodeURIComponent(engagementId)}`,
    {
      params: {
        source: "ITO",
        "include-efiles": "true",
      },
    }
  )

  if (!response.ok || !response.data) {
    return { ...response, data: null }
  }

  // Unwrap { engagement: {...} } if the service wraps it; the list
  // endpoints wrap their results, so assume this one might too.
  const data = response.data
  const engagement =
    data.engagement && typeof data.engagement === "object"
      ? data.engagement
      : data

  return { ok: true, status: response.status, data: engagement, error: null }
}

/**
 * Fetch custom statuses
 * GET /v1/custom-status?source=ITO
 */
export async function fetchCustomStatuses(): Promise<ApiResponse<unknown[]>> {
  const response = await apiRequest<{ statuses: unknown[] }>(
    ENGAGEMENT_SERVICE_URL,
    "/v1/custom-status",
    {
      params: {
        source: "ITO",
      },
    }
  )

  if (!response.ok || !response.data) {
    return { ...response, data: null }
  }

  const statuses = response.data.statuses || response.data
  return {
    ok: true,
    status: response.status,
    data: Array.isArray(statuses) ? statuses : [statuses],
    error: null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract email from a ProConnect client object
 * Handles the nested structure: { person: { emailAddresses: [{ address: "..." }] } }
 */
export function extractClientEmail(client: unknown): string | null {
  if (!client || typeof client !== "object") return null

  const c = client as Record<string, unknown>

  // Try person.emailAddresses
  if (c.person && typeof c.person === "object") {
    const person = c.person as Record<string, unknown>
    if (Array.isArray(person.emailAddresses)) {
      // Find primary or first
      const primary = person.emailAddresses.find((e: unknown) => {
        if (!e || typeof e !== "object") return false
        const properties = (e as Record<string, unknown>).properties
        if (!properties || typeof properties !== "object") return false
        return (properties as Record<string, unknown>).isPrimary === "true"
      })
      const email = primary || person.emailAddresses[0]
      if (email && typeof email === "object") {
        return (email as Record<string, unknown>).address as string | null
      }
    }
  }

  // Try top-level email
  if (typeof c.email === "string") return c.email

  return null
}

/**
 * Extract client ID from a ProConnect client object
 */
export function extractClientId(client: unknown): string | null {
  if (!client || typeof client !== "object") return null

  const c = client as Record<string, unknown>
  return (c.id || c.clientId || c.oiiClientId) as string | null
}

/**
 * Extract name from a ProConnect client object
 */
export function extractClientName(client: unknown): {
  firstName: string | null
  lastName: string | null
  businessName: string | null
  displayName: string | null
} {
  if (!client || typeof client !== "object") {
    return {
      firstName: null,
      lastName: null,
      businessName: null,
      displayName: null,
    }
  }

  const c = client as Record<string, unknown>

  let firstName: string | null = null
  let lastName: string | null = null
  let businessName: string | null = null

  // Try person.names
  if (c.person && typeof c.person === "object") {
    const person = c.person as Record<string, unknown>
    if (Array.isArray(person.names) && person.names.length > 0) {
      const name = person.names[0] as Record<string, unknown>
      firstName = (name.firstName as string) || null
      lastName = (name.lastName as string) || null
    }
  }

  // Try top-level fields
  if (!firstName) firstName = (c.firstName as string) || null
  if (!lastName) lastName = (c.lastName as string) || null
  businessName = (c.businessName as string) || null

  // Build display name
  const displayName =
    businessName ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    (c.name as string) ||
    null

  return { firstName, lastName, businessName, displayName }
}
