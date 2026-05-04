import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/dashboard/details?kind=...&teamMemberId=...
 *
 * Returns up to 10 records that back the dashboard stat cards on the Home
 * tab. Each `kind` returns a list shaped for the drill-in UI in
 * `dashboard-home.tsx`:
 *   - active-clients   → contacts with status='Active'
 *   - open-tasks       → tasks where is_completed=false
 *   - upcoming-deadlines → work_items due in the next 7 days
 *   - pending-documents → documents with status='Pending'
 */
export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get("kind")
    const teamMemberId = searchParams.get("teamMemberId")

    const today = new Date().toISOString().split("T")[0]
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

    if (kind === "active-clients") {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, full_name, email, company, updated_at")
        .eq("status", "Active")
        .order("updated_at", { ascending: false })
        .limit(10)

      if (error) throw error

      return NextResponse.json({
        items: (data ?? []).map((c) => ({
          id: c.id,
          title: c.full_name || c.company || "Unnamed contact",
          subtitle: c.company || c.email || null,
          meta: c.updated_at ? new Date(c.updated_at).toLocaleDateString() : null,
          href: `/clients/${c.id}`,
        })),
      })
    }

    if (kind === "open-tasks") {
      let q = supabase
        .from("tasks")
        .select("id, title, due_date, priority, work_item:work_items(title)")
        .eq("is_completed", false)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(10)
      if (teamMemberId) q = q.eq("assignee_id", teamMemberId)
      const { data, error } = await q
      if (error) throw error

      return NextResponse.json({
        items: (data ?? []).map((t: any) => ({
          id: t.id,
          title: t.title || "Untitled task",
          subtitle: t.work_item?.title || null,
          meta: t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString()}` : null,
          href: `/work-items`,
        })),
      })
    }

    if (kind === "upcoming-deadlines") {
      let q = supabase
        .from("work_items")
        .select("id, title, due_date, status, contact:contacts(full_name), organization:organizations(name)")
        .gte("due_date", today)
        .lte("due_date", weekFromNow)
        .not("status", "eq", "Completed")
        .order("due_date", { ascending: true })
        .limit(10)
      if (teamMemberId) q = q.or(`assignee_id.eq.${teamMemberId},client_manager_id.eq.${teamMemberId}`)
      const { data, error } = await q
      if (error) throw error

      return NextResponse.json({
        items: (data ?? []).map((w: any) => ({
          id: w.id,
          title: w.title || "Untitled work item",
          subtitle: w.organization?.name || w.contact?.full_name || null,
          meta: w.due_date ? `Due ${new Date(w.due_date).toLocaleDateString()}` : null,
          href: `/work-items/${w.id}`,
        })),
      })
    }

    if (kind === "pending-documents") {
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, document_type, created_at, contact:contacts(full_name), organization:organizations(name)")
        .eq("status", "Pending")
        .order("created_at", { ascending: false })
        .limit(10)
      if (error) throw error

      return NextResponse.json({
        items: (data ?? []).map((d: any) => ({
          id: d.id,
          title: d.name || "Untitled document",
          subtitle: d.organization?.name || d.contact?.full_name || d.document_type || null,
          meta: d.created_at ? new Date(d.created_at).toLocaleDateString() : null,
          href: `/clients`,
        })),
      })
    }

    return NextResponse.json({ error: "Unknown kind" }, { status: 400 })
  } catch (error) {
    console.error("Error fetching dashboard details:", error)
    return NextResponse.json({ error: "Failed to fetch details" }, { status: 500 })
  }
}
