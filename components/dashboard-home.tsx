"use client"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Users, CheckSquare, Clock, FileText, TrendingUp, Bell } from "lucide-react"
import { TriageSummary } from "@/components/triage-summary"
import { TeamsChat } from "@/components/teams-chat"
import { MessageBoard } from "@/components/message-board"
import { WorldClocks } from "@/components/world-clocks"
import { ExpandableCard } from "@/components/ui/expandable-card"
import { useDemoMode } from "@/contexts/demo-mode-context"

export function DashboardHome() {
  const { isDemoMode, selectedUser, demoStats, demoTasks, demoNotifications, demoActivity } = useDemoMode()

  // Use demo data when in demo mode
  const userName = isDemoMode && selectedUser ? selectedUser.name.split(" ")[0] : "Sarah"
  const stats = isDemoMode
    ? demoStats
    : {
        activeClients: 247,
        openTasks: 18,
        tasksToday: 3,
        upcomingDeadlines: 7,
        criticalDeadlines: 2,
        pendingDocuments: 12,
      }
  const tasks = isDemoMode ? demoTasks : []
  const notifications = isDemoMode ? demoNotifications : []
  const activity = isDemoMode
    ? demoActivity
    : [
        {
          type: "client_added",
          message: "New client Johnson & Associates added to portfolio",
          time: "2 hours ago",
          user: "Mark Dwyer",
          avatar: "/professional-man-beard.png",
        },
        {
          type: "deliverable_sent",
          message: "Q4 tax planning report sent to Acme Corp",
          time: "4 hours ago",
          user: "Nick Roccuia",
          avatar: "/professional-man-beard.png",
        },
        {
          type: "feedback_received",
          message: "Client feedback received for financial advisory proposal",
          time: "6 hours ago",
          user: "Dai Le",
          avatar: "/professional-asian-man.png",
        },
        {
          type: "task_completed",
          message: "Bookkeeping reconciliation completed for Tech Startup LLC",
          time: "1 day ago",
          user: "Matt Pereria",
          avatar: "/professional-man-glasses.png",
        },
      ]

  const unreadNotifications = notifications.filter((n) => !n.isRead).length
  const pendingTasks = tasks.filter((t) => t.status !== "completed").length

  return (
    <div className="space-y-6">
      <ExpandableCard
        title={`Welcome back, ${userName}`}
        description={
          isDemoMode && selectedUser
            ? `Viewing as ${selectedUser.role}`
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
          {isDemoMode && unreadNotifications > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Bell className="h-4 w-4 text-amber-600" />
                <span className="font-medium text-amber-900">
                  You have {unreadNotifications} unread notification{unreadNotifications > 1 ? "s" : ""}
                </span>
              </div>
              <ul className="space-y-1">
                {notifications
                  .filter((n) => !n.isRead)
                  .slice(0, 3)
                  .map((n, i) => (
                    <li key={i} className="text-sm text-amber-800">
                      • {n.message}
                    </li>
                  ))}
              </ul>
            </div>
          )}

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
            +12% from last month
          </p>
        </ExpandableCard>

        <ExpandableCard
          title="Open Tasks"
          icon={<CheckSquare className="h-4 w-4 text-blue-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">{isDemoMode ? pendingTasks : stats.openTasks}</div>
          <p className="text-xs text-gray-500 mt-1">{stats.tasksToday} due today</p>
        </ExpandableCard>

        <ExpandableCard
          title="Upcoming Deadlines"
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

      {isDemoMode && tasks.length > 0 && (
        <ExpandableCard
          title="Your Tasks"
          description={`${pendingTasks} pending task${pendingTasks !== 1 ? "s" : ""}`}
          defaultExpanded={true}
        >
          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{task.title}</p>
                  <p className="text-sm text-gray-500">
                    {task.client} • Due {new Date(task.dueDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      task.priority === "high" ? "destructive" : task.priority === "medium" ? "default" : "secondary"
                    }
                    className="text-xs"
                  >
                    {task.priority}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      task.status === "completed"
                        ? "bg-green-50 text-green-700"
                        : task.status === "in_progress"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-gray-50"
                    }
                  >
                    {task.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </ExpandableCard>
      )}

      {/* Karbon Triage section */}
      <TriageSummary />

      {/* Recent Activity */}
      <ExpandableCard
        title="Recent Activity"
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
