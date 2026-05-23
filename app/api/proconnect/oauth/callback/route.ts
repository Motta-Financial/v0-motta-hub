/**
 * ProConnect OAuth - Callback
 *
 * Receives the authorization code from Intuit after the user grants
 * consent, exchanges it for access + refresh tokens, and persists them
 * to proconnect_oauth_tokens.
 *
 * Configured in Intuit Developer:
 *   Redirect URIs (Development): https://hub.motta.cpa/api/proconnect/oauth/callback
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const realmId = searchParams.get("realmId")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"

  // Handle user-denied consent or other errors from Intuit
  if (error) {
    const url = new URL("/tax/settings", baseUrl)
    url.searchParams.set("oauth_error", error)
    if (errorDescription) url.searchParams.set("oauth_error_description", errorDescription)
    return NextResponse.redirect(url)
  }

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 })
  }

  // Verify state matches the cookie we set in /connect
  const cookieState = request.cookies.get("pc_oauth_state")?.value
  if (!cookieState || cookieState !== state) {
    return NextResponse.json(
      { error: "Invalid state — possible CSRF attempt" },
      { status: 400 }
    )
  }

  const clientId = process.env.PROCONNECT_CLIENT_ID
  const clientSecret = process.env.PROCONNECT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "ProConnect OAuth credentials not configured" },
      { status: 500 }
    )
  }

  // Exchange the authorization code for tokens
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const redirectUri = `${baseUrl}/api/proconnect/oauth/callback`

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text()
    console.error("[ProConnect OAuth] Token exchange failed:", tokenResponse.status, errText)
    return NextResponse.json(
      { error: "Token exchange failed", details: errText },
      { status: 500 }
    )
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    token_type: string
    expires_in: number
    x_refresh_token_expires_in?: number
  }

  // Persist tokens to Supabase (singleton row)
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const now = new Date().toISOString()
  const payload = {
    is_singleton: true,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: expiresAt,
    scope: "com.intuit.proconnect.taxreturns",
    realm_id: realmId,
    updated_at: now,
  }

  // Upsert (insert, fall back to update on unique violation)
  const { error: insertError } = await supabase
    .from("proconnect_oauth_tokens")
    .insert(payload)

  if (insertError && insertError.code === "23505") {
    const { error: updateError } = await supabase
      .from("proconnect_oauth_tokens")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: expiresAt,
        realm_id: realmId,
        updated_at: now,
      })
      .eq("is_singleton", true)
    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update tokens: ${updateError.message}` },
        { status: 500 }
      )
    }
  } else if (insertError) {
    return NextResponse.json(
      { error: `Failed to insert tokens: ${insertError.message}` },
      { status: 500 }
    )
  }

  // Clear the state cookie and redirect to the tax dashboard
  const successUrl = new URL("/tax", baseUrl)
  successUrl.searchParams.set("connected", "1")
  const response = NextResponse.redirect(successUrl)
  response.cookies.delete("pc_oauth_state")
  return response
}
