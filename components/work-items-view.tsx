"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CheckSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Calendar,
  User,
  Building2,
  Search,
  UserCheck,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { getServiceLineColor, type ServiceLine } from "@/lib/service-lines"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface WorkItem {
  WorkKey: string
  Title: string
  ServiceLine: string
  WorkStatus: string
  PrimaryStatus: string
  SecondaryStatus?: string
  WorkType: string
  ClientName?: string
  ClientKey?: string
  ClientGroup?: string
  DueDate?: string
  DeadlineDate?: string
  StartDate?: string
  CompletedDate?: string
  ModifiedDate?: string
  AssignedTo?: Array<{
    FullName: string
    Email: string
  }>
  Priority?: string
  Description?: string
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

  useEffect(() => {
    fetchWorkItems()
  }, [])

  const determineStatus = (item: WorkItem): "completed" | "active" | "cancelled" => {
    const primaryStatus = item.PrimaryStatus?.toLowerCase() || ""
    const secondaryStatus = item.SecondaryStatus?.toLowerCase() || ""

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
    const serviceLines = new Set(workItems.map((item) => item.ServiceLine))
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
    return baseItems.filter((item) => item.ServiceLine === serviceLine).length
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

  const getAllAssignees = (): Array<{ email: string; name: string }> => {
    const assigneesMap = new Map<string, string>()

    workItems.forEach((item) => {
      if (item.AssignedTo) {
        item.AssignedTo.forEach((assignee) => {
          if (assignee.Email && assignee.FullName) {
            assigneesMap.set(assignee.Email, assignee.FullName)
          }
        })
      }
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
          item.ClientGroup?.toLowerCase().includes(query) ||
          item.WorkKey?.toLowerCase().includes(query),
      )
    }

    if (showAssignedToMe && currentUserEmail) {
      filtered = filtered.filter((item) => item.AssignedTo?.some((assignee) => assignee.Email === currentUserEmail))
    }

    if (!selectedServiceLines.includes("all")) {
      filtered = filtered.filter((item) => selectedServiceLines.includes(item.ServiceLine))
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
        const dates = [item.ModifiedDate, item.CompletedDate, item.DueDate, item.StartDate]
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#333333" }}>
            Work Items
          </h1>
          <p className="text-muted-foreground">Real-time data from Karbon</p>
        </div>
        <Button onClick={fetchWorkItems} disabled={loading} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card
          className="cursor-pointer hover:shadow-lg transition-all hover:scale-105"
          onClick={() => handleCardClick("all")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Work Items</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{workItems.length}</div>}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-lg transition-all hover:scale-105"
          onClick={() => handleCardClick("active")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {workItems.filter((item) => determineStatus(item) === "active").length}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-lg transition-all hover:scale-105"
          onClick={() => handleCardClick("completed")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {workItems.filter((item) => determineStatus(item) === "completed").length}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-lg transition-all hover:scale-105"
          onClick={() => handleCardClick("cancelled")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cancelled & Lost</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {workItems.filter((item) => determineStatus(item) === "cancelled").length}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active">Active Projects</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled & Lost</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="all">All Items</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-4 mt-4">
          {!loading && workItems.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Filter by Service Line</CardTitle>
                <CardDescription className="text-xs">
                  TAX • ACCOUNTING • BOOKKEEPING • ADVISORY • MWM • MOTTA (Internal) • ALFRED AI (Internal)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {getServiceLines().map((serviceLine) => {
                    const count = getServiceLineCount(serviceLine)
                    const isSelected =
                      serviceLine === "all"
                        ? selectedServiceLines.includes("all")
                        : selectedServiceLines.includes(serviceLine)

                    return (
                      <Button
                        key={serviceLine}
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleServiceLine(serviceLine)}
                        className={`text-xs ${isSelected ? "" : getServiceLineColor(serviceLine as ServiceLine)}`}
                      >
                        {serviceLine === "all" ? "All Service Lines" : serviceLine}
                        <Badge variant="secondary" className="ml-2 bg-white/80 text-black">
                          {count}
                        </Badge>
                      </Button>
                    )
                  })}
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search clients or work items..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 h-9 text-sm"
                    />
                  </div>

                  <Select value={currentUserEmail} onValueChange={setCurrentUserEmail}>
                    <SelectTrigger className="w-[200px] h-9 text-sm">
                      <SelectValue placeholder="Select your name" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAllAssignees().map((assignee) => (
                        <SelectItem key={assignee.email} value={assignee.email}>
                          {assignee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant={showAssignedToMe ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowAssignedToMe(!showAssignedToMe)}
                    disabled={!currentUserEmail}
                    className="h-9 text-sm"
                  >
                    <UserCheck className="h-4 w-4 mr-2" />
                    Assigned to Me
                  </Button>
                </div>

                <div className="pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Fiscal Year</p>
                  <div className="flex flex-wrap gap-1.5">
                    {getAvailableFiscalYears().map((fy) => (
                      <Button
                        key={fy}
                        variant={selectedFiscalYear === fy ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedFiscalYear(fy)}
                        className="text-xs h-7"
                      >
                        {fy === "all" ? "All Years" : `FY ${fy}`}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2 mt-2" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckSquare className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium text-muted-foreground">No work items found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {!selectedServiceLines.includes("all")
                    ? `No ${activeTab} work items for selected service lines`
                    : activeTab === "all"
                      ? "Connect to Karbon to see your work items"
                      : `No ${activeTab} work items at the moment`}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <Card key={item.WorkKey} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <CardTitle className="text-lg">{item.Title}</CardTitle>
                          <Badge variant="outline" className="text-xs font-mono">
                            {item.WorkKey}
                          </Badge>
                          <Badge className={`text-xs ${getServiceLineColor(item.ServiceLine as ServiceLine)}`}>
                            {item.ServiceLine}
                          </Badge>
                        </div>
                        <CardDescription className="flex flex-wrap items-center gap-2">
                          {item.ClientName && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {item.ClientName}
                            </span>
                          )}
                          {item.ClientGroup && (
                            <Badge variant="secondary" className="text-xs">
                              {item.ClientGroup}
                            </Badge>
                          )}
                          {item.WorkType && (
                            <Badge variant="secondary" className="text-xs">
                              {item.WorkType}
                            </Badge>
                          )}
                        </CardDescription>
                      </div>
                      <Badge className={`${getStatusColor(item)} border shrink-0`}>
                        {determineStatus(item).charAt(0).toUpperCase() + determineStatus(item).slice(1)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        {item.StartDate && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            <span>Started: {formatDate(item.StartDate)}</span>
                          </div>
                        )}
                        {item.DueDate && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>Due: {formatDate(item.DueDate)}</span>
                          </div>
                        )}
                        {item.CompletedDate && (
                          <div className="flex items-center gap-1.5 text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Completed: {formatDate(item.CompletedDate)}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {item.AssignedTo && item.AssignedTo.length > 0 && (
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <div className="flex flex-wrap gap-1">
                              {item.AssignedTo.map((assignee, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {assignee.FullName}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {item.Priority && (
                          <Badge className={getPriorityColor(item.Priority)} variant="secondary">
                            {item.Priority} Priority
                          </Badge>
                        )}
                      </div>

                      {item.SecondaryStatus && determineStatus(item) === "cancelled" && (
                        <div className="pt-2 border-t">
                          <p className="text-sm font-medium text-muted-foreground mb-1">Reason:</p>
                          <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                            {item.SecondaryStatus}
                          </Badge>
                        </div>
                      )}

                      {item.Description && (
                        <p className="text-sm text-muted-foreground pt-2 border-t line-clamp-2">{item.Description}</p>
                      )}
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
