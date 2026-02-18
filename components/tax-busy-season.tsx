"use client"

import type React from "react"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Loader2,
  ChevronDown,
  Calendar,
  User,
  X,
  AlertCircle,
  FileText,
  Clock,
  CheckCircle2,
  RefreshCw,
  Filter,
  ExternalLink,
  Search,
} from "lucide-react"
import { TAX_RETURN_WORK_TYPES } from "@/lib/karbon-api"
import { useKarbonWorkItems } from "@/contexts/karbon-work-items-context"

interface KarbonWorkItem {
  WorkKey: string
  Title: string
  Description?: string
  WorkType?: string
  ClientKey?: string
  ClientName?: string
  ClientType?: string
  WorkStatus?: string
  StartDate?: string
  DueDate?: string
  CompletedDate?: string
  AssignedTo?:
    | { FullName: string; Email?: string; UserKey?: string }
    | { FullName: string; Email?: string; UserKey?: string }[]
  CreatedDate?: string
  ModifiedDate?: string
  EstimatedBudget?: number
  ActualTime?: number
}

interface TaxWorkItem extends KarbonWorkItem {
  taxYear: number
  returnType: string
}

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-gray-100 text-gray-700 border-gray-300",
  "In Progress": "bg-blue-100 text-blue-700 border-blue-300",
  Waiting: "bg-amber-100 text-amber-700 border-amber-300",
  Completed: "bg-green-100 text-green-700 border-green-300",
  Cancelled: "bg-red-100 text-red-700 border-red-300",
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "Not Started":
      return <AlertCircle className="h-3.5 w-3.5" />
    case "In Progress":
      return <Clock className="h-3.5 w-3.5" />
    case "Waiting":
      return <FileText className="h-3.5 w-3.5" />
    case "Completed":
      return <CheckCircle2 className="h-3.5 w-3.5" />
    default:
      return <FileText className="h-3.5 w-3.5" />
  }
}

// Extract tax year from title (e.g., "2024 Tax Return" or "Tax Return 2024")
function extractTaxYear(title: string): number {
  const yearMatch = title.match(/\b(20\d{2})\b/)
  if (yearMatch) {
    return Number.parseInt(yearMatch[1])
  }
  return new Date().getFullYear()
}

// Get short return type from work type
function getReturnType(workType: string): string {
  if (workType.includes("709")) return "709 (Gift)"
  if (workType.includes("1120S") || workType.includes("S-Corp")) return "1120S (S-Corp)"
  if (workType.includes("1120") && !workType.includes("1120S")) return "1120 (C-Corp)"
  if (workType.includes("1040c")) return "1040c (Individual)"
  if (workType.includes("1040")) return "1040 (Individual)"
  if (workType.includes("990")) return "990 (Non-Profit)"
  if (workType.includes("1065")) return "1065 (Partnership)"
  if (workType.includes("Trusts") || workType.includes("Estates")) return "1041 (Trusts/Estates)"
  return workType
}

// Normalize AssignedTo to always be an array
function normalizeAssignedTo(
  assignedTo: KarbonWorkItem["AssignedTo"],
): { FullName: string; Email?: string; UserKey?: string }[] {
  if (!assignedTo) return []
  if (Array.isArray(assignedTo)) return assignedTo
  return [assignedTo]
}

