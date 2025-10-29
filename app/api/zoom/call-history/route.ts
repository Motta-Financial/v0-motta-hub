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
    const from = searchParams.get("from") || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const to = searchParams.get("to") || new Date().toISOString()

    console.log("[v0] Fetching Zoom call history from:", from, "to:", to)

    const accessToken = await getAccessToken()

    const response = await fetch(`https://api.zoom.us/v2/phone/call_history?from=${from}&to=${to}&page_size=100`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Zoom call history API error:", errorText)

      // If it's a 403, the account might not have Zoom Phone
      if (response.status === 403) {
        console.log("[v0] Zoom Phone not available for this account")
        return NextResponse.json([])
      }

      throw new Error(`Failed to fetch call history: ${response.status}`)
    }

    const data = await response.json()
    console.log("[v0] Successfully fetched", data.call_logs?.length || 0, "call logs")

    return NextResponse.json(data.call_logs || [])
  } catch (error) {
    console.error("[v0] Error fetching Zoom call history:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch call history" },
      { status: 500 },
    )
  }
}
