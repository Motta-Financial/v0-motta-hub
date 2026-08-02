"use client"

import useSWR from "swr"
import { useSearchParams } from "next/navigation"
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Plug,
  Unplug,
  Clock,
  Webhook,
  Building2,
  Users,
  FileText,
  UserCircle,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { useEffect } from "react"
import { toast } from "sonner"

type WebhookEvent = {
  id: string
  received_at: string
  event_type: string
  entity_id: string
  operation: string | null
  processing_status: string | null
  processing_error: string | null
}

type Phase1Status = {
  status: "ok" | "blocked" | "inactive"
  snapshotCount: number
  lastSuccessfulExport: string | null
  exportFailures7d: number
  lastExportError: string | null
  lastExportErrorAt: string | null
}

type ProconnectStatus = {
  phase1?: Phase1Status
  connected: boolean
  realmId: string | null
  scope: string | null
  tokenType: string | null
  accessExpiresAt: string | null
  accessExpired: boolean
  lastTokenRefresh: string | null
  connectedSince: string | null
  connectedBy: { name: string | null } | null
  reconnectRequired: boolean
  lastRefreshError: string | null
  lastClientSync: string | null
  lastEngagementSync: string | null
  clientCount: number
  engagementCount: number
  recentWebhooks: WebhookEvent[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function timeAgo(iso: string | null): string {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return `${d}d ago`
}

function formatExact(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function ProconnectConnectionCard() {
  const searchParams = useSearchParams()
  const { data, error, isLoading, mutate } = useSWR<ProconnectStatus>(
    "/api/tax/proconnect-status",
    fetcher,
    { refreshInterval: 30_000 }
  )

  // Surface ?connected / ?disconnected / ?error toasts from OAuth callback
  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      toast.success("Connected to ProConnect Tax")
    }
    if (searchParams.get("disconnected") === "1") {
      toast.success("Disconnected from ProConnect Tax")
    }
    const err = searchParams.get("error")
    if (err) {
      toast.error(`ProConnect error: ${err}`)
    }
  }, [searchParams])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="size-5" />
            Connection check failed
          </CardTitle>
          <CardDescription>
            Could not load ProConnect status. {error?.message}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const { connected, accessExpired, reconnectRequired } = data

  // ─── Status pill ───
  const statusBadge = !connected ? (
    <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground gap-1">
      <Unplug className="size-3" />
      Not connected
    </Badge>
  ) : reconnectRequired ? (
    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive gap-1">
      <AlertTriangle className="size-3" />
      Reconnect required
    </Badge>
  ) : accessExpired ? (
    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1">
      <AlertTriangle className="size-3" />
      Token expired
    </Badge>
  ) : (
    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1">
      <CheckCircle2 className="size-3" />
      Connected
    </Badge>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-5 text-primary" />
            ProConnect Tax connection
          </CardTitle>
          <CardDescription>
            OAuth status, last sync, and recent webhook activity for the Intuit
            Developer app powering <code className="rounded bg-muted px-1 py-0.5 text-xs">/tax/*</code>.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusBadge}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => mutate()}
            aria-label="Refresh status"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ─── Primary actions ─── */}
        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <Button asChild>
              <a href="/api/proconnect/oauth/connect">
                <Plug className="mr-2 size-4" />
                Connect ProConnect Tax
              </a>
            </Button>
          ) : (
            <>
              <Button asChild variant="outline">
                <a href="/api/proconnect/oauth/connect">
                  <RefreshCw className="mr-2 size-4" />
                  Reconnect / re-consent
                </a>
              </Button>
              <Button asChild variant="outline" className="text-destructive hover:text-destructive">
                <a
                  href="/api/proconnect/oauth/disconnect"
                  onClick={(e) => {
                    if (!confirm("Disconnect ProConnect? Tokens will be revoked and tax syncs will stop until you reconnect.")) {
                      e.preventDefault()
                    }
                  }}
                >
                  <Unplug className="mr-2 size-4" />
                  Disconnect
                </a>
              </Button>
            </>
          )}
        </div>

        {/* ─── Production-only / admin-only note ─── */}
        <p className="text-xs italic text-muted-foreground">
          Production-only integration. Only the firm&apos;s Primary Admin can connect.
        </p>

        {/* ─── Refresh failure banner ─── */}
        {reconnectRequired && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Token refresh failed — reconnect required.</p>
              {data.lastRefreshError && (
                <p className="text-xs opacity-90">{data.lastRefreshError}</p>
              )}
            </div>
          </div>
        )}

        {/* ─── Connection metadata grid ─── */}
        {connected && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <MetaRow
                icon={<Building2 className="size-4" />}
                label="Realm ID"
                value={data.realmId ?? "—"}
                mono
              />
              <MetaRow
                icon={<Clock className="size-4" />}
                label="Connected since"
                value={formatExact(data.connectedSince)}
                hint={timeAgo(data.connectedSince)}
              />
              <MetaRow
                icon={<UserCircle className="size-4" />}
                label="Connected by"
                value={data.connectedBy?.name ?? "—"}
              />
              <MetaRow
                icon={<RefreshCw className="size-4" />}
                label="Last token refresh"
                value={formatExact(data.lastTokenRefresh)}
                hint={timeAgo(data.lastTokenRefresh)}
              />
              <MetaRow
                icon={<Clock className="size-4" />}
                label="Access token expires"
                value={formatExact(data.accessExpiresAt)}
                hint={accessExpired ? "expired" : timeAgo(data.accessExpiresAt)}
                tone={accessExpired ? "warn" : undefined}
              />
              <MetaRow
                icon={<Users className="size-4" />}
                label="Clients synced"
                value={data.clientCount.toLocaleString()}
                hint={data.lastClientSync ? `last ${timeAgo(data.lastClientSync)}` : undefined}
              />
              <MetaRow
                icon={<FileText className="size-4" />}
                label="Engagements synced"
                value={data.engagementCount.toLocaleString()}
                hint={data.lastEngagementSync ? `last ${timeAgo(data.lastEngagementSync)}` : undefined}
              />
            </div>

            {data.scope && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Scopes:</span>{" "}
                <code className="rounded bg-muted px-1 py-0.5">{data.scope}</code>
              </div>
            )}

            <Separator />

            {/* ─── Phase 1 return-data export health ─── */}
            {data.phase1 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="size-4 text-muted-foreground" />
                  Return data (Phase 1 export/import)
                  {data.phase1.status === "ok" ? (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1">
                      <CheckCircle2 className="size-3" />
                      Exports working
                    </Badge>
                  ) : data.phase1.status === "blocked" ? (
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive gap-1">
                      <AlertTriangle className="size-3" />
                      Blocked by Intuit
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground gap-1">
                      No activity
                    </Badge>
                  )}
                </div>
                {data.phase1.status === "blocked" ? (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">
                        Return-data exports are being rejected by Intuit
                        ({data.phase1.exportFailures7d} failures in the last 7 days).
                      </p>
                      <p className="text-xs opacity-90">
                        The token has the <code>taxreturns</code> scope, so this usually
                        means the app is not yet allow-listed for the Phase 1 data
                        endpoints. Contact the Intuit ProConnect API partner team, then
                        Reconnect / re-consent above.
                      </p>
                      {data.phase1.lastExportError && (
                        <p className="text-xs opacity-75">
                          Last error {timeAgo(data.phase1.lastExportErrorAt)}: {data.phase1.lastExportError}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {data.phase1.snapshotCount.toLocaleString()} return snapshot
                    {data.phase1.snapshotCount === 1 ? "" : "s"} stored
                    {data.phase1.lastSuccessfulExport
                      ? ` · last export ${timeAgo(data.phase1.lastSuccessfulExport)}`
                      : " · no exports yet — snapshots populate as TaxReturn webhooks arrive"}
                  </p>
                )}
              </div>
            )}

            <Separator />

            {/* ─── Recent webhooks ─── */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Webhook className="size-4 text-muted-foreground" />
                Recent webhook events
              </div>
              {data.recentWebhooks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No webhooks received yet. Make a change in ProConnect (e.g.
                  edit a client) and an event will appear here within seconds.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.recentWebhooks.map((ev) => {
                    const failed =
                      ev.processing_status === "failed" ||
                      ev.processing_status === "error"
                    return (
                      <li key={ev.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <WebhookStatusDot
                              status={ev.processing_status}
                              error={ev.processing_error}
                            />
                            <span className="font-medium">{ev.event_type}</span>
                            {ev.operation && (
                              <Badge variant="secondary" className="text-xs">
                                {ev.operation}
                              </Badge>
                            )}
                            <code className="truncate text-xs text-muted-foreground">
                              {ev.entity_id}
                            </code>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {timeAgo(ev.received_at)}
                          </span>
                        </div>
                        {failed && ev.processing_error && (
                          <p className="mt-1 pl-4 text-xs text-destructive">
                            {ev.processing_error}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {!connected && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No active ProConnect connection.</p>
            <p className="mt-1">
              Click <span className="font-medium">Connect ProConnect Tax</span>{" "}
              above to launch the Intuit OAuth consent screen. Once authorized,
              client and return data will sync nightly at 06:00 UTC and live
              webhooks will deliver updates in real time.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Helpers ───

function MetaRow({
  icon,
  label,
  value,
  hint,
  mono,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  mono?: boolean
  tone?: "warn"
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={
          (mono ? "font-mono text-sm " : "text-sm ") +
          (tone === "warn" ? "text-amber-700 dark:text-amber-400" : "")
        }
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function WebhookStatusDot({
  status,
  error,
}: {
  status: string | null
  error?: string | null
}) {
  const isOk = status === "processed" || status === "success"
  const isSkipped = status === "skipped"
  const isFail = status === "error" || status === "failed"

  // Both processed and skipped read as healthy green — skipped is drawn as a
  // hollow (ringed) dot so it's distinguishable on close inspection without
  // looking like a problem. Only genuine failures are red.
  const color = isFail
    ? "bg-destructive"
    : isSkipped
      ? "bg-transparent ring-1 ring-inset ring-emerald-500"
      : isOk
        ? "bg-emerald-500"
        : "bg-muted-foreground/40"

  const label = isFail
    ? `Failed: ${error ?? "unknown error"}`
    : isSkipped
      ? `Skipped: ${error ?? "not applied"}`
      : isOk
        ? "Processed successfully"
        : status ?? "pending"

  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${color}`}
      title={label}
      aria-label={label}
    />
  )
}
