"use client"

import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useUser } from "@/contexts/user-context"
import {
  Calendar,
  Clock,
  Users,
  Video,
  MapPin,
  Mail,
  CheckCircle2,
  RefreshCw,
  Search,
  Phone,
  User,
  CalendarDays,
  AlertCircle,
  Bell,
  Settings,
  Link2,
  UserPlus,
  Building2,
  LogOut,
} from "lucide-react"

interface CalendlyConnection {
  id: string
  calendly_user_name: string
  calendly_user_email: string
  calendly_user_avatar?: string
  calendly_user_timezone?: string
  is_active: boolean
  sync_enabled: boolean
  last_synced_at?: string
  team_members?: {
    id: string
    full_name: string
    email: string
    avatar_url?: string
    title?: string
  }
}

interface MasterCalendarEvent {
  uri: string
  name: string
  status: string
  start_time: string
  end_time: string
  location?: {
    type: string
    location?: string
    join_url?: string
  }
  invitees?: Array<{
    uri: string
    email: string
    name?: string
    status: string
    timezone?: string
    cancel_url?: string
    reschedule_url?: string
    questions_and_answers?: Array<{ question: string; answer: string }>
  }>
  host?: {
    teamMemberId: string
    name: string
    email: string
    avatar?: string
    title?: string
  }
}

