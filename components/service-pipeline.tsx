"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar, Clock, User, Building, Plus, Filter, MoreHorizontal, AlertTriangle, CheckCircle, DollarSign, Calculator, BookOpen, TrendingUp } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface PipelineTask {
  id: string
  title: string
  client: {
    name: string
    type: "Individual" | "Business"
  }
  assignee: {
    name: string
    avatar: string
  }
  service: "Tax Planning" | "Financial Planning" | "Bookkeeping" | "Business Advisory" | string
  status: "Not Started" | "In Progress" | "Review" | "Completed"
  priority: "Low" | "Medium" | "High" | "Critical"
  dueDate: string
  value: string
  progress: number
  tags: string[]
}

const serviceIcons: Record<string, any> = {
  "Tax Planning": Calculator,
  "Tax": Calculator,
  "Financial Planning": TrendingUp,
  "Bookkeeping": BookOpen,
  "ACCT": BookOpen,
  "Business Advisory": DollarSign,
}

const serviceColors: Record<string, string> = {
  "Tax Planning": "bg-blue-50 border-blue-200 text-blue-700",
  "Tax": "bg-blue-50 border-blue-200 text-blue-700",
  "Financial Planning": "bg-emerald-50 border-emerald-200 text-emerald-700",
  "Bookkeeping": "bg-purple-50 border-purple-200 text-purple-700",
  "ACCT": "bg-purple-50 border-purple-200 text-purple-700",
  "Business Advisory": "bg-orange-50 border-orange-200 text-orange-700",
}

