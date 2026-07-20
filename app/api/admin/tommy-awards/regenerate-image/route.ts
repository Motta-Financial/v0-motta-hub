import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

/**
 * Admin proxy for triggering a podium image regeneration from the UI.
 *
 * The underlying regenerate-image endpoint requires a CRON_SECRET Bearer
 * token which cannot be safely exposed to the browser. This server-side
 * route verifies the caller has a valid session, then forwards the request
 * internally with the CRON_SECRET attached — keeping the secret server-only.
 *
 * Usage: POST /api/admin/tommy-awards/regenerate-image?week_id=<uuid>
 */
export async function POST(request: NextRequest) {
  // Use createClient (reads session cookies) + getAuthenticatedUser — same
  // pattern as the rest of the codebase (profile route, ballot route, etc.)
  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(supabase)

  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const weekId = url.searchParams.get("week_id")
  if (!weekId) {
    return NextResponse.json({ error: "week_id is required" }, { status: 400 })
  }

  // Build internal URL — same origin, real regenerate route.
  const internalUrl = new URL(
    `/api/tommy-awards/recap/regenerate-image?week_id=${weekId}`,
    url.origin,
  )

  const response = await fetch(internalUrl.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
    },
  })

  const json = await response.json()
  return NextResponse.json(json, { status: response.status })
}
