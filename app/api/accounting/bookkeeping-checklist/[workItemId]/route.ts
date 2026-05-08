import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// GET /api/accounting/bookkeeping-checklist/:workItemId
// Returns the saved per-step progress rows for a work item.
// Missing rows mean "not yet touched" — the UI fills in defaults client-side.
export async function GET(
  _request: Request,
  context: { params: Promise<{ workItemId: string }> },
) {
  const { workItemId } = await context.params
  if (!workItemId) {
    return NextResponse.json({ error: "Missing workItemId" }, { status: 400 })
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("bookkeeping_checklist_progress")
      .select(
        "id, step_number, is_complete, completed_at, completed_by_id, completed_by_name, notes, updated_at",
      )
      .eq("work_item_id", workItemId)
      .order("step_number", { ascending: true })

    if (error) {
      console.error("[v0] Checklist GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ progress: data ?? [] })
  } catch (err) {
    console.error("[v0] Checklist GET unexpected error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load checklist" },
      { status: 500 },
    )
  }
}

// PUT /api/accounting/bookkeeping-checklist/:workItemId
// Body: { step_number: 1-10, is_complete?, notes?, completed_by_name? }
// Upserts a single step. The `unique (work_item_id, step_number)` constraint
// makes this idempotent — toggling the same step rewrites the same row.
export async function PUT(
  request: Request,
  context: { params: Promise<{ workItemId: string }> },
) {
  const { workItemId } = await context.params
  if (!workItemId) {
    return NextResponse.json({ error: "Missing workItemId" }, { status: 400 })
  }

  let body: {
    step_number?: number
    is_complete?: boolean
    notes?: string | null
    completed_by_name?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const stepNumber = Number(body.step_number)
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 10) {
    return NextResponse.json(
      { error: "step_number must be an integer between 1 and 10" },
      { status: 400 },
    )
  }

  const isComplete = body.is_complete === true
  const completedByName = body.completed_by_name?.trim() || null

  try {
    const supabase = createAdminClient()

    const payload = {
      work_item_id: workItemId,
      step_number: stepNumber,
      is_complete: isComplete,
      notes: body.notes ?? null,
      completed_at: isComplete ? new Date().toISOString() : null,
      completed_by_name: isComplete ? completedByName : null,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from("bookkeeping_checklist_progress")
      .upsert(payload, { onConflict: "work_item_id,step_number" })
      .select()
      .single()

    if (error) {
      console.error("[v0] Checklist PUT error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ progress: data })
  } catch (err) {
    console.error("[v0] Checklist PUT unexpected error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save checklist" },
      { status: 500 },
    )
  }
}
