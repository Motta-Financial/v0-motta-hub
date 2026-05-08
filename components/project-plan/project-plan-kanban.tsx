"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ExpandableCard } from "@/components/ui/expandable-card"
import {
  bucketServiceType,
  bucketStatus,
  formatShortDate,
  getAssigneeLabel,
  getClientLabel,
  STATUS_COLORS,
  useAccountingWorkItems,
  type StatusBucket,
} from "./project-plan-shared"
import { useProjectPlanContext } from "./project-plan-context"
import { ExternalLink, KanbanSquare, Loader2 } from "lucide-react"
import type { KarbonWorkItem } from "@/contexts/karbon-work-items-context"

const KANBAN_COLUMNS: StatusBucket[] = ["Not Started", "To Do", "In Progress", "Waiting", "Complete"]
const PER_COLUMN_LIMIT = 30

// Mirrors the "Kanban Board" tab, scoped to ACCT work types. Cards are
// visually grouped by Karbon status bucket; team-member filter narrows
// the view to one assignee. Cards are now interactive — clicking opens
// a detail dialog with the full work-item record (description, dates,
// Karbon link), and the assignee filter is read from
// ProjectPlanContext so deep-links from Team Workload land here
// pre-filtered.
export function ProjectPlanKanban() {
  const { activeWorkItems, isLoading } = useAccountingWorkItems()
  const { filters: shared, setFilters: setShared } = useProjectPlanContext()
  const [detail, setDetail] = useState<KarbonWorkItem | null>(null)

  const assignees = useMemo(() => {
    const set = new Set<string>()
    for (const item of activeWorkItems) set.add(getAssigneeLabel(item))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [activeWorkItems])

  const grouped = useMemo(() => {
    const groups: Record<StatusBucket, KarbonWorkItem[]> = {
      "Not Started": [],
      "To Do": [],
      "In Progress": [],
      Waiting: [],
      Complete: [],
    }
    for (const item of activeWorkItems) {
      if (shared.assignee !== "ALL" && getAssigneeLabel(item) !== shared.assignee) continue
      groups[bucketStatus(item)].push(item)
    }
    return groups
  }, [activeWorkItems, shared.assignee])

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
    <>
      <ExpandableCard
        title="Kanban Board"
        description={`ACCT work items grouped by Karbon workflow status${
          shared.assignee !== "ALL" ? ` — filtered to ${shared.assignee}` : ""
        }`}
        icon={<KanbanSquare className="h-5 w-5 text-blue-600" />}
        actions={
          <Select value={shared.assignee} onValueChange={(v) => setShared({ assignee: v })}>
            <SelectTrigger
              className="md:w-[220px] h-8 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
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
        }
      >
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
                      <button
                        key={item.karbon_work_item_key || item.id}
                        type="button"
                        onClick={() => setDetail(item)}
                        className="w-full text-left rounded-md bg-white border border-inherit p-2.5 text-xs space-y-1 shadow-sm hover:shadow-md hover:border-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-all"
                        aria-label={`Open details for ${getClientLabel(item)} — ${item.title || item.Title}`}
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
                      </button>
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
      </ExpandableCard>

      <KanbanCardDetailDialog item={detail} onClose={() => setDetail(null)} />
    </>
  )
}

// ---- Detail dialog --------------------------------------------------------

function KanbanCardDetailDialog({
  item,
  onClose,
}: {
  item: KarbonWorkItem | null
  onClose: () => void
}) {
  const open = !!item
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{getClientLabel(item)}</span>
                <Badge
                  variant="outline"
                  className={`${STATUS_COLORS[bucketStatus(item)].bg} ${
                    STATUS_COLORS[bucketStatus(item)].text
                  } ${STATUS_COLORS[bucketStatus(item)].border} text-xs`}
                >
                  {bucketStatus(item)}
                </Badge>
              </DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {item.karbon_work_item_key || item.WorkKey}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Work Item
                </p>
                <p className="font-medium">{item.title || item.Title}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Detail label="Service Type" value={bucketServiceType(item)} />
                <Detail label="Work Type" value={item.work_type || item.WorkType || "—"} />
                <Detail label="Assignee" value={getAssigneeLabel(item)} />
                <Detail label="Priority" value={item.priority || item.Priority || "—"} />
                <Detail label="Start" value={formatShortDate(item.start_date || item.StartDate)} />
                <Detail label="Due" value={formatShortDate(item.due_date || item.DueDate)} />
                <Detail
                  label="Last Modified"
                  value={formatShortDate(item.karbon_modified_at || item.LastModifiedDateTime)}
                />
                <Detail
                  label="Workflow Status"
                  value={item.workflow_status || item.WorkStatus || "—"}
                />
              </div>
              {item.description || item.Description ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Description
                  </p>
                  <p className="text-xs whitespace-pre-wrap">{item.description || item.Description}</p>
                </div>
              ) : null}
              {item.karbon_url ? (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={item.karbon_url} target="_blank" rel="noreferrer">
                    Open in Karbon
                    <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  )
}
