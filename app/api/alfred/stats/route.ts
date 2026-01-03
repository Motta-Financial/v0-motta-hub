import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = await createClient()

    // Fetch various statistics in parallel
    const [
      workItemsResult,
      activeWorkItemsResult,
      teamMembersResult,
      contactsResult,
      organizationsResult,
      debriefsResult,
      recentDebriefsResult,
      tasksResult,
      tommyLeadersResult,
      upcomingDeadlinesResult,
      invoicesResult,
    ] = await Promise.all([
      // Total work items
      supabase
        .from("work_items")
        .select("*", { count: "exact", head: true }),

      // Active work items (not completed/cancelled)
      supabase
        .from("work_items")
        .select("*", { count: "exact", head: true })
        .not("status", "in", '("Completed","Cancelled","On Hold")'),

      // Active team members
      supabase
        .from("team_members")
        .select("id, full_name, role, department")
        .eq("is_active", true),

      // Total contacts
      supabase
        .from("contacts")
        .select("*", { count: "exact", head: true }),

      // Total organizations
      supabase
        .from("organizations")
        .select("*", { count: "exact", head: true }),

      // Total debriefs
      supabase
        .from("debriefs")
        .select("*", { count: "exact", head: true }),

      // Recent debriefs
      supabase
        .from("debriefs")
        .select("id, debrief_date, debrief_type, team_member, organization_name, status")
        .order("debrief_date", { ascending: false })
        .limit(5),

      // Pending tasks
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("is_completed", false),

      // Tommy Award leaders
      supabase
        .from("tommy_award_yearly_totals")
        .select("team_member_name, total_points, current_rank")
        .eq("year", 2026)
        .order("total_points", { ascending: false })
        .limit(5),

      // Upcoming deadlines (next 7 days)
      supabase
        .from("work_items")
        .select("id, title, client_group_name, assignee_name, due_date")
        .gte("due_date", new Date().toISOString().split("T")[0])
        .lte("due_date", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
        .order("due_date", { ascending: true })
        .limit(10),

      // Unpaid invoices
      supabase
        .from("invoices")
        .select("*", { count: "exact", head: true })
        .in("status", ["sent", "overdue"]),
    ])

    // Calculate work items by assignee
    const workByAssigneeResult = await supabase
      .from("work_items")
      .select("assignee_name")
      .not("status", "in", '("Completed","Cancelled")')

    const workByAssignee: Record<string, number> = {}
    workByAssigneeResult.data?.forEach((item) => {
      const name = item.assignee_name || "Unassigned"
      workByAssignee[name] = (workByAssignee[name] || 0) + 1
    })

    // Calculate work items by status
    const workByStatusResult = await supabase.from("work_items").select("status")

    const workByStatus: Record<string, number> = {}
    workByStatusResult.data?.forEach((item) => {
      const status = item.status || "Unknown"
      workByStatus[status] = (workByStatus[status] || 0) + 1
    })

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),

      summary: {
        total_work_items: workItemsResult.count || 0,
        active_work_items: activeWorkItemsResult.count || 0,
        total_contacts: contactsResult.count || 0,
        total_organizations: organizationsResult.count || 0,
        total_debriefs: debriefsResult.count || 0,
        pending_tasks: tasksResult.count || 0,
        unpaid_invoices: invoicesResult.count || 0,
      },

      team: {
        active_members: teamMembersResult.data || [],
        member_count: teamMembersResult.data?.length || 0,
      },

      workload: {
        by_assignee: workByAssignee,
        by_status: workByStatus,
      },

      recent_activity: {
        recent_debriefs: recentDebriefsResult.data || [],
        upcoming_deadlines: upcomingDeadlinesResult.data || [],
      },

      tommy_awards: {
        current_leaders: tommyLeadersResult.data || [],
      },
    })
  } catch (error) {
    console.error("[ALFRED Stats API] Error:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch statistics" }, { status: 500 })
  }
}
