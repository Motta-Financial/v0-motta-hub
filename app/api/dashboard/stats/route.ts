import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const teamMemberId = searchParams.get("teamMemberId")

    const today = new Date().toISOString().split("T")[0]
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

    // Active clients
    const { count: activeClients } = await supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("status", "Active")

    // Open tasks (optionally filtered by team member)
    let tasksQuery = supabase.from("tasks").select("*", { count: "exact", head: true }).eq("is_completed", false)
    if (teamMemberId) {
      tasksQuery = tasksQuery.eq("assignee_id", teamMemberId)
    }
    const { count: openTasks } = await tasksQuery

    // Tasks due today
    let tasksTodayQuery = supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("is_completed", false)
      .eq("due_date", today)
    if (teamMemberId) {
      tasksTodayQuery = tasksTodayQuery.eq("assignee_id", teamMemberId)
    }
    const { count: tasksToday } = await tasksTodayQuery

    // Upcoming deadlines (work items due within a week)
    let deadlinesQuery = supabase
      .from("work_items")
      .select("*", { count: "exact", head: true })
      .gte("due_date", today)
      .lte("due_date", weekFromNow)
      .not("status", "eq", "Completed")
    if (teamMemberId) {
      deadlinesQuery = deadlinesQuery.or(`assignee_id.eq.${teamMemberId},client_manager_id.eq.${teamMemberId}`)
    }
    const { count: upcomingDeadlines } = await deadlinesQuery

    // Critical deadlines (due within 3 days)
    let criticalQuery = supabase
      .from("work_items")
      .select("*", { count: "exact", head: true })
      .gte("due_date", today)
      .lte("due_date", threeDaysFromNow)
      .not("status", "eq", "Completed")
    if (teamMemberId) {
      criticalQuery = criticalQuery.or(`assignee_id.eq.${teamMemberId},client_manager_id.eq.${teamMemberId}`)
    }
    const { count: criticalDeadlines } = await criticalQuery

    // Pending documents
    const { count: pendingDocuments } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("status", "Pending")

    let activityQuery = supabase
      .from("activity_log")
      .select(`
        *,
        team_member:team_members(full_name, avatar_url)
      `)
      .order("created_at", { ascending: false })
      .limit(5)

    if (teamMemberId) {
      activityQuery = activityQuery.eq("team_member_id", teamMemberId)
    }

    const { data: activityData } = await activityQuery

    return NextResponse.json({
      stats: {
        activeClients: activeClients || 0,
        openTasks: openTasks || 0,
        tasksToday: tasksToday || 0,
        upcomingDeadlines: upcomingDeadlines || 0,
        criticalDeadlines: criticalDeadlines || 0,
        pendingDocuments: pendingDocuments || 0,
      },
      activity: activityData || [],
    })
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    return NextResponse.json({
      stats: {
        activeClients: 0,
        openTasks: 0,
        tasksToday: 0,
        upcomingDeadlines: 0,
        criticalDeadlines: 0,
        pendingDocuments: 0,
      },
      activity: [],
    })
  }
}
