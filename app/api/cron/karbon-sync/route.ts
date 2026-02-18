import { NextResponse } from "next/server"

/**
 * Vercel Cron endpoint for scheduled Karbon sync.
 * Configure in vercel.json with schedule: "0/15 * * * *" (every 15 minutes)
 */
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // In development or if no CRON_SECRET, allow access
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    // Fix: parentheses needed to avoid operator precedence bug
    // Without them, NEXT_PUBLIC_APP_URL being truthy short-circuits to
    // the ternary, which always evaluates VERCEL_URL regardless.
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")

    // Run incremental sync (only modified records) with audit trail
    // Pass internal secret so middleware allows the server-to-server call chain
    const response = await fetch(`${baseUrl}/api/karbon/sync?incremental=true&expand=false&manual=false`, {
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CRON_SECRET ? { "x-internal-secret": process.env.CRON_SECRET } : {}),
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      return NextResponse.json(
        {
          success: false,
          error: error.error || "Sync failed",
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      )
    }

    const result = await response.json()

    return NextResponse.json({
      success: true,
      message: "Karbon sync completed",
      ...result,
    })
  } catch (error) {
    console.error("[v0] Cron sync error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
