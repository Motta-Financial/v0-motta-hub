import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const CALENDLY_CLIENT_ID = process.env.CALENDLY_CLIENT_ID!
const CALENDLY_CLIENT_SECRET = process.env.CALENDLY_CLIENT_SECRET!
const CALENDLY_REDIRECT_URI = process.env.CALENDLY_REDIRECT_URI || "https://motta.cpa/api/calendly/oauth/callback"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  // Handle OAuth errors
  if (error) {
    console.error("Calendly OAuth error:", error)
    return NextResponse.redirect(new URL("/calendar?error=oauth_denied", request.url))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/calendar?error=missing_params", request.url))
  }

  try {
    // Decode state to get team member ID
    const stateData = JSON.parse(Buffer.from(state, "base64").toString())
    const { teamMemberId } = stateData

    if (!teamMemberId) {
      return NextResponse.redirect(new URL("/calendar?error=invalid_state", request.url))
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://auth.calendly.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CALENDLY_CLIENT_ID,
        client_secret: CALENDLY_CLIENT_SECRET,
        code,
        redirect_uri: CALENDLY_REDIRECT_URI,
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text()
      console.error("Token exchange failed:", errorData)
      return NextResponse.redirect(new URL("/calendar?error=token_exchange_failed", request.url))
    }

    const tokens = await tokenResponse.json()
    const { access_token, refresh_token, expires_in, token_type, scope } = tokens

    // Get Calendly user info
    const userResponse = await fetch("https://api.calendly.com/users/me", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    })

    if (!userResponse.ok) {
      console.error("Failed to get Calendly user info")
      return NextResponse.redirect(new URL("/calendar?error=user_fetch_failed", request.url))
    }

    const { resource: calendlyUser } = await userResponse.json()

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + expires_in * 1000)

    // Save connection to Supabase
    const supabase = await createClient()

    const { error: upsertError } = await supabase.from("calendly_connections").upsert(
      {
        team_member_id: teamMemberId,
        calendly_user_uri: calendlyUser.uri,
        calendly_user_uuid: calendlyUser.uri.split("/").pop(),
        calendly_user_name: calendlyUser.name,
        calendly_user_email: calendlyUser.email,
        calendly_user_avatar: calendlyUser.avatar_url,
        calendly_user_timezone: calendlyUser.timezone,
        calendly_organization_uri: calendlyUser.current_organization,
        access_token,
        refresh_token,
        token_type,
        expires_at: expiresAt.toISOString(),
        scope,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "team_member_id",
      },
    )

    if (upsertError) {
      console.error("Failed to save connection:", upsertError)
      return NextResponse.redirect(new URL("/calendar?error=save_failed", request.url))
    }

    // Redirect to calendar with success message
    return NextResponse.redirect(new URL("/calendar?connected=true", request.url))
  } catch (error) {
    console.error("Calendly OAuth callback error:", error)
    return NextResponse.redirect(new URL("/calendar?error=callback_failed", request.url))
  }
}
