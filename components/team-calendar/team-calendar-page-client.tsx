"use client"

import { useEffect, useMemo, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useUser } from "@/contexts/user-context"
import {
  AlertCircle,
  AlertTriangle,
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
  team_member_id?: string
  calendly_user_name: string
  calendly_user_email: string
  calendly_user_avatar?: string
  calendly_user_timezone?: string
  is_active: boolean
  sync_enabled: boolean
  last_synced_at?: string
  health?: {
    tokenExpired?: boolean
    syncStale?: boolean
    needsReauthForScopes?: boolean
  }
  team_members?: {
    id: string
    full_name: string
    email: string
    avatar_url?: string
    title?: string
  }
}

interface TeamMemberLite {
  id: string
  full_name: string | null
  email: string | null
  avatar_url?: string | null
  title?: string | null
}

export function TeamCalendarPageClient({
  embedded = false,
}: {
  // When `true`, the surrounding DashboardLayout chrome is provided by a
  // parent layout (e.g. the Meetings sub-nav layout at
  // app/meetings/layout.tsx) so we render the bare content to avoid a
  // double sidebar/header. The standalone /calendar route is gone (it now
  // redirects to /meetings/calendar), but the prop keeps this component
  // reusable in either context.
  embedded?: boolean
}) {
  const { teamMember } = useUser()
  const [connections, setConnections] = useState<CalendlyConnection[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([])
  const [myConnection, setMyConnection] = useState<CalendlyConnection | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [connRes, teamRes] = await Promise.all([
          fetch("/api/calendly/connections"),
          fetch("/api/team-members"),
        ])
        if (!connRes.ok) throw new Error("connections failed")
        const data = await connRes.json()
        const list: CalendlyConnection[] = data.connections ?? []
        setConnections(list)
        if (teamMember?.id) {
          setMyConnection(list.find((c) => c.team_members?.id === teamMember.id) ?? null)
        }
        if (teamRes.ok) {
          const teamData = await teamRes.json()
          setTeamMembers(teamData.team_members ?? [])
        }
      } catch (e) {
        console.error(e)
        setError("Failed to load Calendly connections")
      }
    }
    load()
  }, [teamMember])

  // Every active teammate who either has no Calendly connection on
  // file at all, or has one that's dead/reauth-required. This is the
  // gap the "why can't we see so-and-so's Calendly" question kept
  // coming back to: nothing surfaced it anywhere before now — someone
  // had to notice a name missing from the public intake form's host
  // picker to even know there was a problem.
  const needsSetup = useMemo(() => {
    return teamMembers
      .map((tm) => {
        const conn = connections.find(
          (c) => c.team_members?.id === tm.id || c.team_member_id === tm.id,
        )
        if (!conn) {
          return { member: tm, statusLabel: "Not connected" }
        }
        if (!conn.is_active) {
          return { member: tm, statusLabel: "Reconnect needed" }
        }
        if (conn.health?.tokenExpired) {
          return { member: tm, statusLabel: "Token expired" }
        }
        if (conn.health?.needsReauthForScopes) {
          return { member: tm, statusLabel: "Reauthorize for new scopes" }
        }
        return null
      })
      .filter((x): x is { member: TeamMemberLite; statusLabel: string } => x !== null)
  }, [teamMembers, connections])

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

  const content = (
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

        {/* Teammates missing or with a broken Calendly connection —
            each of these is invisible to the public intake form's
            booking-host picker right now. */}
        {needsSetup.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <span className="text-sm font-medium text-amber-900">
                Needs Calendly setup ({needsSetup.length})
              </span>
            </div>
            <p className="mb-3 text-xs text-amber-800">
              These teammates can&apos;t appear as a discovery-call booking option on the
              public intake form until they connect (or reconnect) their Calendly account.
            </p>
            <div className="flex flex-wrap gap-2">
              {needsSetup.map(({ member, statusLabel }) => (
                <div
                  key={member.id}
                  className="flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1.5"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={member.avatar_url || ""} alt={member.full_name || ""} />
                    <AvatarFallback className="text-xs">
                      {(member.full_name || "?")
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{member.full_name}</span>
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-100 text-xs text-amber-800"
                  >
                    {statusLabel}
                  </Badge>
                </div>
              ))}
            </div>
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
  )

  if (embedded) return content
  return <DashboardLayout>{content}</DashboardLayout>
}
