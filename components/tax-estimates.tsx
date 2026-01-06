"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Plus, ExternalLink, Calendar, User, AlertCircle, DollarSign, Bell } from "lucide-react"
import type { KarbonWorkItem } from "@/lib/karbon-types"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import { format, differenceInDays } from "date-fns"

interface TaxEstimateItem extends KarbonWorkItem {
  quarter?: string
}

interface QuarterInfo {
  name: string
  startDate: Date
  endDate: Date
  paymentDeadline: Date
  dateRange: string
}

const getCurrentYear = () => new Date().getFullYear()

const getQuarterInfo = (year: number): Record<string, QuarterInfo> => ({
  Q1: {
    name: "Q1",
    startDate: new Date(year, 0, 1), // Jan 1
    endDate: new Date(year, 2, 31), // Mar 31
    paymentDeadline: new Date(year, 3, 15), // Apr 15
    dateRange: "Jan 1 - Mar 31",
  },
  Q2: {
    name: "Q2",
    startDate: new Date(year, 3, 1), // Apr 1
    endDate: new Date(year, 5, 30), // Jun 30
    paymentDeadline: new Date(year, 5, 15), // Jun 15
    dateRange: "Apr 1 - Jun 30",
  },
  Q3: {
    name: "Q3",
    startDate: new Date(year, 6, 1), // Jul 1
    endDate: new Date(year, 8, 30), // Sep 30
    paymentDeadline: new Date(year, 8, 15), // Sep 15
    dateRange: "Jul 1 - Sep 30",
  },
  Q4: {
    name: "Q4",
    startDate: new Date(year, 9, 1), // Oct 1
    endDate: new Date(year, 11, 31), // Dec 31
    paymentDeadline: new Date(year + 1, 0, 15), // Jan 15 next year
    dateRange: "Oct 1 - Dec 31",
  },
})

const getCurrentAndUpcomingQuarter = () => {
  const now = new Date()
  const year = now.getFullYear()
  const quarters = getQuarterInfo(year)

  let currentQuarter: QuarterInfo | null = null
  let upcomingQuarter: QuarterInfo | null = null

  const quarterKeys = ["Q1", "Q2", "Q3", "Q4"] as const

  for (let i = 0; i < quarterKeys.length; i++) {
    const quarter = quarters[quarterKeys[i]]
    if (now >= quarter.startDate && now <= quarter.endDate) {
      currentQuarter = quarter
      upcomingQuarter = i < 3 ? quarters[quarterKeys[i + 1]] : quarters.Q1
      break
    }
  }

  return { currentQuarter, upcomingQuarter, quarters }
}

