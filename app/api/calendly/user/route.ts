import { NextResponse } from "next/server"

export async function GET() {
  const accessToken = process.env.CALENDLY_ACCESS_TOKEN

  if (!accessToken) {
    console.error("[v0] Calendly access token not found")
    return NextResponse.json({ error: "Calendly access token not configured" }, { status: 401 })
  }

  try {
    console.log("[v0] Fetching Calendly user information...")

    const response = await fetch("https://api.calendly.com/users/me", {
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
    console.log("[v0] Successfully fetched Calendly user")

    return NextResponse.json(data.resource)
  } catch (error) {
    console.error("[v0] Error fetching Calendly user:", error)
    return NextResponse.json({ error: "Failed to fetch Calendly user" }, { status: 500 })
  }
}
