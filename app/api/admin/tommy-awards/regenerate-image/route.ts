import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Admin proxy for triggering a podium image regeneration from the UI.
 *
 * The underlying regenerate-image endpoint requires a CRON_SECRET Bearer
 * token which cannot be safely exposed to the browser. This server-side
 * route verifies the caller has a valid Supabase session, then forwards the
 * request internally with the CRON_SECRET attached — keeping the secret
 * server-only.
 *
 * Usage: POST /api/admin/tommy-awards/regenerate-image?week_id=<uuid>
 */
export async function POST(request: NextRequest) {
  // Verify caller has a valid session — same pattern as ballot route
  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()

  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const weekId = url.searchParams.get("week_id")
  if (!weekId) {
    return NextResponse.json({ error: "week_id is required" }, { status: 400 })
  }

  // Forward to the cron-protected regenerate route with the CRON_SECRET
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
