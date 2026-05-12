"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AlarmClock, CalendarRange, Layers, ListTree, UserMinus, UserRound, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Lightweight slice of the KarbonWorkItem fields this panel actually reads.
 * Keeping it permissive (`any`-ish) avoids a dependency on the much larger
 * KarbonWorkItem type while still documenting the contract: anything we
 * pass in is acceptable so long as these properties resolve.
 */
type WorkItemLike = {
  WorkType?: string
  WorkStatus?: string
  DueDate?: string
  StartDate?: string
  CompletedDate?: string
  LastModifiedDateTime?: string
  AssignedTo?:
    | { FullName: string; Email?: string }
    | Array<{ FullName: string; Email?: string }>
}

/** Coerce the AssignedTo shape into a stable array. */
function asAssignees(a: WorkItemLike["AssignedTo"]): Array<{ FullName: string; Email?: string }> {
  if (!a) return []
  return Array.isArray(a) ? a : [a]
}

/** Active = not completed / cancelled. Matches work-items-view's logic. */
function isActive(item: WorkItemLike): boolean {
  const s = (item.WorkStatus || "").toLowerCase()
  if (
    s.includes("cancelled") ||
    s.includes("canceled") ||
    s.includes("lost") ||
    s.includes("not proceeding") ||
    s.includes("declined") ||
    s.includes("completed") ||
    s.includes("complete")
  ) {
    return false
  }
  return true
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24))
}

function isOverdue(item: WorkItemLike, today: Date): boolean {
  if (!item.DueDate || !isActive(item)) return false
  return new Date(item.DueDate) < today
}

function isDueThisWeek(item: WorkItemLike, today: Date, weekEnd: Date): boolean {
  if (!item.DueDate || !isActive(item)) return false
  const d = new Date(item.DueDate)
  return d >= today && d <= weekEnd
}

function isUnassigned(item: WorkItemLike): boolean {
  return isActive(item) && asAssignees(item.AssignedTo).length === 0
}

/**
 * "Stale" = active item that hasn't been touched in 30+ days. We fall back
 * through LastModifiedDateTime → StartDate so unsynced fields don't make
 * everything register as stale.
 */
function isStale(item: WorkItemLike, today: Date): boolean {
  if (!isActive(item)) return false
  const ref = item.LastModifiedDateTime || item.StartDate
  if (!ref) return false
  return daysBetween(today, new Date(ref)) >= 30
}

export type WorkItemsKpiKey = "overdue" | "dueWeek" | "unassigned" | "stale"

/**
 * Quick-filter tile values. Each tile is clickable and toggles its
 * corresponding virtual filter. We compute the counts on the *unfiltered*
 * `allItems` set so the tile counts stay meaningful even after the user
 * narrows the visible rows.
 */
function buildKpis(allItems: WorkItemLike[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)

  let overdue = 0
  let dueWeek = 0
  let unassigned = 0
  let stale = 0
  for (const item of allItems) {
    if (isOverdue(item, today)) overdue++
    if (isDueThisWeek(item, today, weekEnd)) dueWeek++
    if (isUnassigned(item)) unassigned++
    if (isStale(item, today)) stale++
  }
  return { overdue, dueWeek, unassigned, stale }
}

/**
 * Build a frequency map and return the top N entries sorted descending.
 * Used for the three distribution lists.
 */
function topN<T extends string>(
  items: WorkItemLike[],
  selector: (i: WorkItemLike) => T | T[] | null | undefined,
  n: number,
): Array<{ key: string; count: number; share: number }> {
  const map = new Map<string, number>()
  let total = 0
  for (const item of items) {
    const result = selector(item)
    const keys = Array.isArray(result) ? result : result ? [result] : []
    for (const key of keys) {
      if (!key) continue
      map.set(key, (map.get(key) || 0) + 1)
      total++
    }
  }
  const sorted = [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count, share: total > 0 ? count / total : 0 }))
  return sorted
}

interface DashboardPanelProps {
  /** Unfiltered set — counts are computed against this. */
  allItems: WorkItemLike[]
  /** Filtered set — distribution lists reflect the active filters. */
  filteredItems: WorkItemLike[]
  loading?: boolean
  /** Currently-toggled KPI tile, if any. */
  activeKpi: WorkItemsKpiKey | null
  onKpiClick: (key: WorkItemsKpiKey) => void
  /** Distribution chip handlers — clicking applies the value as a filter. */
  onWorkTypeClick?: (workType: string) => void
  onStatusClick?: (status: string) => void
  onAssigneeClick?: (assigneeName: string) => void
}