export function TaxEstimates() {
  const [estimates, setEstimates] = useState<TaxEstimateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedQuarter, setSelectedQuarter] = useState<string>("all")

  useEffect(() => {
    fetchEstimates()
  }, [])

  const extractQuarter = (item: KarbonWorkItem): string | undefined => {
    const title = item.Title?.toUpperCase() || ""

    // Check title for quarter indicators
    if (title.includes("Q1") || title.includes("FIRST QUARTER")) return "Q1"
    if (title.includes("Q2") || title.includes("SECOND QUARTER")) return "Q2"
    if (title.includes("Q3") || title.includes("THIRD QUARTER")) return "Q3"
    if (title.includes("Q4") || title.includes("FOURTH QUARTER")) return "Q4"

    if (item.DueDate) {
      try {
        const dueDate = new Date(item.DueDate)
        const year = dueDate.getFullYear()
        const quarters = getQuarterInfo(year)

        for (const [key, quarter] of Object.entries(quarters)) {
          if (dueDate >= quarter.startDate && dueDate <= quarter.paymentDeadline) {
            return key
          }
        }
      } catch {
        return undefined
      }
    }

    return undefined
  }

  const fetchEstimates = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/karbon/work-items")

      if (response.status === 401) {
        setError(
          "Karbon API credentials not configured. Please add KARBON_BEARER_TOKEN and KARBON_ACCESS_KEY environment variables.",
        )
        setLoading(false)
        return
      }

      if (!response.ok) {
        throw new Error("Failed to fetch work items")
      }

      const data = await response.json()

      const taxEstimates = data.workItems
        .filter((item: KarbonWorkItem) => {
          const title = item.Title?.toUpperCase() || ""
          const workType = item.WorkType?.toUpperCase() || ""
          const isTax = item.ServiceLine === "TAX"
          const isEstimate =
            workType.includes("ESTIMATE") ||
            workType.includes("ESTIMATED") ||
            title.includes("ESTIMATE") ||
            title.includes("EST") ||
            title.includes("QUARTERLY") ||
            title.includes("Q1") ||
            title.includes("Q2") ||
            title.includes("Q3") ||
            title.includes("Q4")
          return isTax && isEstimate
        })
        .map((item: KarbonWorkItem) => ({
          ...item,
          quarter: extractQuarter(item),
        }))

      setEstimates(taxEstimates)
      setLoading(false)
    } catch (err) {
      console.error("[v0] Error fetching tax estimates:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch tax estimates")
      setLoading(false)
    }
  }

  const groupByQuarter = () => {
    const quarters = {
      Q1: estimates.filter((e) => e.quarter === "Q1"),
      Q2: estimates.filter((e) => e.quarter === "Q2"),
      Q3: estimates.filter((e) => e.quarter === "Q3"),
      Q4: estimates.filter((e) => e.quarter === "Q4"),
      Other: estimates.filter((e) => !e.quarter),
    }
    return quarters
  }

  const getFilteredEstimates = () => {
    if (selectedQuarter === "all") return estimates
    if (selectedQuarter === "other") return estimates.filter((e) => !e.quarter)
    return estimates.filter((e) => e.quarter === selectedQuarter)
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
        return "bg-green-100 text-green-700 border-green-300"
      case "in progress":
        return "bg-blue-100 text-blue-700 border-blue-300"
      case "not started":
        return "bg-gray-100 text-gray-700 border-gray-300"
      case "on hold":
        return "bg-yellow-100 text-yellow-700 border-yellow-300"
      default:
        return "bg-slate-100 text-slate-700 border-slate-300"
    }
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority?.toLowerCase()) {
      case "high":
        return "bg-red-100 text-red-700 border-red-300"
      case "normal":
        return "bg-blue-100 text-blue-700 border-blue-300"
      case "low":
        return "bg-gray-100 text-gray-700 border-gray-300"
      default:
        return "bg-slate-100 text-slate-700 border-slate-300"
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return "No due date"
    try {
      return format(new Date(dateString), "MMM d, yyyy")
    } catch {
      return "Invalid date"
    }
  }

  const isOverdue = (dateString?: string) => {
    if (!dateString) return false
    return new Date(dateString) < new Date()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tax Estimates</h1>
            <p className="text-muted-foreground">Manage quarterly tax estimates for clients</p>
          </div>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Loading tax estimates...</div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tax Estimates</h1>
            <p className="text-muted-foreground">Manage quarterly tax estimates for clients</p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const { currentQuarter, upcomingQuarter, quarters } = getCurrentAndUpcomingQuarter()
  const quarterGroups = groupByQuarter()
  const filteredEstimates = getFilteredEstimates()

  const daysUntilUpcomingDeadline = upcomingQuarter
    ? differenceInDays(upcomingQuarter.paymentDeadline, new Date())
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Estimates</h1>
          <p className="text-muted-foreground">Manage quarterly tax estimates for clients</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Estimate
        </Button>
      </div>

      {upcomingQuarter && daysUntilUpcomingDeadline !== null && daysUntilUpcomingDeadline <= 30 && (
        <Alert className="border-orange-200 bg-orange-50">
          <Bell className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-900">
            <strong>{upcomingQuarter.name} Payment Deadline:</strong>{" "}
            {format(upcomingQuarter.paymentDeadline, "MMMM d, yyyy")} ({daysUntilUpcomingDeadline} days away)
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-5">
        <Card
          className={`cursor-pointer transition-all hover:shadow-md ${
            selectedQuarter === "all" ? "ring-2 ring-primary" : ""
          }`}
          onClick={() => setSelectedQuarter("all")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">All Estimates</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{estimates.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Total estimates</p>
          </CardContent>
        </Card>

        {["Q1", "Q2", "Q3", "Q4"].map((quarter) => {
          const quarterEstimates = quarterGroups[quarter as keyof typeof quarterGroups]
          const overdue = quarterEstimates.filter((e) => isOverdue(e.DueDate)).length
          const quarterInfo = quarters[quarter as keyof typeof quarters]
          const isCurrent = currentQuarter?.name === quarter

          return (
            <Card
              key={quarter}
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedQuarter === quarter ? "ring-2 ring-primary" : ""
              } ${isCurrent ? "border-blue-500" : ""}`}
              onClick={() => setSelectedQuarter(quarter)}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-medium">{quarter}</CardTitle>
                  {isCurrent && <Badge className="text-xs bg-blue-500">Current</Badge>}
                </div>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{quarterEstimates.length}</div>
                <p className="text-xs text-muted-foreground mt-1">{quarterInfo.dateRange}</p>
                <p className="text-xs text-muted-foreground">Due: {format(quarterInfo.paymentDeadline, "MMM d")}</p>
                {overdue > 0 && <p className="text-xs text-red-600 font-medium mt-1">{overdue} overdue</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {selectedQuarter === "all"
              ? "All Tax Estimates"
              : selectedQuarter === "other"
                ? "Other Estimates"
                : `${selectedQuarter} - Quarter ${selectedQuarter.slice(1)} Estimates`}
          </CardTitle>
          <CardDescription>
            {filteredEstimates.length} estimate{filteredEstimates.length !== 1 ? "s" : ""}
            {selectedQuarter !== "all" && " in this view"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredEstimates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No estimates found for this quarter</div>
          ) : (
            <div className="space-y-4">
              {filteredEstimates.map((estimate) => (
                <div
                  key={estimate.WorkKey}
                  className="flex items-start justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{estimate.Title}</h3>
                      {estimate.quarter && (
                        <Badge variant="outline" className="bg-indigo-100 text-indigo-700 border-indigo-300">
                          {estimate.quarter}
                        </Badge>
                      )}
                      {estimate.Priority && (
                        <Badge variant="outline" className={getPriorityColor(estimate.Priority)}>
                          {estimate.Priority}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span>{estimate.ClientName || "No client"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span className={isOverdue(estimate.DueDate) ? "text-red-600 font-medium" : ""}>
                          {formatDate(estimate.DueDate)}
                        </span>
                      </div>
                      {estimate.AssignedTo && estimate.AssignedTo.length > 0 && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>{estimate.AssignedTo[0].FullName}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={getStatusColor(estimate.PrimaryStatus)}>
                        {estimate.PrimaryStatus}
                      </Badge>
                      {estimate.SecondaryStatus && (
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">
                          {estimate.SecondaryStatus}
                        </Badge>
                      )}
                      {estimate.WorkType && (
                        <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                          {estimate.WorkType}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={getKarbonWorkItemUrl(estimate.WorkKey)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
