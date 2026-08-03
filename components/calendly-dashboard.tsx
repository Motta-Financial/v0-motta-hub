"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Calendar,
  Clock,
  Users,
  ExternalLink,
  Video,
  MapPin,
  Mail,
  Copy,
  CheckCircle2,
  RefreshCw,
  Link2,
  AlertTriangle,
  ShieldAlert,
  Webhook,
  LogOut,
  FileText,
  Activity,
  Loader2,
} from "lucide-react"
import type { CalendlyUser, CalendlyEventType, CalendlyScheduledEvent } from "@/lib/calendly-types"

/**
 * Per-user Calendly dashboard. Renders the OAuth-connected Calendly
 * profile, the user's event types, and their upcoming meetings. Handles
 * three top-level states:
 *   1. Not connected → prompt to connect
 *   2. Connected but missing scopes / expired token → prompt to reauth
 *   3. Healthy connection → render full dashboard
 *
 * Data is fetched against the connection-aware /api/calendly/* routes,
 * which read tokens from `calendly_connections` (no static access token).
 */

interface DiagnosticsConnection {
  id: string
  teamMember: { id: string; full_name: string; email: string } | null
  calendlyUser: {
    name: string | null
    email: string | null
    avatar: string | null
    timezone: string | null
    uri: string
    organizationUri: string | null
  }
  tokens: {
    expiresAt: string
    tokenOk: boolean
    probeError: string | null
    grantedScopes: string[]
    missingScopes: string[]
    needsReauth: boolean
  }
  webhooks: {
    callbackUrl: string
    totalSubscriptions: number
    configuredForUs: boolean
  }
  sync: {
    enabled: boolean | null
    active: boolean | null
    lastSyncedAt: string | null
  }
}

