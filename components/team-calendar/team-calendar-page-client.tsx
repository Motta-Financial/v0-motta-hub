"use client"

import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
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
import { TeamCalendarView } from "./team-calendar-view"

/**
 * Top-level page wrapper for the Team Calendar.
 *
 * The big picture:
 *  - The actual day/week/month/list grid lives in <TeamCalendarView>,
 *    which fetches from `/api/calendly/team-calendar` (Supabase) and
 *    handles all view state, timezone, host filter, and event details.
 *  - This wrapper is intentionally thin: it owns the "connect your
 *    Calendly account" affordances, surfaces the list of teammates who
 *    have connected, and offers a manual sync trigger. Everything below
 *    that is the calendar itself.
 *
 * Why we removed the old stats cards and tab toggles: the calendar grid
 * conveys the same information visually, and the toolbar's host filter
 * is a more useful "by host" affordance than the previous separate tab.
 * The grid also covers Day/Week/Month/List in one component instead of
 * the old single-list rendering.
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

export function TeamCalendarPageClient() {
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
      // POST is the legacy "sync everyone" endpoint that triggers the
      // Calendly→Supabase ingestion job. Once it completes, the
      // TeamCalendarView's SWR cache picks up the new rows on its next
      // revalidation (or via the manual refresh button there).
      const res = await fetch("/api/calendly/master-calendar", { method: "POST" })
      if (!res.ok) throw new Error("sync failed")
    } catch (e) {
      console.error(e)
      setError("Sync failed — try again in a minute.")
    } finally {
      setSyncing(false)
    }
  }

  // Strict equality with `is_active && sync_enabled` matches what the
  // sync engine actually polls, so the chip count under "Connected
  // teammates" is a truthful signal rather than a count of stale rows.
  const activeConnections = connections.filter((c) => c.is_active && c.sync_enabled)

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Team Calendar</h1>
            <p className="mt-1 text-muted-foreground">
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
              <Button onClick={handleConnect}>
                <Link2 className="mr-2 h-4 w-4" />
                Connect your Calendly
              </Button>
            )}
            <Button variant="outline" onClick={handleSyncAll} disabled={syncing}>
              <RefreshCw className={syncing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </div>

        {/* Connection prompt */}
        {!myConnection ? (
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
        ) : null}

        {error ? (
          <Card className="flex items-center gap-3 border-rose-200 bg-rose-50 p-4">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            <p className="text-sm text-rose-800">{error}</p>
          </Card>
        ) : null}

        {/* Connected teammates strip */}
        {activeConnections.length > 0 ? (
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                Connected teammates ({activeConnections.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarImage
                      src={conn.team_members?.avatar_url || conn.calendly_user_avatar || ""}
                      alt={conn.team_members?.full_name || conn.calendly_user_name}
                    />
                    <AvatarFallback className="text-xs">
                      {(conn.team_members?.full_name || conn.calendly_user_name || "?")
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">
                    {conn.team_members?.full_name || conn.calendly_user_name}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* The calendar itself */}
        <TeamCalendarView initialTz={myConnection?.calendly_user_timezone ?? null} />
      </div>
    </DashboardLayout>
  )
}
