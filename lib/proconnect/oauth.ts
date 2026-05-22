/**
 * ProConnect OAuth Token Manager
 *
 * Handles token refresh and storage. Tokens are stored in Supabase
 * (proconnect_oauth_tokens table) and refreshed automatically when
 * within 5 minutes of expiration.
 *
 * Environment variables required:
 * - PROCONNECT_CLIENT_ID
 * - PROCONNECT_CLIENT_SECRET
 * - PROCONNECT_REFRESH_TOKEN (initial seed, stored in DB after first use)
 * - PROCONNECT_REALM_ID
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const PROCONNECT_CLIENT_ID = process.env.PROCONNECT_CLIENT_ID!
const PROCONNECT_CLIENT_SECRET = process.env.PROCONNECT_CLIENT_SECRET!
const PROCONNECT_REFRESH_TOKEN = process.env.PROCONNECT_REFRESH_TOKEN!
const PROCONNECT_REALM_ID = process.env.PROCONNECT_REALM_ID!

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
const REFRESH_BUFFER_SECONDS = 300 // Refresh 5 minutes before expiry

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  x_refresh_token_expires_in?: number
}

interface StoredToken {
  id: string
  access_token: string
  refresh_token: string
  token_type: string
  expires_at: string
  scope: string | null
  realm_id: string | null
}

/**
 * Get a Supabase client with service role for token operations
 */
function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const credentials = Buffer.from(
    `${PROCONNECT_CLIENT_ID}:${PROCONNECT_CLIENT_SECRET}`
  ).toString("base64")

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`
    )
  }

  return response.json()
}

/**
 * Store tokens in Supabase using insert-or-update pattern.
 * The Supabase JS SDK doesn't support partial indexes for upsert conflict
 * resolution, so we try insert first and fall back to update on conflict.
 */
async function storeTokens(tokens: TokenResponse): Promise<void> {
  const supabase = getSupabaseAdmin()

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const now = new Date().toISOString()

  const payload = {
    is_singleton: true,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: expiresAt,
    scope: "com.intuit.proconnect.taxreturns",
    realm_id: PROCONNECT_REALM_ID,
    updated_at: now,
  }

  // Try insert first
  const { error: insertError } = await supabase
    .from("proconnect_oauth_tokens")
    .insert(payload)

  if (insertError) {
    // If unique violation (code 23505), update instead
    if (insertError.code === "23505") {
      const { error: updateError } = await supabase
        .from("proconnect_oauth_tokens")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type,
          expires_at: expiresAt,
          updated_at: now,
        })
        .eq("is_singleton", true)

      if (updateError) {
        throw new Error(`Failed to update tokens: ${updateError.message}`)
      }
    } else {
      throw new Error(`Failed to insert tokens: ${insertError.message}`)
    }
  }
}

/**
 * Get stored tokens from Supabase
 */
async function getStoredTokens(): Promise<StoredToken | null> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("proconnect_oauth_tokens")
    .select("*")
    .limit(1)
    .single()

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows
    throw new Error(`Failed to get tokens: ${error.message}`)
  }

  return data
}

/**
 * Check if token needs refresh (within buffer of expiry)
 */
function needsRefresh(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime()
  const bufferTime = Date.now() + REFRESH_BUFFER_SECONDS * 1000
  return bufferTime >= expiryTime
}

/**
 * Get a valid access token, refreshing if necessary.
 * This is the main entry point for other modules.
 */
export async function getAccessToken(): Promise<string> {
  const fnStart = Date.now()
  console.log("[v0] getAccessToken start")

  // Check for stored token
  console.log("[v0] getAccessToken - fetching stored tokens", Date.now() - fnStart, "ms")
  const stored = await getStoredTokens()
  console.log("[v0] getAccessToken - got stored tokens", Date.now() - fnStart, "ms, hasToken:", !!stored)

  if (stored && !needsRefresh(stored.expires_at)) {
    // Token is still valid
    console.log("[v0] getAccessToken - using cached token", Date.now() - fnStart, "ms")
    return stored.access_token
  }

  // Need to refresh
  const refreshToken = stored?.refresh_token || PROCONNECT_REFRESH_TOKEN

  if (!refreshToken) {
    throw new Error(
      "No refresh token available. Set PROCONNECT_REFRESH_TOKEN env var."
    )
  }

  console.log("[v0] getAccessToken - refreshing token", Date.now() - fnStart, "ms")
  const newTokens = await refreshAccessToken(refreshToken)
  console.log("[v0] getAccessToken - got new tokens", Date.now() - fnStart, "ms")

  await storeTokens(newTokens)
  console.log("[v0] getAccessToken - stored tokens", Date.now() - fnStart, "ms")

  return newTokens.access_token
}

/**
 * Force a token refresh (useful for testing or manual intervention)
 */
export async function forceTokenRefresh(): Promise<string> {
  const stored = await getStoredTokens()
  const refreshToken = stored?.refresh_token || PROCONNECT_REFRESH_TOKEN

  if (!refreshToken) {
    throw new Error("No refresh token available")
  }

  const newTokens = await refreshAccessToken(refreshToken)
  await storeTokens(newTokens)

  return newTokens.access_token
}

/**
 * Get the current token status (for admin/debugging)
 */
export async function getTokenStatus(): Promise<{
  hasToken: boolean
  expiresAt: string | null
  isExpired: boolean
  needsRefresh: boolean
}> {
  const stored = await getStoredTokens()

  if (!stored) {
    return {
      hasToken: false,
      expiresAt: null,
      isExpired: true,
      needsRefresh: true,
    }
  }

  const now = Date.now()
  const expiryTime = new Date(stored.expires_at).getTime()

  return {
    hasToken: true,
    expiresAt: stored.expires_at,
    isExpired: now >= expiryTime,
    needsRefresh: needsRefresh(stored.expires_at),
  }
}

/**
 * Get the realm ID for API calls
 */
export function getRealmId(): string {
  return PROCONNECT_REALM_ID
}
