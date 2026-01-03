import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Users, CheckSquare, Clock, FileText, TrendingUp } from "lucide-react"
import { TriageSummary } from "@/components/triage-summary"
import { TeamsChat } from "@/components/teams-chat"
import { MessageBoard } from "@/components/message-board"
import { WorldClocks } from "@/components/world-clocks"
import { ExpandableCard } from "@/components/ui/expandable-card"

export function DashboardHome() {
  return (
    <div className="space-y-6">
      <ExpandableCard
        title="Welcome back, Sarah"
        description="Here's what's happening with your clients today."
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

      {/* Quick Stats - Made each stat card expandable */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <ExpandableCard
          title="Active Clients"
          icon={<Users className="h-4 w-4 text-emerald-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">247</div>
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
          <div className="text-2xl font-bold text-gray-900">18</div>
          <p className="text-xs text-gray-500 mt-1">3 due today</p>
        </ExpandableCard>

        <ExpandableCard
          title="Upcoming Deadlines"
          icon={<Clock className="h-4 w-4 text-orange-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">7</div>
          <p className="text-xs text-orange-600 mt-1">2 critical this week</p>
        </ExpandableCard>

        <ExpandableCard
          title="Pending Documents"
          icon={<FileText className="h-4 w-4 text-purple-600" />}
          defaultExpanded={true}
          collapsible={false}
          headerClassName="pb-2"
        >
          <div className="text-2xl font-bold text-gray-900">12</div>
          <p className="text-xs text-gray-500 mt-1">Awaiting client review</p>
        </ExpandableCard>
      </div>

      {/* Karbon Triage section */}
      <TriageSummary />

      {/* Recent Activity - Made expandable */}
      <ExpandableCard
        title="Recent Activity"
        description="Latest updates from your team and clients"
        defaultExpanded={true}
      >
        <div className="space-y-4">
          {[
            {
              type: "client_added",
              message: "New client Johnson & Associates added to portfolio",
              time: "2 hours ago",
              user: "Mark Dwyer",
              avatar: "/professional-man.png",
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
          ].map((activity, index) => (
            <div key={index} className="flex items-start space-x-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={activity.avatar || "/placeholder.svg"} alt={activity.user} />
                <AvatarFallback>
                  {activity.user
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{activity.message}</p>
                <div className="flex items-center space-x-2 mt-1">
                  <p className="text-xs text-gray-500">{activity.user}</p>
                  <span className="text-xs text-gray-400">•</span>
                  <p className="text-xs text-gray-500">{activity.time}</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">
                {activity.type.replace("_", " ")}
              </Badge>
            </div>
          ))}
        </div>
      </ExpandableCard>
    </div>
  )
}
