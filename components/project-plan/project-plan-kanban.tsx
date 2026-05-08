"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useKarbonWorkItems } from "@/contexts/karbon-work-items-context"
import {
  bucketStatus,
  formatShortDate,
  getAssigneeLabel,
  getClientLabel,
  STATUS_BUCKETS,
  STATUS_COLORS,
  type StatusBucket,
} from "./project-plan-shared"
import { ExternalLink, Loader2 } from "lucide-react"

const KANBAN_COLUMNS: StatusBucket[] = ["Not Started", "To Do", "In Progress", "Waiting", "Complete"]
const PER_COLUMN_LIMIT = 30

// Mirrors the "Kanban Board" tab. Cards are visually grouped by Karbon
// status bucket; team-member filter narrows the view to one assignee at a
// time (matches the workbook's per-person filter dropdown).
export function ProjectPlanKanban() {
  const { activeWorkItems, isLoading } = useKarbonWorkItems()
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL")

  const assignees = useMemo(() => {
    const set = new Set<string>()
    for (const item of activeWorkItems) set.add(getAssigneeLabel(item))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [activeWorkItems])

  const grouped = useMemo(() => {
    const groups: Record<StatusBucket, typeof activeWorkItems> = {
      "Not Started": [],
      "To Do": [],
      "In Progress": [],
      Waiting: [],
      Complete: [],
    }
    for (const item of activeWorkItems) {
      if (assigneeFilter !== "ALL" && getAssigneeLabel(item) !== assigneeFilter) continue
      groups[bucketStatus(item)].push(item)
    }
    return groups
  }, [activeWorkItems, assigneeFilter])

  if (isLoading && !activeWorkItems.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
          Loading kanban board…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Kanban Board</CardTitle>
            <CardDescription>Cards grouped by Karbon workflow status</CardDescription>
          </div>
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="md:w-[260px]">
              <SelectValue placeholder="All team members" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All team members</SelectItem>
              {assignees.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {KANBAN_COLUMNS.map((status) => {
            const items = grouped[status]
            const tone = STATUS_COLORS[status]
            const visible = items.slice(0, PER_COLUMN_LIMIT)
            return (
              <div key={status} className={`rounded-lg border ${tone.border} ${tone.bg} flex flex-col`}>
                <div className="px-3 py-2 border-b border-inherit flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                    <p className={`text-sm font-semibold ${tone.text}`}>{status}</p>
                  </div>
                  <Badge variant="outline" className="bg-white">
                    {items.length}
                  </Badge>
                </div>
                <div className="p-2 space-y-2 max-h-[640px] overflow-y-auto">
                  {visible.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">No items</p>
                  ) : (
                    visible.map((item) => (
                      <div
                        key={item.karbon_work_item_key || item.id}
                        className="rounded-md bg-white border border-inherit p-2.5 text-xs space-y-1 shadow-sm"
                      >
                        <p className="font-medium leading-snug" title={item.title || item.Title}>
                          {getClientLabel(item)}
                        </p>
                        <p className="text-muted-foreground line-clamp-2">{item.title || item.Title}</p>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] text-muted-foreground">
                            {getAssigneeLabel(item)}
                          </span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {formatShortDate(item.due_date || item.DueDate)}
                          </span>
                        </div>
                        {item.karbon_url ? (
                          <Link
                            href={item.karbon_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                          >
                            Open in Karbon
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : null}
                      </div>
                    ))
                  )}
                  {items.length > PER_COLUMN_LIMIT && (
                    <p className="text-center text-[11px] text-muted-foreground pt-1">
                      +{items.length - PER_COLUMN_LIMIT} more — narrow with the team filter
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
