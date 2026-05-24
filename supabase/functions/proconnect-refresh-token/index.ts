// @ts-nocheck
/**
 * ProConnect Refresh Token - Supabase Edge Function (Deno Runtime)
 *
 * Refreshes the ProConnect OAuth token stored in the proconnect_oauth_tokens
 * table. This is a standalone function that can be called by a cron job or
 * manually to keep the token fresh.
 *
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY
 *
 * Env vars (set via `supabase secrets set`):
 * - PROCONNECT_CLIENT_ID
 * - PROCONNECT_CLIENT_SECRET
 * - SUPABASE_URL (auto)
 * - SUPABASE_SERVICE_ROLE_KEY (auto)
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROCONNECT_CLIENT_ID = Deno.env.get("PROCONNECT_CLIENT_ID")!
const PROCONNECT_CLIENT_SECRET = Deno.env.get("PROCONNECT_CLIENT_SECRET")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Admin
// ─────────────────────────────────────────────────────────────────────────────

function getSupabaseAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

interface StoredToken {
  id: string
  refresh_token: string
  access_token: string
  expires_at: string
  realm_id: string | null
  scope: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Refresh Logic
// ─────────────────────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const credentials = btoa(`${PROCONNECT_CLIENT_ID}:${PROCONNECT_CLIENT_SECRET}`)

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
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`)
  }

  return response.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Verify auth - accept service role key
  const authHeader = req.headers.get("authorization")
  const expectedAuth = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`

  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const supabase = getSupabaseAdmin()

  try {
    console.log("[Edge] ProConnect token refresh starting...")

    // 1. Query the singleton token row
    const { data: storedToken, error: fetchError } = await supabase
      .from("proconnect_oauth_tokens")
      .select("id, refresh_token, access_token, expires_at, realm_id, scope")
      .eq("is_singleton", true)
      .single()

    if (fetchError || !storedToken) {
      const message = fetchError?.message || "No singleton token row found"
      console.error(`[Edge] Failed to fetch token: ${message}`)
      return new Response(
        JSON.stringify({ success: false, error: message }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    }

    const { refresh_token: currentRefreshToken, id: tokenRowId } = storedToken as StoredToken

    if (!currentRefreshToken) {
      console.error("[Edge] No refresh_token in stored row")
      return new Response(
        JSON.stringify({ success: false, error: "No refresh_token in stored row" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // 2. Call Intuit OAuth to refresh the token
    console.log("[Edge] Calling Intuit OAuth to refresh token...")
    const newTokens = await refreshAccessToken(currentRefreshToken)

    // 3. Calculate new expires_at (current time + expires_in seconds)
    const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
    const updatedAt = new Date().toISOString()

    // 4. Update the proconnect_oauth_tokens table
    const { error: updateError } = await supabase
      .from("proconnect_oauth_tokens")
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        token_type: newTokens.token_type,
        expires_at: expiresAt,
        updated_at: updatedAt,
      })
      .eq("is_singleton", true)

    if (updateError) {
      console.error(`[Edge] Failed to update token: ${updateError.message}`)
      return new Response(
        JSON.stringify({ success: false, error: `Failed to update token: ${updateError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }

    console.log(`[Edge] Token refreshed successfully. New expiry: ${expiresAt}`)

    return new Response(
      JSON.stringify({
        success: true,
        expires_at: expiresAt,
        updated_at: updatedAt,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error(`[Edge] Token refresh error: ${message}`)

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})
