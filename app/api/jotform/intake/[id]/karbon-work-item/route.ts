import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { runIntakeWorkItemFlow } from "@/lib/karbon/intake-work-item-flow"

/**
 * POST /api/jotform/intake/[id]/karbon-work-item
 *
 * Creates a Karbon Individual (1040) WorkItem for the prospect on the
 * given intake submission. Replaces the legacy Zapier flow that fired
 * on every new intake.
 *
 * Behavior:
 *   1. Loads the intake row + the linked Karbon contact key.
 *   2. Resolves the assignee's email from `team_members.email` so the
 *      Karbon API knows who owns the new work item.
 *   3. Builds the title using the firm's naming convention
 *      "TAX | Individual (1040) | Last, First | <fiscalYear>".
 *   4. POSTs to Karbon, persists the returned WorkItemKey on the
 *      intake row so subsequent clicks are no-ops, and posts a
 *      cross-link note onto the contact's timeline.
 *
 * Idempotency: if `karbon_work_item_key` is already set on the row
 * the route returns the existing work item record without calling
 * Karbon again. The UI uses this to render a "View in Karbon" link.
 *
 * Request body (all optional):
 *   {
 *     "fiscalYear": "2026" | "LEAD" | "[NEW CLIENT]" | string,
 *     "startDate":  "2026-12-31T00:00:00Z"   // ISO; defaults to Dec 31 of current year
 *   }
 */

type RequestBody = {
  fiscalYear?: string
  startDate?: string
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id || !isUuid(id)) {
      return NextResponse.json({ error: "Invalid submission id" }, { status: 400 })
    }

    const body: RequestBody = await req.json().catch(() => ({}))
    const supabase = createAdminClient()

    // The resolution + create + note sequence is shared with the
    // auto-trigger that fires when a teammate qualifies a lead
    // (app/api/jotform/intake/[id]/route.ts). It reports precondition
    // problems as `skipped` rather than throwing, because the
    // auto-trigger treats those as "not yet, and that's fine". Here a
    // human IS waiting, so we map each code onto an actionable 422.
    const outcome = await runIntakeWorkItemFlow(supabase, id, {
      fiscalYear: body.fiscalYear,
      startDate: body.startDate,
    })

    switch (outcome.status) {
      case "exists":
        return NextResponse.json({ ok: true, alreadyExists: true, workItem: outcome.workItem })
      case "created":
        return NextResponse.json({ ok: true, alreadyExists: false, workItem: outcome.workItem })
      case "skipped":
        return NextResponse.json(
          { error: outcome.message, code: outcome.code },
          { status: outcome.code === "not_found" ? 404 : 422 },
        )
      case "failed":
        return NextResponse.json(
          { error: outcome.message, previewTitle: outcome.previewTitle },
          { status: 502 },
        )
    }
  } catch (err: any) {
    console.error("[v0] POST /api/jotform/intake/[id]/karbon-work-item error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 },
    )
  }
}
