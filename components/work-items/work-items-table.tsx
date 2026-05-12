"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowDown, ArrowUp, ArrowUpDown, CheckSquare, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import { getServiceLineColor, type ServiceLine } from "@/lib/service-lines"

/**
 * Table-shaped projection of the work-items list. Kept structurally identical
 * to the Card view (same columns, same colors, same external-link target) so
 * users can switch view mode without re-learning anything.
 *
 * Sortable on every column except Title (Title is sorted lexically by default).
 * Clicking a header cycles asc → desc → no-sort, matching how Karbon's own
 * grid behaves.
 */

type WorkItemLike = {
  WorkKey: string
  Title: string
  ClientName?: string
  WorkType?: string
  WorkStatus?: string
  DueDate?: string
  StartDate?: string
  CompletedDate?: string
  Priority?: string
  AssignedTo?:
    | { FullName: string; Email?: string }
    | Array<{ FullName: string; Email?: string }>
}

type SortKey = "title" | "client" | "type" | "status" | "assignee" | "due" | "priority"
type SortDir = "asc" | "desc" | null

function asAssignees(a: WorkItemLike["AssignedTo"]): Array<{ FullName: string; Email?: string }> {
  if (!a) return []
  return Array.isArray(a) ? a : [a]
}

function priorityRank(p?: string): number {
  // Numerical rank lets us sort priority logically rather than alphabetically.
  // Unknown values sort last so they don't pollute the top of the list.
  switch ((p || "").toLowerCase()) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    default:
      return 0
  }
}

function getPriorityColor(priority?: string) {
  switch ((priority || "").toLowerCase()) {
    case "high":
      return "bg-rose-100 text-rose-700 border-rose-200"
    case "medium":
      return "bg-amber-100 text-amber-700 border-amber-200"
    case "low":
      return "bg-emerald-100 text-emerald-700 border-emerald-200"
    default:
      return "bg-slate-100 text-slate-700 border-slate-200"
  }
}

function determineStatus(item: WorkItemLike): "completed" | "active" | "cancelled" {
  const s = (item.WorkStatus || "").toLowerCase()
  if (
    s.includes("cancelled") ||
    s.includes("canceled") ||
    s.includes("lost") ||
    s.includes("n/a") ||
    s.includes("not proceeding") ||
    s.includes("declined")
  ) {
    return "cancelled"
  }
  if (s.includes("completed") || s.includes("complete")) return "completed"
  return "active"
}

function getStatusBadgeColor(item: WorkItemLike) {
  switch (determineStatus(item)) {
    case "completed":
      return "bg-emerald-100 text-emerald-700 border-emerald-200"
    case "cancelled":
      return "bg-rose-100 text-rose-700 border-rose-200"
    default:
      return "bg-sky-100 text-sky-700 border-sky-200"
  }
}

function formatDate(d?: string) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  })
}

function isOverdueRow(item: WorkItemLike): boolean {
  if (!item.DueDate) return false
  if (determineStatus(item) !== "active") return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(item.DueDate) < today
}

interface WorkItemsTableProps {
  items: WorkItemLike[]
  loading?: boolean
}

export function WorkItemsTable({ items, loading }: WorkItemsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("due")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  /**
   * Cycle asc → desc → null when the user re-clicks the same header.
   * Clicking a new header always starts at asc.
   */
  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir("asc")
      return
    }
    if (sortDir === "asc") setSortDir("desc")
    else if (sortDir === "desc") setSortDir(null)
    else setSortDir("asc")
  }

  const sorted = useMemo(() => {
    if (!sortDir) return items
    const dir = sortDir === "asc" ? 1 : -1
    const get = (item: WorkItemLike) => {
      switch (sortKey) {
        case "title":
          return (item.Title || "").toLowerCase()
        case "client":
          return (item.ClientName || "").toLowerCase()
        case "type":
          return (item.WorkType || "").toLowerCase()
        case "status":
          return (item.WorkStatus || "").toLowerCase()
        case "assignee":
          return asAssignees(item.AssignedTo)
            .map((a) => a.FullName)
            .join(", ")
            .toLowerCase()
        case "due": {
          // Null/missing dates sort last regardless of direction so the
          // "no due date" rows don't crowd the top.
          const t = item.DueDate ? new Date(item.DueDate).getTime() : null
          return t
        }
        case "priority":
          return priorityRank(item.Priority)
      }
    }
    return [...items].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [items, sortKey, sortDir])

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-10 text-muted-foreground">
        <CheckSquare className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm font-medium">No work items match the current filters</p>
        <p className="text-xs">Adjust filters or clear them to see more rows.</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <SortableHeader label="Work Item" colKey="title" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader label="Client" colKey="client" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader
              label="Assignee"
              colKey="assignee"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
            />
            <SortableHeader label="Due" colKey="due" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader
              label="Priority"
              colKey="priority"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              align="right"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((item) => {
            const assignees = asAssignees(item.AssignedTo)
            const overdue = isOverdueRow(item)
            return (
              <TableRow key={item.WorkKey} className="text-xs">
                <TableCell className="py-2">
                  <a
                    href={getKarbonWorkItemUrl(item.WorkKey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline inline-flex items-center gap-1 max-w-[420px]"
                  >
                    <span className="truncate">{item.Title}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                  </a>
                  <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                    {item.WorkKey}
                  </div>
                </TableCell>
                <TableCell className="py-2 max-w-[220px]">
                  <span className="truncate block">{item.ClientName || "—"}</span>
                </TableCell>
                <TableCell className="py-2">
                  {item.WorkType ? (
                    <Badge
                      className={cn(
                        "text-[10px] h-5",
                        getServiceLineColor(item.WorkType as ServiceLine),
                      )}
                    >
                      {item.WorkType}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  <Badge variant="outline" className={cn("text-[10px] h-5 border", getStatusBadgeColor(item))}>
                    {item.WorkStatus || determineStatus(item)}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 max-w-[180px]">
                  {assignees.length === 0 ? (
                    <span className="text-muted-foreground italic">Unassigned</span>
                  ) : (
                    <span className="truncate block">{assignees.map((a) => a.FullName).join(", ")}</span>
                  )}
                </TableCell>
                <TableCell className={cn("py-2 tabular-nums", overdue && "text-rose-600 font-medium")}>
                  {formatDate(item.DueDate)}
                </TableCell>
                <TableCell className="py-2 text-right">
                  {item.Priority ? (
                    <Badge className={cn("text-[10px] h-5", getPriorityColor(item.Priority))}>
                      {item.Priority}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function SortableHeader({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string
  colKey: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  align?: "left" | "right"
}) {
  const isActive = sortKey === colKey && !!sortDir
  const Icon = !isActive ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={cn("text-xs", align === "right" && "text-right")}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSort(colKey)}
        className={cn(
          "h-7 px-2 -ml-2 text-xs font-medium gap-1",
          align === "right" && "ml-auto -mr-2",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" />
      </Button>
    </TableHead>
  )
}
