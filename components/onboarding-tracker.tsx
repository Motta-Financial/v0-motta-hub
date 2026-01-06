"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calendar, Clock, CheckCircle, AlertCircle, XCircle, Search, Filter, Plus, User, Building, Mail, Phone } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

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
  const [onboardingClients, setOnboardingClients] = useState<OnboardingClient[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchOnboardingClients() {
      try {
        const supabase = createClient()

        const { data: workItems, error } = await supabase
          .from("work_items")
          .select(`
            *,
            contacts:contact_id (full_name, primary_email, phone_primary),
            organizations:organization_id (name, primary_email, phone_primary)
          `)
          .or("title.ilike.%onboarding%,work_type.ilike.%onboarding%")
          .order("due_date", { ascending: true })
          .limit(50)

        if (error) {
          console.error("Error fetching onboarding clients:", error)
          setOnboardingClients([])
          setLoading(false)
          return
        }

        // Map work items to OnboardingClient format
        const clients: OnboardingClient[] = (workItems || []).map((item: any) => {
          const isOrg = !!item.organization_id
          const contactData = item.contacts || item.organizations || {}
          const status = mapStatus(item.primary_status)
          const progress = calculateProgress(item.primary_status, item.secondary_status)

          return {
            id: item.id,
            name: item.client_name || contactData.name || contactData.full_name || "Unknown",
            type: isOrg ? "Business" : "Individual",
            contact: {
              name: contactData.full_name || contactData.name || item.client_name || "",
              email: contactData.primary_email || "",
              phone: contactData.phone_primary || "",
            },
            assignedTo: item.assigned_to_name || "Unassigned",
            startDate: item.created_at || new Date().toISOString(),
            dueDate: item.due_date || new Date().toISOString(),
            progress: progress,
            status: status,
            documents: {
              required: 5,
              uploaded: Math.floor(progress / 20),
              pending: progress < 100 ? ["Documents pending"] : [],
            },
            steps: generateSteps(item.primary_status, item.secondary_status),
          }
        })

        setOnboardingClients(clients)
      } catch (error) {
        console.error("Error fetching onboarding clients:", error)
        setOnboardingClients([])
      } finally {
        setLoading(false)
      }
    }

    fetchOnboardingClients()
  }, [])

  const mapStatus = (primaryStatus: string): OnboardingClient["status"] => {
    const status = primaryStatus?.toLowerCase() || ""
    if (status.includes("complete")) return "Completed"
    if (status.includes("review")) return "Review"
    if (status.includes("progress") || status.includes("active")) return "In Progress"
    if (status.includes("overdue")) return "Overdue"
    return "Not Started"
  }

  const calculateProgress = (primaryStatus: string, secondaryStatus: string): number => {
    const status = primaryStatus?.toLowerCase() || ""
    if (status.includes("complete")) return 100
    if (status.includes("review")) return 85
    if (status.includes("progress")) return 50
    return 25
  }

  const generateSteps = (primaryStatus: string, secondaryStatus: string) => {
    const progress = calculateProgress(primaryStatus, secondaryStatus)
    return [
      { name: "Initial Consultation", completed: progress >= 20, dueDate: "" },
      { name: "Document Collection", completed: progress >= 40, dueDate: "" },
      { name: "Setup & Configuration", completed: progress >= 60, dueDate: "" },
      { name: "Review & Testing", completed: progress >= 80, dueDate: "" },
      { name: "Final Approval", completed: progress >= 100, dueDate: "" },
    ]
  }

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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Onboarding Tracker</h1>
            <p className="text-gray-600 mt-1">Loading onboarding data...</p>
          </div>
        </div>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg"></div>
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
                  {onboardingClients.length > 0
                    ? Math.round(onboardingClients.reduce((acc, c) => acc + c.progress, 0) / onboardingClients.length)
                    : 0}%
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
      {filteredClients.length === 0 ? (
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">No onboarding clients found</p>
          </CardContent>
        </Card>
      ) : (
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
                        {client.contact.email && (
                          <span className="flex items-center">
                            <Mail className="h-4 w-4 mr-1" />
                            {client.contact.email}
                          </span>
                        )}
                        {client.contact.phone && (
                          <span className="flex items-center">
                            <Phone className="h-4 w-4 mr-1" />
                            {client.contact.phone}
                          </span>
                        )}
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
      )}
    </div>
  )
}
