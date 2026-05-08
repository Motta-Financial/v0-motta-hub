"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ExpandableCard } from "@/components/ui/expandable-card"
import {
  bucketServiceType,
  bucketStatus,
  formatShortDate,
  getAssigneeLabel,
  getClientLabel,
  SERVICE_TYPE_ORDER,
  STATUS_BUCKETS,
  STATUS_COLORS,
  useAccountingWorkItems,
  type ServiceType,
  type StatusBucket,
} from "./project-plan-shared"
import { useProjectPlanContext } from "./project-plan-context"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RotateCcw,
  Search,
  Users,
} from "lucide-react"

// Mirrors the "Client Roster" tab — a searchable, filterable detail
// listing of every active ACCT work item with status, service type,
// dates, assignee, and a link out to Karbon. Now powered by:
//   • Per-column filter inputs in a second header row (text inputs for
//     freeform columns, dropdowns for enumerable ones, ISO-prefix match
//     for date columns).
//   • Click-to-sort on every header (3-state: asc → desc → none).
//   • Click-to-expand row that exposes Karbon key, work_type, dates,
//     assignee in a slide-down detail row.
//   • Shared filters from ProjectPlanContext so deep-links from the
//     Dashboard land here pre-filtered.

// ---- Sort plumbing ---------------------------------------------------------

type SortColumn =
  | "client"
  | "title"
  | "service"
  | "status"
  | "start"
  | "due"
  | "assignee"

type SortDir = "asc" | "desc" | null

interface RosterFilters {
  client: string
  title: string
  service: ServiceType | "ALL"
  status: StatusBucket | "ALL"
  start: string
  due: string
  assignee: string
}

const EMPTY_FILTERS: RosterFilters = {
  client: "",
  title: "",
  service: "ALL",
  status: "ALL",
  start: "",
  due: "",
  assignee: "ALL",
}

