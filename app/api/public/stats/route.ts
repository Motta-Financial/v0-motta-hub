import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildCorsHeaders,
  handleCorsPreflight,
  isTrustedPublicRequest,
} from "@/lib/cors"

/**
 * GET /api/public/stats
 *
 * Live "trust signal" numbers for the marketing site hero strip.
 * Pulls from marketing.firm_stats_public_rpc() which is a
 * SECURITY DEFINER function with no PII.
 *
 * Cached at the edge for 5 minutes — these numbers don't need to be
 * minute-fresh and we don't want a viral blog post to hammer the DB.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req)
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const cors = buildCorsHeaders(origin)

  if (!isTrustedPublicRequest(req)) {
    return NextResponse.json(
      { error: "untrusted_request" },
      { status: 403, headers: cors },
    )
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .schema("marketing")
    .rpc("firm_stats_public_rpc")
    .single()
  if (error) {
    console.error("[v0] [public/stats] rpc failed:", error)
    return NextResponse.json(
      { error: "stats_failed" },
      { status: 500, headers: cors },
    )
  }
  return NextResponse.json(data, {
    status: 200,
    headers: {
      ...cors,
      // 5 min CDN cache, 1 min browser cache, stale-while-revalidate
      // for 1 hour so a brief DB hiccup doesn't blank the hero.
      "Cache-Control": "public, s-maxage=300, max-age=60, stale-while-revalidate=3600",
    },
  })
}
