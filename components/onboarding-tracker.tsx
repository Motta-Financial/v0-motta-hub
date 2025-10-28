"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  Search,
  Filter,
  Plus,
  User,
  Building,
  Mail,
  Phone,
} from "lucide-react"

interface OnboardingClient {
  id: string
  name: string
  type: "Individual" | "Business"
  contact: {
    name: string
    email: string
    phone: string
  }
  assignedTo: string
  startDate: string
  dueDate: string
  progress: number
  status: "Not Started" | "In Progress" | "Review" | "Completed" | "Overdue"
  documents: {
    required: number
    uploaded: number
    pending: string[]
  }
  steps: {
    name: string
    completed: boolean
    dueDate: string
  }[]
}

export function OnboardingTracker() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [sortBy, setSortBy] = useState("dueDate")

  // Mock onboarding data
  const onboardingClients: OnboardingClient[] = [
    {
      id: "1",
      name: "TechStart Solutions LLC",
      type: "Business",
      contact: {
        name: "Jennifer Martinez",
        email: "jennifer@techstart.com",
        phone: "(555) 234-5678",
      },
      assignedTo: "Mark Dwyer",
      startDate: "2024-01-05",
      dueDate: "2024-01-20",
      progress: 75,
      status: "In Progress",
      documents: {
        required: 8,
        uploaded: 6,
        pending: ["Articles of Incorporation", "Operating Agreement"],
      },
      steps: [
        { name: "Initial Consultation", completed: true, dueDate: "2024-01-06" },
        { name: "Document Collection", completed: true, dueDate: "2024-01-08" },
        { name: "Tax ID Setup", completed: true, dueDate: "2024-01-10" },
        { name: "Banking Setup", completed: false, dueDate: "2024-01-15" },
        { name: "Final Review", completed: false, dueDate: "2024-01-18" },
      ],
    },
    {
      id: "2",
      name: "Robert Chen",
      type: "Individual",
      contact: {
        name: "Robert Chen",
        email: "robert.chen@email.com",
        phone: "(555) 345-6789",
      },
      assignedTo: "Nick Roccuia",
      startDate: "2024-01-08",
      dueDate: "2024-01-15",
      progress: 90,
      status: "Review",
      documents: {
        required: 5,
        uploaded: 5,
        pending: [],
      },
      steps: [
        { name: "Initial Consultation", completed: true, dueDate: "2024-01-09" },
        { name: "Document Collection", completed: true, dueDate: "2024-01-10" },
        { name: "Tax Planning Review", completed: true, dueDate: "2024-01-12" },
        { name: "Service Agreement", completed: true, dueDate: "2024-01-13" },
        { name: "Final Approval", completed: false, dueDate: "2024-01-15" },
      ],
    },
    {
      id: "3",
      name: "Green Valley Consulting",
      type: "Business",
      contact: {
        name: "Sarah Williams",
        email: "sarah@greenvalley.com",
        phone: "(555) 456-7890",
      },
      assignedTo: "Sarah Chen",
      startDate: "2024-01-02",
      dueDate: "2024-01-12",
      progress: 45,
      status: "Overdue",
      documents: {
        required: 10,
        uploaded: 4,
        pending: ["Financial Statements", "Tax Returns", "Bank Statements", "Payroll Records", "Contracts", "Leases"],
      },
      steps: [
        { name: "Initial Consultation", completed: true, dueDate: "2024-01-03" },
        { name: "Document Collection", completed: false, dueDate: "2024-01-05" },
        { name: "Financial Review", completed: false, dueDate: "2024-01-08" },
        { name: "Service Setup", completed: false, dueDate: "2024-01-10" },
        { name: "Final Review", completed: false, dueDate: "2024-01-12" },
      ],
    },
    {
      id: "4",
      name: "Michael Thompson",
      type: "Individual",
      contact: {
        name: "Michael Thompson",
        email: "m.thompson@email.com",
        phone: "(555) 567-8901",
      },
      assignedTo: "Matt Pereria",
      startDate: "2024-01-10",
      dueDate: "2024-01-25",
      progress: 25,
      status: "In Progress",
      documents: {
        required: 6,
        uploaded: 2,
        pending: ["W-2 Forms", "1099 Forms", "Investment Statements", "Mortgage Interest"],
      },
      steps: [
        { name: "Initial Consultation", completed: true, dueDate: "2024-01-11" },
        { name: "Document Collection", completed: false, dueDate: "2024-01-15" },
        { name: "Tax Preparation", completed: false, dueDate: "2024-01-20" },
        { name: "Review & Filing", completed: false, dueDate: "2024-01-25" },
      ],
    },
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-emerald-100 text-emerald-700 border-emerald-200"
      case "In Progress":
        return "bg-blue-100 text-blue-700 border-blue-200"
      case "Review":
        return "bg-purple-100 text-purple-700 border-purple-200"
      case "Overdue":
        return "bg-red-100 text-red-700 border-red-200"
      default:
        return "bg-gray-100 text-gray-700 border-gray-200"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Completed":
        return <CheckCircle className="h-4 w-4" />
      case "In Progress":
        return <Clock className="h-4 w-4" />
      case "Review":
        return <AlertCircle className="h-4 w-4" />
      case "Overdue":
        return <XCircle className="h-4 w-4" />
      default:
        return <Clock className="h-4 w-4" />
    }
  }

  const filteredClients = onboardingClients.filter((client) => {
    const matchesSearch =
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.contact.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || client.status.toLowerCase() === statusFilter.toLowerCase()
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Onboarding Tracker</h1>
          <p className="text-gray-600 mt-1">Monitor new client onboarding progress and status</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-2" />
          New Client
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Active</p>
                <p className="text-2xl font-semibold text-gray-900">{onboardingClients.length}</p>
              </div>
              <User className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">In Progress</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {onboardingClients.filter((c) => c.status === "In Progress").length}
                </p>
              </div>
              <Clock className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Overdue</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {onboardingClients.filter((c) => c.status === "Overdue").length}
                </p>
              </div>
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg. Progress</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {Math.round(onboardingClients.reduce((acc, c) => acc + c.progress, 0) / onboardingClients.length)}%
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-white shadow-sm border-gray-200">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search clients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="not started">Not Started</SelectItem>
                <SelectItem value="in progress">In Progress</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dueDate">Due Date</SelectItem>
                <SelectItem value="progress">Progress</SelectItem>
                <SelectItem value="name">Client Name</SelectItem>
                <SelectItem value="startDate">Start Date</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Client List */}
      <div className="space-y-4">
        {filteredClients.map((client) => (
          <Card key={client.id} className="bg-white shadow-sm border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start space-x-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-emerald-100 text-emerald-700">
                      {client.type === "Business" ? <Building className="h-6 w-6" /> : <User className="h-6 w-6" />}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{client.name}</h3>
                    <p className="text-gray-600">{client.contact.name}</p>
                    <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
                      <span className="flex items-center">
                        <Mail className="h-4 w-4 mr-1" />
                        {client.contact.email}
                      </span>
                      <span className="flex items-center">
                        <Phone className="h-4 w-4 mr-1" />
                        {client.contact.phone}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge className={getStatusColor(client.status)}>
                    {getStatusIcon(client.status)}
                    <span className="ml-1">{client.status}</span>
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Progress Overview */}
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Overall Progress</span>
                      <span className="text-sm text-gray-900">{client.progress}%</span>
                    </div>
                    <Progress value={client.progress} className="h-2" />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Assigned to:</span>
                    <span className="font-medium text-gray-900">{client.assignedTo}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Due Date:</span>
                    <span
                      className={`font-medium ${
                        new Date(client.dueDate) < new Date() ? "text-red-600" : "text-gray-900"
                      }`}
                    >
                      {new Date(client.dueDate).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Document Status */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Document Status</h4>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">
                        {client.documents.uploaded} of {client.documents.required} uploaded
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {Math.round((client.documents.uploaded / client.documents.required) * 100)}%
                      </span>
                    </div>
                    <Progress value={(client.documents.uploaded / client.documents.required) * 100} className="h-2" />
                  </div>
                  {client.documents.pending.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Pending Documents:</p>
                      <div className="space-y-1">
                        {client.documents.pending.slice(0, 2).map((doc, index) => (
                          <p key={index} className="text-xs text-red-600">
                            • {doc}
                          </p>
                        ))}
                        {client.documents.pending.length > 2 && (
                          <p className="text-xs text-gray-500">+{client.documents.pending.length - 2} more</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Steps Progress */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-700">Onboarding Steps</h4>
                  <div className="space-y-2">
                    {client.steps.map((step, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        {step.completed ? (
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <div className="h-4 w-4 border-2 border-gray-300 rounded-full" />
                        )}
                        <span className={`text-sm ${step.completed ? "text-gray-900" : "text-gray-500"}`}>
                          {step.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <Calendar className="h-4 w-4" />
                  <span>Started {new Date(client.startDate).toLocaleDateString()}</span>
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm">
                    View Details
                  </Button>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                    Update Status
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
