"use client"

/**
 * OutlookDashboard — per-user Outlook mailbox connection at
 * /settings/outlook and /meetings/outlook. Mirrors the layout of
 * CalendlyDashboard (components/calendly-dashboard.tsx): one connected
 * account card, stat tiles, and a tabbed view of synced content — so
 * the page reads the same way whichever integration you're looking at.
 *
 * Three states for the signed-in user's own connection:
 *   1. not_connected    — prompt to connect, explain what access is requested
 *   2. connected         — mailbox, connected date, sync stats, disconnect
 *   3. needs_reconnect   — amber banner, reason, reconnect action
 *
 * Backed by real data: connection status comes from
 * GET /api/outlook/connections (outlook_connections table), and recent
 * emails / calendar events / stat counts come from a live Microsoft
 * Graph fetch via POST /api/outlook/sync.
 */

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import { formatDistanceToNow } from "date-fns"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Mail,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Shield,
  KeyRound,
  Webhook,
  Link2,
  XCircle,
} from "lucide-react"

// Codes appended as ?error=<code> when a full-page OAuth redirect
// (authorize or callback route) fails. These are navigations, not
// fetches the UI can inspect directly, so the routes redirect back
// here with a code instead of leaving the button looking like it did
// nothing.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Outlook isn't configured yet — Microsoft app credentials are missing. Contact an administrator.",
  team_member_missing: "Your account isn't registered as a Motta team member.",
  authorize_failed: "Couldn't start the Outlook connection. Please try again.",
  oauth_denied: "Microsoft sign-in was cancelled or denied.",
  missing_params: "The connection attempt was missing required information. Please try again.",
  invalid_state: "That connection link expired or was invalid. Please try connecting again.",
  user_fetch_failed: "Connected to Microsoft, but couldn't read your mailbox details.",
  save_failed: "Connected to Microsoft, but saving the connection failed. Please try again.",
  callback_failed: "Something went wrong finishing the Outlook connection. Please try again.",
}

const DEEP_GREEN = "#6B745D"
const MID_GREEN = "#8E9B79"
const PALE_GREEN = "#B5BFA8"
const DARK_GREEN = "#4A5240"

const WARNING_BG = "#FEF3C7"
const WARNING_BORDER = "#F3D98A"
const WARNING_ICON = "#92720B"
const WARNING_HEADING = "#5C4A0A"
const WARNING_TEXT = "#7A6212"

type OutlookConnectionStatus = "not_connected" | "connected" | "needs_reconnect"

interface OutlookOwnConnection {
  status: OutlookConnectionStatus
  mailbox: string | null
  connectedAt: string | null
  lastSyncAt: string | null
  emailsSynced: number
  calendarEventsSynced: number
  webhookConfigured: boolean
  reconnectReason: string | null
  brokenAt: string | null
}

interface OutlookRecentEmail {
  id: string
  subject: string
  from: string
  receivedAt: string
  preview: string
}

interface OutlookCalendarEvent {
  id: string
  title: string
  startsAt: string
  attendees: number
  location: string | null
}

