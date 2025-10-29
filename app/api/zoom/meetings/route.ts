import { NextResponse } from "next/server"

async function getAccessToken() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/zoom/token`)
  if (!response.ok) {
    throw new Error("Failed to get access token")
  }
  const data = await response.json()
  return data.access_token
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId") || "me"
    const type = searchParams.get("type") || "scheduled" // scheduled, live, upcoming

    console.log("[v0] Fetching Zoom meetings for user:", userId, "type:", type)

    const accessToken = await getAccessToken()

    const response = await fetch(`https://api.zoom.us/v2/users/${userId}/meetings?type=${type}&page_size=100`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Zoom meetings API error:", errorText)
      throw new Error(`Failed to fetch meetings: ${response.status}`)
    }

    const data = await response.json()
    console.log("[v0] Successfully fetched", data.meetings?.length || 0, "meetings")

    return NextResponse.json(data.meetings || [])
  } catch (error) {
    console.error("[v0] Error fetching Zoom meetings:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch meetings" },
      { status: 500 },
    )
  }
}
