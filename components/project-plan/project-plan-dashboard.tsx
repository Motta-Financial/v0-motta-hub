"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useKarbonWorkItems } from "@/contexts/karbon-work-items-context"
import {
  bucketServiceType,
  bucketStatus,
  getClientLabel,
  SERVICE_TYPE_ORDER,
  STATUS_BUCKETS,
  STATUS_COLORS,
  type ServiceType,
  type StatusBucket,
} from "./project-plan-shared"
import { AlertCircle, Briefcase, ClipboardList, Loader2, Users } from "lucide-react"

// Mirrors the Dashboard tab in the FY2026 project-plan workbook:
// KPI tiles, Clients-by-Status, Clients-by-Service-Type, and the
// "Projects / Tasks by Client" leaderboard.
export function ProjectPlanDashboard() {
  const { activeWorkItems, isLoading, error } = useKarbonWorkItems()

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
          Loading firm-wide work items…
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
      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile
          icon={<ClipboardList className="h-4 w-4" />}
          label="Total Work Items"
          value={stats.total}
          subline="Active across all service types"
        />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          label="Distinct Clients"
          value={stats.distinctClients}
          subline="With at least one active item"
        />
        <KpiTile
          icon={<Briefcase className="h-4 w-4" />}
          label="In Progress"
          value={inProgress}
          subline={`${pct(inProgress, stats.total)} of total`}
          tone="blue"
        />
        <KpiTile
          icon={<AlertCircle className="h-4 w-4" />}
          label="Waiting on Client"
          value={waiting}
          subline={`${pct(waiting, stats.total)} of total`}
          tone="rose"
        />
      </div>

      {/* Status & service breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Clients by Status</CardTitle>
            <CardDescription>Mirrors the Karbon workflow buckets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {STATUS_BUCKETS.map((status) => {
              const count = stats.statusCounts[status]
              const tone = STATUS_COLORS[status]
              return (
                <div key={status} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                      <span className="font-medium">{status}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{count}</span>
                      <span className="text-xs">{pct(count, stats.total)}</span>
                    </div>
                  </div>
                  <Progress value={stats.total === 0 ? 0 : (count / stats.total) * 100} className="h-1.5" />
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Clients by Service Type</CardTitle>
            <CardDescription>Derived from Karbon work_type</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {SERVICE_TYPE_ORDER.filter((t) => stats.serviceCounts[t] > 0).map((service) => {
              const count = stats.serviceCounts[service]
              return (
                <div key={service} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{service}</span>
                    <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{count}</span>
                      <span className="text-xs">{pct(count, stats.total)}</span>
                    </div>
                  </div>
                  <Progress value={stats.total === 0 ? 0 : (count / stats.total) * 100} className="h-1.5" />
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Projects / Tasks by Client</CardTitle>
          <CardDescription>
            {stats.distinctClients} active clients across {stats.total} work items — top 25 shown
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  <tr key={client} className="border-b last:border-0">
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
        </CardContent>
      </Card>
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
}: {
  icon: React.ReactNode
  label: string
  value: number
  subline?: string
  tone?: "blue" | "rose"
}) {
  const toneClass =
    tone === "blue"
      ? "bg-blue-50 text-blue-700"
      : tone === "rose"
        ? "bg-rose-50 text-rose-700"
        : "bg-muted/50 text-foreground"
  return (
    <Card>
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
}
