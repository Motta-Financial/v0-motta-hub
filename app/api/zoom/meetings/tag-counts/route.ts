import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Bulk tag-count lookup keyed on the Zoom meeting UUID (one session) or,
 * for a number that has only ever held one session, its bigint id.
 *
 * The dashboard renders 50+ meeting cards at a time; pinging
 * /api/zoom/meetings/[id]/tags once per card would be 50 round trips.
 * Instead we accept a comma-separated list of Zoom meeting ids and return
 * a single object keyed by that id.
 *
 *   GET /api/zoom/meetings/tag-counts?ids=<uuid>,12345   (URL-encoded)
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

  // Resolve each requested key to ONE zoom_meetings row (one session).
  //   • A Zoom meeting UUID → that session's row.
  //   • A bigint meeting id → its row, but only when the number has exactly
  //     one: a Personal Meeting Room / recurring meeting reuses its number
  //     for every session (one row each since migration 433), and summing
  //     their tags would show one session's client on all of them.
  const numericKeys = ids.filter((k) => /^\d+$/.test(k))
  const uuidKeys = ids.filter((k) => !/^\d+$/.test(k))

  const internalIdToZoomId = new Map<string, string>()
  const parentErrors: string[] = []
  for (let i = 0; i < uuidKeys.length; i += 100) {
    const { data, error } = await supabase
      .from("zoom_meetings")
      .select("id, zoom_uuid")
      .in("zoom_uuid", uuidKeys.slice(i, i + 100))
    if (error) parentErrors.push(error.message)
    for (const p of data || []) internalIdToZoomId.set(p.id as string, p.zoom_uuid as string)
  }
  for (let i = 0; i < numericKeys.length; i += 200) {
    const { data, error } = await supabase
      .from("zoom_meetings")
      .select("id, zoom_meeting_id")
      .in("zoom_meeting_id", numericKeys.slice(i, i + 200))
    if (error) parentErrors.push(error.message)
    const byNumber = new Map<string, string[]>()
    for (const p of data || []) {
      const k = String(p.zoom_meeting_id)
      byNumber.set(k, [...(byNumber.get(k) ?? []), p.id as string])
    }
    for (const [k, rowIds] of byNumber) if (rowIds.length === 1) internalIdToZoomId.set(rowIds[0], k)
  }
  if (parentErrors.length > 0) {
    console.error("[v0] [Zoom Tag Counts] parent lookup failed:", parentErrors[0])
    return NextResponse.json({ counts: {} }, { status: 500 })
  }

  const internalIds = Array.from(internalIdToZoomId.keys())

  if (internalIds.length === 0) return NextResponse.json({ counts: {} })

  // Two parallel IN-list counts. We project just the FK column so the
  // rows are tiny — the count is done in JS to avoid running two
  // GROUP BY queries (Supabase JS client doesn't expose `.group()`).
  const [clientRows, workItemRows, dealTagRows, projectTagRows, dealRows] = await Promise.all([
    supabase.from("zoom_meeting_clients").select("zoom_meeting_id").in("zoom_meeting_id", internalIds),
    supabase
      .from("zoom_meeting_work_items")
      .select("zoom_meeting_id")
      .in("zoom_meeting_id", internalIds),
    // Explicit deal/project tags (migration 339).
    supabase
      .from("zoom_meeting_deals")
      .select("zoom_meeting_id, deal_id")
      .in("zoom_meeting_id", internalIds),
    supabase
      .from("zoom_meeting_projects")
      .select("zoom_meeting_id")
      .in("zoom_meeting_id", internalIds),
    // Hub meeting rows also carry a deal_id (from the Calendly/intake
    // bridge). `meetings.zoom_meeting_id` is a text column holding the
    // zoom_meetings internal uuid, so we match on the same internalIds set.
    // We keep this as a fallback so the deep-link icon still works even when
    // no explicit zoom_meeting_deals tag exists yet.
    supabase.from("meetings").select("zoom_meeting_id, deal_id").in("zoom_meeting_id", internalIds),
  ])

  const counts: Record<
    string,
    { clients: number; workItems: number; deals: number; projects: number; dealId: string | null }
  > = {}
  for (const id of ids) counts[id] = { clients: 0, workItems: 0, deals: 0, projects: 0, dealId: null }

  for (const row of clientRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    if (zoomId) counts[zoomId].clients += 1
  }
  for (const row of workItemRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    if (zoomId) counts[zoomId].workItems += 1
  }
  for (const row of dealTagRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    if (zoomId) {
      counts[zoomId].deals += 1
      // Prefer an explicitly-tagged deal for the deep-link icon.
      if (row.deal_id) counts[zoomId].dealId = row.deal_id as string
    }
  }
  for (const row of projectTagRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    if (zoomId) counts[zoomId].projects += 1
  }
  for (const row of dealRows.data || []) {
    const zoomId = internalIdToZoomId.get(row.zoom_meeting_id as string)
    // Only use the Hub-meeting deal as a fallback when no explicit tag set it.
    if (zoomId && row.deal_id && !counts[zoomId].dealId) counts[zoomId].dealId = row.deal_id as string
  }

  return NextResponse.json({ counts })
}
