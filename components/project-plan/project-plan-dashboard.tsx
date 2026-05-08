"use client"

import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ExpandableCard } from "@/components/ui/expandable-card"
import {
  bucketServiceType,
  bucketStatus,
  getClientLabel,
  SERVICE_TYPE_ORDER,
  STATUS_BUCKETS,
  STATUS_COLORS,
  useAccountingWorkItems,
  type ServiceType,
  type StatusBucket,
} from "./project-plan-shared"
import { useProjectPlanContext } from "./project-plan-context"
import {
  AlertCircle,
  BarChart3,
  Briefcase,
  ChevronRight,
  ClipboardList,
  Layers,
  Loader2,
  Trophy,
  Users,
} from "lucide-react"

// Mirrors the Dashboard tab in the FY2026 project-plan workbook, scoped
// to Accounting (ACCT) work types. Every aggregate is wired to drill
// through to the Roster (or Kanban) tab pre-filtered to the slice the
// user clicked — Status row → roster filtered by status, Service row →
// roster filtered by service, Top-Client row → roster filtered to that
// client, and the In-Progress / Waiting KPI tiles likewise.
export function ProjectPlanDashboard() {
  const { activeWorkItems, isLoading, error } = useAccountingWorkItems()
  const { jumpTo } = useProjectPlanContext()

  const stats = useMemo(() => {
    const statusCounts: Record<StatusBucket, number> = {
      "Not Started": 0,
      "To Do": 0,
      "In Progress": 0,
      Waiting: 0,
      Complete: 0,
    }
    const serviceCounts: Record<ServiceType, number> = {
      "Monthly Bookkeeping": 0,
      "Quarterly Filings": 0,
      Payroll: 0,
      "1099s": 0,
      "Advisory / CFO Services": 0,
      Onboarding: 0,
      Tax: 0,
      "Internal Ops": 0,
      "Sales & Marketing": 0,
      Talent: 0,
      Other: 0,
    }
    const clientCounts = new Map<string, number>()

    for (const item of activeWorkItems) {
      statusCounts[bucketStatus(item)] += 1
      serviceCounts[bucketServiceType(item)] += 1
      const client = getClientLabel(item)
      clientCounts.set(client, (clientCounts.get(client) ?? 0) + 1)
    }

    const total = activeWorkItems.length
    const topClients = Array.from(clientCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
    const distinctClients = clientCounts.size

    return { total, statusCounts, serviceCounts, topClients, distinctClients }
  }, [activeWorkItems])

  if (isLoading && !stats.total) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
          Loading Accounting work items…
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const waiting = stats.statusCounts.Waiting
  const inProgress = stats.statusCounts["In Progress"]

  return (
    <div className="space-y-6">
      {/* KPI tiles. The In-Progress / Waiting tiles are click-through
          shortcuts into the Roster tab, mirroring how the workbook's
          conditional formatting drew the eye to those buckets. */}
      <ExpandableCard
        title="Key Performance Indicators"
        description="Click any tile to drill into the underlying work items"
        icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiTile
            icon={<ClipboardList className="h-4 w-4" />}
            label="Total Work Items"
            value={stats.total}
            subline="Active across ACCT service types"
            onClick={() => jumpTo("roster")}
          />
          <KpiTile
            icon={<Users className="h-4 w-4" />}
            label="Distinct Clients"
            value={stats.distinctClients}
            subline="With at least one active item"
            onClick={() => jumpTo("roster")}
          />
          <KpiTile
            icon={<Briefcase className="h-4 w-4" />}
            label="In Progress"
            value={inProgress}
            subline={`${pct(inProgress, stats.total)} of total`}
            tone="blue"
            onClick={() => jumpTo("roster", { status: "In Progress" })}
          />
          <KpiTile
            icon={<AlertCircle className="h-4 w-4" />}
            label="Waiting on Client"
            value={waiting}
            subline={`${pct(waiting, stats.total)} of total`}
            tone="rose"
            onClick={() => jumpTo("roster", { status: "Waiting" })}
          />
        </div>
      </ExpandableCard>

      {/* Status & service breakdown — clickable rows drill into Roster */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpandableCard
          title="Clients by Status"
          description="Mirrors the Karbon workflow buckets — click a row to filter the Roster"
          icon={<Layers className="h-5 w-5 text-amber-600" />}
        >
          <div className="space-y-3">
            {STATUS_BUCKETS.map((status) => {
              const count = stats.statusCounts[status]
              const tone = STATUS_COLORS[status]
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => jumpTo("roster", { status })}
                  className="w-full text-left space-y-1.5 rounded-md p-2 -mx-2 hover:bg-muted/60 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label={`Drill into ${status} (${count})`}
                >
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                      <span className="font-medium">{status}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{count}</span>
                      <span className="text-xs">{pct(count, stats.total)}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </div>
                  </div>
                  <Progress
                    value={stats.total === 0 ? 0 : (count / stats.total) * 100}
                    className="h-1.5"
                  />
                </button>
              )
            })}
          </div>
        </ExpandableCard>

        <ExpandableCard
          title="Clients by Service Type"
          description="Derived from Karbon work_type — click a row to filter the Roster"
          icon={<Briefcase className="h-5 w-5 text-emerald-600" />}
        >
          <div className="space-y-3">
            {SERVICE_TYPE_ORDER.filter((t) => stats.serviceCounts[t] > 0).map((service) => {
              const count = stats.serviceCounts[service]
              return (
                <button
                  key={service}
                  type="button"
                  onClick={() => jumpTo("roster", { service })}
                  className="w-full text-left space-y-1.5 rounded-md p-2 -mx-2 hover:bg-muted/60 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label={`Drill into ${service} (${count})`}
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{service}</span>
                    <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{count}</span>
                      <span className="text-xs">{pct(count, stats.total)}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                    </div>
                  </div>
                  <Progress
                    value={stats.total === 0 ? 0 : (count / stats.total) * 100}
                    className="h-1.5"
                  />
                </button>
              )
            })}
          </div>
        </ExpandableCard>
      </div>

      {/* Leaderboard */}
      <ExpandableCard
        title="Projects / Tasks by Client"
        description={`${stats.distinctClients} active clients across ${stats.total} ACCT work items — top 25 shown, click a row to drill in`}
        icon={<Trophy className="h-5 w-5 text-amber-600" />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Client</th>
                <th className="py-2 pr-4 font-medium text-right">Work Items</th>
                <th className="py-2 pr-4 font-medium text-right">% of Total</th>
                <th className="py-2 pl-4 font-medium">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {stats.topClients.map(([client, count]) => (
                <tr
                  key={client}
                  className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => jumpTo("roster", { query: client })}
                  // Keyboard accessibility — table rows aren't natively
                  // focusable, so we surface the same drill-through with
                  // Enter / Space when the row is reached via tab order.
                  tabIndex={0}
                  role="button"
                  aria-label={`Drill into ${client} (${count} work items)`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      jumpTo("roster", { query: client })
                    }
                  }}
                >
                  <td className="py-2 pr-4 font-medium">{client}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    <Badge variant="outline">{count}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                    {pct(count, stats.total)}
                  </td>
                  <td className="py-2 pl-4 w-1/3">
                    <Progress
                      value={stats.total === 0 ? 0 : (count / stats.total) * 100}
                      className="h-1.5"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ExpandableCard>
    </div>
  )
}

function pct(value: number, total: number) {
  if (!total) return "0.0%"
  return `${((value / total) * 100).toFixed(1)}%`
}

function KpiTile({
  icon,
  label,
  value,
  subline,
  tone,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: number
  subline?: string
  tone?: "blue" | "rose"
  onClick?: () => void
}) {
  const toneClass =
    tone === "blue"
      ? "bg-blue-50 text-blue-700"
      : tone === "rose"
        ? "bg-rose-50 text-rose-700"
        : "bg-muted/50 text-foreground"

  // KPI tiles are interactive when an onClick handler is supplied. We use
  // a real <button> wrapper so screen readers + keyboard navigation work
  // out of the box. Visual treatment matches the original Card.
  const inner = (
    <Card
      className={
        onClick
          ? "transition-all hover:border-blue-400 hover:shadow-md cursor-pointer h-full"
          : "h-full"
      }
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-1.5 rounded-md ${toneClass}`}>{icon}</div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </p>
        </div>
        <p className="text-3xl font-semibold tabular-nums">{value.toLocaleString()}</p>
        {subline ? <p className="text-xs text-muted-foreground mt-1">{subline}</p> : null}
      </CardContent>
    </Card>
  )

  if (!onClick) return inner

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value.toLocaleString()} — drill into roster`}
      className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
    >
      {inner}
    </button>
  )
}
