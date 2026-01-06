"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import {
  RefreshCw,
  Search,
  User,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  Pause,
  ChevronRight,
  ChevronLeft,
  Calendar,
} from "lucide-react"

const BOOKKEEPING_TASKS = [
  { id: "A", label: "Review work item", assignee: "P24" },
  { id: "B", label: "Enter & categorize transactions", assignee: "P24" },
  { id: "C", label: "Code uncertain transactions", assignee: "P24" },
  { id: "D", label: "Gather statements", assignee: "P24" },
  { id: "E", label: "Reconcile accounts", assignee: "P24" },
  { id: "F", label: "Review accounting", assignee: "Andrew" },
  { id: "G", label: "Send reclassification request", assignee: "Andrew" },
  { id: "H", label: "Reclassify transactions", assignee: "Andrew" },
  { id: "I", label: "Send reports", assignee: "Andrew" },
  { id: "J", label: "Complete meeting", assignee: "Andrew" },
]

interface SupabaseWorkItem {
  id: string
  karbon_work_item_key: string
  title: string
  description: string | null
  status: string | null
  workflow_status: string | null
  work_type: string | null
  priority: string | null
  due_date: string | null
  start_date: string | null
  completed_date: string | null
  period_start: string | null
  period_end: string | null
  tax_year: number | null
  client_type: string | null
  karbon_client_key: string | null
  client_group_name: string | null
  client_manager_name: string | null
  client_partner_name: string | null
  assignee_name: string | null
  karbon_url: string | null
  clientName: string | null
  client: {
    id: string
    full_name?: string
    name?: string
    karbon_contact_key?: string
    karbon_organization_key?: string
  } | null
}

interface BookkeepingClient {
  workItemId: string
  karbonWorkItemKey: string
  clientName: string
  lead: string
  clientType: "MONTHLY" | "QUARTERLY"
  meetingDate?: string
  status: keyof typeof STATUS_TYPES
  periodStart?: string
  periodEnd?: string
  dueDate?: string
  karbonUrl?: string
  tasks: {
    [key: string]: boolean
  }
}

const STATUS_TYPES = {
  NOT_READY: { label: "Not ready yet", color: "bg-red-500 text-white", textColor: "text-red-700", icon: AlertCircle },
  NEED_INFO: {
    label: "Need info from client",
    color: "bg-yellow-400 text-gray-900",
    textColor: "text-yellow-700",
    icon: Clock,
  },
  ON_HOLD: { label: "Clients on Hold", color: "bg-orange-400 text-white", textColor: "text-orange-700", icon: Pause },
  REVIEW: {
    label: "Need to review integration",
    color: "bg-blue-500 text-white",
    textColor: "text-blue-700",
    icon: AlertCircle,
  },
  COMPLETE: { label: "Complete", color: "bg-green-500 text-white", textColor: "text-green-700", icon: CheckCircle2 },
}

