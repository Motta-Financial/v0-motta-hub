"use client"

import { useMemo, useState } from "react"
import useSWR, { mutate } from "swr"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { ExpandableCard } from "@/components/ui/expandable-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type KarbonWorkItem } from "@/contexts/karbon-work-items-context"
import {
  BOOKKEEPING_CHECKLIST,
  bucketStatus,
  formatShortDate,
  getAssigneeLabel,
  getClientLabel,
  STATUS_BUCKETS,
  STATUS_COLORS,
  useAccountingWorkItems,
  type StatusBucket,
} from "./project-plan-shared"
import {
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react"

interface ProgressRow {
  step_number: number
  is_complete: boolean
  completed_at: string | null
  completed_by_name: string | null
  notes: string | null
  updated_at: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
}

// Returns the YYYY-MM key for the given date in UTC. We compare period_start
// strings (which Karbon emits as ISO dates) against this key so the month
// filter is robust to timezone drift.
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function workItemPeriodMonthKey(item: KarbonWorkItem): string | null {
  // Prefer `period_start` (the canonical column on the Supabase mirror),
  // then fall back to `due_date` for legacy rows where Karbon didn't
  // populate a period. Bookkeeping items overwhelmingly have a
  // period_start so the fallback is rare.
  const raw = item.period_start || item.due_date || item.DueDate || null
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return monthKey(d)
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

// The Monthly Bookkeeping tab. Unifies what used to be two separate
// components — the per-engagement 10-step checklist (Supabase-backed,
// persisted in `bookkeeping_checklist_progress`) and the standalone
// monthly tracker (which had a month navigator + lead/status filters but
// only persisted to localStorage). Both views now share a single
// Karbon-synced data source via useAccountingWorkItems() and the same
// per-step progress API at /api/accounting/bookkeeping-checklist/:id.
export function ProjectPlanChecklist() {
  // ACCT-scoped items — useAccountingWorkItems filters to canonical ACCT
  // work_types. We narrow further here to the bookkeeping sub-type.
  const { activeWorkItems, isLoading: itemsLoading, refresh } = useAccountingWorkItems()
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [filterAssignee, setFilterAssignee] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [isRefreshing, setIsRefreshing] = useState(false)

  const bookkeepingItems = useMemo(() => {
    return activeWorkItems
      .filter((item) => {
        const wt = (item.work_type || item.WorkType || "").toLowerCase()
        const title = (item.title || item.Title || "").toLowerCase()
        return wt.includes("bookkeeping") || title.startsWith("bkpg |")
      })
      .sort((a, b) => {
        const ad = new Date(a.due_date || a.DueDate || "9999-12-31").getTime()
        const bd = new Date(b.due_date || b.DueDate || "9999-12-31").getTime()
        return ad - bd
      })
  }, [activeWorkItems])

  // Assignee options come from the *unfiltered* bookkeeping pool so the
  // dropdown doesn't churn as you move between months.
  const uniqueAssignees = useMemo(() => {
    const set = new Set<string>()
    for (const it of bookkeepingItems) {
      const name = it.assignee_name || it.AssigneeName || ""
      if (name) set.add(name)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [bookkeepingItems])

  const monthKeyStr = monthKey(selectedMonth)

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookkeepingItems.filter((item) => {
      // Month filter — by period_start (preferred) or due_date fallback.
      const itemMonth = workItemPeriodMonthKey(item)
      if (itemMonth !== monthKeyStr) return false

      // Assignee filter
      if (filterAssignee !== "all") {
        const name = item.assignee_name || item.AssigneeName || ""
        if (name !== filterAssignee) return false
      }

      // Status filter (Karbon workflow_status → 5-bucket model)
      if (filterStatus !== "all") {
        if (bucketStatus(item) !== filterStatus) return false
      }

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
  }, [bookkeepingItems, search, monthKeyStr, filterAssignee, filterStatus])

  const selectedItem = useMemo(
    () => bookkeepingItems.find((i) => (i.id || i.karbon_work_item_key) === selectedId) || null,
    [bookkeepingItems, selectedId],
  )

  const monthCount = filteredItems.length
  const isCurrentMonth = useMemo(() => {
    const now = new Date()
    return (
      selectedMonth.getMonth() === now.getMonth() &&
      selectedMonth.getFullYear() === now.getFullYear()
    )
  }, [selectedMonth])

  function goToPreviousMonth() {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }
  function goToNextMonth() {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }
  function goToCurrentMonth() {
    const now = new Date()
    setSelectedMonth(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      await refresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: month navigator + filters + refresh. Mirrors what the
          legacy AccountingBookkeepingTracker exposed so the unified view
          is a true superset. */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={goToPreviousMonth} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold tabular-nums">
                  {formatMonthYear(selectedMonth)}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={goToNextMonth} aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isCurrentMonth && (
                <Button variant="ghost" size="sm" onClick={goToCurrentMonth}>
                  Today
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
                {monthCount} engagement{monthCount === 1 ? "" : "s"} this month
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || itemsLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1.5 ${isRefreshing || itemsLoading ? "animate-spin" : ""}`}
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
            <Select value={filterAssignee} onValueChange={setFilterAssignee}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by lead" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Leads</SelectItem>
                {uniqueAssignees.map((name) => (
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

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* Left: bookkeeping work item picker. Collapsible + maximizable so
            users on tablets can fold the list away once a work item is
            selected, freeing up screen real estate for the checklist. */}
        <ExpandableCard
          title="Bookkeeping Work Items"
          description={`${monthCount} active engagement${monthCount === 1 ? "" : "s"} in ${formatMonthYear(selectedMonth)}`}
          icon={<ListChecks className="h-5 w-5 text-blue-600" />}
        >
          <div className="space-y-3">
            <div className="border rounded-lg max-h-[640px] overflow-y-auto divide-y">
              {itemsLoading && filteredItems.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading from Karbon…
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
                  <p>No bookkeeping engagements match the current filters.</p>
                  <p className="text-xs mt-1">
                    Try clearing filters or moving to a different month.
                  </p>
                </div>
              ) : (
                filteredItems.map((item) => {
                  const id = item.id || item.karbon_work_item_key || ""
                  const isSelected = id === selectedId
                  const status = bucketStatus(item)
                  const tone = STATUS_COLORS[status]
                  const karbonUrl = item.karbon_url
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className={`w-full text-left p-3 hover:bg-muted/40 transition-colors ${
                        isSelected ? "bg-blue-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{getClientLabel(item)}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {item.title || item.Title}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {karbonUrl ? (
                            <Link
                              href={karbonUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-blue-600 transition-colors"
                              aria-label="Open in Karbon"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          ) : null}
                          <ChevronRight
                            className={`h-4 w-4 ${
                              isSelected ? "text-blue-600" : "text-muted-foreground"
                            }`}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${tone.bg} ${tone.text} ${tone.border}`}
                        >
                          <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${tone.dot}`} />
                          {status}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          Due {formatShortDate(item.due_date || item.DueDate)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 truncate">
                        {getAssigneeLabel(item)}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </ExpandableCard>

        {/* Right: checklist for the selected work item */}
        <div>
          {selectedItem ? (
            <ChecklistForWorkItem item={selectedItem} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-muted-foreground/60" />
                <p className="text-sm">
                  Select a bookkeeping work item on the left to view and update its
                  10-step checklist.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function ChecklistForWorkItem({ item }: { item: KarbonWorkItem }) {
  const workItemId = item.id || item.karbon_work_item_key || ""
  const endpoint = `/api/accounting/bookkeeping-checklist/${workItemId}`
  const { data, error, isLoading } = useSWR<{ progress: ProgressRow[] }>(
    workItemId ? endpoint : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [savingStep, setSavingStep] = useState<number | null>(null)
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({})
  const [completer, setCompleter] = useState<string>("")

  const progressMap = useMemo(() => {
    const map = new Map<number, ProgressRow>()
    for (const row of data?.progress ?? []) map.set(row.step_number, row)
    return map
  }, [data])

  const completedCount = useMemo(
    () => Array.from(progressMap.values()).filter((r) => r.is_complete).length,
    [progressMap],
  )
  const phase1Done = useMemo(
    () =>
      Array.from(progressMap.values()).filter((r) => r.is_complete && r.step_number <= 5).length,
    [progressMap],
  )
  const phase2Done = useMemo(
    () =>
      Array.from(progressMap.values()).filter((r) => r.is_complete && r.step_number >= 6).length,
    [progressMap],
  )

  const phase1Steps = BOOKKEEPING_CHECKLIST.filter((s) => s.step <= 5)
  const phase2Steps = BOOKKEEPING_CHECKLIST.filter((s) => s.step >= 6)

  // Live Karbon status / metadata badges
  const karbonStatus: StatusBucket = bucketStatus(item)
  const karbonTone = STATUS_COLORS[karbonStatus]
  const rawKarbonStatus = item.workflow_status || item.WorkStatus || null

  async function persistStep(
    stepNumber: number,
    patch: Partial<{ is_complete: boolean; notes: string | null }>,
  ) {
    const existing = progressMap.get(stepNumber)
    const payload = {
      step_number: stepNumber,
      is_complete: patch.is_complete ?? existing?.is_complete ?? false,
      notes: patch.notes ?? existing?.notes ?? null,
      completed_by_name: completer.trim() || existing?.completed_by_name || null,
    }

    setSavingStep(stepNumber)
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || res.statusText)
      }
      await mutate(endpoint)
    } catch (err) {
      console.error("[v0] Failed to save checklist step:", err)
      // Soft-fail; UI will reload via SWR
    } finally {
      setSavingStep(null)
    }
  }

  return (
    <ExpandableCard
      title={getClientLabel(item)}
      // ExpandableCard's description sits under the title; keep it terse and
      // use the (often noisy) work-item title for it.
      description={item.title || item.Title}
      icon={<CheckSquare className="h-5 w-5 text-emerald-600" />}
      // Right-rail badges show phase totals AND live Karbon workflow
      // status at a glance, even when the body is collapsed.
      actions={
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className={`${karbonTone.bg} ${karbonTone.text} ${karbonTone.border}`}
            title={rawKarbonStatus ? `Karbon: ${rawKarbonStatus}` : "Karbon status"}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${karbonTone.dot}`} />
            Karbon: {karbonStatus}
          </Badge>
          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
            Phase 1: {phase1Done} / 5
          </Badge>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200">
            Phase 2: {phase2Done} / 5
          </Badge>
          <Badge variant="outline" className="bg-muted text-foreground">
            Total: {completedCount} / 10
          </Badge>
          {item.karbon_url ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-7 px-2"
            >
              <Link href={item.karbon_url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Karbon
              </Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <Progress value={(completedCount / 10) * 100} className="h-2" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Marking complete as
            </label>
            <Input
              placeholder="Your name (will be saved with completed steps)"
              value={completer}
              onChange={(e) => setCompleter(e.target.value)}
              className="md:max-w-sm"
            />
          </div>
          <div className="text-xs text-muted-foreground text-right">
            <div>
              Assigned to:{" "}
              <span className="font-medium text-foreground">{getAssigneeLabel(item)}</span>
            </div>
            <div>
              Due {formatShortDate(item.due_date || item.DueDate)}
              {" · "}
              Last updated:{" "}
              {data?.progress?.length ? formatShortDate(latestUpdatedAt(data.progress)) : "—"}
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            Failed to load progress: {error.message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <>
            <PhaseBlock
              title="Phase 1 — P24 (Preparer)"
              tone="blue"
              steps={phase1Steps}
              progressMap={progressMap}
              draftNotes={draftNotes}
              setDraftNotes={setDraftNotes}
              savingStep={savingStep}
              onToggle={(step, val) => persistStep(step, { is_complete: val })}
              onSaveNotes={(step) => persistStep(step, { notes: draftNotes[step] ?? null })}
            />
            <PhaseBlock
              title="Phase 2 — Reviewer (Andrew / Caleb / Amy / Matt)"
              tone="emerald"
              steps={phase2Steps}
              progressMap={progressMap}
              draftNotes={draftNotes}
              setDraftNotes={setDraftNotes}
              savingStep={savingStep}
              onToggle={(step, val) => persistStep(step, { is_complete: val })}
              onSaveNotes={(step) => persistStep(step, { notes: draftNotes[step] ?? null })}
            />
          </>
        )}
      </div>
    </ExpandableCard>
  )
}

function PhaseBlock({
  title,
  tone,
  steps,
  progressMap,
  draftNotes,
  setDraftNotes,
  savingStep,
  onToggle,
  onSaveNotes,
}: {
  title: string
  tone: "blue" | "emerald"
  steps: typeof BOOKKEEPING_CHECKLIST
  progressMap: Map<number, ProgressRow>
  draftNotes: Record<number, string>
  setDraftNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>
  savingStep: number | null
  onToggle: (step: number, val: boolean) => void
  onSaveNotes: (step: number) => void
}) {
  const headerToneClass =
    tone === "blue"
      ? "bg-blue-50 text-blue-800 border-blue-200"
      : "bg-emerald-50 text-emerald-800 border-emerald-200"

  return (
    <div className="space-y-2">
      <div className={`px-3 py-1.5 rounded-md border text-sm font-medium ${headerToneClass}`}>
        {title}
      </div>
      <div className="space-y-2">
        {steps.map((step) => {
          const row = progressMap.get(step.step)
          const isComplete = row?.is_complete ?? false
          const draft = draftNotes[step.step] ?? row?.notes ?? ""
          const isSaving = savingStep === step.step
          return (
            <div
              key={step.step}
              className={`rounded-md border p-3 transition-colors ${
                isComplete ? "bg-emerald-50/40 border-emerald-200" : "bg-card"
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={isComplete}
                  disabled={isSaving}
                  onCheckedChange={(checked) => onToggle(step.step, Boolean(checked))}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Step {step.step}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{step.assignedTo}</span>
                    {row?.completed_at ? (
                      <span className="text-xs text-emerald-700">
                        Done {formatShortDate(row.completed_at)}
                        {row.completed_by_name ? ` · ${row.completed_by_name}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm">{step.task}</p>
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Notes {row?.notes ? `(${row.notes.length} chars)` : ""}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={draft}
                        onChange={(e) =>
                          setDraftNotes((prev) => ({ ...prev, [step.step]: e.target.value }))
                        }
                        placeholder="Add a note for this step…"
                        className="min-h-[60px] text-sm"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSaving || draft === (row?.notes ?? "")}
                          onClick={() => onSaveNotes(step.step)}
                        >
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                          Save note
                        </Button>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function latestUpdatedAt(rows: ProgressRow[]): string {
  return rows.reduce((latest, r) => (r.updated_at > latest ? r.updated_at : latest), "")
}
