"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  CheckSquare,
  MessageSquare,
  Bot,
  Clock,
  User,
  TrendingUp,
  Download,
  Eye,
  Plus,
  ExternalLink,
  Briefcase,
} from "lucide-react"
import Link from "next/link"

interface ClientProfileProps {
  clientId?: string
}

export function ClientProfile({ clientId = "1" }: ClientProfileProps) {
  const [activeTab, setActiveTab] = useState("overview")
  const [clientData, setClientData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchClientData() {
      try {
        setLoading(true)
        const response = await fetch(`/api/karbon/clients/${clientId}`)
        if (!response.ok) {
          throw new Error("Failed to fetch client data")
        }
        const data = await response.json()
        setClientData(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load client data")
      } finally {
        setLoading(false)
      }
    }

    fetchClientData()
  }, [clientId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading client data...</div>
      </div>
    )
  }

  if (error || !clientData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">{error || "Client not found"}</div>
      </div>
    )
  }

  const client = {
    id: clientId,
    name: clientData.client.clientName,
    type: clientData.client.isOrganization ? "Business" : "Individual",
    avatarUrl: clientData.client.avatarUrl, // Added avatarUrl from API
    contact: {
      primaryContact: clientData.client.contactInfo?.primaryContact || "N/A",
      email: clientData.client.contactInfo?.email || "N/A",
      phone: clientData.client.contactInfo?.phone || "N/A",
      address: clientData.client.contactInfo?.address || "N/A",
    },
    assignedTeam: clientData.teamMembers || [],
    services: clientData.serviceLinesUsed || [],
    status: "Active",
    joinDate: "N/A",
    lastActivity: "N/A",
    revenue: "N/A",
    documents: 0,
    openTasks: clientData.stats.activeWorkItems,
    clientGroup: clientData.client.clientGroup,
  }

  const activeWorkItems = clientData.workItems.filter(
    (item: any) =>
      item.PrimaryStatus === "In Progress" ||
      item.PrimaryStatus === "Ready To Start" ||
      item.PrimaryStatus === "Waiting" ||
      item.PrimaryStatus === "Planned",
  )

  const completedWorkItems = clientData.workItems.filter((item: any) => item.PrimaryStatus === "Completed")

  return (
    <div className="space-y-6">
      {/* Client Header */}
      <Card className="bg-white shadow-sm border-gray-200">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-4">
              <Avatar className="h-16 w-16">
                {client.avatarUrl && <AvatarImage src={client.avatarUrl || "/placeholder.svg"} alt={client.name} />}
                <AvatarFallback className="bg-emerald-100 text-emerald-700 text-lg font-semibold">
                  {client.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-2xl font-semibold text-gray-900">{client.name}</h1>
                  <Badge
                    variant={client.status === "Active" ? "default" : "secondary"}
                    className="bg-emerald-100 text-emerald-700"
                  >
                    {client.status}
                  </Badge>
                </div>
                <p className="text-gray-600 mt-1">{client.type} Client</p>
                <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                  <span className="flex items-center">
                    <Calendar className="h-4 w-4 mr-1" />
                    Joined {new Date(client.joinDate).toLocaleDateString()}
                  </span>
                  <span className="flex items-center">
                    <Clock className="h-4 w-4 mr-1" />
                    Last activity {new Date(client.lastActivity).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex space-x-2">
              <Button variant="outline" size="sm">
                <MessageSquare className="h-4 w-4 mr-2" />
                Message
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4 mr-2" />
                New Task
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Work Items</p>
                <p className="text-xl font-semibold text-gray-900">{clientData.stats.totalWorkItems}</p>
              </div>
              <Briefcase className="h-8 w-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Work Items</p>
                <p className="text-xl font-semibold text-gray-900">{activeWorkItems.length}</p>
              </div>
              <CheckSquare className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-xl font-semibold text-gray-900">{completedWorkItems.length}</p>
              </div>
              <CheckSquare className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Services</p>
                <p className="text-xl font-semibold text-gray-900">{client.services.length}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-6 bg-white border border-gray-200">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workitems">Work Items</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="alfred">ALFRED AI</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Contact Information */}
            <Card className="bg-white shadow-sm border-gray-200">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900">Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {client.contact.primaryContact !== "N/A" && (
                  <div className="flex items-center space-x-3">
                    <User className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-900">{client.contact.primaryContact}</p>
                      <p className="text-sm text-gray-500">Primary Contact</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center space-x-3">
                  <Mail className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-900">{client.contact.email}</p>
                    <p className="text-sm text-gray-500">Email</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-900">{client.contact.phone}</p>
                    <p className="text-sm text-gray-500">Phone</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900">{client.contact.address}</p>
                    <p className="text-sm text-gray-500">Address</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Assigned Team */}
            <Card className="bg-white shadow-sm border-gray-200">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900">Assigned Team</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {client.assignedTeam.map((member, index) => (
                    <div key={index} className="flex items-center space-x-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.avatar || "/placeholder.svg"} alt={member.name} />
                        <AvatarFallback>
                          {member.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-gray-900">{member.name}</p>
                        <p className="text-sm text-gray-500">{member.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Services */}
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-gray-900">Active Services</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {client.services.map((service, index) => (
                  <Badge key={index} variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    {service}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {clientData.relatedIndividuals && clientData.relatedIndividuals.length > 0 && (
            <Card className="bg-white shadow-sm border-gray-200">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                  <User className="h-5 w-5 mr-2 text-purple-600" />
                  Joint Clients & Spouses
                </CardTitle>
                <CardDescription>
                  Related individuals in the same client group
                  {client.clientGroup && `: ${client.clientGroup}`}
                  {clientData.detectedSpouses && clientData.detectedSpouses.length > 0 && (
                    <span className="block mt-1 text-purple-600">
                      • Detected from tax filings: {clientData.detectedSpouses.join(", ")}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {clientData.relatedIndividuals.map((relatedClient: any) => (
                    <Link key={relatedClient.clientKey} href={`/clients/${relatedClient.clientKey}`}>
                      <div className="border border-purple-200 rounded-lg p-4 hover:border-purple-300 hover:shadow-sm transition-all cursor-pointer bg-purple-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="bg-purple-100 text-purple-700 text-sm font-semibold">
                                {relatedClient.clientName
                                  .split(" ")
                                  .map((n: string) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium text-gray-900">{relatedClient.clientName}</h4>
                                {relatedClient.isSpouse && (
                                  <Badge variant="secondary" className="bg-pink-100 text-pink-700 text-xs">
                                    Spouse
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-gray-500">{relatedClient.workItemCount} joint work items</p>
                            </div>
                          </div>
                          <ExternalLink className="h-5 w-5 text-gray-400" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {clientData.relatedBusinesses && clientData.relatedBusinesses.length > 0 && (
            <Card className="bg-white shadow-sm border-gray-200">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                  <Briefcase className="h-5 w-5 mr-2 text-blue-600" />
                  Associated Businesses
                </CardTitle>
                <CardDescription>
                  Businesses owned or associated with this client (from work items and business cards)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {clientData.relatedBusinesses.map((relatedClient: any) => (
                    <Link key={relatedClient.clientKey} href={`/clients/${relatedClient.clientKey}`}>
                      <div className="border border-blue-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer bg-blue-50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-semibold">
                                {relatedClient.clientName
                                  .split(" ")
                                  .map((n: string) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium text-gray-900">{relatedClient.clientName}</h4>
                              <p className="text-sm text-gray-500">
                                {relatedClient.workItemCount > 0
                                  ? `${relatedClient.workItemCount} work items`
                                  : "From business card"}
                              </p>
                            </div>
                          </div>
                          <ExternalLink className="h-5 w-5 text-gray-400" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="workitems" className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Associated Work Items</h3>
            <Link href={`/work-items?client=${clientData.client.clientKey}`}>
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-2" />
                View All in Work Items
              </Button>
            </Link>
          </div>

          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                <CheckSquare className="h-5 w-5 mr-2 text-blue-600" />
                Active Work Items ({activeWorkItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {activeWorkItems.slice(0, 10).map((item: any, index: number) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{item.Title}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {item.PrimaryStatus}
                          </Badge>
                          {item.ServiceLine && (
                            <Badge variant="outline" className="text-xs">
                              {item.ServiceLine}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-500 mt-2">
                      <div className="flex items-center gap-4">
                        {item.AssignedTo && item.AssignedTo.length > 0 && (
                          <span className="flex items-center">
                            <User className="h-4 w-4 mr-1" />
                            {item.AssignedTo[0].FullName}
                          </span>
                        )}
                        {item.DueDate && (
                          <span className="flex items-center">
                            <Calendar className="h-4 w-4 mr-1" />
                            Due: {new Date(item.DueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {activeWorkItems.length === 0 && <p className="text-gray-500 text-center py-4">No active work items</p>}
              </div>
            </CardContent>
          </Card>

          {/* Completed Work Items */}
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                <CheckSquare className="h-5 w-5 mr-2 text-green-600" />
                Completed Work Items ({completedWorkItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {completedWorkItems.slice(0, 5).map((item: any, index: number) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{item.Title}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="default" className="text-xs bg-green-100 text-green-700">
                            Completed
                          </Badge>
                          {item.ServiceLine && (
                            <Badge variant="outline" className="text-xs">
                              {item.ServiceLine}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-500 mt-2">
                      <div className="flex items-center gap-4">
                        {item.AssignedTo && item.AssignedTo.length > 0 && (
                          <span className="flex items-center">
                            <User className="h-4 w-4 mr-1" />
                            {item.AssignedTo[0].FullName}
                          </span>
                        )}
                        {item.CompletedDate && (
                          <span className="flex items-center">
                            <Calendar className="h-4 w-4 mr-1" />
                            Completed: {new Date(item.CompletedDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {completedWorkItems.length === 0 && (
                  <p className="text-gray-500 text-center py-4">No completed work items</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-900">Documents</CardTitle>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Upload Document
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { name: "2024 Tax Return Draft", type: "PDF", size: "2.4 MB", date: "Jan 8, 2024", status: "Review" },
                  {
                    name: "Financial Statements Q4",
                    type: "Excel",
                    size: "1.8 MB",
                    date: "Jan 5, 2024",
                    status: "Final",
                  },
                  {
                    name: "Business Advisory Report",
                    type: "PDF",
                    size: "3.2 MB",
                    date: "Dec 28, 2023",
                    status: "Sent",
                  },
                  { name: "Bookkeeping Records", type: "PDF", size: "5.1 MB", date: "Dec 20, 2023", status: "Final" },
                ].map((doc, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <FileText className="h-8 w-8 text-blue-600" />
                      <div>
                        <p className="font-medium text-gray-900">{doc.name}</p>
                        <p className="text-sm text-gray-500">
                          {doc.type} • {doc.size} • {doc.date}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={doc.status === "Final" ? "default" : "secondary"}>{doc.status}</Badge>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-900">Team Notes</CardTitle>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Note
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    author: "Mark Dwyer",
                    date: "Jan 8, 2024",
                    note: "Client requested expedited tax return processing. Prioritizing for completion by Jan 15th.",
                    avatar: "/professional-man.png",
                  },
                  {
                    author: "Nick Roccuia",
                    date: "Jan 5, 2024",
                    note: "Reviewed Q4 financials. Identified potential tax savings opportunities for next year.",
                    avatar: "/professional-man-beard.png",
                  },
                  {
                    author: "Sarah Chen",
                    date: "Dec 28, 2023",
                    note: "Completed business advisory consultation. Client interested in expansion planning services.",
                    avatar: "/professional-woman.png",
                  },
                ].map((note, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={note.avatar || "/placeholder.svg"} alt={note.author} />
                        <AvatarFallback>
                          {note.author
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <p className="font-medium text-gray-900">{note.author}</p>
                          <p className="text-sm text-gray-500">{note.date}</p>
                        </div>
                        <p className="text-gray-700">{note.note}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-900">Client Tasks</CardTitle>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="h-4 w-4 mr-2" />
                  New Task
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  {
                    title: "Complete 2024 Tax Return",
                    assignee: "Mark Dwyer",
                    dueDate: "Jan 15, 2024",
                    priority: "High",
                    progress: 75,
                    status: "In Progress",
                  },
                  {
                    title: "Review Financial Statements",
                    assignee: "Nick Roccuia",
                    dueDate: "Jan 12, 2024",
                    priority: "Medium",
                    progress: 100,
                    status: "Completed",
                  },
                  {
                    title: "Prepare Business Advisory Report",
                    assignee: "Sarah Chen",
                    dueDate: "Jan 20, 2024",
                    priority: "Medium",
                    progress: 30,
                    status: "In Progress",
                  },
                ].map((task, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-gray-900">{task.title}</h4>
                        <p className="text-sm text-gray-500">Assigned to {task.assignee}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant={task.priority === "High" ? "destructive" : "secondary"}>{task.priority}</Badge>
                        <Badge variant={task.status === "Completed" ? "default" : "secondary"}>{task.status}</Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Progress</span>
                        <span className="text-gray-900">{task.progress}%</span>
                      </div>
                      <Progress value={task.progress} className="h-2" />
                      <p className="text-sm text-gray-500">Due: {task.dueDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alfred" className="space-y-4">
          <Card className="bg-white shadow-sm border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                <Bot className="h-5 w-5 mr-2 text-emerald-600" />
                ALFRED AI Suggestions
              </CardTitle>
              <CardDescription>AI-generated insights and recommendations for this client</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    type: "Tax Optimization",
                    suggestion:
                      "Based on Q4 financials, consider implementing a SEP-IRA to reduce taxable income by up to $66,000.",
                    confidence: "High",
                    impact: "Potential $15,000 tax savings",
                  },
                  {
                    type: "Cash Flow",
                    suggestion:
                      "Client's cash flow pattern suggests quarterly tax payments could be optimized. Recommend adjusting estimates.",
                    confidence: "Medium",
                    impact: "Improved cash flow management",
                  },
                  {
                    type: "Compliance",
                    suggestion:
                      "Upcoming regulatory changes in 2024 may affect depreciation schedules. Schedule review meeting.",
                    confidence: "High",
                    impact: "Ensure compliance",
                  },
                ].map((suggestion, index) => (
                  <div key={index} className="border border-emerald-200 rounded-lg p-4 bg-emerald-50">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-medium text-gray-900">{suggestion.type}</h4>
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                        {suggestion.confidence} Confidence
                      </Badge>
                    </div>
                    <p className="text-gray-700 mb-2">{suggestion.suggestion}</p>
                    <p className="text-sm text-emerald-700 font-medium">Impact: {suggestion.impact}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
