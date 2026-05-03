import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { getCalendlyOAuthConfig } from "@/lib/calendly-api"

/**
 * Begins the Calendly OAuth flow for the currently-authenticated team
 * member. The state parameter is a signed payload binding the redirect
 * back to *this* user — without it, an attacker could trick a victim
 * into linking their own Calendly account to the victim's team_member.
 *
 * Calendly does not accept `scope` as a query parameter; scopes come
 * from the OAuth app configuration in Calendly's developer console.
 */
export async function GET(request: NextRequest) {
  try {
    const { clientId, redirectUri } = getCalendlyOAuthConfig()
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL("/login?next=/calendly", request.url))
    }

    const { data: teamMember } = await supabase
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .single()

    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    }

    // Sign the state payload with a server-only secret. We use a derived
    // key from the Supabase JWT secret since it's already required for
    // the rest of auth — no new env var needed.
    const stateSecret =
      process.env.SUPABASE_JWT_SECRET ||
      process.env.CALENDLY_CLIENT_SECRET ||
      "calendly-state-secret"
    const payload = {
      teamMemberId: teamMember.id,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString("hex"),
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const signature = crypto
      .createHmac("sha256", stateSecret)
      .update(payloadB64)
      .digest("base64url")
    const state = `${payloadB64}.${signature}`

    const authUrl = new URL("https://auth.calendly.com/oauth/authorize")
    authUrl.searchParams.set("client_id", clientId)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("redirect_uri", redirectUri)
    authUrl.searchParams.set("state", state)

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    console.error("[calendly] authorize error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate OAuth" },
      { status: 500 },
    )
  }
}
