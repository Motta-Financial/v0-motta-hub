"use client"

/**
 * Departments → Accounting → Onboarding (the page mounted at
 * /onboarding via app/onboarding/page.tsx).
 *
 * This is a thin client renderer over /api/departments/accounting/onboarding
 * — the API does the heavy lifting (joining work items to Ignition
 * proposals, computing summary rollups, etc.) and we just paint the
 * result. SWR keeps the data fresh on tab focus and filter changes.
 */

import useSWR from "swr"
import Link from "next/link"
import { useMemo, useState } from "react"
import {
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Filter as FilterIcon,
  Search,
  Sparkles,
  TrendingUp,
  User,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface ProposalLink {
  proposal_id: string
  proposal_number: string | null
  title: string | null
  status: string | null
  total_value: number | null
  recurring_total: number | null
  one_time_total: number | null
  signed_url: string | null
  accepted_at: string | null
  completed_at: string | null
  sent_at: string | null
  client_name: string | null
}

interface OnboardingWorkItem {
  id: string
  karbon_work_item_key: string
  title: string
  description: string | null
  work_type: string
  phase: "BKPG" | "PYRL" | "QBO" | "OTHER"
  status: string
  workflow_status: string | null
  primary_status: string | null
  secondary_status: string | null
  priority: string | null
  start_date: string | null
  due_date: string | null
  completed_date: string | null
  period_start: string | null
  period_end: string | null
  tax_year: number | null
  client_type: string | null
  client_name: string
  client_group_name: string | null
  assignee_name: string | null
  manager_name: string | null
  partner_name: string | null
  owner_name: string | null
  todo_count: number
  completed_todo_count: number
  todo_progress: number | null
  has_blocking_todos: boolean
  fee_type: string | null
  fixed_fee_amount: number | null
  estimated_fee: number | null
  actual_fee: number | null
  budget_hours: number | null
  actual_hours: number | null
  karbon_url: string | null
  karbon_modified_at: string | null
  karbon_created_at: string | null
  days_until_due: number | null
  is_overdue: boolean
  proposals: ProposalLink[]
}

interface OnboardingResponse {
  workItems: OnboardingWorkItem[]
  summary: {
    total: number
    totalUnfiltered: number
    byStatus: Record<string, number>
    byPhase: Record<string, number>
    overdueCount: number
    withProposalCount: number
    estimatedFeeTotal: number
    actualFeeTotal: number
  }
  dimensions: {
    statuses: string[]
    phases: string[]
    assignees: string[]
  }
}

const PHASE_LABEL: Record<OnboardingWorkItem["phase"], string> = {
  BKPG: "Bookkeeping",
  PYRL: "Payroll",
  QBO: "QuickBooks Setup",
  OTHER: "Other",
}

// We intentionally route every phase through the same neutral surface +
// accent palette so the page reads as one consolidated workspace. Phase
// is communicated with a small icon + monospace tag instead of a
// rainbow of card colours, which scales better when more variants get
// added by Karbon.
const PHASE_ICON: Record<OnboardingWorkItem["phase"], string> = {
  BKPG: "BK",
  PYRL: "PY",
  QBO: "QB",
  OTHER: "··",
}

/**
 * Map a Karbon status string to one of the five canonical lifecycle
 * states the design uses. We try several lower-cased substrings rather
 * than enumerating every Karbon status because firm administrators
 * regularly add new ones; substrings keep the UI working without code
 * changes.
 */
function statusBucket(s: string): "completed" | "in-progress" | "ready" | "waiting" | "other" {
  const l = (s || "").toLowerCase()
  if (l.includes("complete")) return "completed"
  if (l.includes("progress")) return "in-progress"
  if (l.includes("ready")) return "ready"
  if (l.includes("wait") || l.includes("hold") || l.includes("blocked"))
    return "waiting"
  return "other"
}

const STATUS_STYLES: Record<ReturnType<typeof statusBucket>, string> = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "in-progress": "border-blue-200 bg-blue-50 text-blue-700",
  ready: "border-amber-200 bg-amber-50 text-amber-700",
  waiting: "border-slate-200 bg-slate-50 text-slate-700",
  other: "border-slate-200 bg-slate-50 text-slate-700",
}

