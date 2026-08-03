/**
 * POST   /api/deals/[id]/work-items   — tag a Karbon work item to the deal.
 * DELETE /api/deals/[id]/work-items   — untag (body or ?workItemId=).
 *
 * The debrief is performed on the DEAL against these tagged work items
 * (replacing the old flow of debriefing directly on a single Karbon
 * work item). `link_source='manual'` marks a teammate-driven tag.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: dealId } = await params
  const supabase = createAdminClient()
  const body = (await request.json().catch(() => ({}))) as {
    work_item_id?: string
    created_by_team_member_id?: string | null
  }

  if (!body.work_item_id) {
    return NextResponse.json({ error: "work_item_id is required" }, { status: 400 })
  }

  const { error } = await supabase.from("deal_work_items").upsert(
    {
      deal_id: dealId,
      work_item_id: body.work_item_id,
      link_source: "manual",
      created_by_team_member_id: body.created_by_team_member_id ?? null,
    },
    { onConflict: "deal_id,work_item_id", ignoreDuplicates: true },
  )

  if (error) {
    console.error("[v0] POST /api/deals/[id]/work-items error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: dealId } = await params
  const supabase = createAdminClient()
  const workItemId =
    request.nextUrl.searchParams.get("workItemId") ||
    ((await request.json().catch(() => ({}))) as { work_item_id?: string }).work_item_id

  if (!workItemId) {
    return NextResponse.json({ error: "workItemId is required" }, { status: 400 })
  }

  const { error } = await supabase
    .from("deal_work_items")
    .delete()
    .eq("deal_id", dealId)
    .eq("work_item_id", workItemId)

  if (error) {
    console.error("[v0] DELETE /api/deals/[id]/work-items error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
