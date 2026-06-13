/**
 * ProConnect OAuth - Connect / Reconnect
 *
 * Initiates the Intuit OAuth 2.0 authorization flow.
 *
 * ProConnect is PRODUCTION-ONLY and every token grants write access to real
 * tax returns, so this route is gated to admin-tier team members only
 * (Company / Partner / Admin — see lib/auth/require-admin.ts). A non-admin is
 * bounced back to /tax/settings with an error rather than being sent to Intuit.
 *
 * CSRF / identity binding uses an HMAC-signed `state` (lib/proconnect/oauth-state)
 * rather than a cookie, mirroring the Calendly + Ignition flows. The signed
 * state survives the cross-domain Intuit redirect and lets the callback record
 * which admin completed the consent.
 *
 * Configured in Intuit Developer:
 *   App URLs > Connect/Reconnect URL: https://hub.motta.cpa/api/proconnect/oauth/connect
 */
import { type NextRequest, NextResponse } from "next/server"
import { getRedirectUri } from "@/lib/proconnect/oauth"
import { mintState } from "@/lib/proconnect/oauth-state"
import { requireAdmin } from "@/lib/auth/require-admin"

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2"
const SCOPE = "com.intuit.proconnect.taxreturns openid profile email"
const RETURN_TO = "/tax/settings"

export async function GET(request: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL || "https://hub.motta.cpa"

  // Gate to admin-tier team members. Anyone else is redirected back to the
  // settings page with an error — we never start the Intuit handshake for them.
  const admin = await requireAdmin()
  if (!admin.ok) {
    const url = new URL(RETURN_TO, baseUrl)
    url.searchParams.set("error", "proconnect_admin_only")
    return NextResponse.redirect(url)
  }

  const clientId = process.env.PROCONNECT_CLIENT_ID
  if (!clientId) {
    const url = new URL(RETURN_TO, baseUrl)
    url.searchParams.set("error", "proconnect_not_configured")
    return NextResponse.redirect(url)
  }

  // Signed state binds the round-trip to this admin (CSRF + "connected by").
  const state = mintState({ teamMemberId: admin.teamMemberId, returnTo: RETURN_TO })

  // Must match the registered Intuit redirect URI exactly and be identical to
  // the value used in the token exchange (/callback).
  const redirectUri = getRedirectUri()

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  })

  return NextResponse.redirect(`${AUTHORIZE_URL}?${params.toString()}`)
}
