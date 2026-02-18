"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Calendar,
  User,
  AlertCircle,
  Clock,
  ExternalLink,
  RefreshCw,
  Loader2,
  ShieldAlert,
  FileWarning,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import { useKarbonWorkItems, type KarbonWorkItem } from "@/contexts/karbon-work-items-context"

interface NoticeItem extends KarbonWorkItem {
  noticeType?: string
  urgency?: "critical" | "high" | "medium" | "low"
}

export function IrsNotices() {
  const { activeWorkItems, allWorkItems, isLoading: loading, error, refresh } = useKarbonWorkItems()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("active")

  // Filter for IRS Notice / IRS Support work items
  const noticeItems = useMemo(() => {
    const source = statusFilter === "completed" ? allWorkItems : activeWorkItems

    return source
      .filter((item: KarbonWorkItem) => {
        const title = item.Title?.toUpperCase() || ""
        const workType = item.WorkType?.toUpperCase() || ""
        const combined = `${title} ${workType}`

        const noticeKeywords = [
          "IRS NOTICE",
          "IRS LETTER",
          "IRS SUPPORT",
          "NOTICE",
          "CP2000",
          "CP2501",
          "CP504",
          "CP501",
          "CP14",
          "LP59",
          "LTR",
          "AUDIT",
          "PENALTY",
          "ABATEMENT",
          "LEVY",
          "LIEN",
          "GARNISHMENT",
          "COLLECTION",
        ]

        // Must have TAX prefix or IRS keyword
        const isTax = title.startsWith("TAX") || workType.includes("TAX") || workType.includes("IRS")
        const hasNoticeKeyword = noticeKeywords.some((kw) => combined.includes(kw))

        return isTax && hasNoticeKeyword
      })
      .map((item): NoticeItem => ({
        ...item,
        noticeType: determineNoticeType(item),
        urgency: determineUrgency(item),
      }))
      .sort((a, b) => {
        // Sort by urgency first, then by due date
        const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 }
        const ua = urgencyOrder[a.urgency || "low"]
        const ub = urgencyOrder[b.urgency || "low"]
        if (ua !== ub) return ua - ub
        const da = a.DueDate ? new Date(a.DueDate).getTime() : Infinity
        const db = b.DueDate ? new Date(b.DueDate).getTime() : Infinity
        return da - db
      })
  }, [activeWorkItems, allWorkItems, statusFilter])

  // Filter for completed IRS items
  const completedNotices = useMemo(() => {
    return allWorkItems.filter((item: KarbonWorkItem) => {
      const title = item.Title?.toUpperCase() || ""
      const workType = item.WorkType?.toUpperCase() || ""
      const combined = `${title} ${workType}`
      const s = (item.status || item.primary_status || "").toLowerCase()
      const isCompleted = s.includes("completed") || s.includes("complete")
      const hasNoticeKeyword =
        combined.includes("IRS") || combined.includes("NOTICE") || combined.includes("AUDIT")
      return isCompleted && hasNoticeKeyword
    }).length
  }, [allWorkItems])

  const filteredItems = useMemo(() => {
    if (!searchQuery) return noticeItems
    const q = searchQuery.toLowerCase()
    return noticeItems.filter(
      (item) =>
        item.Title?.toLowerCase().includes(q) ||
        item.ClientName?.toLowerCase().includes(q) ||
        item.AssigneeName?.toLowerCase().includes(q) ||
        item.noticeType?.toLowerCase().includes(q),
    )
  }, [noticeItems, searchQuery])

  const criticalCount = filteredItems.filter((i) => i.urgency === "critical").length
  const overdueCount = filteredItems.filter(
    (i) => i.DueDate && new Date(i.DueDate) < new Date(),
  ).length
  const pendingResponseCount = filteredItems.filter((i) => {
    const s = (i.PrimaryStatus || "").toLowerCase()
    return s.includes("waiting") || s.includes("pending") || s.includes("follow")
  }).length

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">IRS Notices</h1>
          <p className="text-muted-foreground">Track and respond to IRS notices and correspondence</p>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center h-64 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading IRS notices...</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">IRS Notices</h1>
          <p className="text-muted-foreground">Track and respond to IRS notices and correspondence</p>
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
          <h1 className="text-3xl font-bold tracking-tight">IRS Notices</h1>
          <p className="text-muted-foreground">
            Track and respond to IRS notices, audits, and correspondence
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
            <CardTitle className="text-sm font-medium">Active Notices</CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredItems.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Requiring attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
            <FileWarning className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {overdueCount > 0 ? `${overdueCount} overdue` : "None overdue"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Response</CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingResponseCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Awaiting action</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{completedNotices}</div>
            <p className="text-xs text-muted-foreground mt-1">Successfully closed</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by client, title, or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Notices List */}
      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 mb-4 text-muted-foreground/50" />
            <p>No IRS notices found</p>
            <p className="text-sm mt-1">
              IRS notices include work items with "IRS Notice", "IRS Support", "Audit",
              "Penalty", or related keywords
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {statusFilter === "completed" ? "Resolved Notices" : "Active Notices"}
            </CardTitle>
            <CardDescription>
              {filteredItems.length} notice{filteredItems.length !== 1 ? "s" : ""} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <div
                  key={item.WorkKey}
                  className={`flex items-start justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors ${
                    item.urgency === "critical"
                      ? "border-red-200 bg-red-50/30"
                      : ""
                  }`}
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{item.Title}</h3>
                      {item.urgency && (
                        <Badge
                          variant="outline"
                          className={getUrgencyColor(item.urgency)}
                        >
                          {item.urgency.charAt(0).toUpperCase() + item.urgency.slice(1)}
                        </Badge>
                      )}
                      {item.noticeType && (
                        <Badge variant="outline" className={getNoticeTypeColor(item.noticeType)}>
                          {item.noticeType}
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
                            {new Date(item.DueDate) < new Date() ? "OVERDUE: " : "Due: "}
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
      )}
    </div>
  )
}

