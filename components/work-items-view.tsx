"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CheckSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  User,
  Building2,
  Search,
  ExternalLink,
  ChevronDown,
  X,
  Database,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { getServiceLineColor, type ServiceLine } from "@/lib/service-lines"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ViewManager } from "@/components/view-manager"
import type { FilterView } from "@/lib/view-types"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface WorkItem {
  WorkItemKey: string
  Title: string
  ClientName?: string
  ClientKey?: string
  WorkStatus?: string
  StartDate?: string
  DueDate?: string
  CompletedDate?: string
  WorkType?: string
  AssignedTo?:
    | {
        FullName: string
        Email: string
        UserKey?: string
      }
    | Array<{
        FullName: string
        Email: string
        UserKey?: string
      }>
  Priority?: string
  Description?: string
  ClientGroup?: { Name: string }
  ClientGroupName?: string
}

export function WorkItemsView() {
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("active")
  const [selectedServiceLines, setSelectedServiceLines] = useState<string[]>(["all"])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>("all")
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("")
  const [showAssignedToMe, setShowAssignedToMe] = useState(false)
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>(["all"])
  const [selectedWorkTypes, setSelectedWorkTypes] = useState<string[]>(["all"])
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>({})

  const [karbonData, setKarbonData] = useState<{
    workTypes: Record<string, number>
    statuses: Record<string, number>
    assignees: Record<string, number>
    clientGroups: Record<string, number>
    totalItems: number
    sampleItem: any
  } | null>(null)
  const [fetchingKarbonData, setFetchingKarbonData] = useState(false)
  const [showDataDialog, setShowDataDialog] = useState(false)

  const fetchWorkItems = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/karbon/work-items")

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to fetch work items")
      }

      const data = await response.json()
      setWorkItems(data.workItems || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work items")
    } finally {
      setLoading(false)
    }
  }

  const fetchKarbonData = async () => {
    setFetchingKarbonData(true)
    try {
      const response = await fetch("/api/karbon/work-items")
      const data = await response.json()

      if (data.value) {
        const items = data.value
        const workTypes: Record<string, number> = {}
        const statuses: Record<string, number> = {}
        const assignees: Record<string, number> = {}
        const clientGroups: Record<string, number> = {}

        items.forEach((item: any) => {
          // Work Types
          const workType = item.WorkType || "Unknown"
          workTypes[workType] = (workTypes[workType] || 0) + 1

          // Statuses
          const status = item.WorkItemStatus || item.ClientStatus || "Unknown"
          statuses[status] = (statuses[status] || 0) + 1

          // Assignees
          if (item.AssignedTo) {
            const assigned = Array.isArray(item.AssignedTo) ? item.AssignedTo : [item.AssignedTo]
            assigned.forEach((a: any) => {
              const name = a?.FullName || "Unassigned"
              assignees[name] = (assignees[name] || 0) + 1
            })
          }

          // Client Groups
          const clientGroup = item.ClientGroup?.Name || item.ClientGroupName || "No Group"
          clientGroups[clientGroup] = (clientGroups[clientGroup] || 0) + 1
        })

        setKarbonData({
          workTypes,
          statuses,
          assignees,
          clientGroups,
          totalItems: items.length,
          sampleItem: items[0],
        })
        setShowDataDialog(true)
      }
    } catch (error) {
      console.error("Error fetching Karbon data:", error)
    } finally {
      setFetchingKarbonData(false)
    }
  }

  useEffect(() => {
    fetchWorkItems()
  }, [])

  const determineStatus = (item: WorkItem): "completed" | "active" | "cancelled" => {
    const primaryStatus = item.WorkStatus?.toLowerCase() || ""
    const secondaryStatus = item.WorkStatus?.toLowerCase() || ""

    if (
      secondaryStatus.includes("cancelled") ||
      secondaryStatus.includes("canceled") ||
      secondaryStatus.includes("lost") ||
      secondaryStatus.includes("n/a") ||
      secondaryStatus.includes("not proceeding") ||
      secondaryStatus.includes("declined")
    ) {
      return "cancelled"
    }

    if (primaryStatus.includes("completed") || primaryStatus.includes("complete")) {
      return "completed"
    }

    return "active"
  }

  const getStatusColor = (item: WorkItem) => {
    const status = determineStatus(item)
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-700 border-green-300"
      case "cancelled":
        return "bg-red-100 text-red-700 border-red-300"
      case "active":
        return "bg-blue-100 text-blue-700 border-blue-300"
      default:
        return "bg-gray-100 text-gray-700 border-gray-300"
    }
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority?.toLowerCase()) {
      case "high":
        return "bg-red-100 text-red-700"
      case "medium":
        return "bg-yellow-100 text-yellow-700"
      case "low":
        return "bg-green-100 text-green-700"
      default:
        return "bg-gray-100 text-gray-700"
    }
  }

  const getServiceLines = (): string[] => {
    const serviceLines = new Set(workItems.map((item) => item.WorkType))
    const sortedLines = Array.from(serviceLines).sort()
    const filtered = sortedLines.filter((line) => line !== "OTHER")
    if (serviceLines.has("OTHER")) {
      filtered.push("OTHER")
    }
    return ["all", ...filtered]
  }

  const getServiceLineCount = (serviceLine: string) => {
    let baseItems = workItems

    if (selectedFiscalYear !== "all") {
      const targetFY = Number.parseInt(selectedFiscalYear)
      baseItems = baseItems.filter((item) => getWorkItemFiscalYear(item) === targetFY)
    }

    if (activeTab !== "all") {
      baseItems = baseItems.filter((item) => determineStatus(item) === activeTab)
    }

    if (serviceLine === "all") {
      return baseItems.length
    }
    return baseItems.filter((item) => item.WorkType === serviceLine).length
  }

  const getFiscalYear = (dateString?: string): number | null => {
    if (!dateString) return null
    const date = new Date(dateString)
    const year = date.getFullYear()
    const month = date.getMonth() + 1

    if (month >= 7) {
      return year + 1
    }
    return year
  }

  const getWorkItemFiscalYear = (item: WorkItem): number | null => {
    const fy = getFiscalYear(item.StartDate) || getFiscalYear(item.DueDate) || getFiscalYear(item.CompletedDate)
    return fy
  }

  const getAvailableFiscalYears = (): string[] => {
    const fiscalYears = new Set<number>()
    workItems.forEach((item) => {
      const fy = getWorkItemFiscalYear(item)
      if (fy) fiscalYears.add(fy)
    })
    return [
      "all",
      ...Array.from(fiscalYears)
        .sort((a, b) => b - a)
        .map(String),
    ]
  }

  const normalizeAssignedTo = (
    assignedTo: WorkItem["AssignedTo"],
  ): Array<{ FullName: string; Email: string; UserKey?: string }> => {
    if (!assignedTo) return []
    if (Array.isArray(assignedTo)) return assignedTo
    return [assignedTo]
  }

  const getAllAssignees = (): Array<{ email: string; name: string }> => {
    const assigneesMap = new Map<string, string>()

    workItems.forEach((item) => {
      const assignees = normalizeAssignedTo(item.AssignedTo)
      assignees.forEach((assignee) => {
        if (assignee.Email && assignee.FullName) {
          assigneesMap.set(assignee.Email, assignee.FullName)
        }
      })
    })

    return Array.from(assigneesMap.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const filterWorkItems = (items: WorkItem[], filter: string) => {
    let filtered = items

    if (selectedFiscalYear !== "all") {
      const targetFY = Number.parseInt(selectedFiscalYear)
      filtered = filtered.filter((item) => getWorkItemFiscalYear(item) === targetFY)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (item) =>
          item.Title?.toLowerCase().includes(query) ||
          item.ClientName?.toLowerCase().includes(query) ||
          item.WorkItemKey?.toLowerCase().includes(query),
      )
    }

    if (showAssignedToMe && currentUserEmail) {
      filtered = filtered.filter((item) =>
        normalizeAssignedTo(item.AssignedTo).some((assignee) => assignee.Email === currentUserEmail),
      )
    }

    if (!selectedServiceLines.includes("all")) {
      filtered = filtered.filter((item) => selectedServiceLines.includes(item.WorkType))
    }

    if (!selectedPriorities.includes("all")) {
      filtered = filtered.filter((item) => item.Priority && selectedPriorities.includes(item.Priority))
    }

    if (!selectedWorkTypes.includes("all")) {
      filtered = filtered.filter((item) => selectedWorkTypes.includes(item.WorkType))
    }

    if (dateRange.start || dateRange.end) {
      filtered = filtered.filter((item) => {
        const itemDate = item.DueDate || item.StartDate || item.CompletedDate
        if (!itemDate) return false
        const date = new Date(itemDate)
        if (dateRange.start && date < new Date(dateRange.start)) return false
        if (dateRange.end && date > new Date(dateRange.end)) return false
        return true
      })
    }

    switch (filter) {
      case "active":
        return filtered.filter((item) => determineStatus(item) === "active")
      case "completed":
        return filtered.filter((item) => determineStatus(item) === "completed")
      case "cancelled":
        return filtered.filter((item) => determineStatus(item) === "cancelled")
      default:
        return filtered
    }
  }

  const sortByActivity = (items: WorkItem[]) => {
    return [...items].sort((a, b) => {
      const getLatestDate = (item: WorkItem) => {
        const dates = [item.CompletedDate, item.DueDate, item.StartDate]
          .filter(Boolean)
          .map((d) => new Date(d!).getTime())
        return dates.length > 0 ? Math.max(...dates) : 0
      }

      return getLatestDate(b) - getLatestDate(a)
    })
  }

  const filteredItems = sortByActivity(filterWorkItems(workItems, activeTab))

  const formatDate = (dateString?: string) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const handleCardClick = (filter: string) => {
    setActiveTab(filter)
  }

  const toggleServiceLine = (serviceLine: string) => {
    if (serviceLine === "all") {
      setSelectedServiceLines(["all"])
    } else {
      setSelectedServiceLines((prev) => {
        const filtered = prev.filter((s) => s !== "all")
        if (filtered.includes(serviceLine)) {
          const newSelection = filtered.filter((s) => s !== serviceLine)
          return newSelection.length === 0 ? ["all"] : newSelection
        } else {
          return [...filtered, serviceLine]
        }
      })
    }
  }

  const getAllPriorities = () => {
    const priorities = new Set(workItems.map((item) => item.Priority).filter(Boolean))
    return ["all", ...Array.from(priorities).sort()]
  }

  const getAllWorkTypes = () => {
    const workTypes = new Set(workItems.map((item) => item.WorkType).filter(Boolean))
    return ["all", ...Array.from(workTypes).sort()]
  }

  const handleLoadView = (view: FilterView) => {
    if (view.filters.searchQuery !== undefined) setSearchQuery(view.filters.searchQuery)
    if (view.filters.serviceLines) setSelectedServiceLines(view.filters.serviceLines)
    if (view.filters.fiscalYear) setSelectedFiscalYear(view.filters.fiscalYear)
    if (view.filters.status) setActiveTab(view.filters.status)
    if (view.filters.assignedTo) setCurrentUserEmail(view.filters.assignedTo)
    if (view.filters.showAssignedToMe !== undefined) setShowAssignedToMe(view.filters.showAssignedToMe)
    if (view.filters.priority) setSelectedPriorities(view.filters.priority)
    if (view.filters.workType) setSelectedWorkTypes(view.filters.workType)
    if (view.filters.dateRange) setDateRange(view.filters.dateRange)
  }

  const getCurrentFilters = () => ({
    searchQuery,
    serviceLines: selectedServiceLines,
    fiscalYear: selectedFiscalYear,
    status: activeTab,
    assignedTo: currentUserEmail,
    showAssignedToMe,
    priority: selectedPriorities,
    workType: selectedWorkTypes,
    dateRange,
  })

  const getActiveFilterCount = () => {
    let count = 0
    if (!selectedServiceLines.includes("all")) count++
    if (selectedFiscalYear !== "all") count++
    if (!selectedPriorities.includes("all")) count++
    if (!selectedWorkTypes.includes("all")) count++
    if (dateRange.start || dateRange.end) count++
    if (showAssignedToMe) count++
    if (searchQuery.trim()) count++
    return count
  }

  const clearAllFilters = () => {
    setSelectedServiceLines(["all"])
    setSelectedFiscalYear("all")
    setSelectedPriorities(["all"])
    setSelectedWorkTypes(["all"])
    setDateRange({})
    setShowAssignedToMe(false)
    setSearchQuery("")
    setCurrentUserEmail("")
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#333333" }}>
              Work Items
            </h1>
            <p className="text-muted-foreground">Connected to Karbon</p>
          </div>
        </div>

        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              Connection Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="space-y-2 text-sm text-gray-700">
              <p className="font-semibold">To connect to Karbon, you need to:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Get your API keys from Karbon (Settings → Integrations → API)</li>
                <li>Add these environment variables to your project:</li>
              </ol>
              <div className="bg-white p-3 rounded border border-red-200 font-mono text-xs mt-2">
                <div>KARBON_ACCESS_KEY=your_access_key</div>
                <div>KARBON_BEARER_TOKEN=your_bearer_token</div>
              </div>
              <p className="mt-3">
                You can add these in the <strong>Vars</strong> section of the v0 sidebar.
              </p>
            </div>
            <Button onClick={fetchWorkItems} className="mt-4 bg-transparent" variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Connection
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#333333" }}>
            Work Items
          </h1>
          <p className="text-sm text-muted-foreground">Real-time data from Karbon</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showDataDialog} onOpenChange={setShowDataDialog}>
            <DialogTrigger asChild>
              <Button onClick={fetchKarbonData} disabled={fetchingKarbonData} variant="outline" size="sm">
                <Database className={`h-4 w-4 mr-2 ${fetchingKarbonData ? "animate-pulse" : ""}`} />
                {fetchingKarbonData ? "Fetching..." : "Fetch Latest Data"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Karbon Data Analysis</DialogTitle>
                <DialogDescription>Overview of your Karbon work items data structure and values</DialogDescription>
              </DialogHeader>
              {karbonData && (
                <div className="space-y-4 mt-4">
                  <div className="text-sm font-medium">
                    Total Work Items: <span className="text-primary">{karbonData.totalItems}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Work Types */}
                    <Card>
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm">Work Types</CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3 pt-0">
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {Object.entries(karbonData.workTypes)
                            .sort((a, b) => b[1] - a[1])
                            .map(([type, count]) => (
                              <div key={type} className="flex justify-between text-xs">
                                <span className="truncate mr-2">{type}</span>
                                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                  {count}
                                </Badge>
                              </div>
                            ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Statuses */}
                    <Card>
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm">Statuses</CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3 pt-0">
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {Object.entries(karbonData.statuses)
                            .sort((a, b) => b[1] - a[1])
                            .map(([status, count]) => (
                              <div key={status} className="flex justify-between text-xs">
                                <span className="truncate mr-2">{status}</span>
                                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                  {count}
                                </Badge>
                              </div>
                            ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Assignees */}
                    <Card>
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm">Assignees</CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3 pt-0">
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {Object.entries(karbonData.assignees)
                            .sort((a, b) => b[1] - a[1])
                            .map(([assignee, count]) => (
                              <div key={assignee} className="flex justify-between text-xs">
                                <span className="truncate mr-2">{assignee}</span>
                                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                  {count}
                                </Badge>
                              </div>
                            ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Client Groups */}
                    <Card>
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm">Client Groups</CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3 pt-0">
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {Object.entries(karbonData.clientGroups)
                            .sort((a, b) => b[1] - a[1])
                            .map(([group, count]) => (
                              <div key={group} className="flex justify-between text-xs">
                                <span className="truncate mr-2">{group}</span>
                                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                  {count}
                                </Badge>
                              </div>
                            ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Sample Raw Item */}
                  <Card>
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">Sample Work Item (Raw Data)</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 pt-0">
                      <pre className="text-[10px] bg-muted p-2 rounded overflow-x-auto max-h-[200px]">
                        {JSON.stringify(karbonData.sampleItem, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <ViewManager type="workItems" currentFilters={getCurrentFilters()} onLoadView={handleLoadView} />
          <Button onClick={fetchWorkItems} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card
          className="cursor-pointer hover:shadow-md transition-all hover:scale-[1.02]"
          onClick={() => handleCardClick("all")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3">
            <CardTitle className="text-xs font-medium">Total Work Items</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {loading ? <Skeleton className="h-6 w-16" /> : <div className="text-xl font-bold">{workItems.length}</div>}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-all hover:scale-[1.02]"
          onClick={() => handleCardClick("active")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3">
            <CardTitle className="text-xs font-medium">Active Projects</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {loading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl font-bold">
                {workItems.filter((item) => determineStatus(item) === "active").length}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-all hover:scale-[1.02]"
          onClick={() => handleCardClick("completed")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3">
            <CardTitle className="text-xs font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {loading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl font-bold">
                {workItems.filter((item) => determineStatus(item) === "completed").length}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-all hover:scale-[1.02]"
          onClick={() => handleCardClick("cancelled")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3">
            <CardTitle className="text-xs font-medium">Cancelled & Lost</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {loading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl font-bold">
                {workItems.filter((item) => determineStatus(item) === "cancelled").length}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-8">
          <TabsTrigger value="active" className="text-xs px-3 h-7">
            Active Projects
          </TabsTrigger>
          <TabsTrigger value="cancelled" className="text-xs px-3 h-7">
            Cancelled & Lost
          </TabsTrigger>
          <TabsTrigger value="completed" className="text-xs px-3 h-7">
            Completed
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs px-3 h-7">
            All Items
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-3 mt-3">
          {!loading && workItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Search Input */}
              <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 h-8 text-xs"
                />
              </div>

              {/* Service Lines Multi-Select Dropdown */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1 bg-transparent">
                    Service Lines
                    {!selectedServiceLines.includes("all") && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {selectedServiceLines.length}
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                  <div className="space-y-1">
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      onClick={() => setSelectedServiceLines(["all"])}
                    >
                      <Checkbox checked={selectedServiceLines.includes("all")} />
                      <span className="text-xs">All Service Lines</span>
                    </div>
                    {getServiceLines()
                      .filter((s) => s !== "all")
                      .map((serviceLine) => (
                        <div
                          key={serviceLine}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                          onClick={() => toggleServiceLine(serviceLine)}
                        >
                          <Checkbox checked={selectedServiceLines.includes(serviceLine)} />
                          <span className="text-xs">{serviceLine}</span>
                          <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">
                            {getServiceLineCount(serviceLine)}
                          </Badge>
                        </div>
                      ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Fiscal Year Multi-Select Dropdown */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1 bg-transparent">
                    Fiscal Year
                    {selectedFiscalYear !== "all" && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {selectedFiscalYear}
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-2" align="start">
                  <div className="space-y-1">
                    {getAvailableFiscalYears().map((fy) => (
                      <div
                        key={fy}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                        onClick={() => setSelectedFiscalYear(fy)}
                      >
                        <Checkbox checked={selectedFiscalYear === fy} />
                        <span className="text-xs">{fy === "all" ? "All Years" : `FY ${fy}`}</span>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Priority Multi-Select Dropdown */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1 bg-transparent">
                    Priority
                    {!selectedPriorities.includes("all") && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {selectedPriorities.length}
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-2" align="start">
                  <div className="space-y-1">
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      onClick={() => setSelectedPriorities(["all"])}
                    >
                      <Checkbox checked={selectedPriorities.includes("all")} />
                      <span className="text-xs">All Priorities</span>
                    </div>
                    {getAllPriorities()
                      .filter((p) => p !== "all")
                      .map((priority) => (
                        <div
                          key={priority}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                          onClick={() => {
                            setSelectedPriorities((prev) => {
                              const filtered = prev.filter((p) => p !== "all")
                              if (filtered.includes(priority)) {
                                const newSelection = filtered.filter((p) => p !== priority)
                                return newSelection.length === 0 ? ["all"] : newSelection
                              } else {
                                return [...filtered, priority]
                              }
                            })
                          }}
                        >
                          <Checkbox checked={selectedPriorities.includes(priority)} />
                          <span className="text-xs">{priority}</span>
                        </div>
                      ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Work Type Multi-Select Dropdown */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1 bg-transparent">
                    Work Type
                    {!selectedWorkTypes.includes("all") && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {selectedWorkTypes.length}
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      onClick={() => setSelectedWorkTypes(["all"])}
                    >
                      <Checkbox checked={selectedWorkTypes.includes("all")} />
                      <span className="text-xs">All Types</span>
                    </div>
                    {getAllWorkTypes()
                      .filter((t) => t !== "all")
                      .map((workType) => (
                        <div
                          key={workType}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                          onClick={() => {
                            setSelectedWorkTypes((prev) => {
                              const filtered = prev.filter((t) => t !== "all")
                              if (filtered.includes(workType)) {
                                const newSelection = filtered.filter((t) => t !== workType)
                                return newSelection.length === 0 ? ["all"] : newSelection
                              } else {
                                return [...filtered, workType]
                              }
                            })
                          }}
                        >
                          <Checkbox checked={selectedWorkTypes.includes(workType)} />
                          <span className="text-xs truncate">{workType}</span>
                        </div>
                      ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Date Range Dropdown */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1 bg-transparent">
                    Due Date
                    {(dateRange.start || dateRange.end) && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        Set
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground">From</label>
                      <Input
                        type="date"
                        value={dateRange.start || ""}
                        onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">To</label>
                      <Input
                        type="date"
                        value={dateRange.end || ""}
                        onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                    {(dateRange.start || dateRange.end) && (
                      <Button variant="ghost" size="sm" onClick={() => setDateRange({})} className="h-7 text-xs w-full">
                        Clear Dates
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Assignee Dropdown */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1 bg-transparent">
                    <User className="h-3 w-3" />
                    Assignee
                    {(currentUserEmail || showAssignedToMe) && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        1
                      </Badge>
                    )}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                  <div className="space-y-2">
                    <Select value={currentUserEmail || "all"} onValueChange={setCurrentUserEmail}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select assignee" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Assignees</SelectItem>
                        {getAllAssignees().map((assignee) => (
                          <SelectItem key={assignee.email} value={assignee.email}>
                            {assignee.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                      onClick={() => setShowAssignedToMe(!showAssignedToMe)}
                    >
                      <Checkbox checked={showAssignedToMe} disabled={!currentUserEmail} />
                      <span className="text-xs">Assigned to Me</span>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Clear Filters Button */}
              {getActiveFilterCount() > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear ({getActiveFilterCount()})
                </Button>
              )}

              {/* Results Count */}
              <span className="text-xs text-muted-foreground ml-auto">{filteredItems.length} results</span>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="p-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </Card>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <CheckSquare className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No work items found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {getActiveFilterCount() > 0
                    ? "Try adjusting your filters"
                    : activeTab === "all"
                      ? "Connect to Karbon to see your work items"
                      : `No ${activeTab} work items at the moment`}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => (
                <Card key={item.WorkItemKey} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={getKarbonWorkItemUrl(item.WorkItemKey)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline font-medium text-sm flex items-center gap-1"
                          >
                            {item.Title}
                            <ExternalLink className="h-3 w-3 text-gray-400" />
                          </a>
                          <Badge variant="outline" className="text-[10px] font-mono h-5">
                            {item.WorkItemKey}
                          </Badge>
                          {item.WorkType && (
                            <Badge className={`text-[10px] h-5 ${getServiceLineColor(item.WorkType as ServiceLine)}`}>
                              {item.WorkType}
                            </Badge>
                          )}
                          {item.Priority && (
                            <Badge className={`text-[10px] h-5 ${getPriorityColor(item.Priority)}`}>
                              {item.Priority}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                          {item.ClientName && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {item.ClientName}
                            </span>
                          )}
                          {item.DueDate && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Due: {formatDate(item.DueDate)}
                            </span>
                          )}
                          {item.AssignedTo && normalizeAssignedTo(item.AssignedTo).length > 0 && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {normalizeAssignedTo(item.AssignedTo)
                                .map((a) => a.FullName)
                                .join(", ")}
                            </span>
                          )}
                          {item.WorkStatus && (
                            <Badge variant="outline" className="text-[10px] h-5">
                              {item.WorkStatus}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge className={`${getStatusColor(item)} border shrink-0 text-[10px] h-5`}>
                        {determineStatus(item).charAt(0).toUpperCase() + determineStatus(item).slice(1)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
