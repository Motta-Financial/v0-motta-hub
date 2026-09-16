import { getOAuthStateSecret } from "@/lib/oauth-state-secret"
import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { getMicrosoftOAuthConfig, MICROSOFT_REQUESTED_SCOPES } from "@/lib/outlook-api"

/**
 * Begins the Microsoft OAuth flow for the currently-authenticated team
 * member. Mirrors app/api/calendly/oauth/authorize/route.ts: the state
 * parameter is a signed payload binding the redirect back to *this*
 * user, so an attacker can't trick a victim into linking their own
 * Outlook mailbox to the victim's team_member.
 */
export async function GET(request: NextRequest) {
  // Clicking "Connect" is a full-page navigation (window.location.href),
  // not a fetch the UI can inspect — so any failure here MUST end in a
  // redirect back to the settings page with an `error` code, matching
  // the callback route's pattern. A raw JSON response renders as a
  // blank page with no chrome, which just looks like the button did
  // nothing.
  let clientId: string, tenantId: string, redirectUri: string
  try {
    ;({ clientId, tenantId, redirectUri } = getMicrosoftOAuthConfig())
  } catch (err) {
    console.error("[outlook] authorize config error:", err)
    return NextResponse.redirect(new URL("/settings/outlook?error=not_configured", request.url))
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await getAuthenticatedUser(supabase)
    if (!user) {
      return NextResponse.redirect(new URL("/login?next=/settings/outlook", request.url))
    }

    const { data: teamMember } = await supabase
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .single()

    if (!teamMember) {
      return NextResponse.redirect(new URL("/settings/outlook?error=team_member_missing", request.url))
    }

    const stateSecret = getOAuthStateSecret()
    const payload = {
      teamMemberId: teamMember.id,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString("hex"),
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const signature = crypto.createHmac("sha256", stateSecret).update(payloadB64).digest("base64url")
    const state = `${payloadB64}.${signature}`

    const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`)
    authUrl.searchParams.set("client_id", clientId)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("redirect_uri", redirectUri)
    authUrl.searchParams.set("response_mode", "query")
    authUrl.searchParams.set("scope", MICROSOFT_REQUESTED_SCOPES.join(" "))
    authUrl.searchParams.set("state", state)
    // Ensures a refresh_token is issued even if the user previously
    // consented, and lets the user pick a work account if they have several.
    authUrl.searchParams.set("prompt", "select_account")

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    console.error("[outlook] authorize error:", error)
    return NextResponse.redirect(new URL("/settings/outlook?error=authorize_failed", request.url))
  }
}
