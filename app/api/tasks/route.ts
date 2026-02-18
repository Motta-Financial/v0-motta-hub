import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const assigneeId = searchParams.get("assignee_id")
    const workItemId = searchParams.get("work_item_id")
    const status = searchParams.get("status")
    const limit = Number.parseInt(searchParams.get("limit") || "50")

    let query = supabase.from("tasks").select("*").order("due_date", { ascending: true }).limit(limit)

    if (assigneeId) {
      query = query.eq("assignee_id", assigneeId)
    }
    if (workItemId) {
      query = query.eq("work_item_id", workItemId)
    }
    if (status) {
      query = query.eq("status", status)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ tasks: data || [] })
  } catch (error) {
    console.error("Error fetching tasks:", error)
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    const taskData = {
      title: body.title,
      description: body.description || null,
      assignee_id: body.assignee_id || null,
      work_item_id: body.work_item_id || null,
      due_date: body.due_date || null,
      start_date: body.start_date || null,
      priority: body.priority || "medium",
      status: body.status || "pending",
      notes: body.notes || null,
      estimated_minutes: body.estimated_minutes || null,
      is_completed: false,
    }

    const { data, error } = await supabase.from("tasks").insert(taskData).select()

    if (error) throw error

    return NextResponse.json({ task: data[0] })
  } catch (error) {
    console.error("Error creating task:", error)
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 })
  }
}
