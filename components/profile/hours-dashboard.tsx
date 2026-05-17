"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Clock, DollarSign, TrendingUp, Calendar, RefreshCw, ExternalLink, AlertCircle } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts"

interface HoursSummaryBucket {
  hours: number
  billableHours: number
  nonBillableHours: number
  billedAmount: number
  entryCount: number
}

interface HoursResponse {
  karbonUserKey: string | null
  teamMember: { id: string; full_name: string | null } | null
  lastSyncedAt: string | null
  message?: string
  summary: {
    thisWeek: HoursSummaryBucket
    mtd: HoursSummaryBucket
    ytd: HoursSummaryBucket
    allTime: HoursSummaryBucket
  }
  weeklyTrend: Array<{ weekStart: string; hours: number; billableHours: number }>
  byClient: Array<{
    clientKey: string | null
    clientName: string
    hours: number
    billableHours: number
    billedAmount: number
  }>
  byWorkType: Array<{ taskTypeName: string; hours: number }>
  recent: Array<{
    key: string
    date: string | null
    hours: number
    minutes: number
    isBillable: boolean
    billingStatus: string | null
    description: string | null
    taskTypeName: string | null
    clientName: string | null
    workItemTitle: string | null
    billedAmount: number | null
    karbonUrl: string | null
  }>
}

const fetcher = (url: string) =>
  fetch(url, { credentials: "same-origin" }).then((r) => {
    if (!r.ok) throw new Error(`Failed to load (${r.status})`)
    return r.json() as Promise<HoursResponse>
  })

export function HoursDashboard() {
  const { data, error, isLoading, mutate } = useSWR<HoursResponse>("/api/profile/hours", fetcher, {
    refreshInterval: 5 * 60 * 1000, // refresh every 5 min
    revalidateOnFocus: true,
  })

  const [isSyncing, setIsSyncing] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center gap-3 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          Failed to load hours. Please refresh.
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  if (!data.karbonUserKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-[#6B745D]" />
            Karbon Hours
          </CardTitle>
          <CardDescription>
            Your profile is not linked to a Karbon user yet, so we can&apos;t pull your time entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Ask an admin to set <span className="font-mono">karbon_user_key</span> on your team-member record.
          </p>
        </CardContent>
      </Card>
    )
  }

  const { summary, weeklyTrend, byClient, byWorkType, recent, lastSyncedAt } = data

  return (
    <div className="space-y-6">
      {/* Header / sync status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">
            Live sync from Karbon. Last updated{" "}
            <span className="font-medium text-gray-700">
              {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "—"}
            </span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isSyncing}
          onClick={async () => {
            setIsSyncing(true)
            try {
              await fetch("/api/karbon/timesheets?import=true&incremental=true")
              await mutate()
            } finally {
              setIsSyncing(false)
            }
          }}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing..." : "Sync now"}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="This Week" icon={Calendar} bucket={summary.thisWeek} />
        <SummaryCard label="Month-to-Date" icon={TrendingUp} bucket={summary.mtd} />
        <SummaryCard label="Year-to-Date" icon={Clock} bucket={summary.ytd} />
        <SummaryCard label="All Time" icon={DollarSign} bucket={summary.allTime} showBilled />
      </div>

      {/* Weekly trend chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#6B745D]" />
            Last 12 Weeks
          </CardTitle>
          <CardDescription>Total vs billable hours per week</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="weekStart"
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                  }
                  tick={{ fontSize: 12 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  labelFormatter={(v) =>
                    `Week of ${new Date(v).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}`
                  }
                  formatter={(value: number, key: string) => [
                    `${value} hrs`,
                    key === "hours" ? "Total" : "Billable",
                  ]}
                />
                <Legend />
                <Bar dataKey="hours" fill="#8E9B79" name="Total" radius={[4, 4, 0, 0]} />
                <Bar dataKey="billableHours" fill="#6B745D" name="Billable" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Two-column breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Clients (Last 90 Days)</CardTitle>
            <CardDescription>By total hours logged</CardDescription>
          </CardHeader>
          <CardContent>
            {byClient.length === 0 ? (
              <p className="text-sm text-gray-500">No time entries in the last 90 days.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Billable</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byClient.map((c) => (
                    <TableRow key={c.clientKey || c.clientName}>
                      <TableCell className="font-medium">{c.clientName}</TableCell>
                      <TableCell className="text-right">{c.hours}</TableCell>
                      <TableCell className="text-right">{c.billableHours}</TableCell>
                      <TableCell className="text-right">
                        {c.billedAmount ? `$${c.billedAmount.toLocaleString()}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Task Type (Last 90 Days)</CardTitle>
            <CardDescription>Where your hours go</CardDescription>
          </CardHeader>
          <CardContent>
            {byWorkType.length === 0 ? (
              <p className="text-sm text-gray-500">No time entries in the last 90 days.</p>
            ) : (
              <div className="space-y-3">
                {byWorkType.map((w) => {
                  const max = byWorkType[0].hours || 1
                  const pct = Math.max(2, (w.hours / max) * 100)
                  return (
                    <div key={w.taskTypeName}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-gray-800 truncate pr-2">{w.taskTypeName}</span>
                        <span className="text-gray-500 tabular-nums">{w.hours} hrs</span>
                      </div>
                      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#6B745D]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent entries */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Time Entries</CardTitle>
          <CardDescription>Last 30 entries pulled from Karbon</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="text-sm text-gray-500 px-6 py-4">No entries logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client / Work</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {r.date ? new Date(r.date).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium text-gray-900">{r.clientName || "—"}</div>
                        {r.workItemTitle && (
                          <div className="text-xs text-gray-500 truncate max-w-[260px]">{r.workItemTitle}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">{r.taskTypeName || r.description || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.hours}</TableCell>
                      <TableCell>
                        {r.isBillable ? (
                          <Badge variant="secondary" className="bg-[#8E9B79] text-white">
                            Billable
                          </Badge>
                        ) : (
                          <Badge variant="outline">Non-billable</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.karbonUrl && (
                          <a
                            href={r.karbonUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#6B745D] hover:text-[#5a6350] inline-flex items-center"
                            aria-label="Open in Karbon"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  label,
  bucket,
  icon: Icon,
  showBilled,
}: {
  label: string
  bucket: HoursSummaryBucket
  icon: React.ComponentType<{ className?: string }>
  showBilled?: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
          <Icon className="h-4 w-4 text-[#6B745D]" />
        </div>
        <div className="text-2xl font-bold text-gray-900 tabular-nums">{bucket.hours}<span className="text-base font-normal text-gray-500"> hrs</span></div>
        <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
          <span>{bucket.billableHours} billable</span>
          <span aria-hidden="true">•</span>
          <span>{bucket.entryCount} entries</span>
        </div>
        {showBilled && bucket.billedAmount > 0 && (
          <div className="mt-1 text-xs text-gray-500">
            ${bucket.billedAmount.toLocaleString()} billed
          </div>
        )}
      </CardContent>
    </Card>
  )
}
