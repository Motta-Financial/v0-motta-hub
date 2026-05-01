"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Pause,
  FileText,
  Users,
  Calculator,
  RefreshCw,
  Briefcase,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"

interface DashboardOverviewProps {
  onNavigateToBookkeeping: () => void
  onNavigateToOnboarding: () => void
}

interface SupabaseWorkItem {
  id: string
  title: string | null
  status: string | null
  workflow_status: string | null
  work_type: string | null
  due_date: string | null
  period_start: string | null
}

// Karbon ships every accounting work item under one of these six work_type
// values. We render a breakdown card for each so the Overview tab covers the
// full "ACCT | %" universe — not just the Bookkeeping subset. Order matters:
// it controls the display order of the per-type breakdown.
const ACCT_WORK_TYPES: Array<{
  workType: string
  label: string
  icon: LucideIcon
  color: string
  bg: string
  border: string
}> = [
  {
    workType: "ACCT | Bookkeeping",
    label: "Bookkeeping",
    icon: FileText,
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  {
    workType: "ACCT | Payroll",
    label: "Payroll",
    icon: Receipt,
    color: "text-green-600",
    bg: "bg-green-50",
    border: "border-green-200",
  },
  {
    workType: "ACCT | 1099s",
    label: "1099s",
    icon: FileText,
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  {
    workType: "ACCT | FP&A",
    label: "FP&A",
    icon: TrendingUp,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
  },
  {
    workType: "ACCT | Onboarding (BKPG)",
    label: "Onboarding (BKPG)",
    icon: Users,
    color: "text-purple-600",
    bg: "bg-purple-50",
    border: "border-purple-200",
  },
  {
    workType: "ACCT | Onboarding (PYRL)",
    label: "Onboarding (PYRL)",
    icon: Briefcase,
    color: "text-pink-600",
    bg: "bg-pink-50",
    border: "border-pink-200",
  },
]

interface WorkTypeStats {
  workType: string
  total: number
  inProgress: number
  readyToStart: number
  planned: number
  waiting: number
  other: number
}

type StatusBucket = "inProgress" | "readyToStart" | "planned" | "waiting" | "other"

function bucketStatus(status: string | null | undefined): StatusBucket {
  const s = (status || "").toLowerCase()
  if (s.includes("progress")) return "inProgress"
  if (s.includes("ready")) return "readyToStart"
  if (s.includes("plan")) return "planned"
  if (s.includes("wait") || s.includes("hold") || s.includes("info")) return "waiting"
  return "other"
}

export function AccountingDashboardOverview({
  onNavigateToBookkeeping,
  onNavigateToOnboarding,
}: DashboardOverviewProps) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [allItems, setAllItems] = useState<SupabaseWorkItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchStats()
  }, [])

  const fetchStats = async () => {
    setRefreshing(true)
    try {
      // Pull ALL active ACCT | * work items in one request. The new
      // `workTypePrefix` filter on /api/supabase/work-items matches by
      // work_type column (Karbon's canonical categorization) — much more
      // accurate than the prior title-matching which missed Payroll, 1099s,
      // FP&A, and both onboarding subtypes.
      const response = await fetch(`/api/supabase/work-items?workTypePrefix=ACCT | &status=active`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      setAllItems(data.workItems || [])
      setError(null)
    } catch (err) {
      console.error("[v0] Error fetching accounting overview:", err)
      setError(err instanceof Error ? err.message : "Failed to load accounting data")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Build per-work_type stats. We compare case-insensitively because Karbon
  // occasionally varies casing on legacy rows.
  const statsByType: Record<string, WorkTypeStats> = {}
  for (const cfg of ACCT_WORK_TYPES) {
    statsByType[cfg.workType] = {
      workType: cfg.workType,
      total: 0,
      inProgress: 0,
      readyToStart: 0,
      planned: 0,
      waiting: 0,
      other: 0,
    }
  }
  for (const item of allItems) {
    const wt = (item.work_type || "").trim()
    const match = ACCT_WORK_TYPES.find((c) => c.workType.toLowerCase() === wt.toLowerCase())
    if (!match) continue
    const bucket = statsByType[match.workType]
    bucket.total += 1
    bucket[bucketStatus(item.status)] += 1
  }

  const totalCount = allItems.length
  const totalInProgress = allItems.filter((i) => bucketStatus(i.status) === "inProgress").length
  const totalReady = allItems.filter((i) => bucketStatus(i.status) === "readyToStart").length
  const totalWaiting = allItems.filter((i) => bucketStatus(i.status) === "waiting").length

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Loading accounting dashboard from Supabase...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top-level: every active ACCT | * work item */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calculator className="h-5 w-5 text-blue-600" />
                All Accounting Work
              </CardTitle>
              <CardDescription>
                {totalCount} active work item{totalCount === 1 ? "" : "s"} across all ACCT | * work types
              </CardDescription>
            </div>
            <Button onClick={fetchStats} variant="outline" size="sm" disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="inline h-4 w-4 mr-1" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryStat label="Total Active" value={totalCount} tone="default" />
            <SummaryStat label="In Progress" value={totalInProgress} tone="blue" icon={Clock} />
            <SummaryStat label="Ready to Start" value={totalReady} tone="green" icon={CheckCircle2} />
            <SummaryStat label="Waiting / Hold" value={totalWaiting} tone="amber" icon={Pause} />
          </div>

          <div>
            <p className="text-sm font-medium mb-3">Breakdown by Work Type</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ACCT_WORK_TYPES.map((cfg) => {
                const s = statsByType[cfg.workType]
                const Icon = cfg.icon
                const completionRate = s.total > 0 ? Math.round((s.inProgress / s.total) * 100) : 0
                return (
                  <div
                    key={cfg.workType}
                    className={`p-4 rounded-lg border ${cfg.border} ${cfg.bg} hover:shadow-sm transition-shadow`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                        <p className="font-medium text-sm">{cfg.label}</p>
                      </div>
                      <Badge variant="outline" className="bg-white">
                        {s.total}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <StatusPill label="In Progress" value={s.inProgress} />
                      <StatusPill label="Ready" value={s.readyToStart} />
                      <StatusPill label="Waiting" value={s.waiting + s.planned} />
                    </div>
                    {s.total > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>Active progress</span>
                          <span className="font-semibold">{completionRate}%</span>
                        </div>
                        <Progress value={completionRate} className="h-1.5" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drill-in cards: Monthly Bookkeeping */}
      <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onNavigateToBookkeeping}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Monthly Bookkeeping</CardTitle>
                <CardDescription>
                  {statsByType["ACCT | Bookkeeping"]?.total || 0} active ACCT | Bookkeeping work items
                </CardDescription>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full bg-transparent" onClick={onNavigateToBookkeeping}>
            View Full Tracker
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>

      {/* Drill-in cards: Onboarding (covers BKPG + PYRL) */}
      <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onNavigateToOnboarding}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Onboarding Clients</CardTitle>
                <CardDescription>
                  {(statsByType["ACCT | Onboarding (BKPG)"]?.total || 0) +
                    (statsByType["ACCT | Onboarding (PYRL)"]?.total || 0)}{" "}
                  active ACCT | Onboarding work items (Bookkeeping + Payroll)
                </CardDescription>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full bg-transparent" onClick={onNavigateToOnboarding}>
            View Full Tracker
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ----- presentation helpers -----

function SummaryStat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string
  value: number
  tone: "default" | "blue" | "green" | "amber"
  icon?: LucideIcon
}) {
  const toneClass = {
    default: "bg-muted/50 text-foreground",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
  }[tone]
  return (
    <div className={`text-center p-3 rounded-lg ${toneClass}`}>
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

function StatusPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/60 rounded px-2 py-1 text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

