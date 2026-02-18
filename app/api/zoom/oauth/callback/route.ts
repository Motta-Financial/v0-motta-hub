import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabaseAdmin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"

  if (error) {
    console.error("[Zoom OAuth] Error:", error)
    return NextResponse.redirect(`${baseUrl}/zoom?error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/zoom?error=missing_code_or_state`)
  }

  try {
    // Decode state to get team_member_id
    const stateData = JSON.parse(Buffer.from(state, "base64").toString())
    const teamMemberId = stateData.team_member_id

    if (!teamMemberId) {
      return NextResponse.redirect(`${baseUrl}/zoom?error=invalid_state`)
    }

    // Exchange code for tokens
    const clientId = process.env.ZOOM_CLIENT_ID!
    const clientSecret = process.env.ZOOM_CLIENT_SECRET!
    const redirectUri = process.env.ZOOM_REDIRECT_URI || "https://motta.cpa/api/zoom/oauth/callback"

    const tokenResponse = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text()
      console.error("[Zoom OAuth] Token exchange failed:", errorData)
      return NextResponse.redirect(`${baseUrl}/zoom?error=token_exchange_failed`)
    }

    const tokens = await tokenResponse.json()

    // Get user info from Zoom
    const userResponse = await fetch("https://api.zoom.us/v2/users/me", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    })

    if (!userResponse.ok) {
      console.error("[Zoom OAuth] Failed to get user info")
      return NextResponse.redirect(`${baseUrl}/zoom?error=user_info_failed`)
    }

    const zoomUser = await userResponse.json()

    // Calculate token expiration
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Upsert connection in Supabase
    const { error: upsertError } = await supabaseAdmin.from("zoom_connections").upsert(
      {
        team_member_id: teamMemberId,
        zoom_user_id: zoomUser.id,
        zoom_account_id: zoomUser.account_id,
        zoom_email: zoomUser.email,
        zoom_first_name: zoomUser.first_name,
        zoom_last_name: zoomUser.last_name,
        zoom_display_name: zoomUser.display_name || `${zoomUser.first_name} ${zoomUser.last_name}`,
        zoom_pic_url: zoomUser.pic_url,
        zoom_timezone: zoomUser.timezone,
        zoom_user_type: zoomUser.type,
        zoom_pmi: zoomUser.pmi?.toString(),
        zoom_personal_meeting_url: zoomUser.personal_meeting_url,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: expiresAt,
        scope: tokens.scope,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "team_member_id",
      },
    )

    if (upsertError) {
      console.error("[Zoom OAuth] Failed to save connection:", upsertError)
      return NextResponse.redirect(`${baseUrl}/zoom?error=save_failed`)
    }

    return NextResponse.redirect(`${baseUrl}/zoom?success=true`)
  } catch (error) {
    console.error("[Zoom OAuth] Callback error:", error)
    return NextResponse.redirect(`${baseUrl}/zoom?error=callback_failed`)
  }
}
