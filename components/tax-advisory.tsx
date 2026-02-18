"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Search,
  Calendar,
  User,
  AlertCircle,
  FileText,
  Clock,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Loader2,
  Briefcase,
  Users,
} from "lucide-react"
import { useKarbonWorkItems, type KarbonWorkItem } from "@/contexts/karbon-work-items-context"

interface AdvisoryItem extends KarbonWorkItem {
  advisoryType?: string
}

export function TaxAdvisory() {
  const { activeWorkItems, isLoading: loading, error, refresh } = useKarbonWorkItems()
  const [searchQuery, setSearchQuery] = useState("")

  const advisoryItems = useMemo(() => {
    return activeWorkItems
      .filter((item: KarbonWorkItem) => {
        const title = item.Title?.toUpperCase() || ""
        const workType = item.WorkType?.toUpperCase() || ""

        const advisoryKeywords = [
          "ADVISORY",
          "CONSULT",
          "IRS SUPPORT",
          "STOCK COMP",
          "FOREIGN",
          "AMENDMENT",
          "AMENDED",
        ]

        return advisoryKeywords.some(
          (keyword) => title.includes(keyword) || workType.includes(keyword),
        )
      })
      .map((item) => ({
        ...item,
        advisoryType: determineAdvisoryType(item),
      }))
  }, [activeWorkItems])

  const filteredItems = useMemo(() => {
    if (!searchQuery) return advisoryItems
    const q = searchQuery.toLowerCase()
    return advisoryItems.filter(
      (item) =>
        item.Title?.toLowerCase().includes(q) ||
        item.ClientName?.toLowerCase().includes(q) ||
        item.AssigneeName?.toLowerCase().includes(q) ||
        item.advisoryType?.toLowerCase().includes(q),
    )
  }, [advisoryItems, searchQuery])

  const typeGroups = useMemo(() => {
    const groups = new Map<string, AdvisoryItem[]>()
    filteredItems.forEach((item) => {
      const type = item.advisoryType || "Other"
      if (!groups.has(type)) groups.set(type, [])
      groups.get(type)!.push(item)
    })
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [filteredItems])

  const inProgress = filteredItems.filter(
    (item) =>
      item.PrimaryStatus?.toLowerCase().includes("progress") ||
      item.PrimaryStatus?.toLowerCase().includes("preparing"),
  ).length
  const waitingClient = filteredItems.filter(
    (item) =>
      item.PrimaryStatus?.toLowerCase().includes("waiting") ||
      item.PrimaryStatus?.toLowerCase().includes("pending") ||
      item.PrimaryStatus?.toLowerCase().includes("follow"),
  ).length
  const overdue = filteredItems.filter(
    (item) => item.DueDate && new Date(item.DueDate) < new Date(),
  ).length

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Advisory</h1>
          <p className="text-muted-foreground">Ad-hoc tax advisory services and consultations</p>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center h-64 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading advisory items...</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Advisory</h1>
          <p className="text-muted-foreground">Ad-hoc tax advisory services and consultations</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Advisory</h1>
          <p className="text-muted-foreground">
            Ad-hoc tax advisory services, IRS support, and consultations
          </p>
        </div>
        <Button onClick={refresh} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Advisory</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredItems.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Active work items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgress}</div>
            <p className="text-xs text-muted-foreground mt-1">Being worked on</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Waiting on Client</CardTitle>
            <Users className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{waitingClient}</div>
            <p className="text-xs text-muted-foreground mt-1">Pending response</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overdue}</div>
            <p className="text-xs text-muted-foreground mt-1">Past due date</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search advisory items..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Advisory Items grouped by type */}
      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Briefcase className="h-12 w-12 mb-4 text-muted-foreground/50" />
            <p>No advisory work items found</p>
            <p className="text-sm mt-1">
              Advisory items include IRS Support, Stock Comp, Foreign, and Consulting work types
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {typeGroups.map(([type, items]) => (
            <Card key={type}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">{type}</CardTitle>
                    <CardDescription>
                      {items.length} item{items.length !== 1 ? "s" : ""}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className={getAdvisoryTypeColor(type)}>
                    {type}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.WorkKey}
                      className="flex items-start justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{item.Title}</h3>
                          {item.Priority === "High" && (
                            <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300">
                              High Priority
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {item.ClientName && (
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              <span>{item.ClientName}</span>
                            </div>
                          )}
                          {item.DueDate && (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              <span
                                className={
                                  new Date(item.DueDate) < new Date()
                                    ? "text-red-600 font-medium"
                                    : ""
                                }
                              >
                                {new Date(item.DueDate).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                            </div>
                          )}
                          {item.AssigneeName && (
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              <span>{item.AssigneeName}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.PrimaryStatus && (
                            <Badge variant="outline" className={getStatusColor(item.PrimaryStatus)}>
                              {item.PrimaryStatus}
                            </Badge>
                          )}
                          {item.SecondaryStatus && (
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">
                              {item.SecondaryStatus}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {(item.karbon_url || item.WorkKey) && (
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={
                              item.karbon_url ||
                              `https://app2.karbonhq.com/work/${item.WorkKey}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function determineAdvisoryType(item: KarbonWorkItem): string {
  const title = item.Title?.toUpperCase() || ""
  const workType = item.WorkType?.toUpperCase() || ""
  const combined = `${title} ${workType}`

  if (combined.includes("IRS SUPPORT") || combined.includes("IRS NOTICE"))
    return "IRS Support"
  if (combined.includes("STOCK COMP") || combined.includes("RSU") || combined.includes("OPTION"))
    return "Stock Compensation"
  if (combined.includes("FOREIGN") || combined.includes("FBAR") || combined.includes("FATCA"))
    return "Foreign Tax"
  if (combined.includes("AMEND"))
    return "Amended Return"
  if (combined.includes("CONSULT"))
    return "Consultation"
  return "General Advisory"
}

function getAdvisoryTypeColor(type: string): string {
  switch (type) {
    case "IRS Support":
      return "bg-red-100 text-red-700 border-red-300"
    case "Stock Compensation":
      return "bg-indigo-100 text-indigo-700 border-indigo-300"
    case "Foreign Tax":
      return "bg-teal-100 text-teal-700 border-teal-300"
    case "Amended Return":
      return "bg-amber-100 text-amber-700 border-amber-300"
    case "Consultation":
      return "bg-blue-100 text-blue-700 border-blue-300"
    default:
      return "bg-slate-100 text-slate-700 border-slate-300"
  }
}

function getStatusColor(status: string): string {
  const s = status?.toLowerCase() || ""
  if (s.includes("complete")) return "bg-green-100 text-green-700 border-green-300"
  if (s.includes("progress") || s.includes("preparing")) return "bg-blue-100 text-blue-700 border-blue-300"
  if (s.includes("waiting") || s.includes("pending") || s.includes("follow"))
    return "bg-amber-100 text-amber-700 border-amber-300"
  if (s.includes("review")) return "bg-orange-100 text-orange-700 border-orange-300"
  return "bg-slate-100 text-slate-700 border-slate-300"
}
