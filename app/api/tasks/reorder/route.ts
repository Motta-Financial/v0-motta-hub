import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * POST /api/tasks/reorder
 * Bulk update sort_order for multiple tasks after drag-and-drop
 * Body: { tasks: [{ id: string, sort_order: number }] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    if (!body.tasks || !Array.isArray(body.tasks)) {
      return NextResponse.json({ error: "tasks array is required" }, { status: 400 })
    }

    // Update each task's sort_order
    const updates = body.tasks.map((t: { id: string; sort_order: number }) =>
      supabase
        .from("tasks")
        .update({ sort_order: t.sort_order, updated_at: new Date().toISOString() })
        .eq("id", t.id)
    )

    await Promise.all(updates)

    return NextResponse.json({ success: true, updated: body.tasks.length })
  } catch (error) {
    console.error("Error reordering tasks:", error)
    return NextResponse.json({ error: "Failed to reorder tasks" }, { status: 500 })
  }
}
