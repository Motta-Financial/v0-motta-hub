"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { ExpandableCard } from "@/components/ui/expandable-card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
  ClipboardList,
  StickyNote,
} from "lucide-react"
import Link from "next/link"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import { format } from "date-fns"

interface Debrief {
  id: string
  debrief_date: string | null
  debrief_type: string | null
  contact_name: string | null
  organization_name: string | null
  notes: string | null
  action_items: any
  status: string | null
  follow_up_date: string | null
  tax_year: number | null
  filing_status: string | null
  client_owner_name: string | null
  client_manager_name: string | null
}

interface MeetingNote {
  id: string
  client_name: string
  meeting_date: string | null
  meeting_type: string | null
  attendees: string[] | null
  agenda: string | null
  notes: string | null
  action_items: string[] | null
  follow_up_date: string | null
  status: string | null
  created_by: string | null
}

interface ClientNote {
  id: string
  title: string | null
  content: string
  note_type: string | null
  is_pinned: boolean
  created_at: string
  author_id: string | null
}

interface ClientProfileProps {
  clientId?: string
}

export function ClientProfile({ clientId = "1" }: ClientProfileProps) {
  const [activeTab, setActiveTab] = useState("overview")
  const [clientData, setClientData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debriefs, setDebriefs] = useState<Debrief[]>([])
  const [meetingNotes, setMeetingNotes] = useState<MeetingNote[]>([])
  const [clientNotes, setClientNotes] = useState<ClientNote[]>([])
  const [selectedDebrief, setSelectedDebrief] = useState<Debrief | null>(null)
  const [selectedMeetingNote, setSelectedMeetingNote] = useState<MeetingNote | null>(null)

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

        // Fetch debriefs for this client
        fetchDebriefs(clientId, data.client?.clientName)
        // Fetch meeting notes for this client
        fetchMeetingNotes(data.client?.clientName)
        // Fetch client notes
        fetchClientNotes(clientId)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load client data")
      } finally {
        setLoading(false)
      }
    }

    fetchClientData()
  }, [clientId])

  const fetchDebriefs = async (clientKey: string, clientName?: string) => {
    try {
      const response = await fetch(
        `/api/debriefs?clientKey=${clientKey}${clientName ? `&clientName=${encodeURIComponent(clientName)}` : ""}`,
      )
      if (response.ok) {
        const data = await response.json()
        setDebriefs(data.debriefs || [])
      }
    } catch (err) {
      console.error("Error fetching debriefs:", err)
    }
  }

  const fetchMeetingNotes = async (clientName?: string) => {
    if (!clientName) return
    try {
      const response = await fetch(`/api/meeting-notes?clientName=${encodeURIComponent(clientName)}`)
      if (response.ok) {
        const data = await response.json()
        setMeetingNotes(data.data || [])
      }
    } catch (err) {
      console.error("Error fetching meeting notes:", err)
    }
  }

  const fetchClientNotes = async (clientKey: string) => {
    try {
      const response = await fetch(`/api/clients/${clientKey}/notes`)
      if (response.ok) {
        const data = await response.json()
        setClientNotes(data.notes || [])
      }
    } catch (err) {
      console.error("Error fetching client notes:", err)
    }
  }

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
    avatarUrl: clientData.client.avatarUrl,
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
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
                <p className="text-sm text-gray-600">Debriefs</p>
                <p className="text-xl font-semibold text-gray-900">{debriefs.length}</p>
              </div>
              <ClipboardList className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white shadow-sm border-gray-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Meeting Notes</p>
                <p className="text-xl font-semibold text-gray-900">{meetingNotes.length}</p>
              </div>
              <StickyNote className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs - Added Debriefs tab */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-7 bg-white border border-gray-200">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workitems">Work Items</TabsTrigger>
          <TabsTrigger value="debriefs">Debriefs</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="alfred">ALFRED AI</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Contact Information - Made expandable */}
            <ExpandableCard
              title="Contact Information"
              icon={<User className="h-5 w-5 text-gray-500" />}
              defaultExpanded={true}
            >
              <div className="space-y-4">
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
              </div>
            </ExpandableCard>

            {/* Assigned Team - Made expandable */}
            <ExpandableCard
              title="Assigned Team"
              icon={<User className="h-5 w-5 text-gray-500" />}
              defaultExpanded={true}
            >
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
            </ExpandableCard>
          </div>

          {/* Services - Made expandable */}
          <ExpandableCard
            title="Active Services"
            icon={<TrendingUp className="h-5 w-5 text-gray-500" />}
            defaultExpanded={true}
          >
            <div className="flex flex-wrap gap-2">
              {client.services.map((service, index) => (
                <Badge key={index} variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  {service}
                </Badge>
              ))}
            </div>
          </ExpandableCard>

          {/* Recent Debriefs Preview - Added debriefs section to overview */}
          {debriefs.length > 0 && (
            <ExpandableCard
              title="Recent Debriefs"
              icon={<ClipboardList className="h-5 w-5 text-orange-600" />}
              badge={<Badge variant="secondary">{debriefs.length}</Badge>}
              defaultExpanded={true}
              actions={
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("debriefs")}>
                  View All
                </Button>
              }
            >
              <div className="space-y-3">
                {debriefs.slice(0, 3).map((debrief) => (
                  <div
                    key={debrief.id}
                    className="border border-gray-200 rounded-lg p-3 hover:border-orange-300 hover:bg-orange-50/30 transition-all cursor-pointer"
                    onClick={() => setSelectedDebrief(debrief)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-gray-900">{debrief.debrief_type || "General Debrief"}</h4>
                          {debrief.tax_year && (
                            <Badge variant="outline" className="text-xs">
                              TY {debrief.tax_year}
                            </Badge>
                          )}
                          {debrief.status && (
                            <Badge variant="secondary" className="text-xs">
                              {debrief.status}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {debrief.debrief_date ? format(new Date(debrief.debrief_date), "MMM d, yyyy") : "No date"}
                          {debrief.client_owner_name && ` • ${debrief.client_owner_name}`}
                        </p>
                      </div>
                      <Eye className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            </ExpandableCard>
          )}

          {/* Recent Meeting Notes Preview - Added meeting notes section to overview */}
          {meetingNotes.length > 0 && (
            <ExpandableCard
              title="Recent Meeting Notes"
              icon={<StickyNote className="h-5 w-5 text-purple-600" />}
              badge={<Badge variant="secondary">{meetingNotes.length}</Badge>}
              defaultExpanded={true}
              actions={
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("notes")}>
                  View All
                </Button>
              }
            >
              <div className="space-y-3">
                {meetingNotes.slice(0, 3).map((note) => (
                  <div
                    key={note.id}
                    className="border border-gray-200 rounded-lg p-3 hover:border-purple-300 hover:bg-purple-50/30 transition-all cursor-pointer"
                    onClick={() => setSelectedMeetingNote(note)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-gray-900">{note.meeting_type || "Meeting"}</h4>
                          {note.status && (
                            <Badge variant="secondary" className="text-xs">
                              {note.status}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {note.meeting_date ? format(new Date(note.meeting_date), "MMM d, yyyy") : "No date"}
                          {note.attendees && note.attendees.length > 0 && ` • ${note.attendees.length} attendees`}
                        </p>
                        {note.notes && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{note.notes}</p>}
                      </div>
                      <Eye className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            </ExpandableCard>
          )}

          {clientData.relatedIndividuals && clientData.relatedIndividuals.length > 0 && (
            <ExpandableCard
              title="Joint Clients & Spouses"
              icon={<User className="h-5 w-5 text-purple-600" />}
              description={`Related individuals in the same client group${client.clientGroup ? `: ${client.clientGroup}` : ""}`}
              defaultExpanded={true}
            >
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
            </ExpandableCard>
          )}

          {clientData.relatedBusinesses && clientData.relatedBusinesses.length > 0 && (
            <ExpandableCard
              title="Associated Businesses"
              icon={<Briefcase className="h-5 w-5 text-blue-600" />}
              description="Businesses owned or associated with this client"
              defaultExpanded={true}
            >
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
            </ExpandableCard>
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

          {/* Active Work Items - Made expandable */}
          <ExpandableCard
            title={`Active Work Items (${activeWorkItems.length})`}
            icon={<CheckSquare className="h-5 w-5 text-blue-600" />}
            defaultExpanded={true}
          >
            <div className="space-y-3">
              {activeWorkItems.slice(0, 10).map((item: any, index: number) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <a
                        href={getKarbonWorkItemUrl(item.WorkKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline flex items-center gap-2"
                      >
                        <h4 className="font-medium text-gray-900">{item.Title}</h4>
                        <ExternalLink className="h-3 w-3 text-gray-400" />
                      </a>
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
          </ExpandableCard>

          {/* Completed Work Items - Made expandable */}
          <ExpandableCard
            title={`Completed Work Items (${completedWorkItems.length})`}
            icon={<CheckSquare className="h-5 w-5 text-green-600" />}
            defaultExpanded={false}
          >
            <div className="space-y-3">
              {completedWorkItems.slice(0, 5).map((item: any, index: number) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <a
                        href={getKarbonWorkItemUrl(item.WorkKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline flex items-center gap-2"
                      >
                        <h4 className="font-medium text-gray-900">{item.Title}</h4>
                        <ExternalLink className="h-3 w-3 text-gray-400" />
                      </a>
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
          </ExpandableCard>
        </TabsContent>

        <TabsContent value="debriefs" className="space-y-4">
          <ExpandableCard
            title="Client Debriefs"
            icon={<ClipboardList className="h-5 w-5 text-orange-600" />}
            badge={<Badge variant="secondary">{debriefs.length}</Badge>}
            defaultExpanded={true}
            collapsible={false}
          >
            {debriefs.length === 0 ? (
              <div className="text-center py-8">
                <ClipboardList className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No debriefs found for this client</p>
                <p className="text-sm text-gray-500 mt-1">Debriefs will appear here when created</p>
              </div>
            ) : (
              <div className="space-y-3">
                {debriefs.map((debrief) => (
                  <div
                    key={debrief.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-orange-300 hover:shadow-sm transition-all cursor-pointer"
                    onClick={() => setSelectedDebrief(debrief)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-gray-900">{debrief.debrief_type || "General Debrief"}</h4>
                          {debrief.tax_year && (
                            <Badge variant="outline" className="text-xs">
                              TY {debrief.tax_year}
                            </Badge>
                          )}
                          {debrief.status && (
                            <Badge
                              variant="secondary"
                              className={`text-xs ${debrief.status === "completed" ? "bg-green-100 text-green-700" : ""}`}
                            >
                              {debrief.status}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          {debrief.debrief_date
                            ? format(new Date(debrief.debrief_date), "MMMM d, yyyy")
                            : "No date set"}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                          {debrief.client_owner_name && (
                            <span className="flex items-center">
                              <User className="h-4 w-4 mr-1" />
                              {debrief.client_owner_name}
                            </span>
                          )}
                          {debrief.filing_status && <span>Filing: {debrief.filing_status}</span>}
                          {debrief.follow_up_date && (
                            <span className="flex items-center">
                              <Calendar className="h-4 w-4 mr-1" />
                              Follow-up: {format(new Date(debrief.follow_up_date), "MMM d")}
                            </span>
                          )}
                        </div>
                        {debrief.notes && <p className="text-sm text-gray-600 mt-2 line-clamp-2">{debrief.notes}</p>}
                      </div>
                      <Eye className="h-5 w-5 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ExpandableCard>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <ExpandableCard
            title="Documents"
            icon={<FileText className="h-5 w-5 text-blue-600" />}
            defaultExpanded={true}
            actions={
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4 mr-2" />
                Upload Document
              </Button>
            }
          >
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
                { name: "Business Advisory Report", type: "PDF", size: "3.2 MB", date: "Dec 28, 2023", status: "Sent" },
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
          </ExpandableCard>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          {/* Meeting Notes Section */}
          <ExpandableCard
            title="Meeting Notes"
            icon={<StickyNote className="h-5 w-5 text-purple-600" />}
            badge={<Badge variant="secondary">{meetingNotes.length}</Badge>}
            defaultExpanded={true}
          >
            {meetingNotes.length === 0 ? (
              <div className="text-center py-8">
                <StickyNote className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No meeting notes found for this client</p>
              </div>
            ) : (
              <div className="space-y-3">
                {meetingNotes.map((note) => (
                  <div
                    key={note.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 hover:shadow-sm transition-all cursor-pointer"
                    onClick={() => setSelectedMeetingNote(note)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-gray-900">{note.meeting_type || "Meeting"}</h4>
                          {note.status && (
                            <Badge variant="secondary" className="text-xs">
                              {note.status}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          {note.meeting_date ? format(new Date(note.meeting_date), "MMMM d, yyyy") : "No date"}
                          {note.attendees && note.attendees.length > 0 && ` • ${note.attendees.length} attendees`}
                        </p>
                        {note.notes && <p className="text-sm text-gray-600 mt-2 line-clamp-2">{note.notes}</p>}
                        {note.action_items && note.action_items.length > 0 && (
                          <p className="text-xs text-purple-600 mt-1">
                            {note.action_items.length} action item{note.action_items.length > 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                      <Eye className="h-5 w-5 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ExpandableCard>

          {/* Client Notes Section */}
          <ExpandableCard
            title="Client Notes"
            icon={<MessageSquare className="h-5 w-5 text-emerald-600" />}
            defaultExpanded={true}
            actions={
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4 mr-2" />
                Add Note
              </Button>
            }
          >
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
          </ExpandableCard>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <ExpandableCard
            title="Client Tasks"
            icon={<CheckSquare className="h-5 w-5 text-blue-600" />}
            defaultExpanded={true}
            actions={
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4 mr-2" />
                New Task
              </Button>
            }
          >
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
          </ExpandableCard>
        </TabsContent>

        <TabsContent value="alfred" className="space-y-4">
          <ExpandableCard
            title="ALFRED AI Suggestions"
            icon={<Bot className="h-5 w-5 text-emerald-600" />}
            description="AI-generated insights and recommendations for this client"
            defaultExpanded={true}
          >
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
          </ExpandableCard>
        </TabsContent>
      </Tabs>

      {/* Debrief Detail Dialog */}
      <Dialog open={!!selectedDebrief} onOpenChange={() => setSelectedDebrief(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedDebrief && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-orange-600" />
                  {selectedDebrief.debrief_type || "Debrief"}
                  {selectedDebrief.tax_year && <Badge variant="outline">TY {selectedDebrief.tax_year}</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Date:</span>{" "}
                    {selectedDebrief.debrief_date
                      ? format(new Date(selectedDebrief.debrief_date), "MMMM d, yyyy")
                      : "Not set"}
                  </div>
                  <div>
                    <span className="text-gray-500">Status:</span>{" "}
                    <Badge variant="secondary">{selectedDebrief.status || "N/A"}</Badge>
                  </div>
                  {selectedDebrief.filing_status && (
                    <div>
                      <span className="text-gray-500">Filing Status:</span> {selectedDebrief.filing_status}
                    </div>
                  )}
                  {selectedDebrief.follow_up_date && (
                    <div>
                      <span className="text-gray-500">Follow-up:</span>{" "}
                      {format(new Date(selectedDebrief.follow_up_date), "MMMM d, yyyy")}
                    </div>
                  )}
                  {selectedDebrief.client_owner_name && (
                    <div>
                      <span className="text-gray-500">Client Owner:</span> {selectedDebrief.client_owner_name}
                    </div>
                  )}
                  {selectedDebrief.client_manager_name && (
                    <div>
                      <span className="text-gray-500">Client Manager:</span> {selectedDebrief.client_manager_name}
                    </div>
                  )}
                </div>

                {selectedDebrief.notes && (
                  <div>
                    <h4 className="font-medium mb-2">Notes</h4>
                    <p className="text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded">{selectedDebrief.notes}</p>
                  </div>
                )}

                {selectedDebrief.action_items && (
                  <div>
                    <h4 className="font-medium mb-2">Action Items</h4>
                    <div className="bg-gray-50 p-3 rounded">
                      {Array.isArray(selectedDebrief.action_items) ? (
                        <ul className="space-y-1">
                          {selectedDebrief.action_items.map((item: any, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <CheckSquare className="h-4 w-4 mt-0.5 text-gray-500" />
                              {typeof item === "string" ? item : item.description || JSON.stringify(item)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm">{JSON.stringify(selectedDebrief.action_items)}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Meeting Note Detail Dialog */}
      <Dialog open={!!selectedMeetingNote} onOpenChange={() => setSelectedMeetingNote(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedMeetingNote && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <StickyNote className="h-5 w-5 text-purple-600" />
                  {selectedMeetingNote.meeting_type || "Meeting"}
                  {selectedMeetingNote.status && <Badge variant="secondary">{selectedMeetingNote.status}</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Date:</span>{" "}
                    {selectedMeetingNote.meeting_date
                      ? format(new Date(selectedMeetingNote.meeting_date), "MMMM d, yyyy")
                      : "Not set"}
                  </div>
                  {selectedMeetingNote.follow_up_date && (
                    <div>
                      <span className="text-gray-500">Follow-up:</span>{" "}
                      {format(new Date(selectedMeetingNote.follow_up_date), "MMMM d, yyyy")}
                    </div>
                  )}
                </div>

                {selectedMeetingNote.attendees && selectedMeetingNote.attendees.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Attendees</h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedMeetingNote.attendees.map((attendee, i) => (
                        <Badge key={i} variant="secondary">
                          {attendee}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {selectedMeetingNote.agenda && (
                  <div>
                    <h4 className="font-medium mb-2">Agenda</h4>
                    <p className="text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded">{selectedMeetingNote.agenda}</p>
                  </div>
                )}

                {selectedMeetingNote.notes && (
                  <div>
                    <h4 className="font-medium mb-2">Notes</h4>
                    <p className="text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded">{selectedMeetingNote.notes}</p>
                  </div>
                )}

                {selectedMeetingNote.action_items && selectedMeetingNote.action_items.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Action Items</h4>
                    <ul className="space-y-1">
                      {selectedMeetingNote.action_items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckSquare className="h-4 w-4 mt-0.5 text-gray-500" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedMeetingNote.created_by && (
                  <div className="text-xs text-gray-500 pt-4 border-t">Created by {selectedMeetingNote.created_by}</div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
