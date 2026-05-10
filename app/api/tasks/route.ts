import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/tasks
 * Fetch tasks with optional filters and joined entity data
 * Query params:
 *   - assignee_id: Filter by assignee
 *   - work_item_id: Filter by work item
 *   - status: Filter by status
 *   - include_completed: Include completed tasks (default: false)
 *   - limit: Max results (default: 100)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const searchParams = request.nextUrl.searchParams
    const assigneeId = searchParams.get("assignee_id")
    const workItemId = searchParams.get("work_item_id")
    const status = searchParams.get("status")
    const includeCompleted = searchParams.get("include_completed") === "true"
    const limit = Number.parseInt(searchParams.get("limit") || "100")

    let query = supabase
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
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit)

    if (assigneeId) {
      query = query.eq("assignee_id", assigneeId)
    }
    if (workItemId) {
      query = query.eq("work_item_id", workItemId)
    }
    if (status) {
      query = query.eq("status", status)
    }
    if (!includeCompleted) {
      query = query.eq("is_completed", false)
    }

    const { data, error } = await query

    if (error) throw error

    // Transform data for cleaner response with joined entity names
    const tasks = (data || []).map((t: any) => ({
      ...t,
      contact_name: t.contact?.full_name || null,
      organization_name: t.organization?.name || null,
      intake_name: t.intake?.submitter_full_name || t.intake?.business_name || null,
      proposal_name: t.proposal?.title || t.proposal?.client_name || null,
      debrief_name: t.debrief?.organization_name || null,
      debrief_date: t.debrief?.debrief_date || null,
      assignee_name: t.assignee?.full_name || null,
      // Clean up joined relations from response
      contact: undefined,
      organization: undefined,
      intake: undefined,
      proposal: undefined,
      debrief: undefined,
      assignee: undefined,
    }))

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error("Error fetching tasks:", error)
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 })
  }
}

/**
 * POST /api/tasks
 * Create a new task with optional entity linking
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    // Get max sort_order to add new task at the end
    const { data: maxOrder } = await supabase
      .from("tasks")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()

    const newSortOrder = (maxOrder?.sort_order || 0) + 1

    const taskData = {
      title: body.title,
      description: body.description || null,
      assignee_id: body.assignee_id || null,
      work_item_id: body.work_item_id || null,
      due_date: body.due_date || null,
      start_date: body.start_date || null,
      priority: body.priority || "medium",
      status: body.status || "open",
      notes: body.notes || null,
      estimated_minutes: body.estimated_minutes || null,
      is_completed: false,
      sort_order: newSortOrder,
      // Entity linking columns
      contact_id: body.contact_id || null,
      organization_id: body.organization_id || null,
      intake_submission_id: body.intake_submission_id || null,
      proposal_id: body.proposal_id || null,
      debrief_id: body.debrief_id || null,
      karbon_work_item_id: body.karbon_work_item_id || null,
    }

    const { data, error } = await supabase.from("tasks").insert(taskData).select().single()

    if (error) throw error

    return NextResponse.json({ task: data }, { status: 201 })
  } catch (error) {
    console.error("Error creating task:", error)
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 })
  }
}
