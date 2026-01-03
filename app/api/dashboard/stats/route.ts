import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET() {
  try {
    // Get counts from various tables
    const [
      { count: totalContacts },
      { count: totalOrganizations },
      { count: totalWorkItems },
      { count: activeWorkItems },
      { count: overdueWorkItems },
      { count: teamMembers },
      { count: meetingNotes },
    ] = await Promise.all([
      supabase.from("contacts").select("*", { count: "exact", head: true }),
      supabase.from("organizations").select("*", { count: "exact", head: true }),
      supabase.from("work_items").select("*", { count: "exact", head: true }),
      supabase.from("work_items").select("*", { count: "exact", head: true }).neq("workflow_status", "Completed"),
      supabase
        .from("work_items")
        .select("*", { count: "exact", head: true })
        .lt("due_date", new Date().toISOString().split("T")[0])
        .neq("workflow_status", "Completed"),
      supabase.from("team_members").select("*", { count: "exact", head: true }),
      supabase.from("meeting_notes").select("*", { count: "exact", head: true }),
    ])

    // Get work items by status
    const { data: statusCounts } = await supabase.from("work_items").select("workflow_status")

    const statusBreakdown: Record<string, number> = {}
    ;(statusCounts || []).forEach((item) => {
      const status = item.workflow_status || "Unknown"
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1
    })

    // Get recent activity
    const { data: recentWorkItems } = await supabase
      .from("work_items")
      .select("id, title, workflow_status, updated_at, karbon_url")
      .order("updated_at", { ascending: false })
      .limit(10)

    return NextResponse.json({
      stats: {
        totalClients: (totalContacts || 0) + (totalOrganizations || 0),
        totalContacts: totalContacts || 0,
        totalOrganizations: totalOrganizations || 0,
        totalWorkItems: totalWorkItems || 0,
        activeWorkItems: activeWorkItems || 0,
        overdueWorkItems: overdueWorkItems || 0,
        teamMembers: teamMembers || 0,
        meetingNotes: meetingNotes || 0,
      },
      statusBreakdown,
      recentActivity: recentWorkItems || [],
    })
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    return NextResponse.json({ error: "Failed to fetch dashboard stats" }, { status: 500 })
  }
}
