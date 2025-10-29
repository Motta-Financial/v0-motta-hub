import { NextResponse } from "next/server"

export async function GET() {
  try {
    const clientId = process.env.ZOOM_CLIENT_ID
    const clientSecret = process.env.ZOOM_CLIENT_SECRET
    const accountId = process.env.ZOOM_ACCOUNT_ID

    if (!clientId || !clientSecret || !accountId) {
      console.error("[v0] Missing Zoom credentials")
      return NextResponse.json({ error: "Zoom credentials not configured" }, { status: 401 })
    }

    console.log("[v0] Fetching Zoom access token...")

    // Get access token using Server-to-Server OAuth
    const tokenResponse = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "account_credentials",
        account_id: accountId,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error("[v0] Zoom token error:", errorText)
      throw new Error(`Failed to get Zoom access token: ${tokenResponse.status}`)
    }

    const tokenData = await tokenResponse.json()
    console.log("[v0] Successfully obtained Zoom access token")

    return NextResponse.json(tokenData)
  } catch (error) {
    console.error("[v0] Error getting Zoom token:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get Zoom token" },
      { status: 500 },
    )
  }
}