/**
 * Pillared into two visual regions:
 *   1. Four "attention" tiles across the top (Overdue / Due Week / Unassigned
 *      / Stale). Each tile is a toggle filter and visually highlights when
 *      active.
 *   2. Three distribution cards (Top Work Types, Top Statuses, Top
 *      Assignees) with mini progress bars so users can eyeball the firm's
 *      workload mix without leaving the page.
 */
export function WorkItemsDashboardPanel({
  allItems,
  filteredItems,
  loading,
  activeKpi,
  onKpiClick,
  onWorkTypeClick,
  onStatusClick,
  onAssigneeClick,
}: DashboardPanelProps) {
  const kpis = buildKpis(allItems)

  const topWorkTypes = topN(filteredItems, (i) => i.WorkType, 5)
  const topStatuses = topN(filteredItems, (i) => i.WorkStatus, 5)
  const topAssignees = topN(
    filteredItems,
    (i) => asAssignees(i.AssignedTo).map((a) => a.FullName),
    5,
  )

  const tiles: Array<{
    key: WorkItemsKpiKey
    label: string
    sublabel: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    accent: string
  }> = [
    {
      key: "overdue",
      label: "Overdue",
      sublabel: "Past due date",
      value: kpis.overdue,
      icon: AlarmClock,
      accent: "text-rose-600",
    },
    {
      key: "dueWeek",
      label: "Due This Week",
      sublabel: "Next 7 days",
      value: kpis.dueWeek,
      icon: CalendarRange,
      accent: "text-amber-600",
    },
    {
      key: "unassigned",
      label: "Unassigned",
      sublabel: "Needs owner",
      value: kpis.unassigned,
      icon: UserMinus,
      accent: "text-slate-600",
    },
    {
      key: "stale",
      label: "Stale (30d+)",
      sublabel: "No activity",
      value: kpis.stale,
      icon: Wrench,
      accent: "text-violet-600",
    },
  ]

  return (
    <div className="space-y-3">
      {/* Attention tiles ----------------------------------------------- */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon
          const isActive = activeKpi === tile.key
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => onKpiClick(tile.key)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-left transition-all hover:shadow-sm hover:border-foreground/20",
                isActive && "border-foreground bg-accent/40 shadow-sm",
              )}
            >
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {tile.sublabel}
                </div>
                <div className="text-sm font-medium truncate">{tile.label}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {loading ? (
                  <Skeleton className="h-6 w-8" />
                ) : (
                  <span className="text-2xl font-bold tabular-nums">{tile.value}</span>
                )}
                <Icon className={cn("h-4 w-4", tile.accent)} />
              </div>
            </button>
          )
        })}
      </div>

      {/* Distribution cards -------------------------------------------- */}
      <div className="grid gap-3 md:grid-cols-3">
        <DistributionCard
          title="Top Work Types"
          icon={Layers}
          entries={topWorkTypes}
          loading={loading}
          emptyLabel="No work types yet"
          onEntryClick={onWorkTypeClick}
        />
        <DistributionCard
          title="Top Statuses"
          icon={ListTree}
          entries={topStatuses}
          loading={loading}
          emptyLabel="No statuses yet"
          onEntryClick={onStatusClick}
        />
        <DistributionCard
          title="Top Assignees"
          icon={UserRound}
          entries={topAssignees}
          loading={loading}
          emptyLabel="Nothing assigned"
          onEntryClick={onAssigneeClick}
        />
      </div>
    </div>
  )
}

interface DistributionCardProps {
  title: string
  icon: React.ComponentType<{ className?: string }>
  entries: Array<{ key: string; count: number; share: number }>
  loading?: boolean
  emptyLabel: string
  onEntryClick?: (key: string) => void
}

function DistributionCard({
  title,
  icon: Icon,
  entries,
  loading,
  emptyLabel,
  onEntryClick,
}: DistributionCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 py-2">
        <CardTitle className="text-xs font-medium flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        {loading ? (
          <div className="space-y-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => onEntryClick?.(entry.key)}
                  className="group w-full text-left"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate group-hover:underline">{entry.key}</span>
                    <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
                      {entry.count}
                    </Badge>
                  </div>
                  {/* Inline horizontal bar — uses the foreground token so it
                      respects light/dark theme, with 60% opacity so the bar
                      reads as a "fill" rather than a hard rule. */}
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-foreground/60 transition-all"
                      style={{ width: `${Math.max(4, entry.share * 100)}%` }}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