function determineNoticeType(item: KarbonWorkItem): string {
  const title = item.Title?.toUpperCase() || ""
  const workType = item.WorkType?.toUpperCase() || ""
  const combined = `${title} ${workType}`

  if (combined.includes("AUDIT")) return "Audit"
  if (combined.includes("CP2000")) return "CP2000"
  if (combined.includes("PENALTY") || combined.includes("ABATEMENT")) return "Penalty Abatement"
  if (combined.includes("LEVY") || combined.includes("LIEN")) return "Levy/Lien"
  if (combined.includes("COLLECTION")) return "Collection"
  if (combined.includes("NOTICE") || combined.includes("LETTER")) return "Notice/Letter"
  return "IRS Support"
}

function determineUrgency(item: KarbonWorkItem): "critical" | "high" | "medium" | "low" {
  const dueDate = item.DueDate ? new Date(item.DueDate) : null
  const now = new Date()

  // Priority-based
  if (item.Priority === "Critical") return "critical"
  if (item.Priority === "High") return "high"

  // Due date-based
  if (dueDate) {
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (daysUntilDue < 0) return "critical" // Overdue
    if (daysUntilDue <= 7) return "high"
    if (daysUntilDue <= 30) return "medium"
  }

  // Title-based urgency
  const title = item.Title?.toUpperCase() || ""
  if (title.includes("LEVY") || title.includes("LIEN") || title.includes("GARNISHMENT"))
    return "critical"
  if (title.includes("AUDIT")) return "high"

  return "low"
}

function getUrgencyColor(urgency: string): string {
  switch (urgency) {
    case "critical":
      return "bg-red-100 text-red-700 border-red-300"
    case "high":
      return "bg-orange-100 text-orange-700 border-orange-300"
    case "medium":
      return "bg-amber-100 text-amber-700 border-amber-300"
    default:
      return "bg-green-100 text-green-700 border-green-300"
  }
}

function getNoticeTypeColor(type: string): string {
  switch (type) {
    case "Audit":
      return "bg-red-100 text-red-700 border-red-300"
    case "CP2000":
      return "bg-orange-100 text-orange-700 border-orange-300"
    case "Penalty Abatement":
      return "bg-amber-100 text-amber-700 border-amber-300"
    case "Levy/Lien":
      return "bg-rose-100 text-rose-700 border-rose-300"
    case "Collection":
      return "bg-red-100 text-red-700 border-red-300"
    case "Notice/Letter":
      return "bg-blue-100 text-blue-700 border-blue-300"
    default:
      return "bg-slate-100 text-slate-700 border-slate-300"
  }
}

function getStatusColor(status: string): string {
  const s = status?.toLowerCase() || ""
  if (s.includes("complete")) return "bg-green-100 text-green-700 border-green-300"
  if (s.includes("progress") || s.includes("preparing"))
    return "bg-blue-100 text-blue-700 border-blue-300"
  if (s.includes("waiting") || s.includes("pending") || s.includes("follow"))
    return "bg-amber-100 text-amber-700 border-amber-300"
  if (s.includes("review")) return "bg-orange-100 text-orange-700 border-orange-300"
  return "bg-slate-100 text-slate-700 border-slate-300"
}
