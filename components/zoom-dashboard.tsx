"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
} from "lucide-react"
import type { ZoomMeeting, ZoomCallHistory, ZoomUser } from "@/lib/zoom-types"

export function ZoomDashboard() {
  const [meetings, setMeetings] = useState<ZoomMeeting[]>([])
  const [recordings, setRecordings] = useState<any[]>([])
  const [callHistory, setCallHistory] = useState<ZoomCallHistory[]>([])
  const [user, setUser] = useState<ZoomUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState("meetings")

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [meetingsRes, recordingsRes, callHistoryRes, userRes] = await Promise.all([
        fetch("/api/zoom/meetings?type=upcoming"),
        fetch("/api/zoom/recordings"),
        fetch("/api/zoom/call-history"),
        fetch("/api/zoom/user"),
      ])

      if (meetingsRes.ok) {
        const meetingsData = await meetingsRes.json()
        setMeetings(meetingsData)
      }

      if (recordingsRes.ok) {
        const recordingsData = await recordingsRes.json()
        setRecordings(recordingsData)
      }

      if (callHistoryRes.ok) {
        const callHistoryData = await callHistoryRes.json()
        setCallHistory(callHistoryData)
      }

      if (userRes.ok) {
        const userData = await userRes.json()
        setUser(userData)
      }
    } catch (error) {
      console.error("Error fetching Zoom data:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredMeetings = meetings.filter(
    (meeting) =>
      meeting.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
      meeting.host_email?.toLowerCase().includes(searchQuery.toLowerCase()),
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

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
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
          <h1 className="text-3xl font-bold tracking-tight">Zoom</h1>
          <p className="text-muted-foreground">Manage your meetings, recordings, and phone calls</p>
        </div>
        <Button onClick={fetchData} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* User Info */}
      {user && (
        <Card className="p-4">
          <div className="flex items-center gap-4">
            {user.pic_url && (
              <img src={user.pic_url || "/placeholder.svg"} alt={user.first_name} className="h-12 w-12 rounded-full" />
            )}
            <div>
              <h3 className="font-semibold">
                {user.first_name} {user.last_name}
              </h3>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <Badge variant="secondary" className="ml-auto">
              {user.type === 1 ? "Basic" : user.type === 2 ? "Licensed" : "On-Prem"}
            </Badge>
          </div>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search meetings, recordings, or calls..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
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
          ) : (
            <div className="grid gap-4">
              {filteredMeetings.map((meeting) => (
                <Card key={meeting.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold mb-2">{meeting.topic}</h3>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {formatDateTime(meeting.start_time)}
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {meeting.duration} minutes
                        </div>
                        {meeting.host_email && (
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            Host: {meeting.host_email}
                          </div>
                        )}
                      </div>
                      {meeting.agenda && <p className="text-sm text-muted-foreground mt-2">{meeting.agenda}</p>}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Badge variant={meeting.status === "waiting" ? "secondary" : "default"}>{meeting.status}</Badge>
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
                            {formatDuration(call.duration)}
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
