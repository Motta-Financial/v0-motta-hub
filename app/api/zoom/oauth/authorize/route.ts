import crypto from "crypto"
import { NextResponse } from "next/server"
import { firmConfigSync } from "@/lib/firm-settings"

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
 * `state` param (HMAC-signed base64 JSON) so the callback route can
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
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  const redirectUri = process.env.ZOOM_REDIRECT_URI || `${firmConfigSync().hubUrl}/api/zoom/oauth/callback`

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Zoom OAuth not configured" }, { status: 500 })
  }

  // Sign the state so the callback can trust the embedded
  // team_member_id. Format: `<base64 payload>.<hmac-sha256 hex>` keyed
  // on ZOOM_CLIENT_SECRET — the callback recomputes and rejects any
  // state whose signature doesn't match, so a forged state can't point
  // the token upsert at an arbitrary team member.
  const statePayload = Buffer.from(JSON.stringify({ team_member_id: teamMemberId })).toString("base64")
  const stateSig = crypto.createHmac("sha256", clientSecret).update(statePayload).digest("hex")
  const state = `${statePayload}.${stateSig}`

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
