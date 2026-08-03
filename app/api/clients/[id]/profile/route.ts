import { NextRequest, NextResponse } from "next/server"
import { getClientProfile } from "@/lib/clients/profile"

/**
 * GET /api/clients/[id]/profile
 *
 * Returns the cached/freshly-computed Client Profile summary for a Hub
 * master client (contacts.id OR organizations.id). Mirrors the Tax Profile
 * pattern: cheap to call, auto-recomputes when stale.
 *
 * Query params:
 *   - recompute=1     force a recompute, ignoring the cache
 *   - maxAge=600      max-age in seconds before a cached row is considered stale (default 600)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(req.url)
  const recompute = url.searchParams.get("recompute") === "1"
  const maxAgeSeconds = Number(url.searchParams.get("maxAge")) || 600

  try {
    const profile = await getClientProfile(id, { recompute, maxAgeSeconds })
    if (!profile) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }
    return NextResponse.json({ profile })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] /api/clients/[id]/profile error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
