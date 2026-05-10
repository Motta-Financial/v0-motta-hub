import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/tasks/[id]
 * Fetch a single task by ID with joined entity data
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("tasks")
      .select(`
        *,
        contact:contact_id (id, full_name),
        organization:organization_id (id, name),
        intake:intake_submission_id (id, submitter_full_name, business_name),
        proposal:proposal_id (proposal_id, title, client_name),
        debrief:debrief_id (id, organization_name, debrief_date),
        assignee:assignee_id (id, full_name)
      `)
      .eq("id", id)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Task not found" }, { status: 404 })
      }
      throw error
    }

    // Transform joined data
    const task = {
      ...data,
      contact_name: data.contact?.full_name || null,
      organization_name: data.organization?.name || null,
      intake_name: data.intake?.submitter_full_name || data.intake?.business_name || null,
      proposal_name: data.proposal?.title || data.proposal?.client_name || null,
      debrief_name: data.debrief?.organization_name || null,
      debrief_date: data.debrief?.debrief_date || null,
      assignee_name: data.assignee?.full_name || null,
      contact: undefined,
      organization: undefined,
      intake: undefined,
      proposal: undefined,
      debrief: undefined,
      assignee: undefined,
    }

    return NextResponse.json({ task })
  } catch (error) {
    console.error("Error fetching task:", error)
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 })
  }
}

/**
 * PATCH /api/tasks/[id]
 * Update a task (including marking complete, changing priority, reordering)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    // Allow updating these fields
    const allowedFields = [
      "title",
      "description",
      "priority",
      "due_date",
      "start_date",
      "status",
      "is_completed",
      "completed_at",
      "completed_by_id",
      "assignee_id",
      "notes",
      "estimated_minutes",
      "actual_minutes",
      "sort_order",
      "contact_id",
      "organization_id",
      "intake_submission_id",
      "proposal_id",
      "debrief_id",
      "karbon_work_item_id",
      "work_item_id",
    ]

    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field]
      }
    }

    // If marking complete, set completed_at
    if (body.is_completed === true && !body.completed_at) {
      updateData.completed_at = new Date().toISOString()
    }
    // If uncompleting, clear completed_at
    if (body.is_completed === false) {
      updateData.completed_at = null
    }

    const { data, error } = await supabase.from("tasks").update(updateData).eq("id", id).select().single()

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Task not found" }, { status: 404 })
      }
      throw error
    }

    return NextResponse.json({ task: data })
  } catch (error) {
    console.error("Error updating task:", error)
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
  }
}

/**
 * DELETE /api/tasks/[id]
 * Delete a task
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { error } = await supabase.from("tasks").delete().eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting task:", error)
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 })
  }
}
