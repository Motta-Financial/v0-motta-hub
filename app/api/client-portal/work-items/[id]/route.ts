/**
 * GET /api/client-portal/work-items/[id]
 *
 * Returns a single work item for the current portal user's client.
 * Scoped by `client_key` so a client can never read another client's
 * task by guessing its uuid — the filter is part of the query, not a
 * post-fetch check.
 */

import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { mapStatus } from "@/lib/portal/map-status"
import { applyPortalEntityFilter } from "@/lib/portal/entity-filter"
import { NextResponse } from "next/server"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid work item id" }, { status: 400 })
  }

  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  const baseQuery = supabase
    .from("work_items")
    .select(`
      id,
      title,
      work_type_name,
      status,
      assignee_name,
      due_date,
      start_date,
      completed_todo_count,
      todo_count,
      has_blocking_todos,
      created_at
    `)
    .eq("id", id)

  const { data: workItem, error } = await applyPortalEntityFilter(
    baseQuery,
    portalUser,
  ).maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!workItem) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({
    workItem: {
      ...workItem,
      statusDisplay: mapStatus(workItem.status),
      progressPct:
        workItem.todo_count > 0
          ? Math.round((workItem.completed_todo_count / workItem.todo_count) * 100)
          : 0,
    },
  })
}
