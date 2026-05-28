/**
 * ProConnect OAuth - Connect / Reconnect
 *
 * Initiates the Intuit OAuth 2.0 authorization flow.
 * Customers land here when they click "Connect" or "Reconnect" in the
 * Intuit App Marketplace, or directly from /tax/settings.
 *
 * Redirects the user to Intuit's authorization endpoint with the required
 * scope for ProConnect Tax Returns. After consent, Intuit redirects back
 * to /api/proconnect/oauth/callback with an authorization code.
 *
 * Configured in Intuit Developer:
 *   App URLs > Connect/Reconnect URL: https://hub.motta.cpa/api/proconnect/oauth/connect
 */
import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { getRedirectUri } from "@/lib/proconnect/oauth"

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2"
const SCOPE = "com.intuit.proconnect.taxreturns openid profile email"

export async function GET(request: NextRequest) {
  const clientId = process.env.PROCONNECT_CLIENT_ID

  if (!clientId) {
    return NextResponse.json(
      { error: "PROCONNECT_CLIENT_ID not configured" },
      { status: 500 }
    )
  }

  // CSRF protection — store state in a short-lived cookie
  const state = randomBytes(32).toString("hex")
  // Must match the registered Intuit redirect URI exactly and be identical
  // to the value used in the token exchange (/callback).
  const redirectUri = getRedirectUri()

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  })

  const authUrl = `${AUTHORIZE_URL}?${params.toString()}`

  const response = NextResponse.redirect(authUrl)
  response.cookies.set("pc_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  })
  return response
}
