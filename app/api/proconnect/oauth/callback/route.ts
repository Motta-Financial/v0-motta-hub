/**
 * ProConnect OAuth - Callback
 *
 * Receives the authorization code from Intuit after the user grants consent,
 * exchanges it for access + refresh tokens, and persists them to the singleton
 * proconnect_oauth_tokens row.
 *
 * Identity / CSRF is enforced via the HMAC-signed `state` minted in /connect
 * (lib/proconnect/oauth-state). Because the state is self-contained we do not
 * rely on a session cookie here — Intuit's cross-domain redirect would not send
 * one — which is also why middleware.ts exempts this exact path.
 *
 * Configured in Intuit Developer:
 *   Redirect URIs: https://hub.motta.cpa/api/proconnect/oauth/callback
 */
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getRedirectUri } from "@/lib/proconnect/oauth"
import { verifyState } from "@/lib/proconnect/oauth-state"

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const realmId = searchParams.get("realmId")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // The /tax dashboard lives on the Hub host, not the marketing site, so
  // post-OAuth UI redirects use APP_BASE_URL (hub.motta.cpa).
  const baseUrl = process.env.APP_BASE_URL || "https://hub.motta.cpa"

  // Verify the signed state BEFORE doing anything else. An invalid/expired
  // state means a CSRF attempt or a stale tab — bounce to settings.
  const decoded = verifyState(state)
  if (!decoded) {
    const url = new URL("/tax/settings", baseUrl)
    url.searchParams.set("error", "proconnect_invalid_state")
    return NextResponse.redirect(url)
  }
  const returnTo = decoded.returnTo || "/tax/settings"

  // Handle user-denied consent or other errors from Intuit.
  if (error) {
    const url = new URL(returnTo, baseUrl)
    url.searchParams.set("oauth_error", error)
    if (errorDescription) url.searchParams.set("oauth_error_description", errorDescription)
    return NextResponse.redirect(url)
  }

  if (!code) {
    const url = new URL(returnTo, baseUrl)
    url.searchParams.set("error", "proconnect_missing_code")
    return NextResponse.redirect(url)
  }

  const clientId = process.env.PROCONNECT_CLIENT_ID
  const clientSecret = process.env.PROCONNECT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    const url = new URL(returnTo, baseUrl)
    url.searchParams.set("error", "proconnect_not_configured")
    return NextResponse.redirect(url)
  }

  // Exchange the authorization code for tokens. The redirect_uri here must be
  // byte-for-byte identical to the one sent in /connect and registered with
  // Intuit, so it comes from the same resolver.
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const redirectUri = getRedirectUri()

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
    const url = new URL(returnTo, baseUrl)
    url.searchParams.set("error", "proconnect_token_exchange_failed")
    return NextResponse.redirect(url)
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    token_type: string
    expires_in: number
    x_refresh_token_expires_in?: number
    scope?: string
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const now = new Date().toISOString()
  // Persist the *granted* scope from Intuit (not the requested one) so the
  // dashboard can detect when the Phase 1 tax-returns scope was not actually
  // granted (Intuit must explicitly allow-list it) and prompt re-consent.
  const grantedScope = tokens.scope ?? "com.intuit.proconnect.taxreturns"
  const payload = {
    is_singleton: true,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: expiresAt,
    scope: grantedScope,
    realm_id: realmId,
    // Record which admin completed the consent (from the signed state) and
    // clear any prior refresh error now that we have a fresh grant.
    connected_by_team_member_id: decoded.teamMemberId,
    last_refresh_error: null,
    updated_at: now,
  }

  // Upsert (insert, fall back to update on the singleton unique violation).
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
        scope: grantedScope,
        realm_id: realmId,
        connected_by_team_member_id: decoded.teamMemberId,
        last_refresh_error: null,
        updated_at: now,
      })
      .eq("is_singleton", true)
    if (updateError) {
      const url = new URL(returnTo, baseUrl)
      url.searchParams.set("error", "proconnect_save_failed")
      return NextResponse.redirect(url)
    }
  } else if (insertError) {
    const url = new URL(returnTo, baseUrl)
    url.searchParams.set("error", "proconnect_save_failed")
    return NextResponse.redirect(url)
  }

  const successUrl = new URL(returnTo, baseUrl)
  successUrl.searchParams.set("connected", "1")
  return NextResponse.redirect(successUrl)
}