export function ServicePipeline() {
  const [selectedService, setSelectedService] = useState("all")
  const [selectedAssignee, setSelectedAssignee] = useState("all")
  const [pipelineTasks, setPipelineTasks] = useState<PipelineTask[]>([])
  const [loading, setLoading] = useState(true)
  const [assignees, setAssignees] = useState<string[]>([])

  // <CHANGE> Fetch from Supabase work_items table
  useEffect(() => {
    async function fetchPipelineTasks() {
      try {
        const supabase = createClient()

        const { data: workItems, error } = await supabase
          .from("work_items")
          .select("*")
          .in("work_status", ["Active", "In Progress", "Pending", "Review"])
          .order("due_date", { ascending: true })
          .limit(100)

        if (error) {
          console.error("Error fetching pipeline tasks:", error)
          setPipelineTasks([])
          setLoading(false)
          return
        }

        // Extract unique assignees
        const uniqueAssignees = [...new Set((workItems || []).map((item: any) => item.assigned_to_name).filter(Boolean))]
        setAssignees(uniqueAssignees as string[])

        // Map work items to pipeline task format
        const tasks: PipelineTask[] = (workItems || []).map((item: any) => {
          const serviceLine = item.service_line || item.work_type || "General"
          const status = mapStatus(item.primary_status)
          const progress = calculateProgress(status)

          return {
            id: item.id,
            title: item.title || "Untitled Work Item",
            client: {
              name: item.client_name || "Unknown Client",
              type: item.organization_id ? "Business" : "Individual",
            },
            assignee: {
              name: item.assigned_to_name || "Unassigned",
              avatar: "",
            },
            service: serviceLine,
            status: status,
            priority: mapPriority(item.priority),
            dueDate: item.due_date || new Date().toISOString(),
            value: "$0",
            progress: progress,
            tags: [item.work_type || "General"].filter(Boolean),
          }
        })

        setPipelineTasks(tasks)
      } catch (error) {
        console.error("Error fetching pipeline tasks:", error)
        setPipelineTasks([])
      } finally {
        setLoading(false)
      }
    }

    fetchPipelineTasks()
  }, [])

  const mapStatus = (primaryStatus: string): PipelineTask["status"] => {
    const status = primaryStatus?.toLowerCase() || ""
    if (status.includes("complete")) return "Completed"
    if (status.includes("review")) return "Review"
    if (status.includes("progress") || status.includes("active")) return "In Progress"
    return "Not Started"
  }

  const mapPriority = (priority: string): PipelineTask["priority"] => {
    const p = priority?.toLowerCase() || ""
    if (p.includes("critical")) return "Critical"
    if (p.includes("high")) return "High"
    if (p.includes("low")) return "Low"
    return "Medium"
  }

  const calculateProgress = (status: PipelineTask["status"]): number => {
    switch (status) {
      case "Completed": return 100
      case "Review": return 85
      case "In Progress": return 50
      default: return 0
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "Critical":
        return "bg-red-100 text-red-700 border-red-200"
      case "High":
        return "bg-orange-100 text-orange-700 border-orange-200"
      case "Medium":
        return "bg-yellow-100 text-yellow-700 border-yellow-200"
      case "Low":
        return "bg-gray-100 text-gray-700 border-gray-200"
      default:
        return "bg-gray-100 text-gray-700 border-gray-200"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-emerald-100 text-emerald-700"
      case "In Progress":
        return "bg-blue-100 text-blue-700"
      case "Review":
        return "bg-purple-100 text-purple-700"
      case "Not Started":
        return "bg-gray-100 text-gray-700"
      default:
        return "bg-gray-100 text-gray-700"
    }
  }

  const isOverdue = (dueDate: string) => {
    return new Date(dueDate) < new Date()
  }

  const filteredTasks = pipelineTasks.filter((task) => {
    const matchesService = selectedService === "all" || task.service.includes(selectedService)
    const matchesAssignee = selectedAssignee === "all" || task.assignee.name === selectedAssignee
    return matchesService && matchesAssignee
  })

  const tasksByStatus = {
    "Not Started": filteredTasks.filter((task) => task.status === "Not Started"),
    "In Progress": filteredTasks.filter((task) => task.status === "In Progress"),
    Review: filteredTasks.filter((task) => task.status === "Review"),
    Completed: filteredTasks.filter((task) => task.status === "Completed"),
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Service Pipeline</h1>
            <p className="text-gray-600 mt-1">Loading pipeline data...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-24 bg-gray-100 rounded-lg mb-4"></div>
              <div className="space-y-3">
                {[1, 2].map((j) => (
                  <div key={j} className="h-32 bg-gray-100 rounded-lg"></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Service Pipeline</h1>
          <p className="text-gray-600 mt-1">Track work in progress across all service areas</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Tasks</p>
                <p className="text-2xl font-semibold text-gray-900">{filteredTasks.length}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">In Progress</p>
                <p className="text-2xl font-semibold text-gray-900">{tasksByStatus["In Progress"].length}</p>
              </div>
              <Clock className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">In Review</p>
                <p className="text-2xl font-semibold text-gray-900">{tasksByStatus["Review"].length}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-2xl font-semibold text-gray-900">{tasksByStatus["Completed"].length}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Not Started</p>
                <p className="text-2xl font-semibold text-gray-900">{tasksByStatus["Not Started"].length}</p>
              </div>
              <DollarSign className="h-8 w-8 text-gray-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-white shadow-sm border-gray-200">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Select value={selectedService} onValueChange={setSelectedService}>
              <SelectTrigger className="w-full sm:w-64">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by service" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Services</SelectItem>
                <SelectItem value="Tax">Tax</SelectItem>
                <SelectItem value="ACCT">Accounting</SelectItem>
                <SelectItem value="Bookkeeping">Bookkeeping</SelectItem>
                <SelectItem value="Advisory">Advisory</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
              <SelectTrigger className="w-full sm:w-64">
                <User className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Team Members</SelectItem>
                {assignees.map((assignee) => (
                  <SelectItem key={assignee} value={assignee}>
                    {assignee}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {Object.entries(tasksByStatus).map(([status, tasks]) => (
          <div key={status} className="space-y-4">
            <Card className="bg-white shadow-sm border-gray-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center justify-between">
                  <span>{status}</span>
                  <Badge variant="secondary" className="ml-2">
                    {tasks.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
            </Card>

            <div className="space-y-3">
              {tasks.slice(0, 10).map((task) => {
                const ServiceIcon = serviceIcons[task.service] || Calculator
                const serviceColor = serviceColors[task.service] || "bg-gray-50 border-gray-200 text-gray-700"
                return (
                  <Card key={task.id} className="bg-white shadow-sm border-gray-200 hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        {/* Header */}
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-2">
                            <div className={`p-1.5 rounded-lg ${serviceColor}`}>
                              <ServiceIcon className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900 text-sm leading-tight line-clamp-2">{task.title}</h4>
                              <p className="text-xs text-gray-500 mt-1">{task.service}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Client */}
                        <div className="flex items-center space-x-2">
                          <div className="flex items-center space-x-1">
                            {task.client.type === "Business" ? (
                              <Building className="h-3 w-3 text-gray-400" />
                            ) : (
                              <User className="h-3 w-3 text-gray-400" />
                            )}
                            <span className="text-xs text-gray-600 line-clamp-1">{task.client.name}</span>
                          </div>
                        </div>

                        {/* Progress */}
                        {task.progress > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-500">Progress</span>
                              <span className="text-xs text-gray-900">{task.progress}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                              <div
                                className="bg-emerald-600 h-1.5 rounded-full transition-all"
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Footer */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                          <div className="flex items-center space-x-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={task.assignee.avatar || "/placeholder.svg"} alt={task.assignee.name} />
                              <AvatarFallback className="text-xs">
                                {task.assignee.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-gray-600 line-clamp-1">{task.assignee.name}</span>
                          </div>
                          <Badge className={getPriorityColor(task.priority)} variant="outline">
                            {task.priority}
                          </Badge>
                        </div>

                        {/* Due Date */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center space-x-1">
                            <Calendar className="h-3 w-3 text-gray-400" />
                            <span className={isOverdue(task.dueDate) ? "text-red-600" : "text-gray-500"}>
                              {new Date(task.dueDate).toLocaleDateString()}
                            </span>
                            {isOverdue(task.dueDate) && <AlertTriangle className="h-3 w-3 text-red-500" />}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}

              {tasks.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-sm">No tasks in this status</p>
                </div>
              )}

              {tasks.length > 10 && (
                <p className="text-xs text-center text-gray-500">+{tasks.length - 10} more</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
