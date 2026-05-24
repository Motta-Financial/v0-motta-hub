import { NextRequest, NextResponse } from "next/server"
import { searchClientProfiles } from "@/lib/clients/profile"

/**
 * GET /api/clients/search?q=...
 *
 * ALFRED-friendly fuzzy search across the Client Profile summaries.
 * Returns id + identity + a couple of headline numbers per match.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const q = url.searchParams.get("q") || ""
  const limit = Number(url.searchParams.get("limit")) || 10

  if (!q.trim()) return NextResponse.json({ results: [] })

  try {
    const results = await searchClientProfiles(q, { limit })
    return NextResponse.json({ results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] /api/clients/search error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
