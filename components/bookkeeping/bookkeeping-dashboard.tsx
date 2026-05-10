"use client"

// ──────────────────────────────────────────────────────────────────────────
// Monthly Accounting & Bookkeeping Dashboard
//
// Lives at /accounting/bookkeeping. This is the dedicated, end-to-end
// dashboard for the firm's recurring Monthly Bookkeeping book of business
// — i.e. every active Karbon work item whose work_type is
// "ACCT | Bookkeeping" (or whose title begins with "BKPG |", which
// covers a small tail of legacy entries).
//
// It is **NOT** a copy of the multi-tab Project Plan view. The Project
// Plan view (rendered as the Accounting Dashboard at /accounting) is
// scoped to the entire ACCT department; this page narrows to the
// bookkeeping sub-service, then layers on:
//
//   - A FY-wide coverage matrix (client × month) so partners can see at
//     a glance which clients are caught up vs. behind.
//   - A KPI strip scoped to the *currently-selected month*, including a
//     true checklist-completion percentage (pulled from the Supabase
//     `bookkeeping_checklist_progress` table via the bulk summary
//     endpoint at /api/accounting/bookkeeping-checklist/summary).
//   - A status / lead-workload breakdown for the selected month.
//   - An expandable engagement list where each row drops down to the
//     10-step checklist (reusing the same `ChecklistForWorkItem`
//     component the Project Plan tab uses, so the checklist UI is
//     guaranteed to stay in sync).
//   - An at-risk panel highlighting overdue + waiting-on-client items.
//
// Data sources (all live / Karbon-synced):
//   - useAccountingWorkItems() → /api/supabase/work-items (mirror of Karbon)
//   - POST /api/accounting/bookkeeping-checklist/summary (per-WI counts)
//   - PUT  /api/accounting/bookkeeping-checklist/:id (per-step writes,
//     handled inside <ChecklistForWorkItem/>)
// ──────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ExpandableCard } from "@/components/ui/expandable-card"
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Users,
  UsersRound,
} from "lucide-react"
import {
  bucketStatus,
  formatShortDate,
  getAssigneeLabel,
  getClientLabel,
  STATUS_BUCKETS,
  STATUS_COLORS,
  useAccountingWorkItems,
  type StatusBucket,
} from "@/components/project-plan/project-plan-shared"
import { ChecklistForWorkItem } from "@/components/project-plan/project-plan-checklist"
import { type KarbonWorkItem } from "@/contexts/karbon-work-items-context"

// ── Local types ──────────────────────────────────────────────────────────

interface ChecklistSummary {
  completed: number
  phase1Done: number
  phase2Done: number
  lastUpdatedAt: string | null
}

type SummaryMap = Record<string, ChecklistSummary>

// ── Helpers ──────────────────────────────────────────────────────────────

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

// YYYY-MM key for a Date. Used to compare an engagement's period_start
// (or due_date fallback) against the dashboard's selected month.
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

