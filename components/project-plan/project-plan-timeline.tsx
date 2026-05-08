"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useKarbonWorkItems } from "@/contexts/karbon-work-items-context"
import {
  bucketServiceType,
  bucketStatus,
  formatShortDate,
  getClientLabel,
  SERVICE_TYPE_ORDER,
  STATUS_COLORS,
  type ServiceType,
} from "./project-plan-shared"
import { Loader2 } from "lucide-react"

// Simple Gantt-style horizontal-bar timeline. We avoid an external library
// and use proportional flex widths so the bars stay readable on both wide
// monitors and narrow tablets. Each row = one work item with start_date and
// due_date — items missing either date drop out (they don't have a timeline).
export function ProjectPlanTimeline() {
  const { activeWorkItems, isLoading } = useKarbonWorkItems()
  const [serviceFilter, setServiceFilter] = useState<ServiceType | "ALL">("ALL")

  const { rows, range } = useMemo(() => {
    const filtered = activeWorkItems.filter((item) => {
      if (serviceFilter !== "ALL" && bucketServiceType(item) !== serviceFilter) return false
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
    // sort earliest start first
    const sorted = [...filtered].sort(
      (a, b) =>
        new Date(a.start_date || a.StartDate || "").getTime() -
        new Date(b.start_date || b.StartDate || "").getTime(),
    )
    return { rows: sorted.slice(0, 100), range: { min, max } }
  }, [activeWorkItems, serviceFilter])

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
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Engagement Timeline</CardTitle>
            <CardDescription>
              {rows.length} work item{rows.length === 1 ? "" : "s"} with start &amp; due dates
              {range
                ? ` — ${formatShortDate(new Date(range.min).toISOString())} → ${formatShortDate(
                    new Date(range.max).toISOString(),
                  )}`
                : ""}
            </CardDescription>
          </div>
          <Select value={serviceFilter} onValueChange={(v) => setServiceFilter(v as ServiceType | "ALL")}>
            <SelectTrigger className="md:w-[240px]">
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
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 || !range ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No work items in this filter have both a start date and a due date.
          </p>
        ) : (
          <div className="space-y-2">
            {/* Axis labels */}
            <div className="grid grid-cols-[minmax(180px,1fr)_3fr] gap-3 text-xs text-muted-foreground border-b pb-2">
              <span>Work Item</span>
              <div className="flex justify-between">
                <span>{formatShortDate(new Date(range.min).toISOString())}</span>
                <span>
                  {formatShortDate(
                    new Date((range.min + range.max) / 2).toISOString(),
                  )}
                </span>
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
              return (
                <div
                  key={item.karbon_work_item_key || item.id}
                  className="grid grid-cols-[minmax(180px,1fr)_3fr] gap-3 items-center"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" title={item.title || item.Title}>
                      {getClientLabel(item)}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{item.title || item.Title}</p>
                  </div>
                  <div className="relative h-6 rounded bg-muted/40">
                    <div
                      className={`absolute top-0 h-full rounded ${tone.dot}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${formatShortDate(item.start_date || item.StartDate)} → ${formatShortDate(
                        item.due_date || item.DueDate,
                      )}`}
                    />
                  </div>
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
      </CardContent>
    </Card>
  )
}
