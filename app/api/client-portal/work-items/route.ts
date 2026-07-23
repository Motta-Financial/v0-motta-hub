import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

/**
 * Maps Karbon internal work statuses to plain-English client-facing labels.
 * Clients should never see the raw Karbon codes.
 */
function mapStatus(karbonStatus: string | null): {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
  color: string
} {
  const s = (karbonStatus ?? "").toLowerCase()
  if (s.includes("complete") || s.includes("filed") || s.includes("finished")) {
    return { label: "Complete", variant: "default", color: "#16a34a" }
  }
  if (s.includes("review") || s.includes("partner")) {
    return { label: "Under Review", variant: "secondary", color: "#7c3aed" }
  }
  if (s.includes("waiting") || s.includes("info") || s.includes("client") || s.includes("block")) {
    return { label: "Waiting on You", variant: "destructive", color: "#d97706" }
  }
  if (s.includes("progress") || s.includes("started") || s.includes("work")) {
    return { label: "In Progress", variant: "default", color: "#2563eb" }
  }
  if (s.includes("not started") || s.includes("scheduled")) {
    return { label: "Scheduled", variant: "outline", color: "#6b7280" }
  }
  return { label: "In Progress", variant: "default", color: "#2563eb" }
}

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