// Returns the canonical month key (YYYY-MM) for a bookkeeping work item.
// Prefers `period_start` (the canonical month a recurring engagement is
// for) and falls back to `due_date` for the rare item where Karbon
// didn't populate period_start.
function workItemPeriodMonthKey(item: KarbonWorkItem): string | null {
  const raw = item.period_start || item.due_date || item.DueDate || null
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return monthKey(d)
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// Returns true when an engagement is past its due date AND not yet
// complete. Used to flag at-risk rows in the dashboard.
function isOverdue(item: KarbonWorkItem): boolean {
  const status = bucketStatus(item)
  if (status === "Complete") return false
  const raw = item.due_date || item.DueDate
  if (!raw) return false
  const due = new Date(raw)
  if (Number.isNaN(due.getTime())) return false
  // Midnight-of-today comparison so an item "due today" isn't flagged.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

// Filters a list of ACCT work items down to the Monthly Bookkeeping
// service. Mirrors the same predicate the unified checklist tab uses
// in project-plan-checklist.tsx, so the dashboard and the checklist
// agree on the bookkeeping population.
function filterBookkeeping(items: KarbonWorkItem[]): KarbonWorkItem[] {
  return items.filter((it) => {
    const wt = (it.work_type || it.WorkType || "").toLowerCase()
    const title = (it.title || it.Title || "").toLowerCase()
    return wt.includes("bookkeeping") || title.startsWith("bkpg |")
  })
}

const summaryFetcher = async ([_url, ids]: [string, string[]]): Promise<{
  summaries: SummaryMap
}> => {
  const res = await fetch("/api/accounting/bookkeeping-checklist/summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  }
  return res.json()
}

// ── Component ────────────────────────────────────────────────────────────

export function BookkeepingDashboard() {
  const {
    activeWorkItems,
    allWorkItems,
    isLoading: itemsLoading,
    error,
    refresh,
  } = useAccountingWorkItems()

  const [selectedMonth, setSelectedMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [search, setSearch] = useState("")
  const [filterLead, setFilterLead] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Which engagement is currently expanded (showing its inline 10-step
  // checklist). Single-open semantics keep vertical scroll manageable.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Scope to bookkeeping. We compute two populations:
  //  - `bookkeepingActive`: powers the month selector + KPIs + table
  //  - `bookkeepingAll`:    powers the FY coverage matrix (which needs
  //                          even completed rows to draw checkmarks).
  const bookkeepingActive = useMemo(() => filterBookkeeping(activeWorkItems), [activeWorkItems])
  const bookkeepingAll = useMemo(() => filterBookkeeping(allWorkItems), [allWorkItems])

  // The unfiltered pool feeds the lead dropdown so it doesn't churn as
  // you navigate months.
  const uniqueLeads = useMemo(() => {
    const set = new Set<string>()
    for (const it of bookkeepingActive) {
      const name = it.assignee_name || it.AssigneeName || ""
      if (name) set.add(name)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [bookkeepingActive])

  // The list of engagements for the currently-selected month, after
  // applying lead / status / search filters. This is what the table
  // renders + what the per-engagement summary call asks about.
  const monthKeyStr = monthKey(selectedMonth)
  const monthlyEngagements = useMemo(() => {
    return bookkeepingActive
      .filter((it) => workItemPeriodMonthKey(it) === monthKeyStr)
      .sort((a, b) => {
        // Sort: overdue first, then by due date asc, then by client.
        const aOver = isOverdue(a) ? 0 : 1
        const bOver = isOverdue(b) ? 0 : 1
        if (aOver !== bOver) return aOver - bOver
        const ad = new Date(a.due_date || a.DueDate || "9999-12-31").getTime()
        const bd = new Date(b.due_date || b.DueDate || "9999-12-31").getTime()
        if (ad !== bd) return ad - bd
        return getClientLabel(a).localeCompare(getClientLabel(b))
      })
  }, [bookkeepingActive, monthKeyStr])

  const filteredEngagements = useMemo(() => {
    const q = search.trim().toLowerCase()
    return monthlyEngagements.filter((item) => {
      if (filterLead !== "all") {
        const name = item.assignee_name || item.AssigneeName || ""
        if (name !== filterLead) return false
      }
      if (filterStatus !== "all" && bucketStatus(item) !== filterStatus) return false
      if (!q) return true
      const haystack = [
        item.title || item.Title,
        item.client_name || item.ClientName,
        item.assignee_name || item.AssigneeName,
        item.karbon_work_item_key || item.WorkKey,
        item.workflow_status || item.WorkStatus,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [monthlyEngagements, filterLead, filterStatus, search])

  // Bulk fetch checklist summaries for the currently-rendered rows.
  // Keyed on the unfiltered monthly list so navigating filters doesn't
  // re-fire the request unnecessarily.
  const summaryIds = useMemo(
    () => monthlyEngagements.map((i) => i.id || i.karbon_work_item_key).filter((v): v is string => !!v),
    [monthlyEngagements],
  )
  const summaryKey =
    summaryIds.length > 0 ? (["bookkeeping-summary", summaryIds] as const) : null
  const { data: summaryData, mutate: refreshSummary } = useSWR(summaryKey, summaryFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  const summaries: SummaryMap = summaryData?.summaries ?? {}

  // ── KPIs (scoped to the selected month) ───────────────────────────────

  const kpis = useMemo(() => {
    const total = monthlyEngagements.length
    const distinctClients = new Set(monthlyEngagements.map(getClientLabel)).size
    const overdue = monthlyEngagements.filter(isOverdue).length
    const waiting = monthlyEngagements.filter((i) => bucketStatus(i) === "Waiting").length

    // Compute average checklist completion across the month.
    const visibleIds = monthlyEngagements
      .map((i) => i.id || i.karbon_work_item_key)
      .filter((v): v is string => !!v)
    let totalSteps = 0
    let completedSteps = 0
    let fullyDone = 0
    for (const id of visibleIds) {
      const s = summaries[id]
      const completed = s?.completed ?? 0
      totalSteps += 10
      completedSteps += completed
      if (completed >= 10) fullyDone += 1
    }
    const avgCompletionPct = totalSteps === 0 ? 0 : (completedSteps / totalSteps) * 100

    return {
      total,
      distinctClients,
      overdue,
      waiting,
      atRisk: overdue + waiting,
      avgCompletionPct,
      fullyDone,
    }
  }, [monthlyEngagements, summaries])

  // ── Breakdown panels ──────────────────────────────────────────────────

  const statusBreakdown = useMemo(() => {
    const counts: Record<StatusBucket, number> = {
      "Not Started": 0,
      "To Do": 0,
      "In Progress": 0,
      Waiting: 0,
      Complete: 0,
    }
    for (const item of monthlyEngagements) {
      counts[bucketStatus(item)] += 1
    }
    return counts
  }, [monthlyEngagements])

  const leadWorkload = useMemo(() => {
    const map = new Map<string, { total: number; complete: number; atRisk: number }>()
    for (const item of monthlyEngagements) {
      const name = getAssigneeLabel(item)
      const entry = map.get(name) ?? { total: 0, complete: 0, atRisk: 0 }
      entry.total += 1
      if (bucketStatus(item) === "Complete") entry.complete += 1
      if (isOverdue(item) || bucketStatus(item) === "Waiting") entry.atRisk += 1
      map.set(name, entry)
    }
    return Array.from(map.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.total - a.total)
  }, [monthlyEngagements])

  const atRiskItems = useMemo(
    () =>
      monthlyEngagements
        .filter((i) => isOverdue(i) || bucketStatus(i) === "Waiting")
        .slice(0, 12),
    [monthlyEngagements],
  )

  // ── FY coverage matrix (clients × months in the selected fiscal year) ─

  const fyYear = selectedMonth.getFullYear()
  const coverageMatrix = useMemo(() => {
    // Clients with at least one bookkeeping engagement in `fyYear`.
    // We pull from `bookkeepingAll` so completed/cancelled engagements
    // still draw a checkmark (otherwise prior-month rows would vanish
    // the moment Karbon flips them to "Completed").
    type Cell = {
      status: StatusBucket | null
      overdue: boolean
      workItemId: string | null
    }
    const clientToRow = new Map<string, Cell[]>()

    for (const item of bookkeepingAll) {
      const period = item.period_start || item.due_date || item.DueDate
      if (!period) continue
      const d = new Date(period)
      if (Number.isNaN(d.getTime())) continue
      if (d.getFullYear() !== fyYear) continue
      const monthIdx = d.getMonth()
      const client = getClientLabel(item)
      const row =
        clientToRow.get(client) ??
        (Array.from({ length: 12 }, () => ({
          status: null,
          overdue: false,
          workItemId: null,
        })) as Cell[])
      // If multiple engagements landed in the same client+month
      // (rare, but happens when a one-off bookkeeping clean-up is
      // logged), prefer the "most active" one. Priority order:
      // In Progress > Waiting > To Do > Not Started > Complete.
      const next: Cell = {
        status: bucketStatus(item),
        overdue: isOverdue(item),
        workItemId: item.id || item.karbon_work_item_key || null,
      }
      const prev = row[monthIdx]
      row[monthIdx] = pickHotter(prev, next)
      clientToRow.set(client, row)
    }

    return Array.from(clientToRow.entries())
      .map(([client, row]) => ({ client, row }))
      .sort((a, b) => a.client.localeCompare(b.client))
  }, [bookkeepingAll, fyYear])

  // ── Month navigation ──────────────────────────────────────────────────

  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return (
      selectedMonth.getMonth() === now.getMonth() &&
      selectedMonth.getFullYear() === now.getFullYear()
    )
  }, [selectedMonth])

  function goToPreviousMonth() {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    setExpandedId(null)
  }
  function goToNextMonth() {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
    setExpandedId(null)
  }
  function goToCurrentMonth() {
    setSelectedMonth(startOfMonth(new Date()))
    setExpandedId(null)
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      await Promise.all([refresh(), refreshSummary()])
    } finally {
      setIsRefreshing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (error && !bookkeepingActive.length) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-rose-700">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm">{error}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toolbar: month navigator + filters + refresh */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={goToPreviousMonth}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold tabular-nums">
                  {formatMonthYear(selectedMonth)}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={goToNextMonth}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isCurrentMonth ? (
                <Button variant="ghost" size="sm" onClick={goToCurrentMonth}>
                  Today
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
                {kpis.total} engagement{kpis.total === 1 ? "" : "s"} in{" "}
                {formatMonthYear(selectedMonth)}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || itemsLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1.5 ${
                    isRefreshing || itemsLoading ? "animate-spin" : ""
                  }`}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client, work key, status…"
                className="pl-9"
              />
            </div>
            <Select value={filterLead} onValueChange={setFilterLead}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by lead" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Leads</SelectItem>
                {uniqueLeads.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by Karbon status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_BUCKETS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile
          icon={<ClipboardList className="h-4 w-4" />}
          label="Engagements"
          value={kpis.total}
          subline={`${formatMonthYear(selectedMonth)}`}
        />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          label="Distinct Clients"
          value={kpis.distinctClients}
          subline="With a bookkeeping item this month"
        />
        <KpiTile
          icon={<BarChart3 className="h-4 w-4" />}
          label="Avg Checklist Completion"
          value={`${kpis.avgCompletionPct.toFixed(0)}%`}
          subline={`${kpis.fullyDone} fully completed`}
          tone="emerald"
        />
        <KpiTile
          icon={<AlertTriangle className="h-4 w-4" />}
          label="At Risk"
          value={kpis.atRisk}
          subline={`${kpis.overdue} overdue · ${kpis.waiting} waiting`}
          tone={kpis.atRisk > 0 ? "rose" : "default"}
        />
      </div>

      {/* Breakdown row: status + lead workload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpandableCard
          title={`Status — ${formatMonthYear(selectedMonth)}`}
          description="Karbon workflow buckets for bookkeeping engagements this month"
          icon={<BarChart3 className="h-5 w-5 text-amber-600" />}
        >
          <div className="space-y-3">
            {STATUS_BUCKETS.map((status) => {
              const count = statusBreakdown[status]
              const tone = STATUS_COLORS[status]
              const pct = kpis.total === 0 ? 0 : (count / kpis.total) * 100
              const active = filterStatus === status
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() =>
                    setFilterStatus(active ? "all" : status)
                  }
                  className={`w-full text-left space-y-1.5 rounded-md p-2 -mx-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    active ? "bg-muted/80" : "hover:bg-muted/60"
                  }`}
                  aria-label={`Filter engagements by ${status} (${count})`}
                  aria-pressed={active}
                >
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                      <span className="font-medium">{status}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{count}</span>
                      <span className="text-xs">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                </button>
              )
            })}
          </div>
        </ExpandableCard>

        <ExpandableCard
          title={`Lead Workload — ${formatMonthYear(selectedMonth)}`}
          description="Active bookkeeping engagements assigned to each preparer / reviewer"
          icon={<UsersRound className="h-5 w-5 text-emerald-600" />}
        >
          {leadWorkload.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No engagements assigned this month.
            </p>
          ) : (
            <div className="space-y-3">
              {leadWorkload.map((lead) => {
                const completePct =
                  lead.total === 0 ? 0 : (lead.complete / lead.total) * 100
                const active = filterLead === lead.name
                return (
                  <button
                    key={lead.name}
                    type="button"
                    onClick={() =>
                      setFilterLead(active ? "all" : lead.name)
                    }
                    className={`w-full text-left space-y-1 rounded-md p-2 -mx-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      active ? "bg-muted/80" : "hover:bg-muted/60"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate">{lead.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {lead.complete}/{lead.total} complete
                      </span>
                    </div>
                    <Progress value={completePct} className="h-1.5" />
                    {lead.atRisk > 0 ? (
                      <div className="text-xs text-rose-700">
                        {lead.atRisk} at risk (overdue or waiting on client)
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </ExpandableCard>
      </div>

      {/* FY coverage matrix */}
      <ExpandableCard
        title={`${fyYear} Coverage Matrix`}
        description="Every client with a bookkeeping engagement this year, by month — colored by Karbon workflow status"
        icon={<Calendar className="h-5 w-5 text-blue-600" />}
      >
        {coverageMatrix.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bookkeeping engagements found for {fyYear}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium sticky left-0 bg-background z-10">
                    Client
                  </th>
                  {MONTH_LABELS.map((m, idx) => {
                    const isSelected = idx === selectedMonth.getMonth()
                    return (
                      <th
                        key={m}
                        className={`px-1 py-2 text-center font-medium ${
                          isSelected ? "text-foreground" : ""
                        }`}
                      >
                        {m}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {coverageMatrix.map(({ client, row }) => (
                  <tr key={client} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-1.5 pr-3 font-medium truncate max-w-[220px] sticky left-0 bg-background z-10">
                      {client}
                    </td>
                    {row.map((cell, idx) => {
                      const isSelectedColumn = idx === selectedMonth.getMonth()
                      return (
                        <td
                          key={idx}
                          className={`px-1 py-1.5 text-center ${
                            isSelectedColumn ? "bg-muted/40" : ""
                          }`}
                        >
                          <CoverageCell
                            cell={cell}
                            onJump={() =>
                              setSelectedMonth(new Date(fyYear, idx, 1))
                            }
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <CoverageLegend />
          </div>
        )}
      </ExpandableCard>

      {/* Engagement list with inline checklist drawer */}
      <ExpandableCard
        title={`Engagements — ${formatMonthYear(selectedMonth)}`}
        description={`${filteredEngagements.length} of ${kpis.total} shown · click a row to open its 10-step checklist`}
        icon={<ClipboardList className="h-5 w-5 text-blue-600" />}
      >
        {itemsLoading && filteredEngagements.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
            Loading bookkeeping engagements from Karbon…
          </div>
        ) : filteredEngagements.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
            <p>No bookkeeping engagements match the current filters.</p>
            <p className="text-xs mt-1">Try clearing filters or moving to a different month.</p>
          </div>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {filteredEngagements.map((item) => {
              const id = item.id || item.karbon_work_item_key || ""
              const summary = summaries[id]
              const completed = summary?.completed ?? 0
              const status = bucketStatus(item)
              const tone = STATUS_COLORS[status]
              const overdue = isOverdue(item)
              const isExpanded = expandedId === id
              return (
                <li key={id}>
                  <Collapsible
                    open={isExpanded}
                    onOpenChange={(open) => setExpandedId(open ? id : null)}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="w-full text-left p-3 hover:bg-muted/40 transition-colors focus:outline-none focus-visible:bg-muted/60"
                        aria-expanded={isExpanded}
                      >
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-12 md:col-span-4 min-w-0">
                            <div className="flex items-center gap-2">
                              <ChevronDown
                                className={`h-4 w-4 text-muted-foreground transition-transform ${
                                  isExpanded ? "" : "-rotate-90"
                                }`}
                              />
                              <p className="text-sm font-medium truncate">
                                {getClientLabel(item)}
                              </p>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1 pl-6">
                              {item.title || item.Title}
                            </p>
                          </div>
                          <div className="col-span-6 md:col-span-2 flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${tone.bg} ${tone.text} ${tone.border}`}
                            >
                              <span
                                className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${tone.dot}`}
                              />
                              {status}
                            </Badge>
                            {overdue ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                              >
                                Overdue
                              </Badge>
                            ) : null}
                          </div>
                          <div className="col-span-6 md:col-span-2 text-xs text-muted-foreground truncate">
                            {getAssigneeLabel(item)}
                          </div>
                          <div className="col-span-6 md:col-span-2 text-xs text-muted-foreground tabular-nums">
                            Due {formatShortDate(item.due_date || item.DueDate)}
                          </div>
                          <div className="col-span-6 md:col-span-2 flex items-center gap-2">
                            <Progress value={(completed / 10) * 100} className="h-1.5 flex-1" />
                            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                              {completed}/10
                            </span>
                            {item.karbon_url ? (
                              <Link
                                href={item.karbon_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground hover:text-blue-600 transition-colors"
                                aria-label="Open in Karbon"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-4 pt-1 bg-muted/20">
                        <ChecklistForWorkItem item={item} />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              )
            })}
          </ul>
        )}
      </ExpandableCard>

      {/* At-risk panel */}
      <ExpandableCard
        title={`At Risk — ${formatMonthYear(selectedMonth)}`}
        description="Engagements past due or currently waiting on client / blocked — clear these first"
        icon={<AlertTriangle className="h-5 w-5 text-rose-600" />}
      >
        {atRiskItems.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500/70" />
            <p>Nothing at risk in {formatMonthYear(selectedMonth)}.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {atRiskItems.map((item) => {
              const id = item.id || item.karbon_work_item_key || ""
              const summary = summaries[id]
              const completed = summary?.completed ?? 0
              const status = bucketStatus(item)
              const tone = STATUS_COLORS[status]
              const overdue = isOverdue(item)
              return (
                <li key={id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{getClientLabel(item)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.title || item.Title} · {getAssigneeLabel(item)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${tone.bg} ${tone.text} ${tone.border}`}
                    >
                      {status}
                    </Badge>
                    {overdue ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                      >
                        Overdue
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {completed}/10
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(id)}
                    >
                      Open checklist
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </ExpandableCard>
    </div>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────────

function KpiTile({
  icon,
  label,
  value,
  subline,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  subline?: string
  tone?: "default" | "emerald" | "rose"
}) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
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
        <p className="text-3xl font-semibold tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {subline ? <p className="text-xs text-muted-foreground mt-1">{subline}</p> : null}
      </CardContent>
    </Card>
  )
}

function CoverageCell({
  cell,
  onJump,
}: {
  cell: { status: StatusBucket | null; overdue: boolean; workItemId: string | null }
  onJump: () => void
}) {
  if (!cell.status) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted" aria-hidden />
  }
  const tone = STATUS_COLORS[cell.status]
  const label = cell.overdue ? `${cell.status} (overdue)` : cell.status
  return (
    <button
      type="button"
      onClick={onJump}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center h-5 w-5 rounded-full border ${tone.border} ${tone.bg} hover:scale-110 transition-transform`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} aria-hidden />
    </button>
  )
}

function CoverageLegend() {
  return (
    <div className="flex items-center gap-3 flex-wrap pt-3 text-xs text-muted-foreground">
      {STATUS_BUCKETS.map((s) => {
        const tone = STATUS_COLORS[s]
        return (
          <div key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone.dot}`} />
            <span>{s}</span>
          </div>
        )
      })}
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted" />
        <span>No engagement</span>
      </div>
    </div>
  )
}

// Pick the "hotter" status for the FY coverage matrix when a client has
// more than one bookkeeping engagement in the same month. We weight
// active/at-risk states higher than terminal ones so the cell flags the
// work that still needs attention.
function pickHotter(
  a: { status: StatusBucket | null; overdue: boolean; workItemId: string | null },
  b: { status: StatusBucket | null; overdue: boolean; workItemId: string | null },
) {
  const rank: Record<StatusBucket, number> = {
    "In Progress": 5,
    Waiting: 4,
    "To Do": 3,
    "Not Started": 2,
    Complete: 1,
  }
  const aRank = a.status ? rank[a.status] : 0
  const bRank = b.status ? rank[b.status] : 0
  const winner = bRank > aRank ? b : a
  // Preserve overdue flag if either was overdue.
  return { ...winner, overdue: a.overdue || b.overdue }
}