export function AccountingBookkeepingTracker() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [workItems, setWorkItems] = useState<SupabaseWorkItem[]>([])
  const [bookkeepingClients, setBookkeepingClients] = useState<BookkeepingClient[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterLead, setFilterLead] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [checklistExpanded, setChecklistExpanded] = useState(false)
  const [selectedClient, setSelectedClient] = useState<BookkeepingClient | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    fetchData()
  }, [selectedMonth])

  const fetchData = async () => {
    setLoading(true)
    try {
      const monthKey = `${selectedMonth.getFullYear()}-${selectedMonth.getMonth() + 1}`
      const monthNum = selectedMonth.getMonth() + 1
      const yearNum = selectedMonth.getFullYear()

      console.log("[v0] Fetching bookkeeping data from Supabase for:", formatMonthYear(selectedMonth))

      // Fetch ACCT | Bookkeeping work items from Supabase for active clients
      const response = await fetch(
        `/api/supabase/work-items?titleFilter=ACCT | Bookkeeping&status=active&periodMonth=${monthNum}&periodYear=${yearNum}`,
      )

      if (!response.ok) {
        throw new Error("Failed to fetch work items from Supabase")
      }

      const data = await response.json()
      const fetchedWorkItems: SupabaseWorkItem[] = data.workItems || []

      console.log("[v0] Fetched", fetchedWorkItems.length, "ACCT | Bookkeeping work items from Supabase")
      setWorkItems(fetchedWorkItems)

      // Load saved task progress from localStorage
      const savedDataKey = `bookkeeping-tasks-${monthKey}`
      const savedTasks = localStorage.getItem(savedDataKey)
      const savedTasksMap = savedTasks ? JSON.parse(savedTasks) : {}

      // Transform Supabase work items to BookkeepingClient format
      const transformed: BookkeepingClient[] = fetchedWorkItems.map((item) => {
        const existingTasks = savedTasksMap[item.id] || {
          A: false,
          B: false,
          C: false,
          D: false,
          E: false,
          F: false,
          G: false,
          H: false,
          I: false,
          J: false,
        }

        // Determine status based on workflow_status or saved status
        let status: keyof typeof STATUS_TYPES = "NOT_READY"
        const workflowStatus = item.workflow_status?.toLowerCase() || ""
        if (workflowStatus.includes("complete")) {
          status = "COMPLETE"
        } else if (workflowStatus.includes("hold") || workflowStatus.includes("waiting")) {
          status = "ON_HOLD"
        } else if (workflowStatus.includes("review")) {
          status = "REVIEW"
        } else if (workflowStatus.includes("info") || workflowStatus.includes("pending")) {
          status = "NEED_INFO"
        }

        return {
          workItemId: item.id,
          karbonWorkItemKey: item.karbon_work_item_key,
          clientName: item.clientName || item.client_group_name || "Unknown Client",
          lead: item.assignee_name || item.client_manager_name || "",
          clientType: "MONTHLY" as const,
          meetingDate: undefined,
          status: savedTasksMap[item.id]?.status || status,
          periodStart: item.period_start || undefined,
          periodEnd: item.period_end || undefined,
          dueDate: item.due_date || undefined,
          karbonUrl: item.karbon_url || undefined,
          tasks: existingTasks.tasks || existingTasks,
        }
      })

      setBookkeepingClients(transformed)
    } catch (error) {
      console.error("[v0] Error fetching bookkeeping data:", error)
    } finally {
      setLoading(false)
    }
  }

  // Save task progress to localStorage when it changes
  useEffect(() => {
    if (bookkeepingClients.length > 0) {
      const monthKey = `${selectedMonth.getFullYear()}-${selectedMonth.getMonth() + 1}`
      const savedDataKey = `bookkeeping-tasks-${monthKey}`

      const tasksMap: Record<string, { tasks: Record<string, boolean>; status: string }> = {}
      bookkeepingClients.forEach((client) => {
        tasksMap[client.workItemId] = {
          tasks: client.tasks,
          status: client.status,
        }
      })

      localStorage.setItem(savedDataKey, JSON.stringify(tasksMap))
    }
  }, [bookkeepingClients, selectedMonth])

  const toggleTask = (workItemId: string, taskId: string) => {
    setBookkeepingClients((prev) =>
      prev.map((client) =>
        client.workItemId === workItemId
          ? {
              ...client,
              tasks: {
                ...client.tasks,
                [taskId]: !client.tasks[taskId],
              },
            }
          : client,
      ),
    )
  }

  const updateClientStatus = (workItemId: string, status: keyof typeof STATUS_TYPES) => {
    setBookkeepingClients((prev) =>
      prev.map((client) => (client.workItemId === workItemId ? { ...client, status } : client)),
    )
  }

  const uniqueLeads = Array.from(new Set(bookkeepingClients.map((c) => c.lead).filter((lead) => lead !== "")))

  const allFilteredClients = bookkeepingClients.filter((client) => {
    const matchesSearch = client.clientName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesLead = filterLead === "all" || client.lead === filterLead
    const matchesStatus = filterStatus === "all" || client.status === filterStatus

    return matchesSearch && matchesLead && matchesStatus
  })

  const activeClients = allFilteredClients.filter((client) => {
    const completedTasks = Object.values(client.tasks).filter(Boolean).length
    return completedTasks < 10
  })

  const completedClients = allFilteredClients.filter((client) => {
    const completedTasks = Object.values(client.tasks).filter(Boolean).length
    return completedTasks === 10
  })

  const stats = {
    total: bookkeepingClients.length,
    complete: completedClients.length,
    needInfo: bookkeepingClients.filter((c) => c.status === "NEED_INFO").length,
    onHold: bookkeepingClients.filter((c) => c.status === "ON_HOLD").length,
    avgCompletion: Math.round(
      bookkeepingClients.reduce((acc, client) => {
        const completed = Object.values(client.tasks).filter(Boolean).length
        return acc + (completed / 10) * 100
      }, 0) / (bookkeepingClients.length || 1),
    ),
  }

  const displayedClients = showAll ? activeClients : activeClients.slice(0, 10)
  const hasMore = activeClients.length > 10

  const goToPreviousMonth = () => {
    setSelectedMonth((prev) => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() - 1)
      return newDate
    })
  }

  const goToNextMonth = () => {
    setSelectedMonth((prev) => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() + 1)
      return newDate
    })
  }

  const goToCurrentMonth = () => {
    const now = new Date()
    setSelectedMonth(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  const formatMonthYear = (date: Date) => {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  }

  const isCurrentMonth = () => {
    const now = new Date()
    return selectedMonth.getMonth() === now.getMonth() && selectedMonth.getFullYear() === now.getFullYear()
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading bookkeeping tracker from Supabase...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Monthly Bookkeeping Tracker</CardTitle>
            <CardDescription>
              Tracking ACCT | Bookkeeping work items for {formatMonthYear(selectedMonth)}
            </CardDescription>
          </div>
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center justify-between mt-4 p-3 bg-muted/50 rounded-lg">
          <Button variant="outline" size="sm" onClick={goToPreviousMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <span className="text-lg font-semibold">{formatMonthYear(selectedMonth)}</span>
          </div>

          <div className="flex items-center gap-2">
            {!isCurrentMonth() && (
              <Button variant="ghost" size="sm" onClick={goToCurrentMonth}>
                Today
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={goToNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total Clients</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{stats.complete}</p>
            <p className="text-xs text-muted-foreground">Complete</p>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <p className="text-2xl font-bold text-blue-600">{stats.avgCompletion}%</p>
            <p className="text-xs text-muted-foreground">Avg Progress</p>
          </div>
        </div>

        {/* Checklist Reference */}
        <div className="border rounded-lg">
          <button
            className="w-full px-4 py-2 flex items-center justify-between hover:bg-muted/50 transition-colors"
            onClick={() => setChecklistExpanded(!checklistExpanded)}
          >
            <p className="text-sm font-medium">View Bookkeeping Checklist (A-J)</p>
            {checklistExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {checklistExpanded && (
            <div className="px-4 pb-3 border-t">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                {BOOKKEEPING_TASKS.map((task) => (
                  <div key={task.id} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="font-mono text-xs">
                      {task.id}
                    </Badge>
                    <span>{task.label}</span>
                    <span className="text-muted-foreground text-xs ml-auto">{task.assignee}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <Select value={filterLead} onValueChange={setFilterLead}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by lead" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leads</SelectItem>
              {uniqueLeads.map((lead) => (
                <SelectItem key={lead} value={lead}>
                  {lead}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.entries(STATUS_TYPES).map(([key, status]) => (
                <SelectItem key={key} value={key}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Client List */}
        {displayedClients.length === 0 ? (
          <div className="text-center py-12 border rounded-lg">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No ACCT | Bookkeeping work items found for {formatMonthYear(selectedMonth)}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Work items are filtered by "ACCT | Bookkeeping" title pattern
            </p>
          </div>
        ) : (
          <div className="border rounded-lg divide-y">
            {displayedClients.map((client) => {
              const completedTasks = Object.values(client.tasks).filter(Boolean).length
              const totalTasks = Object.keys(client.tasks).length
              const completionRate = Math.round((completedTasks / totalTasks) * 100)
              const StatusIcon = STATUS_TYPES[client.status].icon

              return (
                <div
                  key={client.workItemId}
                  className="p-4 hover:bg-muted/50 transition-colors cursor-pointer group"
                  onClick={() => setSelectedClient(client)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium truncate">{client.clientName}</h4>
                        {client.karbonUrl && (
                          <a
                            href={client.karbonUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:text-blue-800 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span>{client.lead || "Unassigned"}</span>
                        {client.dueDate && (
                          <>
                            <span>•</span>
                            <span>Due: {new Date(client.dueDate).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <StatusIcon className="h-4 w-4" />
                      <Badge className={STATUS_TYPES[client.status].color} variant="secondary">
                        {STATUS_TYPES[client.status].label}
                      </Badge>
                    </div>

                    <div className="w-48 hidden md:block">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span className="font-semibold">{completionRate}%</span>
                      </div>
                      <Progress value={completionRate} className="h-2" />
                    </div>

                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {hasMore && (
          <div className="text-center">
            <Button variant="outline" onClick={() => setShowAll(!showAll)}>
              {showAll ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-2" />
                  Show Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-2" />
                  Show All ({activeClients.length} clients)
                </>
              )}
            </Button>
          </div>
        )}

        {/* Completed Section */}
        {completedClients.length > 0 && (
          <div className="border rounded-lg bg-green-50">
            <button
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-green-100 transition-colors rounded-lg"
              onClick={() => setShowCompleted(!showCompleted)}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <p className="text-sm font-medium">Completed ({completedClients.length})</p>
              </div>
              {showCompleted ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showCompleted && (
              <div className="border-t divide-y bg-background">
                {completedClients.map((client) => (
                  <div
                    key={client.workItemId}
                    className="p-4 hover:bg-muted/50 transition-colors cursor-pointer group"
                    onClick={() => setSelectedClient(client)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium truncate">{client.clientName}</h4>
                          {client.karbonUrl && (
                            <a
                              href={client.karbonUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:text-blue-800 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span>{client.lead || "Unassigned"}</span>
                        </div>
                      </div>
                      <Badge className="bg-green-500 text-white">Complete</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Client Detail Dialog */}
      <Dialog open={!!selectedClient} onOpenChange={() => setSelectedClient(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedClient?.clientName}</DialogTitle>
            <DialogDescription>
              {selectedClient?.lead && `Lead: ${selectedClient.lead}`}
              {selectedClient?.periodStart && selectedClient?.periodEnd && (
                <span className="ml-2">
                  | Period: {new Date(selectedClient.periodStart).toLocaleDateString()} -{" "}
                  {new Date(selectedClient.periodEnd).toLocaleDateString()}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {selectedClient && (
            <div className="space-y-4">
              {/* Status Selector */}
              <div>
                <label className="text-sm font-medium mb-2 block">Status</label>
                <Select
                  value={selectedClient.status}
                  onValueChange={(value) => {
                    updateClientStatus(selectedClient.workItemId, value as keyof typeof STATUS_TYPES)
                    setSelectedClient({ ...selectedClient, status: value as keyof typeof STATUS_TYPES })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_TYPES).map(([key, status]) => (
                      <SelectItem key={key} value={key}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Task Checklist */}
              <div>
                <label className="text-sm font-medium mb-2 block">Tasks</label>
                <div className="space-y-2">
                  {BOOKKEEPING_TASKS.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        toggleTask(selectedClient.workItemId, task.id)
                        setSelectedClient({
                          ...selectedClient,
                          tasks: {
                            ...selectedClient.tasks,
                            [task.id]: !selectedClient.tasks[task.id],
                          },
                        })
                      }}
                    >
                      <Checkbox checked={selectedClient.tasks[task.id]} />
                      <Badge variant="outline" className="font-mono text-xs">
                        {task.id}
                      </Badge>
                      <span className="flex-1 text-sm">{task.label}</span>
                      <span className="text-xs text-muted-foreground">{task.assignee}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Karbon Link */}
              {selectedClient.karbonUrl && (
                <Button variant="outline" className="w-full bg-transparent" asChild>
                  <a href={selectedClient.karbonUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open in Karbon
                  </a>
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
