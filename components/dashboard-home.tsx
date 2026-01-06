"use client"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Users, CheckSquare, Clock, FileText, TrendingUp, Loader2 } from "lucide-react"
import { TriageSummary } from "@/components/triage-summary"
import { TeamsChat } from "@/components/teams-chat"
import { MessageBoard } from "@/components/message-board"
import { WorldClocks } from "@/components/world-clocks"
import { ClientServiceDebriefs } from "@/components/client-service-debriefs"
import { ExpandableCard } from "@/components/ui/expandable-card"
import { useUser, useDisplayName } from "@/contexts/user-context"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface DashboardStats {
  activeClients: number
  openTasks: number
  tasksToday: number
  upcomingDeadlines: number
  criticalDeadlines: number
  pendingDocuments: number
}

interface ActivityItem {
  type: string
  message: string
  time: string
  user: string
  avatar: string | null
}

export function DashboardHome() {
  const { teamMember, isLoading: userLoading } = useUser()
  const displayName = useDisplayName()

  const [stats, setStats] = useState<DashboardStats>({
    activeClients: 0,
    openTasks: 0,
    tasksToday: 0,
    upcomingDeadlines: 0,
    criticalDeadlines: 0,
    pendingDocuments: 0,
  })
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const supabase = createClient()
        const today = new Date().toISOString().split("T")[0]
        const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

        const teamMemberId = teamMember?.id

        // Fetch active clients (contacts with status = active)
        const { count: clientCount } = await supabase
          .from("contacts")
          .select("*", { count: "exact", head: true })
          .eq("status", "Active")

        // Fetch open tasks assigned to this team member
        let tasksQuery = supabase.from("tasks").select("*", { count: "exact", head: true }).eq("is_completed", false)

        if (teamMemberId) {
          tasksQuery = tasksQuery.eq("assignee_id", teamMemberId)
        }
        const { count: taskCount } = await tasksQuery

        // Fetch tasks due today for this team member
        let tasksTodayQuery = supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("is_completed", false)
          .eq("due_date", today)

        if (teamMemberId) {
          tasksTodayQuery = tasksTodayQuery.eq("assignee_id", teamMemberId)
        }
        const { count: tasksTodayCount } = await tasksTodayQuery

        // Fetch upcoming deadlines (work items) for this team member
        let deadlinesQuery = supabase
          .from("work_items")
          .select("*", { count: "exact", head: true })
          .gte("due_date", today)
          .lte("due_date", weekFromNow)
          .not("status", "eq", "Completed")

        if (teamMemberId) {
          deadlinesQuery = deadlinesQuery.or(`assignee_id.eq.${teamMemberId},client_manager_id.eq.${teamMemberId}`)
        }
        const { count: deadlineCount } = await deadlinesQuery

        // Fetch critical deadlines (due within 3 days)
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
        let criticalQuery = supabase
          .from("work_items")
          .select("*", { count: "exact", head: true })
          .gte("due_date", today)
          .lte("due_date", threeDaysFromNow)
          .not("status", "eq", "Completed")

        if (teamMemberId) {
          criticalQuery = criticalQuery.or(`assignee_id.eq.${teamMemberId},client_manager_id.eq.${teamMemberId}`)
        }
        const { count: criticalCount } = await criticalQuery

        // Fetch pending documents
        const { count: docCount } = await supabase
          .from("documents")
          .select("*", { count: "exact", head: true })
          .eq("status", "Pending")

        setStats({
          activeClients: clientCount || 0,
          openTasks: taskCount || 0,
          tasksToday: tasksTodayCount || 0,
          upcomingDeadlines: deadlineCount || 0,
          criticalDeadlines: criticalCount || 0,
          pendingDocuments: docCount || 0,
        })

        // Fetch recent activity for this team member
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

        if (activityData && activityData.length > 0) {
          setActivity(
            activityData.map((item) => ({
              type: item.action || "update",
              message: item.description || "Activity logged",
              time: formatTimeAgo(new Date(item.created_at)),
              user: item.team_member?.full_name || "Team Member",
              avatar: item.team_member?.avatar_url || null,
            })),
          )
        } else {
          // Show placeholder activity if none exists
          setActivity([
            {
              type: "system",
              message: "Welcome to Motta Hub! Your activity will appear here.",
              time: "Just now",
              user: displayName,
              avatar: teamMember?.avatar_url || null,
            },
          ])
        }
      } catch (error) {
        console.error("[v0] Error fetching dashboard data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    if (!userLoading) {
      fetchDashboardData()
    }
  }, [teamMember, userLoading, displayName])

  function formatTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
    if (seconds < 60) return "Just now"
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`
    const days = Math.floor(hours / 24)
    return `${days} day${days > 1 ? "s" : ""} ago`
  }

  if (userLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Client Service Debriefs section */}
      <ClientServiceDebriefs />

      <ExpandableCard
        title={`Welcome back, ${displayName}`}
        description={
          teamMember?.title
            ? `${teamMember.title} at Motta Financial`
            : "Here's what's happening with your clients today."
        }
        defaultExpanded={true}
        collapsible={false}
        className="bg-white shadow-sm border-gray-200"
        actions={
          <div className="text-right">
            <p className="text-sm text-gray-500">Today</p>
            <p className="text-base font-medium text-gray-900">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        }
      >
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Global Time Zones</p>
            <WorldClocks />
          </div>

          <div className="border-t pt-6">
            <MessageBoard />
          </div>

          <div className="border-t pt-6">
            <TeamsChat />
          </div>
        </div>
      </ExpandableCard>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <ExpandableCard
          title="Active Clients"
          icon={<Users className="h-4 w-4 text-emerald-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">{stats.activeClients}</div>
          <p className="text-xs text-emerald-600 flex items-center mt-1">
            <TrendingUp className="h-3 w-3 mr-1" />
            Total active
          </p>
        </ExpandableCard>

        <ExpandableCard
          title={teamMember ? "My Open Tasks" : "Open Tasks"}
          icon={<CheckSquare className="h-4 w-4 text-blue-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">{stats.openTasks}</div>
          <p className="text-xs text-gray-500 mt-1">{stats.tasksToday} due today</p>
        </ExpandableCard>

        <ExpandableCard
          title={teamMember ? "My Deadlines" : "Upcoming Deadlines"}
          icon={<Clock className="h-4 w-4 text-orange-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">{stats.upcomingDeadlines}</div>
          <p className="text-xs text-orange-600 mt-1">{stats.criticalDeadlines} critical this week</p>
        </ExpandableCard>

        <ExpandableCard
          title="Pending Documents"
          icon={<FileText className="h-4 w-4 text-purple-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">{stats.pendingDocuments}</div>
          <p className="text-xs text-gray-500 mt-1">Awaiting client review</p>
        </ExpandableCard>
      </div>

      {/* Karbon Triage section */}
      <TriageSummary />

      {/* Recent Activity */}
      <ExpandableCard
        title={teamMember ? "My Recent Activity" : "Recent Activity"}
        description="Latest updates from your team and clients"
        defaultExpanded={true}
      >
        <div className="space-y-4">
          {activity.map((item, index) => (
            <div key={index} className="flex items-start space-x-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={item.avatar || "/placeholder.svg"} alt={item.user} />
                <AvatarFallback>
                  {item.user
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{item.message}</p>
                <div className="flex items-center space-x-2 mt-1">
                  <p className="text-xs text-gray-500">{item.user}</p>
                  <span className="text-xs text-gray-400">•</span>
                  <p className="text-xs text-gray-500">{item.time}</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">
                {item.type.replace("_", " ")}
              </Badge>
            </div>
          ))}
        </div>
      </ExpandableCard>
    </div>
  )
}
