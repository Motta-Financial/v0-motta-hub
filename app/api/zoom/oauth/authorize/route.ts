import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const teamMemberId = searchParams.get("team_member_id")

  if (!teamMemberId) {
    return NextResponse.json({ error: "team_member_id is required" }, { status: 400 })
  }

  const clientId = process.env.ZOOM_CLIENT_ID
  const redirectUri = process.env.ZOOM_REDIRECT_URI || "https://motta.cpa/api/zoom/oauth/callback"

  if (!clientId) {
    return NextResponse.json({ error: "Zoom client ID not configured" }, { status: 500 })
  }

  // Store team_member_id in state parameter for callback
  const state = Buffer.from(JSON.stringify({ team_member_id: teamMemberId })).toString("base64")

  // Zoom OAuth authorization URL
  const authUrl = new URL("https://zoom.us/oauth/authorize")
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("state", state)

  return NextResponse.redirect(authUrl.toString())
}