export function CalendarPageClient() {
  const { teamMember } = useUser()
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [events, setEvents] = useState<MasterCalendarEvent[]>([])
  const [connections, setConnections] = useState<CalendlyConnection[]>([])
  const [myConnection, setMyConnection] = useState<CalendlyConnection | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedEvent, setSelectedEvent] = useState<MasterCalendarEvent | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [teamMember])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch all connections
      const connectionsRes = await fetch("/api/calendly/connections")
      if (connectionsRes.ok) {
        const data = await connectionsRes.json()
        setConnections(data.connections || [])

        // Find current user's connection
        if (teamMember?.id) {
          const mine = data.connections?.find((c: CalendlyConnection) => c.team_members?.id === teamMember.id)
          setMyConnection(mine || null)
        }
      }

      // Fetch master calendar events
      await fetchMasterCalendar()
    } catch (err) {
      console.error("Error fetching calendar data:", err)
      setError("Failed to load calendar data")
    } finally {
      setLoading(false)
    }
  }

  const fetchMasterCalendar = async () => {
    try {
      const now = new Date()
      const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const maxDate = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate()).toISOString()

      const res = await fetch(`/api/calendly/master-calendar?min_date=${minDate}&max_date=${maxDate}`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events || [])
      }
    } catch (err) {
      console.error("Error fetching master calendar:", err)
    }
  }

  const handleConnectCalendly = () => {
    // Redirect to OAuth flow
    window.location.href = "/api/calendly/oauth/authorize"
  }

  const handleDisconnect = async () => {
    if (!teamMember?.id) return

    if (!confirm("Are you sure you want to disconnect your Calendly account?")) return

    try {
      const res = await fetch("/api/calendly/oauth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId: teamMember.id }),
      })

      if (res.ok) {
        setMyConnection(null)
        await fetchData()
      }
    } catch (err) {
      console.error("Error disconnecting:", err)
    }
  }

  const handleSyncAll = async () => {
    try {
      setSyncing(true)
      const res = await fetch("/api/calendly/master-calendar", {
        method: "POST",
      })

      if (res.ok) {
        const data = await res.json()
        alert(`Synced ${data.synced} events. ${data.notificationsSent} notifications sent.`)
        await fetchMasterCalendar()
      }
    } catch (err) {
      console.error("Error syncing:", err)
    } finally {
      setSyncing(false)
    }
  }

  const handleToggleSync = async (connectionId: string, enabled: boolean) => {
    try {
      await fetch("/api/calendly/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, syncEnabled: enabled }),
      })
      await fetchData()
    } catch (err) {
      console.error("Error toggling sync:", err)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  }

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Tomorrow"
    if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`
    return formatDate(dateString)
  }

  const getLocationIcon = (type?: string) => {
    switch (type) {
      case "zoom":
      case "google_conference":
      case "microsoft_teams_conference":
        return <Video className="h-4 w-4" />
      case "physical":
        return <MapPin className="h-4 w-4" />
      case "inbound_call":
      case "outbound_call":
        return <Phone className="h-4 w-4" />
      default:
        return <Calendar className="h-4 w-4" />
    }
  }

  // Filter events
  const filteredEvents = events.filter((event) => {
    const query = searchQuery.toLowerCase()
    return (
      event.name.toLowerCase().includes(query) ||
      event.host?.name?.toLowerCase().includes(query) ||
      event.invitees?.some((inv) => inv.name?.toLowerCase().includes(query) || inv.email.toLowerCase().includes(query))
    )
  })

  // Group events by date
  const groupedEvents = filteredEvents.reduce(
    (groups, event) => {
      const date = new Date(event.start_time).toDateString()
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(event)
      return groups
    },
    {} as Record<string, MasterCalendarEvent[]>,
  )

  // Stats
  const todayEvents = events.filter((e) => {
    const eventDate = new Date(e.start_time).toDateString()
    const today = new Date().toDateString()
    return eventDate === today && e.status === "active"
  })

  const thisWeekEvents = events.filter((e) => {
    const eventDate = new Date(e.start_time)
    const now = new Date()
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    return eventDate >= now && eventDate <= weekFromNow && e.status === "active"
  })

  const activeConnections = connections.filter((c) => c.is_active && c.sync_enabled)

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Master Calendar</h1>
            <p className="text-muted-foreground mt-1">
              Firm-wide meeting schedule from all connected Calendly accounts
            </p>
          </div>
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Loading calendar...</p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Master Calendar</h1>
            <p className="text-muted-foreground mt-1">
              Firm-wide meeting schedule from all connected Calendly accounts
            </p>
          </div>
          <div className="flex items-center gap-2">
            {myConnection ? (
              <Button variant="outline" size="sm" className="border-green-500 text-green-600 bg-transparent">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Connected
              </Button>
            ) : (
              <Button onClick={handleConnectCalendly}>
                <Link2 className="h-4 w-4 mr-2" />
                Connect Your Calendly
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowSettings(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button variant="outline" onClick={handleSyncAll} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync & Notify"}
            </Button>
          </div>
        </div>

        {/* Connection Status Banner */}
        {!myConnection && (
          <Card className="p-4 border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-amber-800">Connect Your Calendly Account</h3>
                <p className="text-sm text-amber-700 mt-1">
                  Connect your Calendly account to sync your meetings and allow the team to see your schedule.
                </p>
              </div>
              <Button onClick={handleConnectCalendly} size="sm">
                <UserPlus className="h-4 w-4 mr-2" />
                Connect Now
              </Button>
            </div>
          </Card>
        )}

        {error && (
          <Card className="p-4 border-red-200 bg-red-50">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchData}>
                Retry
              </Button>
            </div>
          </Card>
        )}

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-lg">
                <CalendarDays className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-2xl font-semibold">{todayEvents.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">This Week</p>
                <p className="text-2xl font-semibold">{thisWeekEvents.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-500/10 rounded-lg">
                <Users className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Connected Users</p>
                <p className="text-2xl font-semibold">{activeConnections.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-500/10 rounded-lg">
                <Bell className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Meetings</p>
                <p className="text-2xl font-semibold">{events.length}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Connected Team Members */}
        {activeConnections.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Team Members with Connected Calendly</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {activeConnections.map((conn) => (
                <div key={conn.id} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                  <Avatar className="h-6 w-6">
                    <AvatarImage
                      src={conn.team_members?.avatar_url || conn.calendly_user_avatar || ""}
                      alt={conn.team_members?.full_name || conn.calendly_user_name}
                    />
                    <AvatarFallback className="text-xs">
                      {(conn.team_members?.full_name || conn.calendly_user_name || "?")
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{conn.team_members?.full_name || conn.calendly_user_name}</span>
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Main Content */}
        <Tabs defaultValue="schedule" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <TabsList>
              <TabsTrigger value="schedule">Schedule</TabsTrigger>
              <TabsTrigger value="by-host">By Host</TabsTrigger>
            </TabsList>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events, hosts, or invitees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-72"
              />
            </div>
          </div>

          {/* Schedule View */}
          <TabsContent value="schedule" className="space-y-4">
            {filteredEvents.length === 0 ? (
              <Card className="p-12">
                <div className="text-center">
                  <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Upcoming Meetings</h3>
                  <p className="text-muted-foreground mb-4">
                    {connections.length === 0
                      ? "No team members have connected their Calendly accounts yet."
                      : "No meetings scheduled in the selected period."}
                  </p>
                  {!myConnection && (
                    <Button onClick={handleConnectCalendly}>
                      <Link2 className="h-4 w-4 mr-2" />
                      Connect Your Calendly
                    </Button>
                  )}
                </div>
              </Card>
            ) : (
              Object.entries(groupedEvents)
                .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
                .map(([date, dayEvents]) => (
                  <div key={date} className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground sticky top-0 bg-background py-2 flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      {formatRelativeTime(date)} - {formatDate(date)}
                      <Badge variant="secondary" className="ml-2">
                        {dayEvents.length} meeting{dayEvents.length !== 1 ? "s" : ""}
                      </Badge>
                    </h3>
                    <div className="space-y-2">
                      {dayEvents.map((event) => (
                        <Card
                          key={event.uri}
                          className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setSelectedEvent(event)}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4">
                              {/* Host Avatar */}
                              <Avatar className="h-10 w-10">
                                <AvatarImage src={event.host?.avatar || ""} alt={event.host?.name} />
                                <AvatarFallback>
                                  {(event.host?.name || "?")
                                    .split(" ")
                                    .map((n) => n[0])
                                    .join("")}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <h4 className="font-medium">{event.name}</h4>
                                <p className="text-sm text-muted-foreground">
                                  Hosted by {event.host?.name}
                                  {event.host?.title && ` (${event.host.title})`}
                                </p>
                                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatTime(event.start_time)} - {formatTime(event.end_time)}
                                  </span>
                                  {event.location && (
                                    <span className="flex items-center gap-1">
                                      {getLocationIcon(event.location.type)}
                                      {event.location.type?.replace(/_/g, " ")}
                                    </span>
                                  )}
                                  {event.invitees && event.invitees.length > 0 && (
                                    <span className="flex items-center gap-1">
                                      <Users className="h-3 w-3" />
                                      {event.invitees.length} invitee{event.invitees.length !== 1 ? "s" : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {event.status === "active" ? (
                                <Badge className="bg-green-100 text-green-700">Scheduled</Badge>
                              ) : (
                                <Badge variant="destructive">Cancelled</Badge>
                              )}
                              {event.location?.join_url && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    window.open(event.location?.join_url, "_blank")
                                  }}
                                >
                                  <Video className="h-4 w-4 mr-1" />
                                  Join
                                </Button>
                              )}
                            </div>
                          </div>
                          {/* Invitees preview */}
                          {event.invitees && event.invitees.length > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs text-muted-foreground mb-2">Client(s):</p>
                              <div className="flex flex-wrap gap-2">
                                {event.invitees.map((inv) => (
                                  <Badge key={inv.uri} variant="outline" className="text-xs">
                                    <User className="h-3 w-3 mr-1" />
                                    {inv.name || inv.email}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                ))
            )}
          </TabsContent>

          {/* By Host View */}
          <TabsContent value="by-host" className="space-y-4">
            {activeConnections.map((conn) => {
              const hostEvents = filteredEvents.filter((e) => e.host?.teamMemberId === conn.team_members?.id)
              return (
                <Card key={conn.id} className="p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Avatar>
                      <AvatarImage
                        src={conn.team_members?.avatar_url || conn.calendly_user_avatar || ""}
                        alt={conn.team_members?.full_name || conn.calendly_user_name}
                      />
                      <AvatarFallback>
                        {(conn.team_members?.full_name || conn.calendly_user_name || "?")
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-medium">{conn.team_members?.full_name || conn.calendly_user_name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {conn.team_members?.title || conn.calendly_user_email}
                      </p>
                    </div>
                    <Badge variant="secondary" className="ml-auto">
                      {hostEvents.length} meeting{hostEvents.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  {hostEvents.length > 0 ? (
                    <div className="space-y-2">
                      {hostEvents.slice(0, 5).map((event) => (
                        <div
                          key={event.uri}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-muted cursor-pointer"
                          onClick={() => setSelectedEvent(event)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="text-center w-12">
                              <p className="text-xs text-muted-foreground">
                                {new Date(event.start_time).toLocaleDateString("en-US", { month: "short" })}
                              </p>
                              <p className="text-lg font-semibold">{new Date(event.start_time).getDate()}</p>
                            </div>
                            <div>
                              <p className="font-medium text-sm">{event.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatTime(event.start_time)} with{" "}
                                {event.invitees?.[0]?.name || event.invitees?.[0]?.email || "Client"}
                              </p>
                            </div>
                          </div>
                          {event.location?.join_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                window.open(event.location?.join_url, "_blank")
                              }}
                            >
                              <Video className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {hostEvents.length > 5 && (
                        <p className="text-sm text-muted-foreground text-center pt-2">
                          + {hostEvents.length - 5} more meetings
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No upcoming meetings</p>
                  )}
                </Card>
              )
            })}
          </TabsContent>
        </Tabs>

        {/* Event Detail Dialog */}
        <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedEvent?.name}</DialogTitle>
              <DialogDescription>
                {selectedEvent && formatDate(selectedEvent.start_time)} at{" "}
                {selectedEvent && formatTime(selectedEvent.start_time)}
              </DialogDescription>
            </DialogHeader>
            {selectedEvent && (
              <div className="space-y-4">
                {/* Host Info */}
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <Avatar>
                    <AvatarImage src={selectedEvent.host?.avatar || ""} />
                    <AvatarFallback>
                      {(selectedEvent.host?.name || "?")
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{selectedEvent.host?.name}</p>
                    <p className="text-sm text-muted-foreground">{selectedEvent.host?.email}</p>
                  </div>
                </div>

                {/* Time */}
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">
                      {formatTime(selectedEvent.start_time)} - {formatTime(selectedEvent.end_time)}
                    </p>
                    <p className="text-sm text-muted-foreground">{formatDate(selectedEvent.start_time)}</p>
                  </div>
                </div>

                {/* Location */}
                {selectedEvent.location && (
                  <div className="flex items-center gap-3">
                    {getLocationIcon(selectedEvent.location.type)}
                    <div className="flex-1">
                      <p className="font-medium capitalize">{selectedEvent.location.type?.replace(/_/g, " ")}</p>
                      {selectedEvent.location.location && (
                        <p className="text-sm text-muted-foreground">{selectedEvent.location.location}</p>
                      )}
                    </div>
                    {selectedEvent.location.join_url && (
                      <Button size="sm" onClick={() => window.open(selectedEvent.location?.join_url, "_blank")}>
                        <Video className="h-4 w-4 mr-2" />
                        Join Meeting
                      </Button>
                    )}
                  </div>
                )}

                {/* Invitees */}
                {selectedEvent.invitees && selectedEvent.invitees.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Invitees ({selectedEvent.invitees.length})
                    </h4>
                    <div className="space-y-2">
                      {selectedEvent.invitees.map((inv) => (
                        <div key={inv.uri} className="p-3 bg-muted rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{inv.name || "Guest"}</p>
                              <p className="text-sm text-muted-foreground flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {inv.email}
                              </p>
                            </div>
                            <Badge variant={inv.status === "active" ? "default" : "destructive"}>{inv.status}</Badge>
                          </div>
                          {inv.questions_and_answers && inv.questions_and_answers.length > 0 && (
                            <div className="mt-3 pt-3 border-t space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">Booking Questions:</p>
                              {inv.questions_and_answers.map((qa, i) => (
                                <div key={i} className="text-sm">
                                  <p className="text-muted-foreground">{qa.question}</p>
                                  <p className="font-medium">{qa.answer}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Settings Dialog */}
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Calendar Settings</DialogTitle>
              <DialogDescription>Manage Calendly connections and sync settings</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* My Connection */}
              <div>
                <h4 className="font-medium mb-3">Your Connection</h4>
                {myConnection ? (
                  <Card className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={myConnection.calendly_user_avatar || ""} />
                          <AvatarFallback>
                            {myConnection.calendly_user_name
                              ?.split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{myConnection.calendly_user_name}</p>
                          <p className="text-sm text-muted-foreground">{myConnection.calendly_user_email}</p>
                        </div>
                      </div>
                      <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                        <LogOut className="h-4 w-4 mr-2" />
                        Disconnect
                      </Button>
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-4 border-t">
                      <Label htmlFor="sync-enabled">Sync my calendar to Master Calendar</Label>
                      <Switch
                        id="sync-enabled"
                        checked={myConnection.sync_enabled}
                        onCheckedChange={(checked) => handleToggleSync(myConnection.id, checked)}
                      />
                    </div>
                  </Card>
                ) : (
                  <Card className="p-4">
                    <div className="text-center">
                      <p className="text-muted-foreground mb-3">Connect your Calendly account to sync your meetings</p>
                      <Button onClick={handleConnectCalendly}>
                        <Link2 className="h-4 w-4 mr-2" />
                        Connect Calendly
                      </Button>
                    </div>
                  </Card>
                )}
              </div>

              {/* Team Connections */}
              <div>
                <h4 className="font-medium mb-3">Team Connections ({connections.length})</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {connections.map((conn) => (
                    <div key={conn.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={conn.team_members?.avatar_url || conn.calendly_user_avatar || ""} />
                          <AvatarFallback className="text-xs">
                            {(conn.team_members?.full_name || conn.calendly_user_name || "?")
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">
                            {conn.team_members?.full_name || conn.calendly_user_name}
                          </p>
                          <p className="text-xs text-muted-foreground">{conn.calendly_user_email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {conn.sync_enabled ? (
                          <Badge variant="default" className="text-xs">
                            Syncing
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Paused
                          </Badge>
                        )}
                        {conn.is_active ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-600" />
                        )}
                      </div>
                    </div>
                  ))}
                  {connections.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No team members have connected their Calendly accounts yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  )
}
