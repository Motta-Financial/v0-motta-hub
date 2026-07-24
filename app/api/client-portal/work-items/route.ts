import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { mapStatus } from "@/lib/portal/map-status"
import { NextResponse } from "next/server"

/**
 * GET /api/client-portal/work-items
 * Returns open Karbon work items for the current portal user's client.
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  const { data: workItems, error } = await supabase
    .from("work_items")
    .select(`
      id,
      title,
      work_type_name,
      status,
      assignee_name,
      due_date,
      completed_todo_count,
      todo_count,
      has_blocking_todos,
      start_date,
      created_at
    `)
    .eq("client_key", portalUser.clientId)
    .not("status", "ilike", "%complete%")
    .not("status", "ilike", "%filed%")
    .order("due_date", { ascending: true, nullsFirst: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const items = (workItems ?? []).map((w) => ({
    ...w,
    statusDisplay: mapStatus(w.status),
    progressPct:
      w.todo_count > 0
        ? Math.round((w.completed_todo_count / w.todo_count) * 100)
        : 0,
  }))

  return NextResponse.json({ workItems: items })
}
