import { type NextRequest, NextResponse } from "next/server"
import { buildCorsHeaders, handleCorsPreflight } from "@/lib/cors"

/**
 * GET /api/public/health
 *
 * Lightweight health probe used by the marketing site (and any
 * external uptime monitor) to confirm the cross-project bridge is
 * reachable. Intentionally does NOT require the shared secret —
 * a 200 here only proves the route is up.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req)
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const cors = buildCorsHeaders(origin)
  return NextResponse.json(
    {
      ok: true,
      service: "alfred-hub",
      role: "public-bridge",
      time: new Date().toISOString(),
    },
    { status: 200, headers: cors },
  )
}
