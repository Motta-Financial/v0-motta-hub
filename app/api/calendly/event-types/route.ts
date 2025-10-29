import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const accessToken = process.env.CALENDLY_ACCESS_TOKEN

  if (!accessToken) {
    console.error("[v0] Calendly access token not found")
    return NextResponse.json({ error: "Calendly access token not configured" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const userUri = searchParams.get("user")

  if (!userUri) {
    return NextResponse.json({ error: "User URI is required" }, { status: 400 })
  }

  try {
    console.log("[v0] Fetching Calendly event types...")

    const response = await fetch(
      `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&active=true`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Calendly API error:", response.status, errorText)
      throw new Error(`Calendly API error: ${response.status}`)
    }

    const data = await response.json()
    console.log("[v0] Successfully fetched", data.collection?.length || 0, "event types")

    return NextResponse.json(data.collection || [])
  } catch (error) {
    console.error("[v0] Error fetching Calendly event types:", error)
    return NextResponse.json({ error: "Failed to fetch Calendly event types" }, { status: 500 })
  }
}
