import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const accessToken = process.env.CALENDLY_ACCESS_TOKEN

  if (!accessToken) {
    console.error("[v0] Calendly access token not found")
    return NextResponse.json({ error: "Calendly access token not configured" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const userUri = searchParams.get("user")
  const status = searchParams.get("status") || "active"
  const minStartTime = searchParams.get("min_start_time")
  const maxStartTime = searchParams.get("max_start_time")

  if (!userUri) {
    return NextResponse.json({ error: "User URI is required" }, { status: 400 })
  }

  try {
    console.log("[v0] Fetching Calendly scheduled events...")

    // Build query parameters
    const params = new URLSearchParams({
      user: userUri,
      status,
      sort: "start_time:asc",
    })

    if (minStartTime) params.append("min_start_time", minStartTime)
    if (maxStartTime) params.append("max_start_time", maxStartTime)

    const response = await fetch(`https://api.calendly.com/scheduled_events?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Calendly API error:", response.status, errorText)
      throw new Error(`Calendly API error: ${response.status}`)
    }

    const data = await response.json()
    console.log("[v0] Successfully fetched", data.collection?.length || 0, "scheduled events")

    return NextResponse.json(data.collection || [])
  } catch (error) {
    console.error("[v0] Error fetching Calendly scheduled events:", error)
    return NextResponse.json({ error: "Failed to fetch Calendly scheduled events" }, { status: 500 })
  }
}
