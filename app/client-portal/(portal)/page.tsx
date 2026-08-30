"use client"

import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  FolderKanban,
  MessageSquare,
  AlertTriangle,
  ChevronRight,
  Users,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { LatestMeetingCard } from "@/components/portal/latest-meeting-card"
import { ProjectStatusChip, WaitingOnLine } from "@/components/portal/project-status"
import { deriveClientStatus } from "@/lib/portal/client-status"

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkItem {
  id: string
  title: string
  work_type_name: string | null
  statusDisplay: { label: string; color: string }
  assignee_name: string | null
  due_date: string | null
  has_blocking_todos: boolean
  progressPct: number
}

interface PortalMessage {
  id: string
  sender_role: "client" | "team"
  sender_name: string | null
  body: string
  created_at: string
  read_at: string | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── Page ──────────────────────────────────────────────────────────────────────

interface TeamMemberSnapshot {
  karbon_user_key: string
  first_name: string | null
  last_name: string | null
  title: string | null
  role: string | null
  email: string | null
}

interface MeResponse {
  contacts: Array<{
    first_name: string | null
    last_name: string | null
    full_name: string | null
    client_manager_key: string | null
    client_partner_key: string | null
  }>
  organizations: Array<{
    name: string | null
    client_manager_key: string | null
    client_partner_key: string | null
  }>
  team: Record<string, TeamMemberSnapshot>
}

export default function PortalDashboardPage() {
  const { data: meData } = useSWR<MeResponse>("/api/client-portal/me", fetcher)
  const { data: workData } = useSWR("/api/client-portal/work-items", fetcher)
  const { data: msgData } = useSWR("/api/client-portal/messages", fetcher)

  const isLoading = !workData || !msgData

  const primaryContact = meData?.contacts?.[0]
  const primaryOrg = meData?.organizations?.[0]
  const firstName =
    primaryContact?.first_name ?? primaryOrg?.name?.split(" ")[0] ?? "there"

  const workItems: WorkItem[] = workData?.workItems ?? []
  const messages: PortalMessage[] = msgData?.messages ?? []

  const activeCount = workItems.length
  const hasBlockingItems = workItems.some((w) => w.has_blocking_todos)

  const unreadCount = messages.filter(
    (m) => m.sender_role === "team" && !m.read_at,
  ).length

  const recentMessages = [...messages]
    .reverse()
    .slice(0, 3)

  const recentWork = workItems.slice(0, 3)

  // Greet based on time of day
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">{today}</p>
      </div>

      {/* Action needed banner */}
      {hasBlockingItems && (
        <div
          className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: "#FEF3C7",
            borderColor: "#8E9B79",
            color: "#92400E",
          }}
        >
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: "#6B745D" }} />
          <div>
            <p className="font-medium">Action needed from you</p>
            <p className="mt-0.5 text-xs">
              Your team is waiting on information to move forward with one or more of your projects.{" "}
              <a
                href="/client-portal/tax"
                className="underline underline-offset-2 font-medium"
                style={{ color: "#92400E" }}
              >
                View details →
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title="Active Projects"
          value={isLoading ? null : activeCount}
          icon={FolderKanban}
          href="/client-portal/tax"
          iconColor="#6B745D"
        />
        <StatCard
          title="Unread Messages"
          value={isLoading ? null : unreadCount}
          icon={MessageSquare}
          href="/client-portal/messages"
          iconColor="#6B745D"
          highlight={unreadCount > 0}
        />
      </div>

      {/* Two-column grid: recent work + recent messages */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent work */}
        <Card className="shadow-sm border-0">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Active Work</CardTitle>
            <a
              href="/client-portal/tax"
              className="text-xs font-medium flex items-center gap-1 hover:underline"
              style={{ color: "#6B745D" }}
            >
              View all <ChevronRight className="h-3.5 w-3.5" />
            </a>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))
            ) : recentWork.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No active projects at this time.
              </p>
            ) : (
              recentWork.map((item) => (
                <WorkItemRow key={item.id} item={item} />
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent messages */}
        <Card className="shadow-sm border-0">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Messages</CardTitle>
            <a
              href="/client-portal/messages"
              className="text-xs font-medium flex items-center gap-1 hover:underline"
              style={{ color: "#6B745D" }}
            >
              View all <ChevronRight className="h-3.5 w-3.5" />
            </a>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))
            ) : recentMessages.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No messages yet. Send us a note anytime.
              </p>
            ) : (
              recentMessages.map((msg) => (
                <MessageRow key={msg.id} msg={msg} />
              ))
            )}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full mt-1"
            >
              <a href="/client-portal/messages">
                <MessageSquare className="mr-2 h-4 w-4" />
                Send a message
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Latest meeting recap */}
      <LatestMeetingCard />

      {/* Your team */}
      <YourTeamCard meData={meData} isLoading={!meData} />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  href,
  iconColor,
  highlight = false,
}: {
  title: string
  value: number | null
  icon: React.ElementType
  href: string
  iconColor: string
  highlight?: boolean
}) {
  return (
    <a href={href} className="block">
      <Card
        className={`shadow-sm border-0 transition-shadow hover:shadow-md ${
          highlight ? "ring-1 ring-[#8E9B79]" : ""
        }`}
      >
        <CardContent className="flex items-center gap-4 py-5 px-5">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-lg shrink-0"
            style={{ backgroundColor: `${iconColor}18` }}
          >
            <Icon className="h-5 w-5" style={{ color: iconColor }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
              {title}
            </p>
            {value === null ? (
              <Skeleton className="mt-1 h-7 w-10" />
            ) : (
              <p className="text-2xl font-bold text-gray-900 leading-none mt-0.5">
                {value}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </a>
  )
}

function WorkItemRow({ item }: { item: WorkItem }) {
  const status = deriveClientStatus({
    id: item.id,
    rawLabel: item.statusDisplay.label,
    hasBlockingTodos: item.has_blocking_todos,
    assigneeName: item.assignee_name,
  })

  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <ProjectStatusChip status={status} />
          {item.assignee_name && (
            <span className="text-xs text-gray-400 truncate">
              {item.assignee_name}
            </span>
          )}
        </div>
        <WaitingOnLine status={status} className="mt-1" />
      </div>
    </div>
  )
}

function MessageRow({ msg }: { msg: PortalMessage }) {
  const isUnread = msg.sender_role === "team" && !msg.read_at
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 ${
        isUnread ? "bg-[#8E9B79]/10 border border-[#8E9B79]/30" : "bg-gray-50/60 border border-gray-100"
      } rounded-xl`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-700">
            {msg.sender_role === "team" ? msg.sender_name ?? "Motta Financial" : "You"}
          </p>
          {isUnread && (
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: "#6B745D" }} />
          )}
        </div>
        <p className="text-sm text-gray-600 mt-0.5 line-clamp-2 leading-snug">
          {msg.body}
        </p>
      </div>
      <p className="text-[10px] text-gray-400 shrink-0 mt-0.5">
        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
      </p>
    </div>
  )
}

function YourTeamCard({
  meData,
  isLoading,
}: {
  meData: MeResponse | undefined
  isLoading: boolean
}) {
  const entity = meData?.contacts?.[0] ?? meData?.organizations?.[0]
  const managerKey = entity?.client_manager_key ?? null
  const partnerKey = entity?.client_partner_key ?? null
  const team = meData?.team ?? {}

  return (
    <Card className="shadow-sm border-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" style={{ color: "#6B745D" }} />
          Your Motta Team
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex gap-4">
            <Skeleton className="h-12 w-32" />
            <Skeleton className="h-12 w-32" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            {managerKey ? (
              <TeamMemberBadge label="Client Manager" member={team[managerKey]} />
            ) : null}
            {partnerKey ? (
              <TeamMemberBadge label="Partner" member={team[partnerKey]} />
            ) : null}
            {!managerKey && !partnerKey && (
              <p className="text-sm text-gray-500">
                Your team members will appear here.
              </p>
            )}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="ml-auto"
            >
              <a href="/client-portal/messages">
                <MessageSquare className="mr-2 h-4 w-4" />
                Send a message
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TeamMemberBadge({
  label,
  member,
}: {
  label: string
  member: TeamMemberSnapshot | undefined
}) {
  const fullName = member
    ? [member.first_name, member.last_name].filter(Boolean).join(" ")
    : null
  const initials =
    member?.first_name && member?.last_name
      ? `${member.first_name[0]}${member.last_name[0]}`.toUpperCase()
      : "MF"

  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full text-white text-sm font-semibold"
        style={{ backgroundColor: "#6B745D" }}
      >
        {initials}
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-medium text-gray-800">
          {fullName || "Motta Financial"}
        </p>
        {member?.title && (
          <p className="text-xs text-gray-400">{member.title}</p>
        )}
      </div>
    </div>
  )
}
