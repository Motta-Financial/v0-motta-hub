"use client"

/**
 * OutlookDashboard — per-user Outlook mailbox connection at
 * /settings/outlook. Mirrors the shape of CalendlyDashboard: one
 * component handles every state so the page itself stays a thin
 * wrapper.
 *
 * Three states for the signed-in user's own connection:
 *   1. not_connected    — prompt to connect, explain what access is requested
 *   2. connected         — mailbox, connected date, sync stats, disconnect
 *   3. needs_reconnect   — amber banner, reason, reconnect action
 *
 * Below that, a read-only "Firm coverage" list of who else has
 * connected — triage only covers connected mailboxes, so staff need to
 * know at a glance who isn't covered yet. There is no way to connect on
 * someone else's behalf here.
 *
 * Data is mocked (lib/mock/outlook-connections.ts) until the real
 * outlook_connections table and /api/outlook/* routes exist, so the
 * whole thing is wrapped in <PreviewFeature>.
 */

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { PreviewFeature } from "@/components/shared/preview-feature"
import {
  Mail,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Shield,
  KeyRound,
} from "lucide-react"
import {
  MOCK_MY_CONNECTION,
  MOCK_TEAM_COVERAGE,
  type OutlookOwnConnection,
} from "@/lib/mock/outlook-connections"

const DEEP_GREEN = "#6B745D"
const MID_GREEN = "#8E9B79"
const PALE_GREEN = "#B5BFA8"
const DARK_GREEN = "#4A5240"

const WARNING_BG = "#FEF3C7"
const WARNING_BORDER = "#F3D98A"
const WARNING_ICON = "#92720B"
const WARNING_HEADING = "#5C4A0A"
const WARNING_TEXT = "#7A6212"

export function OutlookDashboard() {
  const [connection, setConnection] = useState<OutlookOwnConnection>(MOCK_MY_CONNECTION)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const handleConnect = () => {
    window.location.href = "/api/outlook/oauth/connect"
  }

  const handleReconnect = () => {
    window.location.href = "/api/outlook/oauth/connect"
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await fetch("/api/outlook/oauth/disconnect", { method: "DELETE" })
    } catch {
      // mocked — ignore network errors in preview
    } finally {
      setConnection((prev) => ({
        ...prev,
        status: "not_connected",
        mailbox: null,
        connectedAt: null,
        lastSyncAt: null,
      }))
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }

  const connectedCount = MOCK_TEAM_COVERAGE.filter((m) => !!m.mailbox).length

  return (
    <PreviewFeature id="outlook-connection">
      <div className="space-y-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-foreground">Outlook</h1>
          <p className="text-sm text-muted-foreground">
            Connect your Outlook mailbox so client emails appear in Triage and can
            be attached to projects.
          </p>
        </header>

        {connection.status === "not_connected" && (
          <NotConnectedCard onConnect={handleConnect} />
        )}

        {connection.status === "connected" && (
          <ConnectedCard connection={connection} onDisconnect={() => setDisconnectOpen(true)} />
        )}

        {connection.status === "needs_reconnect" && (
          <NeedsReconnectCard connection={connection} onReconnect={handleReconnect} />
        )}

        <FirmCoverageSection connectedCount={connectedCount} total={MOCK_TEAM_COVERAGE.length} />
      </div>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Outlook?</AlertDialogTitle>
            <AlertDialogDescription>
              New mail will stop appearing in Triage as soon as you disconnect.
              Emails already synced stay where they are — nothing gets deleted.
              You can reconnect anytime.
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
    </PreviewFeature>
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
          <Mail className="h-6 w-6" style={{ color: DARK_GREEN }} aria-hidden="true" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">
            Connect your Outlook mailbox
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Connect your Outlook mailbox so client emails appear in Triage and can
            be attached to projects. We read your mail; we never send from your
            account.
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
            Read your mail
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
  const lastSyncRelative = connection.lastSyncAt
    ? `${formatDistanceToNow(new Date(connection.lastSyncAt))} ago`
    : "never"

  return (
    <Card className="rounded-xl border-0 shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: DEEP_GREEN }}
              aria-hidden="true"
            />
            <div>
              <p className="text-base font-semibold text-foreground">
                {connection.mailbox}
              </p>
              <p className="text-xs text-muted-foreground">
                Connected on {connectedDate}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>

        <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-3">
          <Stat label="Emails synced" value={connection.emailsSynced.toLocaleString()} icon={Mail} />
          <Stat label="Last sync" value={lastSyncRelative} icon={RefreshCw} />
          <Stat
            label="Calendar events synced"
            value={connection.calendarEventsSynced.toLocaleString()}
            icon={Calendar}
          />
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

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Mail
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0" style={{ color: MID_GREEN }} aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function FirmCoverageSection({
  connectedCount,
  total,
}: {
  connectedCount: number
  total: number
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Firm coverage</h2>
        <p className="text-sm text-muted-foreground">
          {connectedCount} of {total} team members connected. Triage only covers
          mailboxes that are connected.
        </p>
      </div>
      <Card className="rounded-xl border-0 shadow-sm">
        <CardContent className="divide-y p-0">
          {MOCK_TEAM_COVERAGE.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-4 py-3"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback
                  className="text-xs font-medium text-white"
                  style={{ backgroundColor: member.mailbox ? DEEP_GREEN : MID_GREEN }}
                >
                  {initials(member.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.fullName}
                </p>
                {member.mailbox ? (
                  <p className="truncate text-xs text-muted-foreground">{member.mailbox}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Not connected</p>
                )}
              </div>
              {member.mailbox && (
                <CheckCircle2
                  className="h-4 w-4 shrink-0"
                  style={{ color: DEEP_GREEN }}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
}
