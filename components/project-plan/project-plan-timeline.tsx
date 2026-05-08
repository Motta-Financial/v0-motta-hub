"use client"

import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ExpandableCard } from "@/components/ui/expandable-card"
import {
  bucketServiceType,
  bucketStatus,
  formatShortDate,
  getClientLabel,
  SERVICE_TYPE_ORDER,
  STATUS_COLORS,
  useAccountingWorkItems,
  type ServiceType,
} from "./project-plan-shared"
import { useProjectPlanContext } from "./project-plan-context"
import { CalendarRange, Loader2 } from "lucide-react"

// Simple Gantt-style horizontal-bar timeline scoped to ACCT work types.
// Each row = one work item with start_date and due_date — items missing
// either date drop out (they don't have a timeline). Clicking a bar
// jumps to the Roster filtered to that client (or opens Karbon if a URL
// is available). The service-type filter is now read from
// ProjectPlanContext so it stays in sync with the Dashboard's
// drill-throughs.
export function ProjectPlanTimeline() {
  const { activeWorkItems, isLoading } = useAccountingWorkItems()
  const { filters: shared, setFilters: setShared, jumpTo } = useProjectPlanContext()

  const { rows, range } = useMemo(() => {
    const filtered = activeWorkItems.filter((item) => {
      if (shared.service !== "ALL" && bucketServiceType(item) !== shared.service) return false
      return Boolean((item.start_date || item.StartDate) && (item.due_date || item.DueDate))
    })

    if (filtered.length === 0) {
      return { rows: [] as typeof filtered, range: null as null | { min: number; max: number } }
    }

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const item of filtered) {
      const start = new Date(item.start_date || item.StartDate || "").getTime()
      const due = new Date(item.due_date || item.DueDate || "").getTime()
      if (Number.isFinite(start)) min = Math.min(min, start)
      if (Number.isFinite(due)) max = Math.max(max, due)
    }
    const sorted = [...filtered].sort(
      (a, b) =>
        new Date(a.start_date || a.StartDate || "").getTime() -
        new Date(b.start_date || b.StartDate || "").getTime(),
    )
    return { rows: sorted.slice(0, 100), range: { min, max } }
  }, [activeWorkItems, shared.service])

  if (isLoading && !activeWorkItems.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
          Loading timeline…
        </CardContent>
      </Card>
    )
  }

  return (
    <ExpandableCard
      title="Engagement Timeline"
      description={
        rows.length === 0
          ? "ACCT work items with start & due dates"
          : `${rows.length} ACCT work item${rows.length === 1 ? "" : "s"} with start & due dates${
              range
                ? ` — ${formatShortDate(new Date(range.min).toISOString())} → ${formatShortDate(
                    new Date(range.max).toISOString(),
                  )}`
                : ""
            }`
      }
      icon={<CalendarRange className="h-5 w-5 text-emerald-600" />}
      actions={
        <Select
          value={shared.service}
          onValueChange={(v) => setShared({ service: v as ServiceType | "ALL" })}
        >
          {/* stopPropagation so clicking the dropdown doesn't toggle the
              ExpandableCard's collapsible header. */}
          <SelectTrigger
            className="md:w-[200px] h-8 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <SelectValue placeholder="All service types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All service types</SelectItem>
            {SERVICE_TYPE_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {rows.length === 0 || !range ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No ACCT work items in this filter have both a start date and a due date.
        </p>
      ) : (
        <div className="space-y-2">
          {/* Axis labels */}
          <div className="grid grid-cols-[minmax(180px,1fr)_3fr] gap-3 text-xs text-muted-foreground border-b pb-2">
            <span>Work Item</span>
            <div className="flex justify-between">
              <span>{formatShortDate(new Date(range.min).toISOString())}</span>
              <span>{formatShortDate(new Date((range.min + range.max) / 2).toISOString())}</span>
              <span>{formatShortDate(new Date(range.max).toISOString())}</span>
            </div>
          </div>
          {rows.map((item) => {
            const start = new Date(item.start_date || item.StartDate || "").getTime()
            const due = new Date(item.due_date || item.DueDate || "").getTime()
            const total = Math.max(range.max - range.min, 1)
            const left = ((start - range.min) / total) * 100
            const width = Math.max(((due - start) / total) * 100, 0.5)
            const status = bucketStatus(item)
            const tone = STATUS_COLORS[status]
            const client = getClientLabel(item)
            const id = item.karbon_work_item_key || item.id
            // Bars open Karbon if available; otherwise they drill into
            // the Roster filtered to that client. Either way the row is
            // a real interactive element so keyboard users can reach it.
            const onActivate = () => {
              if (item.karbon_url) {
                window.open(item.karbon_url, "_blank", "noopener,noreferrer")
              } else {
                jumpTo("roster", { query: client })
              }
            }
            return (
              <div
                key={id}
                className="grid grid-cols-[minmax(180px,1fr)_3fr] gap-3 items-center group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate" title={item.title || item.Title}>
                    {client}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {item.title || item.Title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onActivate}
                  className="relative h-6 rounded bg-muted/40 hover:bg-muted/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label={`${client}: ${formatShortDate(
                    item.start_date || item.StartDate,
                  )} → ${formatShortDate(item.due_date || item.DueDate)} (${status})`}
                  title={`${formatShortDate(item.start_date || item.StartDate)} → ${formatShortDate(
                    item.due_date || item.DueDate,
                  )}${item.karbon_url ? " — click to open in Karbon" : " — click to filter Roster"}`}
                >
                  <div
                    className={`absolute top-0 h-full rounded ${tone.dot} group-hover:brightness-110 transition-all`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </button>
              </div>
            )
          })}
          <div className="flex flex-wrap gap-2 pt-3">
            {Object.entries(STATUS_COLORS).map(([status, tone]) => (
              <Badge
                key={status}
                variant="outline"
                className={`${tone.bg} ${tone.text} ${tone.border} text-xs`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} mr-1.5`} />
                {status}
              </Badge>
            ))}
          </div>
          {rows.length === 100 && (
            <p className="text-xs text-muted-foreground pt-2">
              Showing the first 100 items by start date — narrow with filters to see the rest.
            </p>
          )}
        </div>
      )}
    </ExpandableCard>
  )
}
