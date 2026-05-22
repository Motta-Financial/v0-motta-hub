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
 * Fetch a single client by ID
 * GET /v1/clients/{id}
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
 * GET /v2/engagements?source=ITO&period={year}&oiiClientId={clientId}
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
      const primary = person.emailAddresses.find(
        (e: unknown) =>
          e &&
          typeof e === "object" &&
          (e as Record<string, unknown>).properties?.isPrimary === "true"
      )
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
