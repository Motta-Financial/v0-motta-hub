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
import type { KarbonClient } from "@/lib/karbon-types"
import { getKarbonClientUrl } from "@/lib/karbon-utils"

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

interface BookkeepingClient {
  clientKey: string
  clientName: string
  lead: string
  clientType: "MONTHLY" | "QUARTERLY"
  meetingDate?: string
  status: keyof typeof STATUS_TYPES
  tasks: {
    [key: string]: boolean // A-J task completion
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
  const [clients, setClients] = useState<KarbonClient[]>([])
  const [bookkeepingClients, setBookkeepingClients] = useState<BookkeepingClient[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterLead, setFilterLead] = useState<string>("all")
  const [filterType, setFilterType] = useState<string>("all")
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
      const monthKey = `${selectedMonth.getFullYear()}-${selectedMonth.getMonth()}`
      console.log("[v0] Fetching bookkeeping data for:", formatMonthYear(selectedMonth), "- Month key:", monthKey)

      const response = await fetch("/api/karbon/clients")
      if (!response.ok) throw new Error("Failed to fetch clients")

      const data = await response.json()
      const accountingClients = (data.clients || []).filter((client: KarbonClient) =>
        (client.serviceLinesUsed || []).some((sl) => ["ACCOUNTING", "ACCT", "ACCTG"].includes(sl)),
      )

      setClients(accountingClients)

      const savedDataKey = `bookkeeping-data-${monthKey}`
      const savedData = localStorage.getItem(savedDataKey)

      if (savedData) {
        console.log("[v0] Loading saved bookkeeping data for", formatMonthYear(selectedMonth))
        const parsed = JSON.parse(savedData)
        setBookkeepingClients(parsed)
      } else {
        console.log("[v0] No saved data found, initializing bookkeeping data for", formatMonthYear(selectedMonth))
        const monthlyClients = accountingClients.filter((client: KarbonClient) => {
          return true
        })

        const transformed = monthlyClients.map((client: KarbonClient) => ({
          clientKey: client.clientKey,
          clientName: client.clientName,
          lead: "",
          clientType: "MONTHLY" as const,
          meetingDate: undefined,
          status: "NOT_READY" as keyof typeof STATUS_TYPES,
          tasks: {
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
          },
        }))

        setBookkeepingClients(transformed)
        localStorage.setItem(savedDataKey, JSON.stringify(transformed))
      }
    } catch (error) {
      console.error("Error fetching data:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (bookkeepingClients.length > 0) {
      const monthKey = `${selectedMonth.getFullYear()}-${selectedMonth.getMonth()}`
      const savedDataKey = `bookkeeping-data-${monthKey}`
      localStorage.setItem(savedDataKey, JSON.stringify(bookkeepingClients))
      console.log("[v0] Saved bookkeeping data for", formatMonthYear(selectedMonth))
    }
  }, [bookkeepingClients, selectedMonth])

  const toggleTask = (clientKey: string, taskId: string) => {
    setBookkeepingClients((prev) =>
      prev.map((client) =>
        client.clientKey === clientKey
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

  const updateClientStatus = (clientKey: string, status: keyof typeof STATUS_TYPES) => {
    setBookkeepingClients((prev) =>
      prev.map((client) => (client.clientKey === clientKey ? { ...client, status } : client)),
    )
  }

  const updateClientLead = (clientKey: string, lead: string) => {
    setBookkeepingClients((prev) =>
      prev.map((client) => (client.clientKey === clientKey ? { ...client, lead } : client)),
    )
  }

  const uniqueLeads = Array.from(new Set(bookkeepingClients.map((c) => c.lead).filter((lead) => lead !== "")))

  const allFilteredClients = bookkeepingClients.filter((client) => {
    const matchesSearch = client.clientName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesLead = filterLead === "all" || client.lead === filterLead
    const matchesType = filterType === "all" || client.clientType === filterType
    const matchesStatus = filterStatus === "all" || client.status === filterStatus

    return matchesSearch && matchesLead && matchesType && matchesStatus
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
      console.log("[v0] Navigating to previous month:", formatMonthYear(newDate))
      return newDate
    })
  }

  const goToNextMonth = () => {
    setSelectedMonth((prev) => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() + 1)
      console.log("[v0] Navigating to next month:", formatMonthYear(newDate))
      return newDate
    })
  }

  const goToCurrentMonth = () => {
    const now = new Date()
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    console.log("[v0] Navigating to current month:", formatMonthYear(currentMonth))
    setSelectedMonth(currentMonth)
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
          <p className="text-gray-500">Loading bookkeeping tracker...</p>
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
            <CardDescription>Tracking progress for {formatMonthYear(selectedMonth)}</CardDescription>
          </div>
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="flex items-center justify-between mt-4 p-3 bg-gray-50 rounded-lg">
          <Button variant="outline" size="sm" onClick={goToPreviousMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-gray-600" />
            <span className="text-lg font-semibold text-gray-900">{formatMonthYear(selectedMonth)}</span>
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
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-600">Total Clients</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{stats.complete}</p>
            <p className="text-xs text-gray-600">Complete</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.avgCompletion}%</p>
            <p className="text-xs text-gray-600">Avg Progress</p>
          </div>
        </div>

        <div className="border rounded-lg">
          <button
            className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
            onClick={() => setChecklistExpanded(!checklistExpanded)}
          >
            <p className="text-sm font-medium text-gray-900">View Bookkeeping Checklist (A-J)</p>
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
                    <span className="text-gray-900">{task.label}</span>
                    <span className="text-gray-500 text-xs ml-auto">{task.assignee}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
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

        <div className="border rounded-lg divide-y">
          {displayedClients.map((client) => {
            const completedTasks = Object.values(client.tasks).filter(Boolean).length
            const totalTasks = Object.keys(client.tasks).length
            const completionRate = Math.round((completedTasks / totalTasks) * 100)
            const StatusIcon = STATUS_TYPES[client.status].icon

            return (
              <div
                key={client.clientKey}
                className="p-4 hover:bg-gray-50 transition-colors cursor-pointer group"
                onClick={() => setSelectedClient(client)}
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-gray-900 truncate">{client.clientName}</h4>
                      <a
                        href={getKarbonClientUrl(client.clientKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <User className="h-3 w-3" />
                      <span>{client.lead}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <StatusIcon className="h-4 w-4" />
                    <Badge className={STATUS_TYPES[client.status].color} variant="secondary">
                      {STATUS_TYPES[client.status].label}
                    </Badge>
                  </div>

                  <div className="w-48 hidden md:block">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>Progress</span>
                      <span className="font-semibold">{completionRate}%</span>
                    </div>
                    <Progress value={completionRate} className="h-2" />
                  </div>

                  <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                </div>
              </div>
            )
          })}
        </div>

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

        {completedClients.length > 0 && (
          <div className="border rounded-lg bg-green-50">
            <button
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-green-100 transition-colors rounded-lg"
              onClick={() => setShowCompleted(!showCompleted)}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <p className="text-sm font-medium text-gray-900">Completed ({completedClients.length})</p>
              </div>
              {showCompleted ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showCompleted && (
              <div className="border-t divide-y bg-white">
                {completedClients.map((client) => {
                  const StatusIcon = STATUS_TYPES[client.status].icon

                  return (
                    <div
                      key={client.clientKey}
                      className="p-4 hover:bg-gray-50 transition-colors cursor-pointer group"
                      onClick={() => setSelectedClient(client)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-gray-900 truncate">{client.clientName}</h4>
                            <a
                              href={getKarbonClientUrl(client.clientKey)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:text-blue-800 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <User className="h-3 w-3" />
                            <span>{client.lead}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <StatusIcon className="h-4 w-4" />
                          <Badge className={STATUS_TYPES[client.status].color} variant="secondary">
                            {STATUS_TYPES[client.status].label}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle2 className="h-5 w-5" />
                          <span className="text-sm font-semibold">100%</span>
                        </div>

                        <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={!!selectedClient} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedClient && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span>{selectedClient.clientName}</span>
                  <a
                    href={getKarbonClientUrl(selectedClient.clientKey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <ExternalLink className="h-5 w-5" />
                  </a>
                </DialogTitle>
                <DialogDescription>Manage bookkeeping tasks and status</DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">Lead</label>
                    <Select
                      value={selectedClient.lead || "unassigned"}
                      onValueChange={(value) => {
                        const newLead = value === "unassigned" ? "" : value
                        updateClientLead(selectedClient.clientKey, newLead)
                        setSelectedClient({ ...selectedClient, lead: newLead })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        <SelectItem value="Andrew">Andrew</SelectItem>
                        <SelectItem value="Ganesh">Ganesh</SelectItem>
                        <SelectItem value="Thameem">Thameem</SelectItem>
                        <SelectItem value="Angie">Angie</SelectItem>
                        <SelectItem value="Matt">Matt</SelectItem>
                        <SelectItem value="P24">P24</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Type</label>
                    <div className="mt-1">
                      <Badge variant="outline">{selectedClient.clientType}</Badge>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-3">Status</label>
                  <Select
                    value={selectedClient.status}
                    onValueChange={(value) => {
                      updateClientStatus(selectedClient.clientKey, value as keyof typeof STATUS_TYPES)
                      setSelectedClient({ ...selectedClient, status: value as keyof typeof STATUS_TYPES })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_TYPES).map(([key, status]) => (
                        <SelectItem key={key} value={key}>
                          <span className={status.textColor}>{status.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-3">Tasks</label>
                  <div className="space-y-3">
                    {BOOKKEEPING_TASKS.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <Checkbox
                          id={`task-${task.id}`}
                          checked={selectedClient.tasks[task.id]}
                          onCheckedChange={() => {
                            toggleTask(selectedClient.clientKey, task.id)
                            setSelectedClient({
                              ...selectedClient,
                              tasks: {
                                ...selectedClient.tasks,
                                [task.id]: !selectedClient.tasks[task.id],
                              },
                            })
                          }}
                        />
                        <label htmlFor={`task-${task.id}`} className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {task.id}
                            </Badge>
                            <span className="text-sm text-gray-900">{task.label}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Assigned to: {task.assignee}</p>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Overall Progress</span>
                    <span className="text-lg font-bold text-blue-600">
                      {Math.round((Object.values(selectedClient.tasks).filter(Boolean).length / 10) * 100)}%
                    </span>
                  </div>
                  <Progress
                    value={(Object.values(selectedClient.tasks).filter(Boolean).length / 10) * 100}
                    className="h-3"
                  />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
