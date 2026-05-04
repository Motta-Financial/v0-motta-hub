"use client"

import { Users, CheckSquare, Clock, FileText, TrendingUp, Loader2 } from "lucide-react"
import { MessageBoard } from "@/components/message-board"
import { WorldClocks } from "@/components/world-clocks"
import { ClientServiceDebriefs } from "@/components/client-service-debriefs"
import { ExpandableCard } from "@/components/ui/expandable-card"
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

  return (
    <div className="space-y-6">
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

          {/* Replaces the former Microsoft Teams Chat slot. */}
          <div className="border-t pt-6">
            <ClientServiceDebriefs />
          </div>
        </div>
      </ExpandableCard>

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
    </div>
  )
}