function fetcher<T = unknown>(url: string): Promise<T> {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Request failed: ${r.status}`)
    return r.json() as Promise<T>
  })
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return null
  const v = Number(n)
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
}

function fmtDate(d: string | null) {
  if (!d) return null
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function initials(name: string | null | undefined) {
  if (!name) return "··"
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

export function OnboardingTracker() {
  // URL-state-free local filters. The dataset is small (<200 items) so a
  // pure client-side filter on top of a single fetched payload is far
  // simpler than round-tripping every chip change.
  const [search, setSearch] = useState("")
  const [phase, setPhase] = useState<string>("all")
  const [status, setStatus] = useState<string>("all")
  const [assignee, setAssignee] = useState<string>("all")
  const [includeCompleted, setIncludeCompleted] = useState(false)

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (includeCompleted) params.set("includeCompleted", "true")
    return `/api/departments/accounting/onboarding${
      params.toString() ? `?${params.toString()}` : ""
    }`
  }, [includeCompleted])

  const { data, error, isLoading, mutate } = useSWR<OnboardingResponse>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: true, keepPreviousData: true },
  )

  const filteredWorkItems = useMemo(() => {
    if (!data?.workItems) return []
    const s = search.trim().toLowerCase()
    return data.workItems.filter((w) => {
      if (phase !== "all" && w.phase !== phase) return false
      if (status !== "all" && w.status.toLowerCase() !== status.toLowerCase())
        return false
      if (
        assignee !== "all" &&
        (w.assignee_name || "").toLowerCase() !== assignee.toLowerCase()
      ) {
        return false
      }
      if (s) {
        const hay = [
          w.title,
          w.client_name,
          w.client_group_name,
          w.assignee_name,
          w.manager_name,
          w.partner_name,
          w.karbon_work_item_key,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [data, search, phase, status, assignee])

  const summary = data?.summary
  const totalShown = filteredWorkItems.length
  const totalAvailable = data?.workItems.length ?? 0

  return (
    <div className="space-y-6">
      {/* ───────── Header ───────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Departments</span>
            <span aria-hidden>/</span>
            <span>Accounting</span>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">Onboarding</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Accounting Onboarding
          </h1>
          <p className="text-muted-foreground max-w-2xl text-pretty">
            Live view of every Karbon work item under the{" "}
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">
              ACCT | Onboarding
            </span>{" "}
            umbrella — bookkeeping, payroll, and QuickBooks setups — joined
            to their matching Ignition proposals.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* ───────── Stats grid ───────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active engagements"
          value={summary?.total ?? 0}
          hint={
            includeCompleted
              ? "All onboarding work items"
              : "Excludes completed / cancelled"
          }
          icon={<UserPlus className="h-4 w-4" />}
        />
        <StatCard
          label="In progress"
          value={
            (summary?.byStatus["In Progress"] ?? 0) +
            (summary?.byStatus["in progress"] ?? 0)
          }
          hint="Karbon status: In Progress"
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Overdue"
          value={summary?.overdueCount ?? 0}
          hint="Past due, not yet completed"
          icon={<XCircle className="h-4 w-4" />}
          tone={summary?.overdueCount ? "warn" : "muted"}
        />
        <StatCard
          label="Linked to proposal"
          value={summary?.withProposalCount ?? 0}
          hint="Has a matching Ignition proposal"
          icon={<Sparkles className="h-4 w-4" />}
        />
      </div>

      {/* ───────── Phase breakdown ───────── */}
      {summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              By phase
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {(Object.keys(PHASE_LABEL) as Array<keyof typeof PHASE_LABEL>).map(
              (k) => {
                const n = summary.byPhase[k] ?? 0
                if (!n && k === "OTHER") return null
                return (
                  <button
                    key={k}
                    onClick={() => setPhase(phase === k ? "all" : k)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors",
                      phase === k
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {PHASE_ICON[k]}
                    </span>
                    <span className="font-medium">{PHASE_LABEL[k]}</span>
                    <span className="text-muted-foreground">{n}</span>
                  </button>
                )
              },
            )}
            {phase !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => setPhase("all")}>
                Clear
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ───────── Filter bar ───────── */}
      <Card>
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, client, assignee, work key…"
              className="pl-10"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-44">
              <FilterIcon className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(data?.dimensions.statuses ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="w-full sm:w-52">
              <User className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              {(data?.dimensions.assignees ?? []).map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm shrink-0 px-2 py-1.5 rounded-md border bg-background">
            <Switch
              checked={includeCompleted}
              onCheckedChange={setIncludeCompleted}
              aria-label="Include completed"
            />
            <span className="text-muted-foreground">Show completed</span>
          </label>
        </CardContent>
      </Card>

      {/* ───────── Result count ───────── */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          Showing <span className="font-medium text-foreground">{totalShown}</span>{" "}
          of{" "}
          <span className="font-medium text-foreground">{totalAvailable}</span>{" "}
          work items
          {!includeCompleted && (
            <span className="ml-2">
              · completed/cancelled hidden
            </span>
          )}
        </p>
        {error && <p className="text-destructive">Failed to load: {String(error)}</p>}
      </div>

      {/* ───────── Work item list ───────── */}
      {isLoading && !data ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Loading onboarding work items from Karbon…
          </CardContent>
        </Card>
      ) : totalShown === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            No onboarding work items match your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredWorkItems.map((w) => (
            <WorkItemCard key={w.id} workItem={w} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Cards ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string
  value: number
  hint?: string
  icon?: React.ReactNode
  tone?: "default" | "warn" | "muted"
}) {
  return (
    <Card
      className={cn(
        tone === "warn" &&
          value > 0 &&
          "border-amber-200 bg-amber-50/40",
      )}
    >
      <CardContent className="p-4 flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold mt-1">{value.toLocaleString()}</p>
          {hint && (
            <p className="text-xs text-muted-foreground mt-1">{hint}</p>
          )}
        </div>
        {icon && (
          <div className="h-8 w-8 rounded-md bg-muted text-muted-foreground flex items-center justify-center">
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function WorkItemCard({ workItem: w }: { workItem: OnboardingWorkItem }) {
  const bucket = statusBucket(w.status)
  const dueDate = fmtDate(w.due_date)
  const startDate = fmtDate(w.start_date)
  const completedDate = fmtDate(w.completed_date)
  const periodStart = fmtDate(w.period_start)
  const periodEnd = fmtDate(w.period_end)
  const estFee = fmtMoney(w.estimated_fee ?? w.fixed_fee_amount)
  const actFee = fmtMoney(w.actual_fee)
  const totalProposalValue = w.proposals.reduce(
    (sum, p) => sum + Number(p.total_value || 0),
    0,
  )

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Header row: title + key + open-in-Karbon */}
        <div className="flex items-start gap-4 p-5 pb-3">
          <div className="shrink-0 h-10 w-10 rounded-md border bg-muted/50 flex items-center justify-center">
            {w.client_type === "Organization" ? (
              <Building2 className="h-5 w-5 text-muted-foreground" />
            ) : (
              <User className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2">
              <h3 className="font-semibold text-base text-balance">
                {w.client_name}
              </h3>
              <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {PHASE_ICON[w.phase]}
              </span>
              <Badge
                variant="outline"
                className={cn("text-xs", STATUS_STYLES[bucket])}
              >
                {w.status}
              </Badge>
              {w.is_overdue && (
                <Badge
                  variant="outline"
                  className="text-xs border-red-200 bg-red-50 text-red-700"
                >
                  Overdue
                </Badge>
              )}
              {w.has_blocking_todos && (
                <Badge
                  variant="outline"
                  className="text-xs border-orange-200 bg-orange-50 text-orange-700"
                >
                  Blocked
                </Badge>
              )}
              {w.priority && w.priority.toLowerCase() !== "normal" && (
                <Badge variant="outline" className="text-xs">
                  {w.priority}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {w.title}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-mono">{w.karbon_work_item_key}</span>
              {w.work_type && (
                <>
                  <span className="mx-1.5">·</span>
                  <span>{w.work_type}</span>
                </>
              )}
            </p>
          </div>
          {w.karbon_url && (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a href={w.karbon_url} target="_blank" rel="noopener noreferrer">
                Open in Karbon <ExternalLink className="h-3 w-3 ml-1.5" />
              </a>
            </Button>
          )}
        </div>

        {/* Detail grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-5 pb-4 border-t pt-4">
          {/* People */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Team
            </p>
            <PersonRow label="Assignee" name={w.assignee_name} />
            <PersonRow label="Manager" name={w.manager_name} />
            <PersonRow label="Partner" name={w.partner_name} />
          </div>

          {/* Dates */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Schedule
            </p>
            <DateRow label="Start" value={startDate} />
            <DateRow
              label="Due"
              value={dueDate}
              tone={
                w.is_overdue
                  ? "warn"
                  : typeof w.days_until_due === "number" &&
                      w.days_until_due >= 0 &&
                      w.days_until_due <= 7
                    ? "soon"
                    : "default"
              }
              suffix={
                typeof w.days_until_due === "number"
                  ? w.days_until_due < 0
                    ? `(${Math.abs(w.days_until_due)}d overdue)`
                    : w.days_until_due === 0
                      ? "(today)"
                      : `(in ${w.days_until_due}d)`
                  : null
              }
            />
            {completedDate ? (
              <DateRow label="Completed" value={completedDate} />
            ) : (
              <DateRow
                label="Period"
                value={
                  periodStart && periodEnd
                    ? `${periodStart} → ${periodEnd}`
                    : periodStart || periodEnd || null
                }
              />
            )}
          </div>

          {/* Progress + fees */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Progress &amp; fees
            </p>
            {w.todo_count > 0 ? (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">
                    Todos {w.completed_todo_count}/{w.todo_count}
                  </span>
                  <span className="font-medium">{w.todo_progress}%</span>
                </div>
                <Progress value={w.todo_progress ?? 0} className="h-1.5" />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No checklist todos</p>
            )}
            {(estFee || actFee) && (
              <div className="text-xs space-y-0.5">
                {estFee && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Estimated</span>
                    <span className="font-medium">{estFee}</span>
                  </div>
                )}
                {actFee && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Actual</span>
                    <span className="font-medium">{actFee}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Linked Ignition proposals */}
        {w.proposals.length > 0 && (
          <div className="border-t bg-muted/30 px-5 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Ignition proposals · {w.proposals.length}
              </p>
              {totalProposalValue > 0 && (
                <p className="text-xs text-muted-foreground">
                  Total value:{" "}
                  <span className="font-medium text-foreground">
                    {fmtMoney(totalProposalValue)}
                  </span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {w.proposals.map((p) => (
                <ProposalChip key={p.proposal_id} proposal={p} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PersonRow({
  label,
  name,
}: {
  label: string
  name: string | null | undefined
}) {
  if (!name)
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground/70">Unassigned</span>
      </div>
    )
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <Avatar className="h-5 w-5">
          <AvatarFallback className="text-[10px]">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium">{name}</span>
      </span>
    </div>
  )
}

function DateRow({
  label,
  value,
  tone = "default",
  suffix,
}: {
  label: string
  value: string | null
  tone?: "default" | "warn" | "soon"
  suffix?: string | null
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium",
          tone === "warn" && "text-red-600",
          tone === "soon" && "text-amber-700",
          !value && "text-muted-foreground/70 font-normal",
        )}
      >
        {value || "—"}
        {suffix && (
          <span className="ml-1 font-normal text-muted-foreground">
            {suffix}
          </span>
        )}
      </span>
    </div>
  )
}

function ProposalChip({ proposal }: { proposal: ProposalLink }) {
  const statusLower = (proposal.status || "").toLowerCase()
  const tone =
    statusLower === "accepted" || statusLower === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : statusLower === "lost" || statusLower === "cancelled" || statusLower === "revoked"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-blue-200 bg-blue-50 text-blue-700"
  const value = fmtMoney(proposal.total_value)
  // The Sales › Proposals page accepts a `q=` deep link for the
  // freeform search box, so clicking a proposal jumps straight to a
  // pre-filtered view of that single proposal number.
  const href = proposal.proposal_number
    ? `/sales/proposals?q=${encodeURIComponent(proposal.proposal_number)}`
    : "/sales/proposals"
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 bg-background hover:bg-muted/50 transition-colors group"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">
            {proposal.proposal_number || "Proposal"}
          </span>
          <Badge
            variant="outline"
            className={cn("text-[10px] capitalize", tone)}
          >
            {proposal.status || "—"}
          </Badge>
        </div>
        {proposal.title && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {proposal.title}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {value && <span className="text-xs font-medium">{value}</span>}
        {proposal.signed_url ? (
          <a
            href={proposal.signed_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Open proposal ${proposal.proposal_number} in Ignition`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </Link>
  )
}

// Re-export for legacy imports (some pages used a default-style import).
export default OnboardingTracker
