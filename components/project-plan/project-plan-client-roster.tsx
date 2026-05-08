"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useKarbonWorkItems } from "@/contexts/karbon-work-items-context"
import {
  bucketServiceType,
  bucketStatus,
  formatShortDate,
  getAssigneeLabel,
  getClientLabel,
  SERVICE_TYPE_ORDER,
  STATUS_BUCKETS,
  STATUS_COLORS,
  type ServiceType,
  type StatusBucket,
} from "./project-plan-shared"
import { ExternalLink, Loader2, Search } from "lucide-react"

// Mirrors the "Client Roster" tab — a searchable, filterable detail listing
// of every active work item with status, service type, dates, assignee,
// and a link out to Karbon.
export function ProjectPlanClientRoster() {
  const { activeWorkItems, isLoading } = useKarbonWorkItems()
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusBucket | "ALL">("ALL")
  const [serviceFilter, setServiceFilter] = useState<ServiceType | "ALL">("ALL")
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL")

  const assignees = useMemo(() => {
    const set = new Set<string>()
    for (const item of activeWorkItems) set.add(getAssigneeLabel(item))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [activeWorkItems])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return activeWorkItems
      .filter((item) => {
        const status = bucketStatus(item)
        const service = bucketServiceType(item)
        const assignee = getAssigneeLabel(item)
        if (statusFilter !== "ALL" && status !== statusFilter) return false
        if (serviceFilter !== "ALL" && service !== serviceFilter) return false
        if (assigneeFilter !== "ALL" && assignee !== assigneeFilter) return false
        if (!q) return true
        const haystack = [
          item.title || item.Title,
          item.client_name || item.ClientName,
          item.client_group_name || item.ClientGroupName,
          item.work_type || item.WorkType,
          item.assignee_name || item.AssigneeName,
          item.karbon_work_item_key || item.WorkKey,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return haystack.includes(q)
      })
      .slice(0, 500) // cap render volume; full set is in the dashboard tab
  }, [activeWorkItems, query, statusFilter, serviceFilter, assigneeFilter])

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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Client Roster</CardTitle>
        <CardDescription>
          {filtered.length} of {activeWorkItems.length} active work items
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client, title, work type, or Karbon key"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusBucket | "ALL")}>
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
            value={serviceFilter}
            onValueChange={(v) => setServiceFilter(v as ServiceType | "ALL")}
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
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
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

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 font-medium">Client</th>
                <th className="py-2 px-3 font-medium">Work Item</th>
                <th className="py-2 px-3 font-medium">Service</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 px-3 font-medium whitespace-nowrap">Start</th>
                <th className="py-2 px-3 font-medium whitespace-nowrap">Due</th>
                <th className="py-2 px-3 font-medium">Assignee</th>
                <th className="py-2 px-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    No work items match those filters.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const status = bucketStatus(item)
                  const tone = STATUS_COLORS[status]
                  return (
                    <tr key={item.karbon_work_item_key || item.id} className="border-b last:border-0 hover:bg-muted/40">
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
                        <Badge
                          variant="outline"
                          className={`${tone.bg} ${tone.text} ${tone.border} text-xs`}
                        >
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
                      <td className="py-2 px-3 text-right">
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
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length === 500 && (
          <p className="text-xs text-muted-foreground">
            Showing the first 500 matches — refine filters to narrow the list.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
