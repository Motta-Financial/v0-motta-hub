import { NextResponse } from "next/server"
import { getZoomAccessToken } from "@/lib/zoom-auth"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId") || "me"

    console.log("[v0] Fetching Zoom user info for:", userId)

    const accessToken = await getZoomAccessToken()

    const response = await fetch(`https://api.zoom.us/v2/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Zoom user API error:", response.status, errorText)
      throw new Error(`Failed to fetch user: ${response.status}`)
    }

    const data = await response.json()
    console.log("[v0] Successfully fetched user info")

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error fetching Zoom user:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch user" },
      { status: 500 },
    )
  }
}
