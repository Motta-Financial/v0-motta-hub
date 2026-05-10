"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useUser } from "@/contexts/user-context"
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  LogOut,
  RefreshCw,
  Users,
} from "lucide-react"
import { TeamCalendarView } from "./team-calendar/team-calendar-view"

/**
 * Inline calendar component for the Dashboard tab.
 * 
 * This is a simplified version of TeamCalendarPageClient that doesn't
 * wrap content in DashboardLayout (since it's already inside the dashboard).
 */

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

export function DashboardCalendar() {
  const { teamMember } = useUser()
  const [connections, setConnections] = useState<CalendlyConnection[]>([])
  const [myConnection, setMyConnection] = useState<CalendlyConnection | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/calendly/connections")
        if (!res.ok) throw new Error("connections failed")
        const data = await res.json()
        const list: CalendlyConnection[] = data.connections ?? []
        setConnections(list)
        if (teamMember?.id) {
          setMyConnection(list.find((c) => c.team_members?.id === teamMember.id) ?? null)
        }
      } catch (e) {
        console.error(e)
        setError("Failed to load Calendly connections")
      }
    }
    load()
  }, [teamMember])

  const handleConnect = () => {
    window.location.href = "/api/calendly/oauth/authorize"
  }

  const handleDisconnect = async () => {
    if (!teamMember?.id) return
    if (!confirm("Disconnect your Calendly account?")) return
    try {
      const res = await fetch("/api/calendly/oauth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId: teamMember.id }),
      })
      if (res.ok) {
        setMyConnection(null)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSyncAll = async () => {
    try {
      setSyncing(true)
      const res = await fetch("/api/calendly/master-calendar", { method: "POST" })
      if (!res.ok) throw new Error("sync failed")
    } catch (e) {
      console.error(e)
      setError("Sync failed — try again in a minute.")
    } finally {
      setSyncing(false)
    }
  }

  const activeConnections = connections.filter((c) => c.is_active && c.sync_enabled)

  return (
    <div className="space-y-4">
      {/* Header with connection controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Firm-wide meeting schedule from every connected Calendly account.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {myConnection ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-500 text-emerald-700 hover:text-emerald-800 bg-transparent"
                disabled
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Connected as {myConnection.calendly_user_name}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                <LogOut className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleConnect}>
              <Link2 className="mr-2 h-4 w-4" />
              Connect Calendly
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleSyncAll} disabled={syncing}>
            <RefreshCw className={syncing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      {/* Connection prompt */}
      {!myConnection && (
        <Card className="flex items-start gap-3 border-amber-200 bg-amber-50 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600" />
          <div className="flex-1">
            <h3 className="font-medium text-amber-900">Connect your Calendly account</h3>
            <p className="mt-1 text-sm text-amber-800">
              Once connected, your meetings will appear on the Team Calendar and any invitee that
              matches an existing client will be auto-tagged.
            </p>
          </div>
          <Button size="sm" onClick={handleConnect}>
            <Link2 className="mr-2 h-4 w-4" />
            Connect now
          </Button>
        </Card>
      )}

      {error && (
        <Card className="flex items-center gap-3 border-rose-200 bg-rose-50 p-4">
          <AlertCircle className="h-5 w-5 text-rose-600" />
          <p className="text-sm text-rose-800">{error}</p>
        </Card>
      )}

      {/* Connected teammates strip */}
      {activeConnections.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="text-xs font-medium">
                {activeConnections.length} connected
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {activeConnections.slice(0, 8).map((conn) => (
                <Avatar key={conn.id} className="h-7 w-7 border-2 border-background">
                  <AvatarImage
                    src={conn.team_members?.avatar_url || conn.calendly_user_avatar || ""}
                    alt={conn.team_members?.full_name || conn.calendly_user_name}
                  />
                  <AvatarFallback className="text-[10px]">
                    {(conn.team_members?.full_name || conn.calendly_user_name || "?")
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </AvatarFallback>
                </Avatar>
              ))}
              {activeConnections.length > 8 && (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                  +{activeConnections.length - 8}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* The calendar itself */}
      <TeamCalendarView initialTz={myConnection?.calendly_user_timezone ?? null} />
    </div>
  )
}