// Multi-select dropdown filter component
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  icon: Icon,
}: {
  label: string
  options: { value: string; label: string; count?: number }[]
  selected: string[]
  onChange: (selected: string[]) => void
  icon?: React.ElementType
}) {
  const [open, setOpen] = useState(false)

  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const selectAll = () => {
    onChange(options.map((o) => o.value))
  }

  const clearAll = () => {
    onChange([])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs bg-transparent">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 ml-0.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex items-center justify-between mb-2 pb-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={selectAll}>
              All
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={clearAll}>
              Clear
            </Button>
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
            >
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={() => toggleOption(option.value)}
                className="h-3.5 w-3.5"
              />
              <span className="flex-1 truncate">{option.label}</span>
              {option.count !== undefined && <span className="text-xs text-muted-foreground">{option.count}</span>}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function TaxBusySeason() {
  const { activeWorkItems, isLoading: loading, error: contextError, refresh } = useKarbonWorkItems()
  const error = contextError
  const [selectedItem, setSelectedItem] = useState<TaxWorkItem | null>(null)

  // Filters
  const [selectedReturnTypes, setSelectedReturnTypes] = useState<string[]>([])
  const [selectedYears, setSelectedYears] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState("")

  // Derive tax work items from the shared context (completed already excluded)
  const workItems = useMemo<TaxWorkItem[]>(() => {
    return activeWorkItems
      .filter((item) => {
        const workType = item.WorkType || ""
        return TAX_RETURN_WORK_TYPES.some((type) => type.toLowerCase() === workType.toLowerCase())
      })
      .map((item) => ({
        ...item,
        taxYear: extractTaxYear(item.Title || ""),
        returnType: getReturnType(item.WorkType || ""),
      }))
  }, [activeWorkItems])

  // Get unique filter options with counts
  const filterOptions = useMemo(() => {
    const returnTypes = new Map<string, number>()
    const years = new Map<string, number>()
    const statuses = new Map<string, number>()
    const assignees = new Map<string, number>()

    workItems.forEach((item) => {
      // Return types
      const rt = item.returnType
      returnTypes.set(rt, (returnTypes.get(rt) || 0) + 1)

      // Years
      const year = item.taxYear.toString()
      years.set(year, (years.get(year) || 0) + 1)

      // Statuses
      const status = item.WorkStatus || "Unknown"
      statuses.set(status, (statuses.get(status) || 0) + 1)

      // Assignees
      const assigned = normalizeAssignedTo(item.AssignedTo)
      if (assigned.length > 0) {
        assigned.forEach((a) => {
          assignees.set(a.FullName, (assignees.get(a.FullName) || 0) + 1)
        })
      } else {
        assignees.set("Unassigned", (assignees.get("Unassigned") || 0) + 1)
      }
    })

    return {
      returnTypes: Array.from(returnTypes.entries())
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      years: Array.from(years.entries())
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => b.label.localeCompare(a.label)),
      statuses: Array.from(statuses.entries())
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      assignees: Array.from(assignees.entries())
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }
  }, [workItems])

  // Helper to format relative time for last updated
  const formatLastUpdated = (dateString?: string) => {
    if (!dateString) return null
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // Filtered work items
  const filteredItems = useMemo(() => {
    let filtered = workItems.filter((item) => {
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const clientName = (item.ClientName || "").toLowerCase()
        const title = (item.Title || "").toLowerCase()
        const assignees = normalizeAssignedTo(item.AssignedTo).map(a => a.FullName.toLowerCase()).join(" ")
        if (!clientName.includes(query) && !title.includes(query) && !assignees.includes(query)) {
          return false
        }
      }

      // Return type filter
      if (selectedReturnTypes.length > 0 && !selectedReturnTypes.includes(item.returnType)) {
        return false
      }

      // Year filter
      if (selectedYears.length > 0 && !selectedYears.includes(item.taxYear.toString())) {
        return false
      }

      // Status filter
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(item.WorkStatus || "Unknown")) {
        return false
      }

      // Assignee filter
      if (selectedAssignees.length > 0) {
        const assigned = normalizeAssignedTo(item.AssignedTo)
        const assigneeNames = assigned.length > 0 ? assigned.map((a) => a.FullName) : ["Unassigned"]
        if (!assigneeNames.some((name) => selectedAssignees.includes(name))) {
          return false
        }
      }

      return true
    })

    // Sort by ModifiedDate (most recent first)
    return filtered.sort((a, b) => {
      const dateA = a.ModifiedDate ? new Date(a.ModifiedDate).getTime() : 0
      const dateB = b.ModifiedDate ? new Date(b.ModifiedDate).getTime() : 0
      return dateB - dateA
    })
  }, [workItems, selectedReturnTypes, selectedYears, selectedStatuses, selectedAssignees, searchQuery])

  // Stats
  const stats = useMemo(() => {
    const byStatus = new Map<string, number>()
    filteredItems.forEach((item) => {
      const status = item.WorkStatus || "Unknown"
      byStatus.set(status, (byStatus.get(status) || 0) + 1)
    })
    return {
      total: filteredItems.length,
      notStarted: byStatus.get("Not Started") || 0,
      inProgress: byStatus.get("In Progress") || 0,
      waiting: byStatus.get("Waiting") || 0,
      completed: byStatus.get("Completed") || 0,
    }
  }, [filteredItems])

  const hasActiveFilters =
    selectedReturnTypes.length > 0 ||
    selectedYears.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedAssignees.length > 0

  const clearAllFilters = () => {
    setSelectedReturnTypes([])
    setSelectedYears([])
    setSelectedStatuses([])
    setSelectedAssignees([])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-destructive">{error}</p>
        <Button onClick={refresh} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tax Returns - Busy Season</h1>
          <p className="text-sm text-muted-foreground">{workItems.length} tax returns from Karbon</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients, titles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[280px]"
            />
          </div>
          <Button onClick={refresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Not Started</div>
          <div className="text-2xl font-bold text-gray-600">{stats.notStarted}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">In Progress</div>
          <div className="text-2xl font-bold text-blue-600">{stats.inProgress}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Waiting</div>
          <div className="text-2xl font-bold text-amber-600">{stats.waiting}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Completed</div>
          <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <MultiSelectFilter
          label="Return Type"
          options={filterOptions.returnTypes}
          selected={selectedReturnTypes}
          onChange={setSelectedReturnTypes}
          icon={FileText}
        />
        <MultiSelectFilter
          label="Year"
          options={filterOptions.years}
          selected={selectedYears}
          onChange={setSelectedYears}
          icon={Calendar}
        />
        <MultiSelectFilter
          label="Status"
          options={filterOptions.statuses}
          selected={selectedStatuses}
          onChange={setSelectedStatuses}
          icon={Clock}
        />
        <MultiSelectFilter
          label="Assignee"
          options={filterOptions.assignees}
          selected={selectedAssignees}
          onChange={setSelectedAssignees}
          icon={User}
        />
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearAllFilters}>
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Work Items List */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">Tax Returns ({filteredItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {filteredItems.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">No tax returns match the current filters</div>
            ) : (
              filteredItems.map((item) => {
                const assigned = normalizeAssignedTo(item.AssignedTo)
                const dueDate = item.DueDate ? new Date(item.DueDate) : null
                const isOverdue = dueDate && dueDate < new Date() && item.WorkStatus !== "Completed"

                return (
                  <div
                    key={item.WorkKey}
                    className="px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <a
                            href={item.karbon_url || `https://app2.karbonhq.com/work/${item.WorkKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium truncate hover:underline flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.ClientName || item.Title}
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                            {item.returnType}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                            {item.taxYear}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          {dueDate && (
                            <span className={`flex items-center gap-1 ${isOverdue ? "text-red-600" : ""}`}>
                              <Calendar className="h-3 w-3" />
                              Due: {dueDate.toLocaleDateString()}
                            </span>
                          )}
                          {assigned.length > 0 && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {assigned.map((a) => a.FullName).join(", ")}
                            </span>
                          )}
                          {item.ModifiedDate && (
                            <span className="flex items-center gap-1 text-muted-foreground/70">
                              <Clock className="h-3 w-3" />
                              Updated {formatLastUpdated(item.ModifiedDate)}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`${STATUS_COLORS[item.WorkStatus || ""] || "bg-gray-100 text-gray-700"} text-[10px] px-1.5 py-0.5 shrink-0 flex items-center gap-1`}
                      >
                        {getStatusIcon(item.WorkStatus || "")}
                        {item.WorkStatus}
                      </Badge>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedItem?.ClientName || selectedItem?.Title}</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Return Type</div>
                  <div className="font-medium">{selectedItem.returnType}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Tax Year</div>
                  <div className="font-medium">{selectedItem.taxYear}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Status</div>
                  <Badge variant="outline" className={`${STATUS_COLORS[selectedItem.WorkStatus || ""] || ""}`}>
                    {selectedItem.WorkStatus}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Due Date</div>
                  <div className="font-medium">
                    {selectedItem.DueDate ? new Date(selectedItem.DueDate).toLocaleDateString() : "Not set"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Last Updated</div>
                  <div className="font-medium">
                    {selectedItem.ModifiedDate 
                      ? `${formatLastUpdated(selectedItem.ModifiedDate)} (${new Date(selectedItem.ModifiedDate).toLocaleDateString()})`
                      : "Not available"}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground text-xs mb-1">Assigned To</div>
                  <div className="font-medium">
                    {normalizeAssignedTo(selectedItem.AssignedTo).length > 0
                      ? normalizeAssignedTo(selectedItem.AssignedTo)
                          .map((a) => a.FullName)
                          .join(", ")
                      : "Unassigned"}
                  </div>
                </div>
                {selectedItem.Description && (
                  <div className="col-span-2">
                    <div className="text-muted-foreground text-xs mb-1">Description</div>
                    <div className="text-sm">{selectedItem.Description}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
