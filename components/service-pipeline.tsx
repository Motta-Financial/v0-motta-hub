"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Calendar,
  Clock,
  User,
  Building,
  Plus,
  Filter,
  MoreHorizontal,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Calculator,
  BookOpen,
  TrendingUp,
} from "lucide-react"

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
  service: "Tax Planning" | "Financial Planning" | "Bookkeeping" | "Business Advisory"
  status: "Not Started" | "In Progress" | "Review" | "Completed"
  priority: "Low" | "Medium" | "High" | "Critical"
  dueDate: string
  value: string
  progress: number
  tags: string[]
}

const serviceIcons = {
  "Tax Planning": Calculator,
  "Financial Planning": TrendingUp,
  Bookkeeping: BookOpen,
  "Business Advisory": DollarSign,
}

const serviceColors = {
  "Tax Planning": "bg-blue-50 border-blue-200 text-blue-700",
  "Financial Planning": "bg-emerald-50 border-emerald-200 text-emerald-700",
  Bookkeeping: "bg-purple-50 border-purple-200 text-purple-700",
  "Business Advisory": "bg-orange-50 border-orange-200 text-orange-700",
}

export function ServicePipeline() {
  const [selectedService, setSelectedService] = useState("all")
  const [selectedAssignee, setSelectedAssignee] = useState("all")

  // Mock pipeline data
  const pipelineTasks: PipelineTask[] = [
    {
      id: "1",
      title: "Q4 2024 Tax Return Preparation",
      client: { name: "Johnson & Associates LLC", type: "Business" },
      assignee: { name: "Mark Dwyer", avatar: "/professional-man.png" },
      service: "Tax Planning",
      status: "In Progress",
      priority: "High",
      dueDate: "2024-01-15",
      value: "$8,500",
      progress: 75,
      tags: ["Corporate", "Quarterly"],
    },
    {
      id: "2",
      title: "Individual Tax Planning Review",
      client: { name: "Robert Chen", type: "Individual" },
      assignee: { name: "Nick Roccuia", avatar: "/professional-man-beard.png" },
      service: "Tax Planning",
      status: "Review",
      priority: "Medium",
      dueDate: "2024-01-12",
      value: "$2,200",
      progress: 90,
      tags: ["Individual", "Review"],
    },
    {
      id: "3",
      title: "Retirement Portfolio Analysis",
      client: { name: "Sarah Williams", type: "Individual" },
      assignee: { name: "Sarah Chen", avatar: "/professional-woman.png" },
      service: "Financial Planning",
      status: "In Progress",
      priority: "Medium",
      dueDate: "2024-01-20",
      value: "$5,000",
      progress: 45,
      tags: ["Retirement", "Investment"],
    },
    {
      id: "4",
      title: "Monthly Bookkeeping Reconciliation",
      client: { name: "TechStart Solutions LLC", type: "Business" },
      assignee: { name: "Matt Pereria", avatar: "/professional-man-glasses.png" },
      service: "Bookkeeping",
      status: "In Progress",
      priority: "Medium",
      dueDate: "2024-01-10",
      value: "$1,800",
      progress: 60,
      tags: ["Monthly", "Reconciliation"],
    },
    {
      id: "5",
      title: "Business Expansion Strategy",
      client: { name: "Green Valley Consulting", type: "Business" },
      assignee: { name: "Mark Dwyer", avatar: "/professional-man.png" },
      service: "Business Advisory",
      status: "Not Started",
      priority: "High",
      dueDate: "2024-01-25",
      value: "$12,000",
      progress: 0,
      tags: ["Strategy", "Expansion"],
    },
    {
      id: "6",
      title: "Estate Planning Review",
      client: { name: "Michael Thompson", type: "Individual" },
      assignee: { name: "Sarah Chen", avatar: "/professional-woman.png" },
      service: "Financial Planning",
      status: "Review",
      priority: "Low",
      dueDate: "2024-01-30",
      value: "$3,500",
      progress: 85,
      tags: ["Estate", "Planning"],
    },
    {
      id: "7",
      title: "Payroll Setup & Processing",
      client: { name: "Local Restaurant Group", type: "Business" },
      assignee: { name: "Matt Pereria", avatar: "/professional-man-glasses.png" },
      service: "Bookkeeping",
      status: "Completed",
      priority: "Medium",
      dueDate: "2024-01-05",
      value: "$2,400",
      progress: 100,
      tags: ["Payroll", "Setup"],
    },
    {
      id: "8",
      title: "Tax Optimization Consultation",
      client: { name: "Innovation Labs Inc", type: "Business" },
      assignee: { name: "Nick Roccuia", avatar: "/professional-man-beard.png" },
      service: "Tax Planning",
      status: "Not Started",
      priority: "Critical",
      dueDate: "2024-01-08",
      value: "$6,800",
      progress: 0,
      tags: ["Optimization", "Consultation"],
    },
  ]

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
    const matchesService = selectedService === "all" || task.service === selectedService
    const matchesAssignee = selectedAssignee === "all" || task.assignee.name === selectedAssignee
    return matchesService && matchesAssignee
  })

  const tasksByStatus = {
    "Not Started": filteredTasks.filter((task) => task.status === "Not Started"),
    "In Progress": filteredTasks.filter((task) => task.status === "In Progress"),
    Review: filteredTasks.filter((task) => task.status === "Review"),
    Completed: filteredTasks.filter((task) => task.status === "Completed"),
  }

  const totalValue = filteredTasks.reduce(
    (sum, task) => sum + Number.parseFloat(task.value.replace("$", "").replace(",", "")),
    0,
  )

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
                <p className="text-sm text-gray-600">Pipeline Value</p>
                <p className="text-2xl font-semibold text-gray-900">${totalValue.toLocaleString()}</p>
              </div>
              <DollarSign className="h-8 w-8 text-emerald-600" />
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
                <SelectItem value="Tax Planning">Tax Planning</SelectItem>
                <SelectItem value="Financial Planning">Financial Planning</SelectItem>
                <SelectItem value="Bookkeeping">Bookkeeping</SelectItem>
                <SelectItem value="Business Advisory">Business Advisory</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
              <SelectTrigger className="w-full sm:w-64">
                <User className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Team Members</SelectItem>
                <SelectItem value="Mark Dwyer">Mark Dwyer</SelectItem>
                <SelectItem value="Nick Roccuia">Nick Roccuia</SelectItem>
                <SelectItem value="Sarah Chen">Sarah Chen</SelectItem>
                <SelectItem value="Matt Pereria">Matt Pereria</SelectItem>
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
              {tasks.map((task) => {
                const ServiceIcon = serviceIcons[task.service]
                return (
                  <Card key={task.id} className="bg-white shadow-sm border-gray-200 hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        {/* Header */}
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-2">
                            <div className={`p-1.5 rounded-lg ${serviceColors[task.service]}`}>
                              <ServiceIcon className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900 text-sm leading-tight">{task.title}</h4>
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
                            <span className="text-xs text-gray-600">{task.client.name}</span>
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

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1">
                          {task.tags.slice(0, 2).map((tag, index) => (
                            <Badge key={index} variant="secondary" className="text-xs px-2 py-0">
                              {tag}
                            </Badge>
                          ))}
                        </div>

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
                            <span className="text-xs text-gray-600">{task.assignee.name}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge className={getPriorityColor(task.priority)} variant="outline">
                              {task.priority}
                            </Badge>
                          </div>
                        </div>

                        {/* Due Date & Value */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center space-x-1">
                            <Calendar className="h-3 w-3 text-gray-400" />
                            <span className={isOverdue(task.dueDate) ? "text-red-600" : "text-gray-500"}>
                              {new Date(task.dueDate).toLocaleDateString()}
                            </span>
                            {isOverdue(task.dueDate) && <AlertTriangle className="h-3 w-3 text-red-500" />}
                          </div>
                          <span className="font-medium text-emerald-600">{task.value}</span>
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
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
