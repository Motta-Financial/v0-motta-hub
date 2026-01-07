import { NextResponse } from "next/server"
import { getZoomAccessToken } from "@/lib/zoom-auth"

export async function GET() {
  try {
    const accessToken = await getZoomAccessToken()
    return NextResponse.json({ access_token: accessToken })
  } catch (error) {
    console.error("[v0] Error getting Zoom token:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get Zoom token" },
      { status: 500 },
    )
  }
}
