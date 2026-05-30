import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Bulk tag-count lookup keyed on Zoom's bigint meeting id.
 *
 * The dashboard renders 50+ meeting cards at a time; pinging
 * /api/zoom/meetings/[id]/tags once per card would be 50 round trips.
 * Instead we accept a comma-separated list of Zoom meeting ids and return
 * a single object keyed by that id.
 *
 *   GET /api/zoom/meetings/tag-counts?ids=12345,67890
 *   →   { counts: { "12345": { clients: 2, workItems: 1, dealId: "uuid" }, ... } }
 *
 * `dealId` (migration 337) is the opportunity the Zoom meeting rolls up
 * into. It's resolved through the Hub meeting row
 * (`meetings.zoom_meeting_id` → `meetings.deal_id`) so the dashboard can
 * deep-link each recording straight to its Deal.
 *
 * Only meetings that have been synced to `zoom_meetings` will appear in
 * the response. The dashboard treats absence as "no tags" so we don't
 * need to backfill the parent rows here.
 */
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") || ""
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (ids.length === 0) return NextResponse.json({ counts: {} })

  const supabase = createAdminClient()

  // First, resolve the Zoom bigint ids → internal UUIDs via a single
  // IN-list lookup. Bigints are passed as strings; pg coerces.
  const { data: parents, error: parentErr } = await supabase
    .from("zoom_meetings")
    .select("id, zoom_meeting_id")
    .in("zoom_meeting_id", ids)
  // The internal-uuid string of the zoom_meetings parent rows, used to
  // resolve the Deal each meeting rolls up into.
  if (parentErr) {
    console.error("[v0] [Zoom Tag Counts] parent lookup failed:", parentErr.message)
    return NextResponse.json({ counts: {} }, { status: 500 })
  }

  const internalIdToZoomId = new Map<string, string>(
    (parents || []).map((p) => [p.id as string, String(p.zoom_meeting_id)]),
  )
  const internalIds = Array.from(internalIdToZoomId.keys())

  if (internalIds.length === 0) return NextResponse.json({ counts: {} })

  // Two parallel IN-list counts. We project just the FK column so the
  // rows are tiny — the count is done in JS to avoid running two
  // GROUP BY queries (Supabase JS client doesn't expose `.group()`).
  const [clientRows, workItemRows, dealRows] = await Promise.all([
    supabase.from("zoom_meeting_clients").select("zoom_meeting_id").in("zoom_meeting_id", internalIds),
    supabase
      .from("zoom_meeting_work_items")
      .select("zoom_meeting_id")
      .in("zoom_meeting_id", internalIds),
    // Hub meeting rows carry the deal_id. `meetings.zoom_meeting_id` is a
    // text column holding the zoom_meetings internal uuid, so we match on
    // the same internalIds set.
    supabase.from("meetings").select("zoom_meeting_id, deal_id").in("zoom_meeting_id", internalIds),
  ])

  const counts: Record<string, { clients: number; workItems: number; dealId: string | null }> = {}
  for (const id of ids) counts[id] = { clients: 0, workItems: 0, dealId: null }

  for (const row of clientRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    if (zoomId) counts[zoomId].clients += 1
  }
  for (const row of workItemRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    if (zoomId) counts[zoomId].workItems += 1
  }
  for (const row of dealRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    if (zoomId && row.deal_id) counts[zoomId].dealId = row.deal_id as string
  }

  return NextResponse.json({ counts })
}
