"use client"

import { Users, CheckSquare, Clock, FileText, Loader2 } from "lucide-react"
import { MessageBoard } from "@/components/message-board"
import { WorldClocks } from "@/components/world-clocks"
import { ClientServiceDebriefs } from "@/components/client-service-debriefs"
import { ExpandableCard } from "@/components/ui/expandable-card"
import { StatDrillCard } from "@/components/stat-drill-card"
import { useUser, useDisplayName } from "@/contexts/user-context"
import { useEffect, useState } from "react"

interface DashboardStats {
  activeClients: number
  openTasks: number
  tasksToday: number
  upcomingDeadlines: number
  criticalDeadlines: number
  pendingDocuments: number
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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const teamMemberId = teamMember?.id
        const url = teamMemberId ? `/api/dashboard/stats?teamMemberId=${teamMemberId}` : "/api/dashboard/stats"

        const response = await fetch(url)

        if (!response.ok) {
          throw new Error("Failed to fetch dashboard data")
        }

        const data = await response.json()
        setStats(data.stats)
      } catch (error) {
        console.error("Error fetching dashboard data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    if (!userLoading) {
      fetchDashboardData()
    }
  }, [teamMember?.id, userLoading])

  if (userLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  // Append `?teamMemberId=` only when we know who the user is — otherwise the
  // API falls back to the firm-wide view.
  const tmQuery = teamMember?.id ? `?teamMemberId=${teamMember.id}` : ""

  return (
    <div className="w-full space-y-6">
      <ExpandableCard
        title={`Welcome back, ${displayName}`}
        description={
          teamMember?.title
            ? `${teamMember.title} at Motta Financial`
            : "Here's what's happening with your clients today."
        }
        defaultExpanded={true}
        collapsible={true}
        className="bg-white shadow-sm border-gray-200 w-full"
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
          <ExpandableCard
            title="Global Time Zones"
            defaultExpanded={true}
            collapsible={true}
            className="bg-gray-50 border-gray-200 shadow-none w-full"
          >
            <WorldClocks />
          </ExpandableCard>

          <ExpandableCard
            title="Team Message Board"
            defaultExpanded={true}
            collapsible={true}
            className="bg-gray-50 border-gray-200 shadow-none w-full"
            contentClassName="pt-0"
          >
            <MessageBoard />
          </ExpandableCard>

          <ExpandableCard
            title="Client Service Updates"
            description="Recent debriefs across the firm"
            defaultExpanded={true}
            collapsible={true}
            className="bg-gray-50 border-gray-200 shadow-none w-full"
            contentClassName="pt-0"
          >
            <ClientServiceDebriefs />
          </ExpandableCard>
        </div>
      </ExpandableCard>

      <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatDrillCard
          title="Active Clients"
          icon={<Users className="h-4 w-4 text-emerald-600" />}
          value={stats.activeClients}
          hint="Total active"
          hintClassName="text-emerald-600 flex items-center"
          detailsEndpoint={`/api/dashboard/details?kind=active-clients`}
          viewAllHref="/clients"
        />

        <StatDrillCard
          title={teamMember ? "My Open Tasks" : "Open Tasks"}
          icon={<CheckSquare className="h-4 w-4 text-blue-600" />}
          value={stats.openTasks}
          hint={`${stats.tasksToday} due today`}
          detailsEndpoint={`/api/dashboard/details?kind=open-tasks${tmQuery ? `&teamMemberId=${teamMember!.id}` : ""}`}
          viewAllHref="/work-items"
        />

        <StatDrillCard
          title={teamMember ? "My Deadlines" : "Upcoming Deadlines"}
          icon={<Clock className="h-4 w-4 text-orange-600" />}
          value={stats.upcomingDeadlines}
          hint={`${stats.criticalDeadlines} critical this week`}
          hintClassName="text-orange-600"
          detailsEndpoint={`/api/dashboard/details?kind=upcoming-deadlines${tmQuery ? `&teamMemberId=${teamMember!.id}` : ""}`}
          viewAllHref="/work-items"
        />

        <StatDrillCard
          title="Pending Documents"
          icon={<FileText className="h-4 w-4 text-purple-600" />}
          value={stats.pendingDocuments}
          hint="Awaiting client review"
          detailsEndpoint={`/api/dashboard/details?kind=pending-documents`}
          viewAllHref="/clients"
        />
      </div>
    </div>
  )
}
