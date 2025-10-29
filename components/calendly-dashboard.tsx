"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Calendar, Clock, Users, ExternalLink, Video, MapPin, Mail, Copy, CheckCircle2, RefreshCw } from "lucide-react"
import type { CalendlyUser, CalendlyEventType, CalendlyScheduledEvent } from "@/lib/calendly-types"

export function CalendlyDashboard() {
  const [user, setUser] = useState<CalendlyUser | null>(null)
  const [eventTypes, setEventTypes] = useState<CalendlyEventType[]>([])
  const [scheduledEvents, setScheduledEvents] = useState<CalendlyScheduledEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  useEffect(() => {
    fetchCalendlyData()
  }, [])

  const fetchCalendlyData = async () => {
    try {
      setLoading(true)

      // Fetch user info
      const userRes = await fetch("/api/calendly/user")
      if (userRes.ok) {
        const userData = await userRes.json()
        setUser(userData)

        // Fetch event types
        const eventTypesRes = await fetch(`/api/calendly/event-types?user=${encodeURIComponent(userData.uri)}`)
        if (eventTypesRes.ok) {
          const eventTypesData = await eventTypesRes.json()
          setEventTypes(eventTypesData)
        }

        // Fetch scheduled events (upcoming only)
        const now = new Date().toISOString()
        const scheduledEventsRes = await fetch(
          `/api/calendly/scheduled-events?user=${encodeURIComponent(userData.uri)}&status=active&min_start_time=${now}`,
        )
        if (scheduledEventsRes.ok) {
          const scheduledEventsData = await scheduledEventsRes.json()
          setScheduledEvents(scheduledEventsData)
        }
      }
    } catch (error) {
      console.error("Error fetching Calendly data:", error)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedUrl(id)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  }

  const getLocationIcon = (type?: string) => {
    switch (type) {
      case "zoom":
      case "google_meet":
      case "microsoft_teams":
        return <Video className="h-4 w-4" />
      case "physical":
        return <MapPin className="h-4 w-4" />
      default:
        return <Calendar className="h-4 w-4" />
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Calendly</h1>
            <p className="text-gray-600 mt-1">Manage your scheduling and view upcoming meetings</p>
          </div>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading Calendly data...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Calendly</h1>
            <p className="text-gray-600 mt-1">Manage your scheduling and view upcoming meetings</p>
          </div>
        </div>
        <Card className="p-6">
          <p className="text-center text-muted-foreground">
            Unable to load Calendly data. Please check your API configuration.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Calendly</h1>
          <p className="text-gray-600 mt-1">Manage your scheduling and view upcoming meetings</p>
        </div>
        <Button onClick={fetchCalendlyData} variant="outline" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* User Profile Card */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {user.avatar_url && (
              <img src={user.avatar_url || "/placeholder.svg"} alt={user.name} className="h-16 w-16 rounded-full" />
            )}
            <div>
              <h2 className="text-2xl font-semibold">{user.name}</h2>
              <p className="text-muted-foreground flex items-center gap-2 mt-1">
                <Mail className="h-4 w-4" />
                {user.email}
              </p>
              <p className="text-sm text-muted-foreground mt-1">Timezone: {user.timezone}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => window.open(user.scheduling_url, "_blank")}>
            <ExternalLink className="h-4 w-4 mr-2" />
            View Scheduling Page
          </Button>
        </div>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-lg">
              <Calendar className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Event Types</p>
              <p className="text-2xl font-semibold">{eventTypes.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <Users className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Upcoming Events</p>
              <p className="text-2xl font-semibold">{scheduledEvents.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <Clock className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Invitees</p>
              <p className="text-2xl font-semibold">
                {scheduledEvents.reduce((sum, event) => sum + event.invitees_counter.active, 0)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs for Event Types and Scheduled Events */}
      <Tabs defaultValue="scheduled" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scheduled">Upcoming Events</TabsTrigger>
          <TabsTrigger value="event-types">Event Types</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduled" className="space-y-4">
          {scheduledEvents.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Upcoming Events</h3>
                <p className="text-muted-foreground">You don't have any scheduled events at the moment.</p>
              </div>
            </Card>
          ) : (
            scheduledEvents.map((event) => (
              <Card key={event.uri} className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold">{event.name}</h3>
                      <Badge variant={event.status === "active" ? "default" : "secondary"}>{event.status}</Badge>
                    </div>

                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {formatDate(event.start_time)}
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {formatTime(event.start_time)} - {formatTime(event.end_time)}
                      </div>
                      {event.location && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {getLocationIcon(event.location.type)}
                          {event.location.location || event.location.type}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-4 w-4" />
                        {event.invitees_counter.active} invitee(s)
                      </div>
                    </div>

                    {event.location?.join_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 bg-transparent"
                        onClick={() => window.open(event.location?.join_url, "_blank")}
                      >
                        <Video className="h-4 w-4 mr-2" />
                        Join Meeting
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="event-types" className="space-y-4">
          {eventTypes.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Event Types</h3>
                <p className="text-muted-foreground">You don't have any active event types configured.</p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {eventTypes.map((eventType) => (
                <Card key={eventType.uri} className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: eventType.color }} />
                          <h3 className="font-semibold">{eventType.name}</h3>
                        </div>
                        {eventType.description_plain && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{eventType.description_plain}</p>
                        )}
                      </div>
                      <Badge variant="outline">{eventType.kind}</Badge>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {eventType.duration} min
                      </div>
                      <Badge variant={eventType.active ? "default" : "secondary"}>
                        {eventType.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 bg-transparent"
                        onClick={() => window.open(eventType.scheduling_url, "_blank")}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(eventType.scheduling_url, eventType.uri)}
                      >
                        {copiedUrl === eventType.uri ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