// A hung request (bad Supabase/network config, a stalled cold compile,
// etc.) previously left the page spinning forever with no way out —
// there was nothing to reject the SWR promise. Bounding it means a
// stall surfaces as a retryable error within 15s instead of an
// indefinite spinner.
async function fetcher(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res.json()
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.")
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export function OutlookDashboard() {
  const {
    data: connection,
    error: connectionError,
    isLoading,
    mutate,
  } = useSWR<OutlookOwnConnection>("/api/outlook/connections", fetcher)
  /**
   * The mail list is its own paged resource rather than whatever the last
   * sync happened to return. POST /api/outlook/sync fetches 10 messages to
   * refresh the counters; that is a status check, not a mailbox. This
   * loads pages of 25 from GET /api/outlook/messages and keeps going as
   * far as the mailbox does.
   */
  const {
    data: emailPages,
    size: emailPageCount,
    setSize: setEmailPageCount,
    isValidating: emailsValidating,
    mutate: mutateEmails,
  } = useSWRInfinite<{
    status: string
    emails: OutlookRecentEmail[]
    nextSkip: number | null
  }>((index, previous) => {
    if (index === 0) return "/api/outlook/messages"
    if (previous?.nextSkip == null) return null
    return `/api/outlook/messages?skip=${previous.nextSkip}`
  }, fetcher, { revalidateAll: false })

  const emails = useMemo(() => {
    const byId = new Map<string, OutlookRecentEmail>()
    for (const page of emailPages ?? []) {
      for (const email of page.emails ?? []) {
        if (!byId.has(email.id)) byId.set(email.id, email)
      }
    }
    return Array.from(byId.values())
  }, [emailPages])

  const lastEmailPage = emailPages?.[emailPages.length - 1]
  const hasMoreEmails = Boolean(lastEmailPage && lastEmailPage.nextSkip != null)
  const loadingMoreEmails = emailsValidating && (emailPages?.length ?? 0) < emailPageCount

  function loadMoreEmails() {
    if (!hasMoreEmails || loadingMoreEmails) return
    setEmailPageCount((n) => n + 1)
  }

  /** Auto-load as the box nears its end, the way a mail client does. */
  function onEmailScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 200) return
    loadMoreEmails()
  }

  const [events, setEvents] = useState<OutlookCalendarEvent[]>([])
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Read the ?error=<code> the authorize/callback routes redirect back
  // with on failure (plain window.location parsing, not useSearchParams,
  // so this doesn't force the page into a Suspense boundary). Clear it
  // from the URL once shown so a refresh doesn't re-surface a stale error.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const code = params.get("error")
    if (code) {
      setSyncError(OAUTH_ERROR_MESSAGES[code] || "Something went wrong connecting Outlook. Please try again.")
      params.delete("error")
      const query = params.toString()
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
    }
  }, [])

  const runSync = async () => {
    const res = await fetch("/api/outlook/sync", { method: "POST" })
    const json = await res.json()
    if (!res.ok) {
      throw new Error(json.error || "Sync failed")
    }
    setEvents(json.calendarEvents || [])
    // The counters moved, so re-read the connection; the mail list is its
    // own resource and refreshes itself.
    await Promise.all([mutate(), mutateEmails()])
  }

  // Pull real mail/calendar content as soon as we know we're connected.
  useEffect(() => {
    if (connection?.status === "connected") {
      runSync().catch((err) => setSyncError(err instanceof Error ? err.message : "Sync failed"))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.status])

  const handleConnect = () => {
    window.location.href = "/api/outlook/oauth/authorize"
  }

  const handleReconnect = () => {
    window.location.href = "/api/outlook/oauth/authorize"
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await fetch("/api/outlook/oauth/disconnect", { method: "POST" })
      await mutateEmails()
      setEvents([])
      await mutate()
    } finally {
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }

  const handleSubscribeWebhook = async () => {
    setSubscribing(true)
    try {
      const res = await fetch("/api/outlook/webhook/subscribe", { method: "POST" })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || "Failed to subscribe")
      }
      await mutate()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Failed to subscribe")
    } finally {
      setSubscribing(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setSyncError(null)
    try {
      await mutate()
    } finally {
      setRefreshing(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      await runSync()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  // A failed fetch (network error, 401, 500, etc.) left `connection`
  // undefined. Previously this fell through to the loading branch above
  // and spun forever with no way to tell the button click "did"
  // anything — surface it instead, with a retry.
  if (connectionError || !connection) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Outlook</h1>
          <p className="text-muted-foreground mt-1">
            Connect your Outlook mailbox so client emails and events sync into
            the Hub.
          </p>
        </div>
        <Card className="rounded-xl border shadow-sm" style={{ backgroundColor: WARNING_BG, borderColor: WARNING_BORDER }}>
          <CardContent className="p-6 flex items-start gap-3">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: WARNING_ICON }} aria-hidden="true" />
            <div className="flex-1 space-y-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: WARNING_HEADING }}>
                  Couldn&apos;t load your Outlook connection
                </h2>
                <p className="text-sm mt-1" style={{ color: WARNING_TEXT }}>
                  {connectionError instanceof Error ? connectionError.message : "Please try again."}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => mutate()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Outlook</h1>
          <p className="text-muted-foreground mt-1">
            Connect your Outlook mailbox so client emails and events sync into
            the Hub.
          </p>
        </div>
        {connection.status === "connected" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              onClick={handleSync}
              disabled={syncing}
              className="text-white hover:opacity-90"
              style={{ backgroundColor: DEEP_GREEN }}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        )}
      </div>

      {syncError && (
        <Card className="rounded-xl border shadow-sm" style={{ backgroundColor: WARNING_BG, borderColor: WARNING_BORDER }}>
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: WARNING_ICON }} aria-hidden="true" />
            <p className="text-sm" style={{ color: WARNING_TEXT }}>
              {syncError}
            </p>
          </CardContent>
        </Card>
      )}

      {connection.status === "connected" && !connection.webhookConfigured && (
        <Card className="rounded-xl border shadow-sm" style={{ backgroundColor: "#E9EEE3", borderColor: PALE_GREEN }}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Webhook className="mt-0.5 h-5 w-5 shrink-0" style={{ color: DARK_GREEN }} aria-hidden="true" />
              <div className="flex-1">
                <h3 className="font-medium" style={{ color: DARK_GREEN }}>
                  Webhooks not configured
                </h3>
                <p className="text-sm mt-1" style={{ color: MID_GREEN }}>
                  Real-time notifications for new mail and calendar changes
                  require an active webhook subscription.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleSubscribeWebhook} disabled={subscribing}>
                {subscribing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                Subscribe
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {connection.status === "not_connected" && <NotConnectedCard onConnect={handleConnect} />}

      {connection.status === "connected" && (
        <ConnectedCard connection={connection} onDisconnect={() => setDisconnectOpen(true)} />
      )}

      {connection.status === "needs_reconnect" && (
        <NeedsReconnectCard connection={connection} onReconnect={handleReconnect} />
      )}

      {connection.status === "connected" && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard icon={Mail} label="Emails synced" value={connection.emailsSynced.toLocaleString()} />
            <StatCard
              icon={Calendar}
              label="Calendar events synced"
              value={connection.calendarEventsSynced.toLocaleString()}
            />
            <StatCard
              icon={RefreshCw}
              label="Last sync"
              value={
                connection.lastSyncAt
                  ? `${formatDistanceToNow(new Date(connection.lastSyncAt))} ago`
                  : "never"
              }
            />
          </div>

          <Tabs defaultValue="emails" className="space-y-4">
            <TabsList>
              <TabsTrigger value="emails">Recent Emails</TabsTrigger>
              <TabsTrigger value="events">Calendar Events</TabsTrigger>
            </TabsList>

            <TabsContent value="emails" className="space-y-3">
              {emails.length === 0 ? (
                <EmptyState icon={Mail} title="No recent emails" description="Nothing has synced from this mailbox yet." />
              ) : (
                /* Scrolls in its own box rather than running down the page,
                   so the connection card and counters stay in view the way
                   a mail client keeps its chrome fixed. Capped against the
                   viewport so it still fills a large screen. */
                <div
                  onScroll={onEmailScroll}
                  className="max-h-[calc(100vh-26rem)] min-h-[20rem] space-y-3 overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-3"
                >
                {emails.map((email) => (
                  <Card key={email.id} className="rounded-xl border-0 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{email.subject}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{email.from}</p>
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-1">{email.preview}</p>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                          {formatDistanceToNow(new Date(email.receivedAt))} ago
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {hasMoreEmails ? (
                  <div className="flex justify-center py-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadMoreEmails}
                      disabled={loadingMoreEmails}
                      className="gap-1.5 text-xs"
                    >
                      {loadingMoreEmails ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          Loading older email…
                        </>
                      ) : (
                        "Load older email"
                      )}
                    </Button>
                  </div>
                ) : (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    That&apos;s the whole mailbox.
                  </p>
                )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="events" className="space-y-3">
              {events.length === 0 ? (
                <EmptyState icon={Calendar} title="No upcoming events" description="Your synced calendar has nothing coming up." />
              ) : (
                events.map((event) => (
                  <Card key={event.id} className="rounded-xl border-0 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{event.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(event.startsAt).toLocaleString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                            {event.location ? ` · ${event.location}` : ""}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                          {event.attendees} attendee{event.attendees === 1 ? "" : "s"}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Outlook?</AlertDialogTitle>
            <AlertDialogDescription>
              New mail will stop syncing as soon as you disconnect. Emails
              already synced stay where they are — nothing gets deleted. You
              can reconnect anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Disconnecting…
                </>
              ) : (
                "Disconnect"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function NotConnectedCard({ onConnect }: { onConnect: () => void }) {
  return (
    <Card className="rounded-xl border-0 shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: `${PALE_GREEN}33` }}
        >
          <Link2 className="h-6 w-6" style={{ color: DARK_GREEN }} aria-hidden="true" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">
            Connect your Outlook mailbox
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Authorize the Hub to read your mail and calendar so client emails
            and meetings sync in automatically. The Hub only ever sends mail
            when you click Send on a reply you wrote in Triage — never
            automatically.
          </p>
        </div>
        <Button
          className="mt-1 text-white hover:opacity-90"
          style={{ backgroundColor: DEEP_GREEN }}
          onClick={onConnect}
        >
          <Mail className="mr-2 h-4 w-4" />
          Connect Outlook
        </Button>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Read and mark your mail as read
          </li>
          <li className="flex items-center gap-1.5">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Send replies you write in Triage
          </li>
          <li className="flex items-center gap-1.5">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Read your calendar
          </li>
          <li className="flex items-center gap-1.5">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Stay signed in
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

function ConnectedCard({
  connection,
  onDisconnect,
}: {
  connection: OutlookOwnConnection
  onDisconnect: () => void
}) {
  const connectedDate = connection.connectedAt
    ? new Date(connection.connectedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null

  return (
    <Card className="rounded-xl border-0 shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">{connection.mailbox}</h2>
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <Mail className="h-4 w-4" aria-hidden="true" />
              Connected on {connectedDate}
            </p>
          </div>
          <Button variant="outline" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3" style={{ color: DEEP_GREEN }} aria-hidden="true" />
            Token OK
          </div>
          <div className="flex items-center gap-2">
            <Webhook
              className="h-3 w-3"
              style={{ color: connection.webhookConfigured ? DEEP_GREEN : "#B45309" }}
              aria-hidden="true"
            />
            Webhook {connection.webhookConfigured ? "active" : "not configured"}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function NeedsReconnectCard({
  connection,
  onReconnect,
}: {
  connection: OutlookOwnConnection
  onReconnect: () => void
}) {
  const brokenDate = connection.brokenAt
    ? new Date(connection.brokenAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null

  return (
    <Card
      className="rounded-xl border shadow-sm"
      style={{ backgroundColor: WARNING_BG, borderColor: WARNING_BORDER }}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: WARNING_ICON }}
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h2 className="text-base font-semibold" style={{ color: WARNING_HEADING }}>
                Outlook needs to be reconnected
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: WARNING_TEXT }}>
                {connection.reconnectReason}
              </p>
              {brokenDate && (
                <p className="text-xs" style={{ color: WARNING_TEXT }}>
                  Stopped working on {brokenDate}
                </p>
              )}
              <p className="text-xs" style={{ color: WARNING_TEXT }}>
                Emails already synced stay visible — only new ones stop.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0 text-white hover:opacity-90"
            style={{ backgroundColor: DEEP_GREEN }}
            onClick={onReconnect}
          >
            <KeyRound className="mr-2 h-3.5 w-3.5" />
            Reconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail
  label: string
  value: string
}) {
  return (
    <Card className="rounded-xl border-0 shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg" style={{ backgroundColor: `${PALE_GREEN}33` }}>
            <Icon className="h-6 w-6" style={{ color: DARK_GREEN }} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Mail
  title: string
  description: string
}) {
  return (
    <Card className="rounded-xl border-0 shadow-sm">
      <CardContent className="p-12">
        <div className="text-center">
          <Icon className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold mb-2 text-foreground">{title}</h3>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
