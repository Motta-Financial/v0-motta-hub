// @ts-nocheck
/**
 * ProConnect Refresh Token - Supabase Edge Function (Deno Runtime)
 *
 * Refreshes the ProConnect OAuth token stored in the proconnect_oauth_tokens
 * table. This is a standalone function that can be called by a cron job or
 * manually to keep the token fresh.
 *
 * NO AUTH REQUIRED - Supabase gateway handles auth via apikey header.
 * "Verify JWT with legacy secret" should be OFF in function settings.
 *
 * Env vars (set via `supabase secrets set`):
 * - PROCONNECT_CLIENT_ID
 * - PROCONNECT_CLIENT_SECRET
 * - SUPABASE_URL (auto)
 * - SUPABASE_SERVICE_ROLE_KEY (auto)
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// CORS Headers - allow calls from anywhere
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"

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
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  console.log("[v0] ========== FUNCTION INVOKED ==========")
  console.log("[v0] Method:", req.method)
  console.log("[v0] URL:", req.url)

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("[v0] Handling CORS preflight request")
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Read environment variables
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 1: Reading environment variables...")

    const PROCONNECT_CLIENT_ID = Deno.env.get("PROCONNECT_CLIENT_ID")
    const PROCONNECT_CLIENT_SECRET = Deno.env.get("PROCONNECT_CLIENT_SECRET")
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    console.log("[v0] PROCONNECT_CLIENT_ID exists:", !!PROCONNECT_CLIENT_ID)
    console.log("[v0] PROCONNECT_CLIENT_SECRET exists:", !!PROCONNECT_CLIENT_SECRET)
    console.log("[v0] SUPABASE_URL:", SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + "..." : "MISSING")
    console.log("[v0] SUPABASE_SERVICE_ROLE_KEY exists:", !!SUPABASE_SERVICE_ROLE_KEY)

    if (!PROCONNECT_CLIENT_ID) {
      console.error("[v0] ERROR: PROCONNECT_CLIENT_ID is not set")
      return new Response(
        JSON.stringify({ success: false, error: "PROCONNECT_CLIENT_ID is not set" }),
        { status: 500, headers: corsHeaders }
      )
    }

    if (!PROCONNECT_CLIENT_SECRET) {
      console.error("[v0] ERROR: PROCONNECT_CLIENT_SECRET is not set")
      return new Response(
        JSON.stringify({ success: false, error: "PROCONNECT_CLIENT_SECRET is not set" }),
        { status: 500, headers: corsHeaders }
      )
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[v0] ERROR: Supabase env vars missing")
      return new Response(
        JSON.stringify({ success: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" }),
        { status: 500, headers: corsHeaders }
      )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Create Supabase client
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 2: Creating Supabase admin client...")

    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    console.log("[v0] Supabase client created successfully")

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Query the singleton token row
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 3: Querying proconnect_oauth_tokens for is_singleton=true...")

    const { data: storedToken, error: fetchError } = await supabase
      .from("proconnect_oauth_tokens")
      .select("id, refresh_token, access_token, expires_at, realm_id, scope")
      .eq("is_singleton", true)
      .single()

    console.log("[v0] Query complete")
    console.log("[v0] Fetch error:", fetchError ? JSON.stringify(fetchError) : "none")
    console.log("[v0] Token found:", !!storedToken)

    if (fetchError) {
      console.error("[v0] ERROR: Failed to fetch token row:", fetchError.message)
      return new Response(
        JSON.stringify({ success: false, error: `Database fetch failed: ${fetchError.message}` }),
        { status: 500, headers: corsHeaders }
      )
    }

    if (!storedToken) {
      console.error("[v0] ERROR: No singleton token row found")
      return new Response(
        JSON.stringify({ success: false, error: "No singleton token row found (is_singleton=true)" }),
        { status: 404, headers: corsHeaders }
      )
    }

    const { refresh_token: currentRefreshToken, id: tokenRowId } = storedToken as StoredToken
    console.log("[v0] Token row ID:", tokenRowId)
    console.log("[v0] Refresh token exists:", !!currentRefreshToken)
    console.log("[v0] Refresh token length:", currentRefreshToken?.length || 0)

    if (!currentRefreshToken) {
      console.error("[v0] ERROR: No refresh_token value in stored row")
      return new Response(
        JSON.stringify({ success: false, error: "No refresh_token value in stored row" }),
        { status: 400, headers: corsHeaders }
      )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Call Intuit OAuth to refresh the token
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 4: Calling Intuit OAuth endpoint...")
    console.log("[v0] Token URL:", TOKEN_URL)

    const credentials = btoa(`${PROCONNECT_CLIENT_ID}:${PROCONNECT_CLIENT_SECRET}`)
    console.log("[v0] Basic auth credentials encoded (length):", credentials.length)

    const requestBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
    })

    console.log("[v0] Request body:", requestBody.toString().substring(0, 50) + "...")

    const intuitResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
      body: requestBody,
    })

    console.log("[v0] Intuit response status:", intuitResponse.status)
    console.log("[v0] Intuit response ok:", intuitResponse.ok)

    const intuitResponseText = await intuitResponse.text()
    console.log("[v0] Intuit response body:", intuitResponseText.substring(0, 200))

    if (!intuitResponse.ok) {
      console.error("[v0] ERROR: Intuit token refresh failed")
      return new Response(
        JSON.stringify({
          success: false,
          error: `Intuit OAuth failed: ${intuitResponse.status}`,
          intuit_response: intuitResponseText,
        }),
        { status: 502, headers: corsHeaders }
      )
    }

    let newTokens: TokenResponse
    try {
      newTokens = JSON.parse(intuitResponseText)
      console.log("[v0] Parsed new tokens successfully")
      console.log("[v0] New access_token length:", newTokens.access_token?.length || 0)
      console.log("[v0] New refresh_token length:", newTokens.refresh_token?.length || 0)
      console.log("[v0] expires_in:", newTokens.expires_in)
    } catch (parseError) {
      console.error("[v0] ERROR: Failed to parse Intuit response as JSON")
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to parse Intuit response",
          raw_response: intuitResponseText,
        }),
        { status: 502, headers: corsHeaders }
      )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Calculate new expires_at and update the database
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 5: Updating proconnect_oauth_tokens table...")

    const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
    const updatedAt = new Date().toISOString()

    console.log("[v0] New expires_at:", expiresAt)
    console.log("[v0] updated_at:", updatedAt)

    const { error: updateError } = await supabase
      .from("proconnect_oauth_tokens")
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        token_type: newTokens.token_type || "Bearer",
        expires_at: expiresAt,
        updated_at: updatedAt,
      })
      .eq("is_singleton", true)

    if (updateError) {
      console.error("[v0] ERROR: Failed to update token in database:", updateError.message)
      return new Response(
        JSON.stringify({ success: false, error: `Database update failed: ${updateError.message}` }),
        { status: 500, headers: corsHeaders }
      )
    }

    console.log("[v0] ========== SUCCESS ==========")
    console.log("[v0] Token refreshed and saved to database")

    return new Response(
      JSON.stringify({
        success: true,
        expires_at: expiresAt,
        updated_at: updatedAt,
        message: "Token refreshed successfully",
      }),
      { status: 200, headers: corsHeaders }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined

    console.error("[v0] ========== UNHANDLED ERROR ==========")
    console.error("[v0] Error message:", message)
    console.error("[v0] Error stack:", stack)

    return new Response(
      JSON.stringify({
        success: false,
        error: message,
        stack: stack,
      }),
      { status: 500, headers: corsHeaders }
    )
  }
})
