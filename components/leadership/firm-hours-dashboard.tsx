"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, DollarSign, Users, RefreshCw, AlertCircle, TrendingUp } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

/**
 * FirmHoursDashboard — leadership-only ("PPD") view of firm-wide
 * Karbon time. Mirrors the per-user `HoursDashboard` visual grammar
 * (summary cards, weekly trend, breakdown tables) and adds a
 * `byMember` table that's the headline for leadership use.
 *
 * Data source: GET /api/firm/hours, which is gated by
 * `requireLeadership()` server-side. This component intentionally does
 * NOT do any extra client-side gating — it trusts the API; if a
 * non-PPD somehow ends up rendering this page, they'll just see a
 * 403 message.
 */

interface SummaryBucket {
  hours: number
  billableHours: number
  nonBillableHours: number
  billedAmount: number
  entryCount: number
  memberCount: number
}

interface FirmHoursResponse {
  summary: {
    thisWeek: SummaryBucket
    mtd: SummaryBucket
    ytd: SummaryBucket
    allTime: SummaryBucket
  }
  weeklyTrend: Array<{ weekStart: string; hours: number; billableHours: number }>
  byMember: Array<{
    userKey: string | null
    userName: string
    hours: number
    billableHours: number
    billedAmount: number
    entryCount: number
    utilization: number
  }>
  byClient: Array<{
    clientKey: string | null
    clientName: string
    hours: number
    billableHours: number
    billedAmount: number
  }>
  byWorkType: Array<{ taskTypeName: string; hours: number }>
  lastSyncedAt: string | null
  windowDays: number
}

const fetcher = async (url: string): Promise<FirmHoursResponse> => {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
  return res.json()
}

export function FirmHoursDashboard() {
  // Window selector for the breakdown tables. Summary cards always
  // show fixed time-buckets (this week / MTD / YTD / all-time).
  const [days, setDays] = useState<number>(90)
  const [syncing, setSyncing] = useState(false)

  const { data, error, isLoading, mutate } = useSWR<FirmHoursResponse>(
    `/api/firm/hours?days=${days}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  async function handleSync() {
    setSyncing(true)
    try {
      // Reuse the existing import endpoint. It already handles batched
      // upsert of timesheets via the OData $expand=TimeEntries path.
      await fetch("/api/karbon/timesheets?import=true&incremental=true", {
        method: "GET",
        cache: "no-store",
      })
      await mutate()
    } catch (e) {
      console.error("[v0] firm-hours: sync failed", e)
    } finally {
      setSyncing(false)
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-6">
          <AlertCircle className="h-5 w-5 mt-0.5 text-red-600 shrink-0" />
          <div>
            <p className="font-medium text-foreground">Couldn&apos;t load firm hours</p>
            <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading || !data) {
    return <SkeletonState />
  }

  const { summary, weeklyTrend, byMember, byClient, byWorkType, lastSyncedAt, windowDays } = data

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-[#6B745D] text-white border-[#6B745D]">
            Leadership
          </Badge>
          <p className="text-sm text-muted-foreground">
            {lastSyncedAt
              ? `Last synced ${formatRelative(lastSyncedAt)}`
              : "No sync recorded yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 6 months</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="This week"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          bucket={summary.thisWeek}
        />
        <SummaryCard
          label="Month-to-date"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          bucket={summary.mtd}
        />
        <SummaryCard
          label="Year-to-date"
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          bucket={summary.ytd}
        />
        <SummaryCard
          label="All time"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          bucket={summary.allTime}
        />
      </div>

      {/* Weekly trend */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly trend</CardTitle>
          <CardDescription>Total firm hours, billable vs. total — last 12 weeks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                <XAxis
                  dataKey="weekStart"
                  tickFormatter={formatWeekTick}
                  tick={{ fontSize: 12 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)} hrs`, ""]}
                  labelFormatter={(label) => `Week of ${formatWeekTick(label as string)}`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="hours" name="Total" fill="#8E9B79" radius={[4, 4, 0, 0]} />
                <Bar dataKey="billableHours" name="Billable" fill="#6B745D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* By member — the table leadership came here for */}
      <Card>
        <CardHeader>
          <CardTitle>Hours by team member</CardTitle>
          <CardDescription>Last {windowDays} days, sorted by total hours</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team member</TableHead>
                <TableHead className="text-right">Total hrs</TableHead>
                <TableHead className="text-right">Billable hrs</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
                <TableHead className="text-right">Billed $</TableHead>
                <TableHead className="text-right">Entries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byMember.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No tracked time in this window.
                  </TableCell>
                </TableRow>
              ) : (
                byMember.map((m) => (
                  <TableRow key={m.userKey || m.userName}>
                    <TableCell className="font-medium">{m.userName}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.hours.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.billableHours.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <UtilizationBadge value={m.utilization} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">${m.billedAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.entryCount}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* By client + by work-type, side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top clients</CardTitle>
            <CardDescription>Last {windowDays} days, top 15</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Billed $</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byClient.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No client time in this window.
                    </TableCell>
                  </TableRow>
                ) : (
                  byClient.map((c) => (
                    <TableRow key={c.clientKey || c.clientName}>
                      <TableCell className="font-medium truncate max-w-[260px]">{c.clientName}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.hours.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">${c.billedAmount.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hours by work type</CardTitle>
            <CardDescription>Last {windowDays} days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byWorkType} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E1DA" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="taskTypeName"
                    tick={{ fontSize: 11 }}
                    width={140}
                  />
                  <Tooltip formatter={(value: number) => [`${value.toFixed(1)} hrs`, "Hours"]} />
                  <Bar dataKey="hours" fill="#8E9B79" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  icon,
  bucket,
}: {
  label: string
  icon: React.ReactNode
  bucket: SummaryBucket
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{bucket.hours.toFixed(1)}</div>
        <p className="text-xs text-muted-foreground mt-1">
          {bucket.billableHours.toFixed(1)} billable
          {bucket.memberCount > 0 ? ` · ${bucket.memberCount} ${bucket.memberCount === 1 ? "member" : "members"}` : ""}
        </p>
        {bucket.billedAmount > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            ${bucket.billedAmount.toLocaleString()} billed
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function UtilizationBadge({ value }: { value: number }) {
  // Visual cue: 0–40 amber, 40–75 neutral, 75+ leadership-green.
  // Capped at 100 for the label even though billable can technically
  // exceed total in odd Karbon edge cases.
  const display = Math.min(100, Math.max(0, value))
  let cls = "bg-stone-100 text-stone-700"
  if (display >= 75) cls = "bg-[#6B745D] text-white"
  else if (display < 40) cls = "bg-amber-100 text-amber-800"
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{display}%</span>
}

function SkeletonState() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-[320px] w-full" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  )
}

function formatWeekTick(iso: string) {
  const d = new Date(iso + "T00:00:00")
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatRelative(iso: string) {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.round(diff / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  return `${d}d ago`
}
