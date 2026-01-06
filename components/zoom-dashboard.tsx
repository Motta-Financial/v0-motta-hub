"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Video,
  Phone,
  FileVideo,
  RefreshCw,
  Search,
  Calendar,
  Clock,
  Users,
  Download,
  ExternalLink,
  Settings,
  AlertCircle,
  UserPlus,
} from "lucide-react"
import { useUser } from "@/hooks/use-user"
import type { ZoomMeeting, ZoomCallHistory } from "@/lib/zoom-types"

interface ZoomConnection {
  id: string
  zoom_user_id: string
  zoom_email: string
  zoom_display_name: string
  zoom_pic_url: string
  is_active: boolean
  sync_enabled: boolean
  last_synced_at: string
  team_members?: {
    id: string
    full_name: string
    avatar_url: string
    email: string
  }
}

interface MasterMeeting extends ZoomMeeting {
  host_name?: string
  host_pic_url?: string
}

export function ZoomDashboard() {
  const { teamMember } = useUser()
  const [meetings, setMeetings] = useState<MasterMeeting[]>([])
  const [recordings, setRecordings] = useState<any[]>([])
  const [callHistory, setCallHistory] = useState<ZoomCallHistory[]>([])
  const [zoomUsers, setZoomUsers] = useState<any[]>([])
  const [connections, setConnections] = useState<ZoomConnection[]>([])
  const [myConnection, setMyConnection] = useState<ZoomConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState("meetings")
  const [viewMode, setViewMode] = useState<"schedule" | "byHost">("schedule")
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [teamMember])

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch master calendar meetings (all users in the organization)
      const meetingsRes = await fetch("/api/zoom/master-meetings?type=upcoming")
      if (meetingsRes.ok) {
        const meetingsData = await meetingsRes.json()
        setMeetings(meetingsData.meetings || [])
        setZoomUsers(meetingsData.users || [])
      } else {
        const errorData = await meetingsRes.json()
        setError(errorData.error || "Failed to fetch meetings")
      }

      // Fetch recordings
      const recordingsRes = await fetch("/api/zoom/recordings")
      if (recordingsRes.ok) {
        const recordingsData = await recordingsRes.json()
        setRecordings(Array.isArray(recordingsData) ? recordingsData : [])
      }

      // Fetch call history
      const callHistoryRes = await fetch("/api/zoom/call-history")
      if (callHistoryRes.ok) {
        const callHistoryData = await callHistoryRes.json()
        setCallHistory(Array.isArray(callHistoryData) ? callHistoryData : [])
      }

      // Fetch OAuth connections
      const connectionsRes = await fetch("/api/zoom/connections")
      if (connectionsRes.ok) {
        const connectionsData = await connectionsRes.json()
        setConnections(connectionsData.connections || [])

        // Find my connection
        if (teamMember?.id) {
          const mine = connectionsData.connections?.find((c: ZoomConnection) => c.team_members?.id === teamMember.id)
          setMyConnection(mine || null)
        }
      }
    } catch (error) {
      console.error("Error fetching Zoom data:", error)
      setError("Failed to connect to Zoom. Please check your credentials.")
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const response = await fetch("/api/zoom/master-meetings", { method: "POST" })
      if (response.ok) {
        const data = await response.json()
        alert(`Synced ${data.meetingsSynced} meetings. ${data.todayMeetings} meetings scheduled today.`)
        await fetchData()
      }
    } catch (error) {
      console.error("Sync error:", error)
    } finally {
      setSyncing(false)
    }
  }

  const handleConnect = () => {
    if (!teamMember?.id) {
      alert("Please log in to connect your Zoom account")
      return
    }
    window.location.href = `/api/zoom/oauth/authorize?team_member_id=${teamMember.id}`
  }

  const handleDisconnect = async () => {
    if (!teamMember?.id) return

    if (!confirm("Are you sure you want to disconnect your Zoom account?")) return

    try {
      const response = await fetch("/api/zoom/oauth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_member_id: teamMember.id }),
      })

      if (response.ok) {
        setMyConnection(null)
        await fetchData()
      }
    } catch (error) {
      console.error("Disconnect error:", error)
    }
  }

  const filteredMeetings = meetings.filter(
    (meeting) =>
      meeting.topic?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      meeting.host_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      meeting.host_name?.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const filteredRecordings = recordings.filter((recording) =>
    recording.topic?.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const filteredCallHistory = callHistory.filter(
    (call) =>
      call.caller_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.callee_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.caller_number?.includes(searchQuery) ||
      call.callee_number?.includes(searchQuery),
  )

  // Group meetings by host
  const meetingsByHost = filteredMeetings.reduce(
    (acc, meeting) => {
      const hostKey = meeting.host_email || "unknown"
      if (!acc[hostKey]) {
        acc[hostKey] = {
          host_name: meeting.host_name || meeting.host_email,
          host_email: meeting.host_email,
          host_pic_url: meeting.host_pic_url,
          meetings: [],
        }
      }
      acc[hostKey].meetings.push(meeting)
      return acc
    },
    {} as Record<string, { host_name: string; host_email: string; host_pic_url?: string; meetings: MasterMeeting[] }>,
  )

  // Stats
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)

  const todayMeetings = filteredMeetings.filter((m) => {
    const startTime = new Date(m.start_time)
    return startTime >= today && startTime < tomorrow
  })

  const thisWeekMeetings = filteredMeetings.filter((m) => {
    const startTime = new Date(m.start_time)
    return startTime >= today && startTime < nextWeek
  })

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours > 0) {
      return `${hours}h ${mins}m`
    }
    return `${mins}m`
  }

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Zoom Master Calendar</h1>
          <p className="text-muted-foreground">
            View all meetings across the organization ({zoomUsers.length} users connected)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleSync} variant="outline" disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync All"}
          </Button>
          <Dialog open={showSettings} onOpenChange={setShowSettings}>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Zoom Settings</DialogTitle>
                <DialogDescription>Manage your Zoom connection and team settings</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {/* My Connection */}
                <div className="space-y-2">
                  <h4 className="font-medium">Your Connection</h4>
                  {myConnection ? (
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={myConnection.zoom_pic_url || "/placeholder.svg"} />
                          <AvatarFallback>
                            {myConnection.zoom_display_name
                              ?.split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{myConnection.zoom_display_name}</p>
                          <p className="text-sm text-muted-foreground">{myConnection.zoom_email}</p>
                        </div>
                      </div>
                      <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 border rounded-lg border-dashed">
                      <p className="text-muted-foreground">Connect your personal Zoom account</p>
                      <Button onClick={handleConnect}>
                        <UserPlus className="h-4 w-4 mr-2" />
                        Connect
                      </Button>
                    </div>
                  )}
                </div>

                {/* Connected Users */}
                <div className="space-y-2">
                  <h4 className="font-medium">Organization Users ({zoomUsers.length})</h4>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {zoomUsers.map((user) => (
                      <div key={user.id} className="flex items-center gap-3 p-2 border rounded">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.pic_url || "/placeholder.svg"} />
                          <AvatarFallback>
                            {user.first_name?.[0]}
                            {user.last_name?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{user.display_name}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                        <Badge variant="secondary">
                          {user.type === 1 ? "Basic" : user.type === 2 ? "Licensed" : "On-Prem"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Video className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{todayMeetings.length}</p>
              <p className="text-sm text-muted-foreground">Today's Meetings</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
              <Calendar className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{thisWeekMeetings.length}</p>
              <p className="text-sm text-muted-foreground">This Week</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{zoomUsers.length}</p>
              <p className="text-sm text-muted-foreground">Team Members</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
              <FileVideo className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{recordings.length}</p>
              <p className="text-sm text-muted-foreground">Recordings</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Search and View Toggle */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search meetings, recordings, or calls..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-1 border rounded-lg p-1">
          <Button
            variant={viewMode === "schedule" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("schedule")}
          >
            <Calendar className="h-4 w-4 mr-1" />
            Schedule
          </Button>
          <Button
            variant={viewMode === "byHost" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("byHost")}
          >
            <Users className="h-4 w-4 mr-1" />
            By Host
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="meetings">
            <Video className="h-4 w-4 mr-2" />
            Meetings ({filteredMeetings.length})
          </TabsTrigger>
          <TabsTrigger value="recordings">
            <FileVideo className="h-4 w-4 mr-2" />
            Recordings ({filteredRecordings.length})
          </TabsTrigger>
          <TabsTrigger value="calls">
            <Phone className="h-4 w-4 mr-2" />
            Call History ({filteredCallHistory.length})
          </TabsTrigger>
        </TabsList>

        {/* Meetings Tab */}
        <TabsContent value="meetings" className="space-y-4">
          {filteredMeetings.length === 0 ? (
            <Card className="p-8 text-center">
              <Video className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No upcoming meetings found</p>
            </Card>
          ) : viewMode === "schedule" ? (
            <div className="grid gap-4">
              {filteredMeetings.map((meeting) => (
                <Card key={meeting.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={meeting.host_pic_url || "/placeholder.svg"} />
                        <AvatarFallback>
                          {meeting.host_name
                            ?.split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{meeting.topic}</h3>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            {formatDateTime(meeting.start_time)}
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            {formatDuration(meeting.duration)}
                          </div>
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            Host: {meeting.host_name || meeting.host_email}
                          </div>
                        </div>
                        {meeting.agenda && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{meeting.agenda}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <Badge variant={meeting.status === "waiting" ? "secondary" : "default"}>
                        {meeting.status || "scheduled"}
                      </Badge>
                      <Button size="sm" asChild>
                        <a href={meeting.join_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Join
                        </a>
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(meetingsByHost).map(([hostEmail, hostData]) => (
                <div key={hostEmail} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={hostData.host_pic_url || "/placeholder.svg"} />
                      <AvatarFallback>
                        {hostData.host_name
                          ?.split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold">{hostData.host_name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {hostData.meetings.length} meeting{hostData.meetings.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 pl-11">
                    {hostData.meetings.map((meeting) => (
                      <Card key={meeting.id} className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-medium">{meeting.topic}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatDateTime(meeting.start_time)} · {formatDuration(meeting.duration)}
                            </p>
                          </div>
                          <Button size="sm" variant="outline" asChild>
                            <a href={meeting.join_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Recordings Tab */}
        <TabsContent value="recordings" className="space-y-4">
          {filteredRecordings.length === 0 ? (
            <Card className="p-8 text-center">
              <FileVideo className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No recordings found</p>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredRecordings.map((recording) => (
                <Card key={recording.uuid} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold mb-2">{recording.topic}</h3>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {formatDateTime(recording.start_time)}
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {recording.duration} minutes
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {recording.recording_files?.map((file: any, index: number) => (
                        <Button key={index} size="sm" variant="outline" asChild>
                          <a href={file.download_url} target="_blank" rel="noopener noreferrer">
                            <Download className="h-4 w-4 mr-2" />
                            {file.file_type}
                          </a>
                        </Button>
                      ))}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Call History Tab */}
        <TabsContent value="calls" className="space-y-4">
          {filteredCallHistory.length === 0 ? (
            <Card className="p-8 text-center">
              <Phone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No call history found</p>
              <p className="text-sm text-muted-foreground mt-2">Zoom Phone may not be enabled for this account</p>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredCallHistory.map((call) => (
                <Card key={call.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={call.direction === "inbound" ? "secondary" : "default"}>{call.direction}</Badge>
                        <Badge variant="outline">{call.result}</Badge>
                      </div>
                      <div className="space-y-1 text-sm">
                        <div>
                          <span className="text-muted-foreground">From: </span>
                          {call.caller_name || call.caller_number}
                        </div>
                        <div>
                          <span className="text-muted-foreground">To: </span>
                          {call.callee_name || call.callee_number}
                        </div>
                        <div className="flex items-center gap-4 text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDateTime(call.date_time)}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {Math.floor(call.duration / 60)}m {call.duration % 60}s
                          </div>
                        </div>
                      </div>
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