export function CalendlyDashboard() {
  const [user, setUser] = useState<CalendlyUser | null>(null)
  const [eventTypes, setEventTypes] = useState<CalendlyEventType[]>([])
  const [scheduledEvents, setScheduledEvents] = useState<CalendlyScheduledEvent[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticsConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [needsReauth, setNeedsReauth] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Lazy-loaded org-level surfaces. These need extra scopes
  // (routing_forms:read / activity_log:read) and admin role, so we only
  // fetch them when the tab is opened and degrade gracefully on 403/404.
  const [routingForms, setRoutingForms] = useState<any[] | null>(null)
  const [routingLoading, setRoutingLoading] = useState(false)
  const [routingError, setRoutingError] = useState<string | null>(null)
  const [activity, setActivity] = useState<any[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)

  useEffect(() => {
    void loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    setNeedsConnect(false)
    setNeedsReauth(false)

    try {
      // Diagnostics first — that gives us the connection-health signal.
      const diagRes = await fetch("/api/calendly/diagnostics")
      if (diagRes.ok) {
        const diag = await diagRes.json()
        // Try to find the current caller's connection. Without a userId
        // hint here we use the first connection that the diagnostics
        // route exposes for the caller; in practice the API masks any
        // connection the caller can't read.
        const myConn: DiagnosticsConnection | undefined =
          diag.connections?.[0] ?? undefined
        setDiagnostics(myConn || null)

        if (!myConn) {
          setNeedsConnect(true)
          setLoading(false)
          return
        }
        if (myConn.tokens.needsReauth) {
          setNeedsReauth(true)
          // We can still try to render whatever data we have.
        }
      }

      // User profile
      const userRes = await fetch("/api/calendly/user")
      if (userRes.status === 404) {
        const body = await userRes.json().catch(() => ({}))
        if (body.needsConnect) setNeedsConnect(true)
      } else if (userRes.status === 401) {
        setNeedsReauth(true)
      } else if (userRes.ok) {
        const userData = await userRes.json()
        setUser(userData)

        const [etRes, evRes] = await Promise.all([
          fetch("/api/calendly/event-types"),
          fetch(
            `/api/calendly/scheduled-events?status=active&min_start_time=${new Date().toISOString()}`,
          ),
        ])
        if (etRes.ok) setEventTypes(await etRes.json())
        if (evRes.ok) setScheduledEvents(await evRes.json())
      } else {
        const body = await userRes.json().catch(() => ({}))
        setError(body.error || "Failed to load Calendly data")
      }
    } catch (err) {
      console.error("[v0] Calendly dashboard load failed:", err)
      setError("Failed to load Calendly data")
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = () => {
    window.location.href = "/api/calendly/oauth/authorize"
  }

  const handleDisconnect = async () => {
    if (!diagnostics?.teamMember?.id) return
    if (!confirm("Disconnect your Calendly account? You can reconnect anytime.")) return
    await fetch("/api/calendly/oauth/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamMemberId: diagnostics.teamMember.id }),
    })
    await loadAll()
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetch("/api/calendly/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncPast: false,
          daysForward: 90,
          syncEventTypes: true,
          teamMemberId: diagnostics?.teamMember?.id,
        }),
      })
      await loadAll()
    } finally {
      setSyncing(false)
    }
  }

  const loadRoutingForms = async () => {
    if (routingForms !== null || routingLoading) return
    setRoutingLoading(true)
    setRoutingError(null)
    try {
      const tm = diagnostics?.teamMember?.id
      const res = await fetch(
        `/api/calendly/routing-forms${tm ? `?teamMemberId=${tm}` : ""}`,
      )
      if (res.ok) {
        const body = await res.json()
        setRoutingForms(Array.isArray(body.forms) ? body.forms : [])
      } else {
        const body = await res.json().catch(() => ({}))
        setRoutingError(
          body.error?.includes("scope") || res.status === 403
            ? "Your Calendly token is missing the routing_forms:read scope. Reauthorize to enable this view."
            : body.error || "Routing forms are unavailable for this account.",
        )
        setRoutingForms([])
      }
    } catch {
      setRoutingError("Failed to load routing forms.")
      setRoutingForms([])
    } finally {
      setRoutingLoading(false)
    }
  }

  const loadActivity = async () => {
    if (activity !== null || activityLoading) return
    setActivityLoading(true)
    setActivityError(null)
    try {
      const tm = diagnostics?.teamMember?.id
      const res = await fetch(
        `/api/calendly/activity-log${tm ? `?teamMemberId=${tm}` : ""}`,
      )
      if (res.ok) {
        const body = await res.json()
        setActivity(Array.isArray(body.entries) ? body.entries : [])
      } else {
        const body = await res.json().catch(() => ({}))
        setActivityError(
          res.status === 403
            ? "The activity log requires admin access and the activity_log:read scope on your Calendly account."
            : body.error || "The activity log is unavailable for this account.",
        )
        setActivity([])
      }
    } catch {
      setActivityError("Failed to load activity log.")
      setActivity([])
    } finally {
      setActivityLoading(false)
    }
  }

  const handleResubscribeWebhook = async () => {
    if (!diagnostics) return
    await fetch("/api/calendly/webhook/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: diagnostics.id, scope: "user" }),
    })
    await loadAll()
  }

  const copyToClipboard = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedUrl(id)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  const formatTime = (s: string) =>
    new Date(s).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })

  const getLocationIcon = (type?: string) => {
    switch (type) {
      case "zoom":
      case "google_conference":
      case "microsoft_teams_conference":
        return <Video className="h-4 w-4" />
      case "physical":
        return <MapPin className="h-4 w-4" />
      default:
        return <Calendar className="h-4 w-4" />
    }
  }

  /* ────────────────────────────  RENDER  ──────────────────────────── */

  if (loading) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading Calendly data...</p>
          </div>
        </div>
      </div>
    )
  }

  if (needsConnect) {
    return (
      <div className="space-y-6">
        <Header />
        <Card className="p-8">
          <div className="flex flex-col items-center text-center max-w-md mx-auto">
            <div className="p-4 rounded-full bg-primary/10 mb-4">
              <Link2 className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold">Connect your Calendly account</h2>
            <p className="text-muted-foreground mt-2">
              Authorize Motta Hub to read your scheduling data, manage event types,
              and receive webhook events for new bookings and cancellations.
            </p>
            <Button className="mt-6" onClick={handleConnect}>
              <Link2 className="h-4 w-4 mr-2" />
              Connect Calendly
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        right={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadAll} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync now"}
            </Button>
          </div>
        }
      />

      {needsReauth && (
        <Card className="p-4 border-amber-300 bg-amber-50">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-900">Reauthorization required</h3>
              <p className="text-sm text-amber-800 mt-1">
                Your Calendly connection is missing scopes that were recently
                enabled, or its token can no longer be refreshed. Reauthorize to
                restore full functionality.
              </p>
              {diagnostics?.tokens?.missingScopes?.length ? (
                <p className="text-xs text-amber-700 mt-2">
                  Missing scopes: {diagnostics.tokens.missingScopes.join(", ")}
                </p>
              ) : null}
            </div>
            <Button onClick={handleConnect} size="sm">
              Reauthorize
            </Button>
          </div>
        </Card>
      )}

      {diagnostics && !diagnostics.webhooks.configuredForUs && !needsReauth && (
        <Card className="p-4 border-blue-200 bg-blue-50">
          <div className="flex items-start gap-3">
            <Webhook className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">Webhooks not configured</h3>
              <p className="text-sm text-blue-800 mt-1">
                Real-time event notifications require an active webhook
                subscription. Click below to subscribe.
              </p>
            </div>
            <Button onClick={handleResubscribeWebhook} size="sm" variant="outline">
              Subscribe
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-700 flex-1">{error}</p>
            <Button variant="outline" size="sm" onClick={loadAll}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {/* User profile card */}
      {user && (
        <Card className="p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              {user.avatar_url && (
                <img
                  src={user.avatar_url || "/placeholder.svg"}
                  alt={user.name}
                  className="h-16 w-16 rounded-full"
                />
              )}
              <div>
                <h2 className="text-2xl font-semibold">{user.name}</h2>
                <p className="text-muted-foreground flex items-center gap-2 mt-1">
                  <Mail className="h-4 w-4" />
                  {user.email}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Timezone: {user.timezone}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => window.open(user.scheduling_url, "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Scheduling page
              </Button>
              <Button variant="outline" onClick={handleDisconnect}>
                <LogOut className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </div>

          {diagnostics && (
            <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`h-3 w-3 ${diagnostics.tokens.tokenOk ? "text-green-600" : "text-red-500"}`}
                />
                Token {diagnostics.tokens.tokenOk ? "OK" : "invalid"}
              </div>
              <div className="flex items-center gap-2">
                <Webhook
                  className={`h-3 w-3 ${diagnostics.webhooks.configuredForUs ? "text-green-600" : "text-amber-600"}`}
                />
                Webhook{" "}
                {diagnostics.webhooks.configuredForUs ? "active" : "not configured"}
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3 w-3" />
                Last sync:{" "}
                {diagnostics.sync.lastSyncedAt
                  ? new Date(diagnostics.sync.lastSyncedAt).toLocaleString()
                  : "never"}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Stats */}
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
                {scheduledEvents.reduce(
                  (sum, e) => sum + (e.invitees_counter?.active ?? 0),
                  0,
                )}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs
        defaultValue="scheduled"
        className="space-y-4"
        onValueChange={(v) => {
          if (v === "routing") void loadRoutingForms()
          if (v === "activity") void loadActivity()
        }}
      >
        <TabsList>
          <TabsTrigger value="scheduled">Upcoming Events</TabsTrigger>
          <TabsTrigger value="event-types">Event Types</TabsTrigger>
          <TabsTrigger value="routing">Routing Forms</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduled" className="space-y-4">
          {scheduledEvents.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Upcoming Events</h3>
                <p className="text-muted-foreground">
                  You don&apos;t have any scheduled events at the moment.
                </p>
              </div>
            </Card>
          ) : (
            scheduledEvents.map((event) => (
              <Card key={event.uri} className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold">{event.name}</h3>
                      <Badge
                        variant={event.status === "active" ? "default" : "secondary"}
                      >
                        {event.status}
                      </Badge>
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
                        {event.invitees_counter?.active ?? 0} invitee(s)
                      </div>
                    </div>
                    {event.location?.join_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 bg-transparent"
                        onClick={() =>
                          window.open(event.location?.join_url, "_blank")
                        }
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
                <p className="text-muted-foreground">
                  You don&apos;t have any active event types configured.
                </p>
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
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: eventType.color }}
                          />
                          <h3 className="font-semibold">{eventType.name}</h3>
                        </div>
                        {eventType.description_plain && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {eventType.description_plain}
                          </p>
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
                        onClick={() =>
                          copyToClipboard(eventType.scheduling_url, eventType.uri)
                        }
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

        {/* Routing Forms — org-level, scope-gated */}
        <TabsContent value="routing" className="space-y-4">
          {routingLoading ? (
            <Card className="p-12">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading routing forms...
              </div>
            </Card>
          ) : routingError ? (
            <Card className="p-6 border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
                <p className="text-sm text-amber-800">{routingError}</p>
              </div>
            </Card>
          ) : routingForms && routingForms.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {routingForms.map((form) => (
                <Card key={form.uri} className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 rounded-md bg-primary/10 shrink-0">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{form.name || "Untitled form"}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {Array.isArray(form.questions)
                            ? `${form.questions.length} question(s)`
                            : "Routing form"}
                          {Array.isArray(form.submissions)
                            ? ` · ${form.submissions.length} submission(s)`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <Badge variant={form.status === "published" ? "default" : "secondary"}>
                      {form.status || "draft"}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-12">
              <div className="text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Routing Forms</h3>
                <p className="text-muted-foreground">
                  This Calendly organization has no routing forms configured.
                </p>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Activity log — org-level, admin + scope-gated */}
        <TabsContent value="activity" className="space-y-4">
          {activityLoading ? (
            <Card className="p-12">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading activity log...
              </div>
            </Card>
          ) : activityError ? (
            <Card className="p-6 border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
                <p className="text-sm text-amber-800">{activityError}</p>
              </div>
            </Card>
          ) : activity && activity.length > 0 ? (
            <Card className="divide-y">
              {activity.map((entry, i) => (
                <div key={entry.uri || i} className="flex items-start gap-3 p-4">
                  <div className="p-2 rounded-md bg-muted shrink-0">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">
                        {entry.actor?.display_name || entry.actor?.email || "Someone"}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {(entry.action || entry.namespace || "performed an action").replace(/_/g, " ")}
                      </span>
                    </p>
                    {entry.occurred_at && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(entry.occurred_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {entry.namespace && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {entry.namespace}
                    </Badge>
                  )}
                </div>
              ))}
            </Card>
          ) : (
            <Card className="p-12">
              <div className="text-center">
                <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Recent Activity</h3>
                <p className="text-muted-foreground">
                  No organization activity has been recorded recently.
                </p>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-4">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Calendly</h1>
        <p className="text-muted-foreground mt-1">
          Manage your scheduling and view upcoming meetings
        </p>
      </div>
      {right}
    </div>
  )
}
