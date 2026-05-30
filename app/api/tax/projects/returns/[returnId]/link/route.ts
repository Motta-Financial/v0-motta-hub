import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * PATCH /api/tax/projects/returns/[returnId]/link
 *
 * Manually link or unlink a work item and/or proposal service for a single
 * tax return. Manual links always win and are never overwritten by auto.
 *
 * Body: {
 *   workItemId?: string | null,      // link to this work item (null = unlink)
 *   proposalServiceId?: string | null // link to this proposal service (null = unlink)
 * }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ returnId: string }> }) {
  try {
    const { returnId } = await params
    const body = await req.json()
    const { workItemId, proposalServiceId } = body as {
      workItemId?: string | null
      proposalServiceId?: string | null
    }

    const supabase = createAdminClient()

    // Fetch current link to determine what's changing
    const { data: link, error: fetchErr } = await supabase
      .from("tax_return_links")
      .select("id, work_item_id, proposal_service_id, work_item_link_source, proposal_link_source")
      .eq("id", returnId)
      .maybeSingle()

    if (fetchErr) throw new Error(fetchErr.message)
    if (!link) return NextResponse.json({ error: "Return link not found" }, { status: 404 })

    const update: Record<string, unknown> = {}

    // Work item change
    if (workItemId !== undefined) {
      if (workItemId === null) {
        // Unlink
        update.work_item_id = null
        update.karbon_work_item_key = null
        update.work_item_link_source = "none"
        update.work_item_confidence = null
      } else {
        // Link (manual always wins)
        // Fetch karbon_work_item_key from work_items
        const { data: wi } = await supabase
          .from("work_items")
          .select("karbon_work_item_key")
          .eq("id", workItemId)
          .maybeSingle()

        update.work_item_id = workItemId
        update.karbon_work_item_key = wi?.karbon_work_item_key ?? null
        update.work_item_link_source = "manual"
        update.work_item_confidence = 1.0
      }
    }

    // Proposal service change
    if (proposalServiceId !== undefined) {
      if (proposalServiceId === null) {
        // Unlink
        update.proposal_service_id = null
        update.ignition_proposal_id = null
        update.proposal_link_source = "none"
      } else {
        // Link (manual always wins)
        const { data: ps } = await supabase
          .from("ignition_proposal_services")
          .select("proposal_id")
          .eq("id", proposalServiceId)
          .maybeSingle()

        update.proposal_service_id = proposalServiceId
        update.ignition_proposal_id = ps?.proposal_id ?? null
        update.proposal_link_source = "manual"
      }
    }

    // Recompute status based on final state
    const finalWorkItem = workItemId !== undefined ? workItemId : link.work_item_id
    if (finalWorkItem) {
      update.status = "linked"
    } else {
      // No work item — fall back to prior status or no_match
      update.status = "no_match"
    }

    if (Object.keys(update).length > 0) {
      const { error: upErr } = await supabase
        .from("tax_return_links")
        .update(update)
        .eq("id", returnId)

      if (upErr) throw new Error(upErr.message)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[tax/projects/returns/[returnId]/link] PATCH error:", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
