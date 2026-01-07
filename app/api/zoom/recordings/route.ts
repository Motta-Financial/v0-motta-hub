import { NextResponse } from "next/server"
import { getZoomAccessToken } from "@/lib/zoom-auth"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId") || "me"
    const from = searchParams.get("from") || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    const to = searchParams.get("to") || new Date().toISOString().split("T")[0]

    console.log("[v0] Fetching Zoom recordings for user:", userId, "from:", from, "to:", to)

    const accessToken = await getZoomAccessToken()

    const response = await fetch(
      `https://api.zoom.us/v2/users/${userId}/recordings?from=${from}&to=${to}&page_size=100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Zoom recordings API error:", response.status, errorText)
      throw new Error(`Failed to fetch recordings: ${response.status}`)
    }

    const data = await response.json()
    console.log("[v0] Successfully fetched", data.meetings?.length || 0, "recordings")

    return NextResponse.json(data.meetings || [])
  } catch (error) {
    console.error("[v0] Error fetching Zoom recordings:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch recordings" },
      { status: 500 },
    )
  }
}
