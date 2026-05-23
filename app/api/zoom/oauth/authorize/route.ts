import { NextResponse } from "next/server"

/**
 * Per-user OAuth scopes the Hub asks Zoom for.
 *
 * Scope strings must EXACTLY match what is enabled on the Zoom
 * Marketplace app under Features > Scopes. Asking for a scope that
 * isn't enabled results in `invalid_scope` from Zoom; not asking for
 * a scope you need results in 401s on every API call.
 *
 * Grouped here so the list is reviewable at a glance and so we can
 * trim it down per-team-member later if we want progressive consent.
 */
const ZOOM_SCOPES = [
  // User identity
  "user:read:user",

  // Meetings -- read & write
  "meeting:read:list_meetings",
  "meeting:read:meeting",
  "meeting:read:list_past_participants",
  "meeting:read:list_past_instances",
  "meeting:read:meeting_summary",
  "meeting:write:meeting",
  "meeting:update:meeting",
  "meeting:delete:meeting",

  // Cloud recordings & transcripts
  "cloud_recording:read:list_user_recordings",
  "cloud_recording:read:recording",
  "cloud_recording:read:list_recording_files",
  "cloud_recording:read:recording_settings",
].join(" ")

/**
 * Kick off the Zoom OAuth flow for a given team member.
 *
 * Builds Zoom's authorize URL with the team_member_id stashed in the
 * `state` param (base64-encoded JSON) so the callback route can
 * resolve which Hub user the connection belongs to.
 *
 * The Hub UI calls this from a "Connect Zoom" button. Zoom's
 * Marketplace "Add to Zoom" button bypasses this route entirely --
 * the callback handles that case via the logged-in user fallback.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const teamMemberId = searchParams.get("team_member_id")

  if (!teamMemberId) {
    return NextResponse.json({ error: "team_member_id is required" }, { status: 400 })
  }

  const clientId = process.env.ZOOM_CLIENT_ID
  const redirectUri = process.env.ZOOM_REDIRECT_URI || "https://hub.motta.cpa/api/zoom/oauth/callback"

  if (!clientId) {
    return NextResponse.json({ error: "Zoom client ID not configured" }, { status: 500 })
  }

  const state = Buffer.from(JSON.stringify({ team_member_id: teamMemberId })).toString("base64")

  const authUrl = new URL("https://zoom.us/oauth/authorize")
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("state", state)
  // Without an explicit scope, Zoom returns the minimum set and
  // every meeting/recording API call will 401. Must match the
  // scope list configured under Marketplace > Features > Scopes.
  authUrl.searchParams.set("scope", ZOOM_SCOPES)

  return NextResponse.redirect(authUrl.toString())
}
