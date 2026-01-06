import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const CALENDLY_CLIENT_ID = process.env.CALENDLY_CLIENT_ID!
const CALENDLY_REDIRECT_URI = process.env.CALENDLY_REDIRECT_URI || "https://motta.cpa/api/calendly/oauth/callback"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    // Get team member ID
    const { data: teamMember } = await supabase.from("team_members").select("id").eq("auth_user_id", user.id).single()

    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    }

    // Generate state parameter (includes team member ID for callback)
    const state = Buffer.from(
      JSON.stringify({
        teamMemberId: teamMember.id,
        timestamp: Date.now(),
      }),
    ).toString("base64")

    // Build Calendly OAuth URL
    const authUrl = new URL("https://auth.calendly.com/oauth/authorize")
    authUrl.searchParams.set("client_id", CALENDLY_CLIENT_ID)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("redirect_uri", CALENDLY_REDIRECT_URI)
    authUrl.searchParams.set("state", state)

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    console.error("Calendly OAuth authorize error:", error)
    return NextResponse.json({ error: "Failed to initiate OAuth" }, { status: 500 })
  }
}
