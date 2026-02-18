"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Plus,
  Calendar,
  User,
  AlertCircle,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Users,
  UserPlus,
  Loader2,
} from "lucide-react"
import { useKarbonWorkItems, type KarbonWorkItem } from "@/contexts/karbon-work-items-context"

interface PlanningItem extends KarbonWorkItem {
  planningType?: string
}

export function TaxPlanning() {
  const { activeWorkItems, isLoading: loading, error } = useKarbonWorkItems()
  const [currentClientsOpen, setCurrentClientsOpen] = useState(false)
  const [prospectsOpen, setProspectsOpen] = useState(false)
  const [showAllCurrentClients, setShowAllCurrentClients] = useState(false)
  const [showAllProspects, setShowAllProspects] = useState(false)

  const planningItems = useMemo(() => {
    return activeWorkItems.filter((item: KarbonWorkItem) => {
      const title = item.Title?.toUpperCase() || ""
      const workType = item.WorkType?.toUpperCase() || ""

      // Look for planning-related keywords
      const planningKeywords = [
        "PLANNING",
          "PLAN",
          "TAX PLAN",
          "PROJECTION",
          "STRATEGY",
          "CONSULTATION",
          "REVIEW",
          "ANALYSIS",
        ]

        return planningKeywords.some((keyword) => title.includes(keyword) || workType.includes(keyword))
      }).map((item) => ({
        ...item,
        planningType: determinePlanningType(item),
      }))
  }, [activeWorkItems])

  const determinePlanningType = (item: KarbonWorkItem): string => {
    const title = item.Title?.toUpperCase() || ""
    const workType = item.WorkType?.toUpperCase() || ""
    const combined = `${title} ${workType}`

    if (combined.includes("PROJECTION") || combined.includes("ESTIMATE")) return "Projection"
    if (combined.includes("STRATEGY") || combined.includes("STRATEGIC")) return "Strategy"
    if (combined.includes("CONSULTATION") || combined.includes("CONSULT")) return "Consultation"
    if (combined.includes("REVIEW") || combined.includes("ANALYSIS")) return "Review"
    if (combined.includes("YEAR-END") || combined.includes("YEAR END")) return "Year-End"

    return "General Planning"
  }

  const getStatusColor = (status: string) => {
    const statusLower = status?.toLowerCase() || ""
    if (statusLower.includes("complete") || statusLower.includes("delivered"))
      return "bg-green-500/10 text-green-700 border-green-200"
    if (statusLower.includes("progress") || statusLower.includes("working"))
      return "bg-blue-500/10 text-blue-700 border-blue-200"
    if (statusLower.includes("not started") || statusLower.includes("pending"))
      return "bg-gray-500/10 text-gray-700 border-gray-200"
    if (statusLower.includes("blocked") || statusLower.includes("hold"))
      return "bg-red-500/10 text-red-700 border-red-200"
    return "bg-gray-500/10 text-gray-700 border-gray-200"
  }

  const getPriorityColor = (priority: string) => {
    const priorityLower = priority?.toLowerCase() || ""
    if (priorityLower === "high") return "bg-red-500/10 text-red-700 border-red-200"
    if (priorityLower === "medium") return "bg-yellow-500/10 text-yellow-700 border-yellow-200"
    return "bg-green-500/10 text-green-700 border-green-200"
  }

  const getPlanningTypeColor = (type: string) => {
    switch (type) {
      case "Projection":
        return "bg-purple-500/10 text-purple-700 border-purple-200"
      case "Strategy":
        return "bg-blue-500/10 text-blue-700 border-blue-200"
      case "Consultation":
        return "bg-teal-500/10 text-teal-700 border-teal-200"
      case "Review":
        return "bg-orange-500/10 text-orange-700 border-orange-200"
      case "Year-End":
        return "bg-indigo-500/10 text-indigo-700 border-indigo-200"
      default:
        return "bg-gray-500/10 text-gray-700 border-gray-200"
    }
  }

  const isOverdue = (dueDate: string) => {
    if (!dueDate) return false
    return new Date(dueDate) < new Date()
  }

  const formatDate = (dateString: string) => {
    if (!dateString) return "No due date"
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  // Calculate summary stats
  const totalItems = planningItems.length
  const inProgress = planningItems.filter(
    (item) =>
      item.PrimaryStatus?.toLowerCase().includes("progress") || item.PrimaryStatus?.toLowerCase().includes("working"),
  ).length
  const notStarted = planningItems.filter(
    (item) =>
      item.PrimaryStatus?.toLowerCase().includes("not started") ||
      item.PrimaryStatus?.toLowerCase().includes("pending"),
  ).length
  const completed = planningItems.filter(
    (item) =>
      item.PrimaryStatus?.toLowerCase().includes("complete") || item.PrimaryStatus?.toLowerCase().includes("delivered"),
  ).length
  const overdue = planningItems.filter((item) => isOverdue(item.DueDate || "")).length

  const getCurrentClients = () => {
    // Get unique clients with active planning items (In Progress or Not Started)
    const activeItems = planningItems.filter(
      (item) =>
        item.PrimaryStatus?.toLowerCase().includes("progress") ||
        item.PrimaryStatus?.toLowerCase().includes("working") ||
        item.PrimaryStatus?.toLowerCase().includes("not started") ||
        item.PrimaryStatus?.toLowerCase().includes("pending"),
    )

    // Group by client name
    const clientMap = new Map<string, PlanningItem[]>()
    activeItems.forEach((item) => {
      const clientName = item.ClientName || "Unknown Client"
      if (!clientMap.has(clientName)) {
        clientMap.set(clientName, [])
      }
      clientMap.get(clientName)?.push(item)
    })

    return Array.from(clientMap.entries())
      .map(([clientName, items]) => {
        // Find the most recent date among all items for this client
        const mostRecentDate = items.reduce((latest, item) => {
          const itemDate = new Date(item.DueDate || "")
          return itemDate > latest ? itemDate : latest
        }, new Date(0))

        return {
          clientName,
          items,
          activeCount: items.length,
          mostRecentDate,
        }
      })
      .sort((a, b) => b.mostRecentDate.getTime() - a.mostRecentDate.getTime())
  }

  const getProspects = () => {
    // Get clients with consultation-type planning or specific prospect indicators
    const prospectItems = planningItems.filter(
      (item) =>
        item.planningType === "Consultation" ||
        item.Title?.toLowerCase().includes("prospect") ||
        item.Title?.toLowerCase().includes("initial") ||
        item.SecondaryStatus?.toLowerCase().includes("prospect"),
    )

    // Group by client name
    const clientMap = new Map<string, PlanningItem[]>()
    prospectItems.forEach((item) => {
      const clientName = item.ClientName || "Unknown Client"
      if (!clientMap.has(clientName)) {
        clientMap.set(clientName, [])
      }
      clientMap.get(clientName)?.push(item)
    })

    return Array.from(clientMap.entries())
      .map(([clientName, items]) => {
        // Find the most recent date among all items for this client
        const mostRecentDate = items.reduce((latest, item) => {
          const itemDate = new Date(item.DueDate || "")
          return itemDate > latest ? itemDate : latest
        }, new Date(0))

        return {
          clientName,
          items,
          activeCount: items.length,
          mostRecentDate,
        }
      })
      .sort((a, b) => b.mostRecentDate.getTime() - a.mostRecentDate.getTime())
  }

  const currentClients = getCurrentClients()
  const prospects = getProspects()

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading tax planning items...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tax Planning</h1>
            <p className="text-muted-foreground">Strategic tax planning and projections for clients</p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Planning</h1>
          <p className="text-muted-foreground">Strategic tax planning and projections for clients</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Planning Session
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Current Clients - Compact Preview */}
        <Card className="p-0">
          <CardHeader className="px-3 pt-3 pb-0.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-600" />
                <CardTitle className="text-sm font-semibold">Current Clients</CardTitle>
                <Badge variant="secondary" className="text-xs h-5">
                  {currentClients.length}
                </Badge>
              </div>
              {currentClients.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllCurrentClients(!showAllCurrentClients)}
                  className="h-6 text-xs px-2"
                >
                  {showAllCurrentClients ? "Show Less" : "View All"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-3 py-0 pb-2">
            {currentClients.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">No current clients</div>
            ) : (
              <div className="space-y-0">
                {(showAllCurrentClients ? currentClients : currentClients.slice(0, 3)).map(
                  ({ clientName, activeCount, items }, index) => (
                    <div
                      key={clientName}
                      className={`flex items-center justify-between py-1 px-2 border-b last:border-b-0 hover:bg-accent transition-colors cursor-pointer ${
                        index % 2 === 0 ? "bg-muted/30" : "bg-background"
                      }`}
                      onClick={() => {
                        console.log("[v0] Clicked client:", clientName)
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{clientName}</div>
                        <Badge variant="outline" className="text-xs h-5 shrink-0">
                          {activeCount}
                        </Badge>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Prospects - Compact Preview */}
        <Card className="p-0">
          <CardHeader className="px-3 pt-3 pb-0.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-green-600" />
                <CardTitle className="text-sm font-semibold">Prospects</CardTitle>
                <Badge variant="secondary" className="text-xs h-5">
                  {prospects.length}
                </Badge>
              </div>
              {prospects.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllProspects(!showAllProspects)}
                  className="h-6 text-xs px-2"
                >
                  {showAllProspects ? "Show Less" : "View All"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-3 py-0 pb-2">
            {prospects.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">No prospects</div>
            ) : (
              <div className="space-y-0">
                {(showAllProspects ? prospects : prospects.slice(0, 3)).map(
                  ({ clientName, activeCount, items }, index) => (
                    <div
                      key={clientName}
                      className={`flex items-center justify-between py-1 px-2 border-b last:border-b-0 hover:bg-accent transition-colors cursor-pointer ${
                        index % 2 === 0 ? "bg-muted/30" : "bg-background"
                      }`}
                      onClick={() => {
                        console.log("[v0] Clicked prospect:", clientName)
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{clientName}</div>
                        <Badge variant="outline" className="text-xs h-5 shrink-0">
                          {activeCount}
                        </Badge>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Planning Items</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgress}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Not Started</CardTitle>
            <AlertCircle className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{notStarted}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completed}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overdue}</div>
          </CardContent>
        </Card>
      </div>

      {/* Planning Items List */}
      <Card>
        <CardHeader>
          <CardTitle>Planning Sessions</CardTitle>
          <CardDescription>Active tax planning engagements and consultations</CardDescription>
        </CardHeader>
        <CardContent>
          {planningItems.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No tax planning items found
            </div>
          ) : (
            <div className="space-y-4">
              {planningItems.map((item) => (
                <div
                  key={item.Key}
                  className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <h3 className="font-semibold">{item.Title}</h3>
                        <p className="text-sm text-muted-foreground">{item.ClientName}</p>
                      </div>
                      <div className="flex gap-2">
                        {item.planningType && (
                          <Badge variant="outline" className={getPlanningTypeColor(item.planningType)}>
                            {item.planningType}
                          </Badge>
                        )}
                        {item.WorkType && (
                          <Badge variant="outline" className="bg-slate-500/10 text-slate-700 border-slate-200">
                            {item.WorkType}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className={isOverdue(item.DueDate || "") ? "text-red-600 font-medium" : ""}>
                          {formatDate(item.DueDate || "")}
                        </span>
                        {isOverdue(item.DueDate || "") && (
                          <Badge variant="outline" className="ml-1 bg-red-500/10 text-red-700 border-red-200">
                            Overdue
                          </Badge>
                        )}
                      </div>

                      {item.AssignedTo && (
                        <div className="flex items-center gap-1.5">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>
                            {typeof item.AssignedTo === "string"
                              ? item.AssignedTo
                              : item.AssignedTo?.FullName || "Unassigned"}
                          </span>
                        </div>
                      )}

                      {item.PrimaryStatus && (
                        <Badge variant="outline" className={getStatusColor(item.PrimaryStatus)}>
                          {item.PrimaryStatus}
                        </Badge>
                      )}

                      {item.Priority && (
                        <Badge variant="outline" className={getPriorityColor(item.Priority)}>
                          {item.Priority}
                        </Badge>
                      )}
                    </div>

                    {item.SecondaryStatus && (
                      <div className="text-sm text-muted-foreground">{item.SecondaryStatus}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
