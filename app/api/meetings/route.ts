import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/**
 * GET /api/meetings — list Hub Meetings from the enriched view.
 *
 * Each row is one Hub Meeting ID carrying its links to Prospect/Intake (via
 * shared contact_id), Calendly, Zoom, Debrief, and ALFRED summary. Supports
 * lightweight filtering + pagination for the dashboard.
 *
 * Query params:
 *   q            free-text match on title / client name
 *   status       scheduled | completed | cancelled
 *   has          comma list of required links: calendly,zoom,debrief,summary,transcript,recording
 *   limit/offset pagination (default 50 / 0)
 */
export async function GET(req: NextRequest) {
  // Middleware already gates the route; confirm a session is present so we
  // never serve the enriched view (which carries PII) to an anon request.
  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams
  const limit = Math.min(Number(sp.get("limit")) || 50, 200)
  const offset = Number(sp.get("offset")) || 0
  const q = sp.get("q")?.trim()
  const status = sp.get("status")?.trim()
  const has = (sp.get("has") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  let query = admin
    .from("hub_meetings_enriched")
    .select("*", { count: "exact" })
    .order("scheduled_start", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq("status", status)
  if (q) query = query.or(`title.ilike.%${q}%,client_name.ilike.%${q}%`)

  // Presence filters map to the view's boolean flags (has_*) or NOT-NULL
  // checks on the summary note. Column names mirror hub_meetings_enriched.
  const boolFlag: Record<string, string> = {
    calendly: "has_calendly",
    zoom: "has_zoom",
    debrief: "has_debrief",
    prospect: "has_prospect",
    transcript: "has_transcript",
    recording: "has_recording",
  }
  for (const h of has) {
    if (h === "summary") {
      query = query.not("summary_note_id", "is", null)
      continue
    }
    const col = boolFlag[h]
    if (col) query = query.eq(col, true)
  }

  const { data, error, count } = await query
  if (error) {
    console.error("[v0] [meetings] list failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ meetings: data ?? [], total: count ?? 0, limit, offset })
}
