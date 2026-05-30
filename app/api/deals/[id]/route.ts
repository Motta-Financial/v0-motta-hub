/**
 * GET   /api/deals/[id] — full deal detail for the /deals/[id] page:
 *   deal (enriched) + meetings timeline (with recording/transcript/
 *   debrief state) + debriefs + tagged work items.
 * PATCH /api/deals/[id] — update stage / status / owner / notes /
 *   estimated_value. Closing a deal stamps closed_at.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: deal, error } = await supabase
    .from("deals_enriched")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("[v0] GET /api/deals/[id] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  }

  // Meetings under this deal. Pull ids first, then fetch the enriched
  // read model (recording / transcript / summary / debrief flags) for
  // exactly those meetings.
  const { data: meetingRows } = await supabase
    .from("meetings")
    .select("id")
    .eq("deal_id", id)
  const meetingIds = (meetingRows ?? []).map((m) => m.id)

  let meetings: unknown[] = []
  if (meetingIds.length > 0) {
    const { data: enriched } = await supabase
      .from("hub_meetings_enriched")
      .select("*")
      .in("meeting_id", meetingIds)
      .order("scheduled_start", { ascending: false })
    meetings = enriched ?? []
  }

  // Debriefs on the deal. We read the BASE `debriefs` table (the
  // pre-existing `debriefs_with_member` view predates the deal_id column
  // and doesn't expose it), then resolve author names in one extra query.
  const { data: debriefRows } = await supabase
    .from("debriefs")
    .select(
      "id, debrief_date, debrief_type, notes, action_items, follow_up_date, status, created_at, team_member_id, meeting_id, work_item_id",
    )
    .eq("deal_id", id)
    .order("created_at", { ascending: false })

  let debriefs: unknown[] = debriefRows ?? []
  const memberIds = Array.from(
    new Set((debriefRows ?? []).map((d) => d.team_member_id).filter(Boolean)),
  ) as string[]
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, full_name")
      .in("id", memberIds)
    const nameById = new Map((members ?? []).map((m) => [m.id, m.full_name]))
    debriefs = (debriefRows ?? []).map((d) => ({
      ...d,
      team_member_full_name: d.team_member_id ? nameById.get(d.team_member_id) ?? null : null,
    }))
  }

  // Tagged work items (join through deal_work_items to work_items_enriched).
  const { data: tagged } = await supabase
    .from("deal_work_items")
    .select("id, work_item_id, link_source, created_at")
    .eq("deal_id", id)

  let workItems: unknown[] = []
  const workItemIds = (tagged ?? []).map((t) => t.work_item_id)
  if (workItemIds.length > 0) {
    const { data: wi } = await supabase
      .from("work_items_enriched")
      .select(
        "id, title, work_type, status, primary_status, due_date, assignee_full_name, karbon_url, client_name, estimated_fee",
      )
      .in("id", workItemIds)
    // Merge link_source from the join table onto each work item.
    const sourceById = new Map((tagged ?? []).map((t) => [t.work_item_id, t.link_source]))
    workItems = (wi ?? []).map((w) => ({
      ...w,
      link_source: sourceById.get((w as { id: string }).id) ?? "manual",
    }))
  }

  return NextResponse.json({ deal, meetings, debriefs: debriefs ?? [], workItems })
}

interface PatchDealBody {
  stage?: string
  status?: "open" | "closed"
  owner_team_member_id?: string | null
  notes?: string | null
  estimated_value?: number | null
}

const VALID_STAGES = new Set([
  "new",
  "meeting_scheduled",
  "met",
  "debriefed",
  "won",
  "lost",
])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = (await request.json().catch(() => ({}))) as PatchDealBody

  const patch: Record<string, unknown> = {}

  if (body.stage !== undefined) {
    if (!VALID_STAGES.has(body.stage)) {
      return NextResponse.json({ error: `Invalid stage: ${body.stage}` }, { status: 400 })
    }
    patch.stage = body.stage
    // Won/lost are terminal — closing the deal and stamping closed_at.
    if (body.stage === "won" || body.stage === "lost") {
      patch.status = "closed"
      patch.closed_at = new Date().toISOString()
    }
  }

  if (body.status !== undefined) {
    patch.status = body.status
    patch.closed_at = body.status === "closed" ? new Date().toISOString() : null
  }
  if (body.owner_team_member_id !== undefined) {
    patch.owner_team_member_id = body.owner_team_member_id
  }
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.estimated_value !== undefined) patch.estimated_value = body.estimated_value

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    console.error("[v0] PATCH /api/deals/[id] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

  return NextResponse.json({ ok: true })
}