// Render the Client Roster tab. Top of the body keeps a global free-text
// search; the table itself has per-column filters in row 2 and clickable
// headers for sort. Both filter sources combine via AND.
export function ProjectPlanClientRoster() {
  const { activeWorkItems, isLoading } = useAccountingWorkItems()
  const { filters: shared, setFilters: setShared, resetFilters: resetShared } = useProjectPlanContext()

  // Column filters are local-only — they don't bleed into the cross-tab
  // ProjectPlanContext because they're roster-table-specific (e.g.
  // matching a substring of the work-item title isn't meaningful in the
  // Kanban view).
  const [columnFilters, setColumnFilters] = useState<RosterFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<{ col: SortColumn; dir: Exclude<SortDir, null> } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // The shared filters come from the cross-tab Context (Dashboard
  // drill-throughs land here) and apply *in addition to* the column
  // filters. We seed the assignee dropdown options from the same
  // active-items list so a deep-link to a now-empty assignee still
  // shows that selection in the Select.
  const assignees = useMemo(() => {
    const set = new Set<string>()
    for (const item of activeWorkItems) set.add(getAssigneeLabel(item))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [activeWorkItems])

  const filtered = useMemo(() => {
    const q = shared.query.trim().toLowerCase()
    const cf = columnFilters
    const cClient = cf.client.trim().toLowerCase()
    const cTitle = cf.title.trim().toLowerCase()
    const cStart = cf.start.trim().toLowerCase()
    const cDue = cf.due.trim().toLowerCase()

    return activeWorkItems.filter((item) => {
      const status = bucketStatus(item)
      const service = bucketServiceType(item)
      const assignee = getAssigneeLabel(item)
      const clientLabel = getClientLabel(item)
      const title = (item.title || item.Title || "").toString()
      const start = (item.start_date || item.StartDate || "").toString().slice(0, 10) // YYYY-MM-DD
      const due = (item.due_date || item.DueDate || "").toString().slice(0, 10)

      // ---- Cross-tab (shared) filters
      if (shared.status !== "ALL" && status !== shared.status) return false
      if (shared.service !== "ALL" && service !== shared.service) return false
      if (shared.assignee !== "ALL" && assignee !== shared.assignee) return false
      if (q) {
        const haystack = [
          title,
          clientLabel,
          item.client_group_name || item.ClientGroupName,
          item.work_type || item.WorkType,
          assignee,
          item.karbon_work_item_key || item.WorkKey,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }

      // ---- Per-column filters
      if (cf.status !== "ALL" && status !== cf.status) return false
      if (cf.service !== "ALL" && service !== cf.service) return false
      if (cf.assignee !== "ALL" && assignee !== cf.assignee) return false
      if (cClient && !clientLabel.toLowerCase().includes(cClient)) return false
      if (cTitle) {
        const titleHay = `${title} ${(item.karbon_work_item_key || item.WorkKey || "")}`.toLowerCase()
        if (!titleHay.includes(cTitle)) return false
      }
      // Date filters do prefix matches on the ISO string so users can
      // type "2026" (whole year) or "2026-03" (month) without committing
      // to a full date picker UI.
      if (cStart && !start.startsWith(cStart)) return false
      if (cDue && !due.startsWith(cDue)) return false
      return true
    })
  }, [activeWorkItems, shared, columnFilters])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const dir = sort.dir === "asc" ? 1 : -1
    const cmp = (a: typeof filtered[number], b: typeof filtered[number]) => {
      let av: string | number = ""
      let bv: string | number = ""
      switch (sort.col) {
        case "client":
          av = getClientLabel(a).toLowerCase()
          bv = getClientLabel(b).toLowerCase()
          break
        case "title":
          av = (a.title || a.Title || "").toString().toLowerCase()
          bv = (b.title || b.Title || "").toString().toLowerCase()
          break
        case "service":
          av = bucketServiceType(a)
          bv = bucketServiceType(b)
          break
        case "status":
          av = bucketStatus(a)
          bv = bucketStatus(b)
          break
        case "start": {
          const at = new Date(a.start_date || a.StartDate || "").getTime()
          const bt = new Date(b.start_date || b.StartDate || "").getTime()
          av = Number.isFinite(at) ? at : Number.POSITIVE_INFINITY
          bv = Number.isFinite(bt) ? bt : Number.POSITIVE_INFINITY
          break
        }
        case "due": {
          const at = new Date(a.due_date || a.DueDate || "").getTime()
          const bt = new Date(b.due_date || b.DueDate || "").getTime()
          av = Number.isFinite(at) ? at : Number.POSITIVE_INFINITY
          bv = Number.isFinite(bt) ? bt : Number.POSITIVE_INFINITY
          break
        }
        case "assignee":
          av = getAssigneeLabel(a).toLowerCase()
          bv = getAssigneeLabel(b).toLowerCase()
          break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    }
    // Stable sort: Array.prototype.sort is stable in modern engines, so
    // ties keep their previous order — important for the date columns
    // where many rows share a month.
    return [...filtered].sort(cmp)
  }, [filtered, sort])

  const visible = sorted.slice(0, 500)

  function toggleSort(col: SortColumn) {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" }
      if (prev.dir === "asc") return { col, dir: "desc" }
      return null // third click clears
    })
  }

  function clearAllFilters() {
    setColumnFilters(EMPTY_FILTERS)
    setSort(null)
    resetShared()
  }

  const hasActiveFilters =
    columnFilters !== EMPTY_FILTERS &&
    (columnFilters.client !== "" ||
      columnFilters.title !== "" ||
      columnFilters.service !== "ALL" ||
      columnFilters.status !== "ALL" ||
      columnFilters.start !== "" ||
      columnFilters.due !== "" ||
      columnFilters.assignee !== "ALL" ||
      shared.query !== "" ||
      shared.status !== "ALL" ||
      shared.service !== "ALL" ||
      shared.assignee !== "ALL")

  if (isLoading && !activeWorkItems.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
          Loading client roster…
        </CardContent>
      </Card>
    )
  }

  return (
    <ExpandableCard
      title="Client Roster"
      description={`${sorted.length.toLocaleString()} of ${activeWorkItems.length.toLocaleString()} ACCT work items${
        hasActiveFilters ? " (filtered)" : ""
      }`}
      icon={<Users className="h-5 w-5 text-blue-600" />}
      badge={hasActiveFilters ? (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
          Filters active
        </Badge>
      ) : undefined}
      actions={
        hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              clearAllFilters()
            }}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Clear
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Top-of-card global controls — search across all columns plus
            the cross-tab status / service / assignee selects (shared so
            they persist when the user jumps tabs). */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={shared.query}
              onChange={(e) => setShared({ query: e.target.value })}
              placeholder="Search client, title, work type, or Karbon key"
              className="pl-9"
            />
          </div>
          <Select
            value={shared.status}
            onValueChange={(v) => setShared({ status: v as StatusBucket | "ALL" })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUS_BUCKETS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={shared.service}
            onValueChange={(v) => setShared({ service: v as ServiceType | "ALL" })}
          >
            <SelectTrigger>
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
        <Select
          value={shared.assignee}
          onValueChange={(v) => setShared({ assignee: v })}
        >
          <SelectTrigger className="md:max-w-sm">
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

        {/* Roster table with per-column filters + sortable headers */}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              {/* Header row 1 — sortable column titles */}
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 font-medium w-8" aria-label="Expand row" />
                <SortableHeader label="Client" col="client" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Work Item" col="title" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Service" col="service" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Status" col="status" sort={sort} onSort={toggleSort} />
                <SortableHeader
                  label="Start"
                  col="start"
                  sort={sort}
                  onSort={toggleSort}
                  className="whitespace-nowrap"
                />
                <SortableHeader
                  label="Due"
                  col="due"
                  sort={sort}
                  onSort={toggleSort}
                  className="whitespace-nowrap"
                />
                <SortableHeader label="Assignee" col="assignee" sort={sort} onSort={toggleSort} />
                <th className="py-2 px-3 font-medium" />
              </tr>
              {/* Header row 2 — per-column filters */}
              <tr className="border-b bg-muted/20 text-xs">
                <th className="py-1.5 px-3 w-8" />
                <th className="py-1.5 px-3">
                  <Input
                    value={columnFilters.client}
                    onChange={(e) => setColumnFilters((f) => ({ ...f, client: e.target.value }))}
                    placeholder="Filter…"
                    className="h-7 text-xs"
                  />
                </th>
                <th className="py-1.5 px-3">
                  <Input
                    value={columnFilters.title}
                    onChange={(e) => setColumnFilters((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Filter title or key…"
                    className="h-7 text-xs"
                  />
                </th>
                <th className="py-1.5 px-3">
                  <Select
                    value={columnFilters.service}
                    onValueChange={(v) =>
                      setColumnFilters((f) => ({ ...f, service: v as ServiceType | "ALL" }))
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All</SelectItem>
                      {SERVICE_TYPE_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </th>
                <th className="py-1.5 px-3">
                  <Select
                    value={columnFilters.status}
                    onValueChange={(v) =>
                      setColumnFilters((f) => ({ ...f, status: v as StatusBucket | "ALL" }))
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All</SelectItem>
                      {STATUS_BUCKETS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </th>
                <th className="py-1.5 px-3">
                  <Input
                    value={columnFilters.start}
                    onChange={(e) => setColumnFilters((f) => ({ ...f, start: e.target.value }))}
                    placeholder="YYYY or YYYY-MM"
                    className="h-7 text-xs"
                  />
                </th>
                <th className="py-1.5 px-3">
                  <Input
                    value={columnFilters.due}
                    onChange={(e) => setColumnFilters((f) => ({ ...f, due: e.target.value }))}
                    placeholder="YYYY or YYYY-MM"
                    className="h-7 text-xs"
                  />
                </th>
                <th className="py-1.5 px-3">
                  <Select
                    value={columnFilters.assignee}
                    onValueChange={(v) => setColumnFilters((f) => ({ ...f, assignee: v }))}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All</SelectItem>
                      {assignees.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </th>
                <th className="py-1.5 px-3" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    No work items match those filters.
                  </td>
                </tr>
              ) : (
                visible.map((item) => {
                  const status = bucketStatus(item)
                  const tone = STATUS_COLORS[status]
                  const id = item.karbon_work_item_key || item.id || ""
                  const isExpanded = expandedId === id
                  return (
                    <RosterRow
                      key={id}
                      id={id}
                      item={item}
                      status={status}
                      tone={tone}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : id)}
                    />
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 500 && (
          <p className="text-xs text-muted-foreground">
            Showing the first 500 of {sorted.length.toLocaleString()} matches — refine filters to
            narrow the list.
          </p>
        )}
      </div>
    </ExpandableCard>
  )
}

// ---- Header cell with sort indicator --------------------------------------

function SortableHeader({
  label,
  col,
  sort,
  onSort,
  className = "",
}: {
  label: string
  col: SortColumn
  sort: { col: SortColumn; dir: Exclude<SortDir, null> } | null
  onSort: (col: SortColumn) => void
  className?: string
}) {
  const active = sort?.col === col
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown
  return (
    <th className={`py-2 px-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground" : ""
        }`}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  )
}

// ---- Roster row + expandable detail ---------------------------------------

function RosterRow({
  id,
  item,
  status,
  tone,
  isExpanded,
  onToggle,
}: {
  id: string
  item: ReturnType<typeof useAccountingWorkItems>["activeWorkItems"][number]
  status: StatusBucket
  tone: typeof STATUS_COLORS[StatusBucket]
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <td className="py-2 px-3 w-8">
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </td>
        <td className="py-2 px-3 font-medium">{getClientLabel(item)}</td>
        <td className="py-2 px-3 max-w-xs">
          <p className="truncate" title={item.title || item.Title}>
            {item.title || item.Title}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {item.karbon_work_item_key || item.WorkKey}
          </p>
        </td>
        <td className="py-2 px-3 text-xs">{bucketServiceType(item)}</td>
        <td className="py-2 px-3">
          <Badge variant="outline" className={`${tone.bg} ${tone.text} ${tone.border} text-xs`}>
            {status}
          </Badge>
        </td>
        <td className="py-2 px-3 whitespace-nowrap text-xs text-muted-foreground">
          {formatShortDate(item.start_date || item.StartDate)}
        </td>
        <td className="py-2 px-3 whitespace-nowrap text-xs text-muted-foreground">
          {formatShortDate(item.due_date || item.DueDate)}
        </td>
        <td className="py-2 px-3 text-xs">{getAssigneeLabel(item)}</td>
        <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
          {item.karbon_url ? (
            <Link
              href={item.karbon_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              Karbon
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b last:border-0 bg-muted/20">
          <td />
          <td colSpan={8} className="py-3 px-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <DetailField label="Karbon Key" value={item.karbon_work_item_key || item.WorkKey || "—"} mono />
              <DetailField label="Work Type" value={item.work_type || item.WorkType || "—"} />
              <DetailField label="Workflow Status" value={item.workflow_status || item.WorkStatus || "—"} />
              <DetailField label="Priority" value={item.priority || item.Priority || "—"} />
              <DetailField
                label="Client Group"
                value={item.client_group_name || item.ClientGroupName || "—"}
              />
              <DetailField
                label="Last Modified"
                value={formatShortDate(item.karbon_modified_at || item.LastModifiedDateTime)}
              />
              <DetailField
                label="Completed"
                value={formatShortDate(item.completed_date || item.CompletedDate)}
              />
              <DetailField label="Assignee" value={getAssigneeLabel(item)} />
              {item.description || item.Description ? (
                <div className="md:col-span-2 lg:col-span-4">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Description
                  </p>
                  <p className="text-xs whitespace-pre-wrap">{item.description || item.Description}</p>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xs ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}
