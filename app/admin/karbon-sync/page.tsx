"use client"

import { useEffect, useState, useCallback } from "react"
import useSWR from "swr"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  RefreshCw,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Power,
  PowerOff,
  Webhook,
  Zap,
  RotateCcw,
} from "lucide-react"
import { useKarbonRealtime } from "@/hooks/use-karbon-realtime"
import { formatDistanceToNow } from "date-fns"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Subscription {
  id: string
  webhook_type: string
  target_url: string
  status: string
  failure_count: number
  last_event_at: string | null
  subscribed_at: string
  karbon_subscription_id: string | null
}

interface WebhookEvent {
  id: string
  resource_type: string
  action_type: string
  resource_perma_key: string
  status: string
  retry_count: number
  error_message: string | null
  event_timestamp: string
  created_at: string
  processed_at: string | null
}

export default function KarbonSyncAdminPage() {
  // Subscriptions + recent events from the receiver's GET handler.
  const { data: webhookData, mutate: mutateWebhooks, isLoading: webhooksLoading } = useSWR<{
    subscriptions: Subscription[]
    recent_events: WebhookEvent[]
  }>("/api/karbon/webhooks", fetcher, { refreshInterval: 30_000 })

  // Sync log + watchdog summary from the cron's GET handler.
  const { data: syncData, mutate: mutateSync } = useSWR<{
    recent: any[]
    summary: { ok: boolean; reasons: string[] }
  }>("/api/cron/karbon-sync", fetcher, { refreshInterval: 30_000 })

  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)

  // Live updates: when webhook events land, refresh the lists immediately.
  useKarbonRealtime({
    table: "karbon_webhook_events",
    event: "*",
    onChange: () => mutateWebhooks(),
  })
  useKarbonRealtime({
    table: "karbon_webhook_subscriptions",
    event: "*",
    onChange: () => mutateWebhooks(),
  })

  const showFlash = useCallback((kind: "ok" | "err", msg: string) => {
    setFlash({ kind, msg })
    setTimeout(() => setFlash(null), 6000)
  }, [])

  const subscribeAll = async () => {
    setBusy("subscribe")
    try {
      const res = await fetch("/api/karbon/webhooks/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Subscription failed")
      showFlash("ok", `Subscribed ${json.subscribed?.length || 0} webhook types.`)
      mutateWebhooks()
    } catch (e: any) {
      showFlash("err", e.message)
    } finally {
      setBusy(null)
    }
  }

  const unsubscribeAll = async () => {
    if (!confirm("Cancel ALL Karbon webhook subscriptions? Live sync will stop until you re-subscribe.")) {
      return
    }
    setBusy("unsubscribe")
    try {
      const res = await fetch("/api/karbon/webhooks/subscriptions?all=true", { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Unsubscribe failed")
      showFlash("ok", `Cancelled ${json.deleted?.length || 0} subscriptions.`)
      mutateWebhooks()
    } catch (e: any) {
      showFlash("err", e.message)
    } finally {
      setBusy(null)
    }
  }

  const runWatchdog = async () => {
    setBusy("watchdog")
    try {
      const res = await fetch("/api/cron/karbon-sync", { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Watchdog failed")
      const replayed = json.replayed?.replayed ?? 0
      const drift = json.drift?.drift_count ?? 0
      showFlash("ok", `Watchdog OK — replayed ${replayed} stuck events, ${drift} entities drifted.`)
      mutateSync()
      mutateWebhooks()
    } catch (e: any) {
      showFlash("err", e.message)
    } finally {
      setBusy(null)
    }
  }

  const retryFailed = async () => {
    setBusy("retry")
    try {
      const res = await fetch("/api/karbon/webhooks/events/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all_failed: true, max: 100 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Retry failed")
      showFlash("ok", `Replayed ${json.replayed} events: ${json.succeeded} succeeded, ${json.failed} failed.`)
      mutateWebhooks()
    } catch (e: any) {
      showFlash("err", e.message)
    } finally {
      setBusy(null)
    }
  }

  const subs = webhookData?.subscriptions ?? []
  const events = webhookData?.recent_events ?? []
  const activeSubs = subs.filter((s) => s.status === "active").length
  const failingSubs = subs.filter((s) => s.status === "failing" || s.failure_count > 0).length
  const failedEvents = events.filter((e) => e.status === "failed").length
  const pendingEvents = events.filter((e) => e.status === "pending" || e.status === "processing").length

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-balance">Karbon Live Sync</h1>
            <p className="text-sm text-muted-foreground">
              Webhook subscriptions, event log, and reconciliation watchdog.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={runWatchdog} disabled={!!busy} variant="outline" size="sm">
              <Activity className={`mr-2 h-4 w-4 ${busy === "watchdog" ? "animate-pulse" : ""}`} />
              Run watchdog now
            </Button>
            <Button onClick={subscribeAll} disabled={!!busy} size="sm">
              <Power className={`mr-2 h-4 w-4 ${busy === "subscribe" ? "animate-pulse" : ""}`} />
              Subscribe all
            </Button>
            <Button onClick={unsubscribeAll} disabled={!!busy} variant="destructive" size="sm">
              <PowerOff className="mr-2 h-4 w-4" />
              Unsubscribe all
            </Button>
          </div>
        </header>

        {flash ? (
          <Alert variant={flash.kind === "err" ? "destructive" : "default"}>
            {flash.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <AlertTitle>{flash.kind === "ok" ? "Done" : "Error"}</AlertTitle>
            <AlertDescription>{flash.msg}</AlertDescription>
          </Alert>
        ) : null}

        {syncData?.summary && !syncData.summary.ok ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Live sync needs attention</AlertTitle>
            <AlertDescription>
              <ul className="ml-4 list-disc text-sm">
                {syncData.summary.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Active subscriptions"
            value={activeSubs}
            sub={`${subs.length} total`}
            icon={<Webhook className="h-4 w-4" />}
            tone={activeSubs === 0 ? "warn" : "ok"}
          />
          <StatCard
            label="Failing subs"
            value={failingSubs}
            sub={failingSubs > 0 ? "needs re-subscribe" : "all healthy"}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={failingSubs > 0 ? "err" : "ok"}
          />
          <StatCard
            label="Pending events"
            value={pendingEvents}
            sub="last 25 events"
            icon={<Clock className="h-4 w-4" />}
            tone={pendingEvents > 5 ? "warn" : "ok"}
          />
          <StatCard
            label="Failed events"
            value={failedEvents}
            sub={
              failedEvents > 0 ? (
                <button onClick={retryFailed} className="underline">
                  retry now
                </button>
              ) : (
                "no failures"
              )
            }
            icon={<Zap className="h-4 w-4" />}
            tone={failedEvents > 0 ? "err" : "ok"}
          />
        </div>

        <Tabs defaultValue="subscriptions" className="w-full">
          <TabsList>
            <TabsTrigger value="subscriptions">Subscriptions ({subs.length})</TabsTrigger>
            <TabsTrigger value="events">Recent Events ({events.length})</TabsTrigger>
            <TabsTrigger value="syncs">Sync Log</TabsTrigger>
          </TabsList>

          <TabsContent value="subscriptions" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Webhook subscriptions</CardTitle>
                <CardDescription>
                  Karbon delivers a webhook to MOTTA HUB whenever one of these resource types changes. If a subscription
                  fails 10 times in a row, Karbon cancels it automatically — re-subscribe from the top of this page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {webhooksLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : subs.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No subscriptions yet. Click <strong>Subscribe all</strong> above to register the 8 webhook types in
                    Karbon.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {subs.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{s.webhook_type}</span>
                            <SubBadge status={s.status} failureCount={s.failure_count} />
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            target: {s.target_url}
                          </div>
                        </div>
                        <div className="flex flex-col items-end text-right text-xs text-muted-foreground">
                          <span>
                            last event:{" "}
                            {s.last_event_at
                              ? formatDistanceToNow(new Date(s.last_event_at), { addSuffix: true })
                              : "never"}
                          </span>
                          <span>since {formatDistanceToNow(new Date(s.subscribed_at), { addSuffix: true })}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Recent webhook events</CardTitle>
                  <CardDescription>Live stream — updates instantly via Supabase Realtime.</CardDescription>
                </div>
                <Button onClick={retryFailed} disabled={!!busy || failedEvents === 0} size="sm" variant="outline">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Retry failed
                </Button>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No events yet. Once subscriptions are active, edits made in Karbon will show up here within seconds.
                  </p>
                ) : (
                  <ul className="divide-y text-sm">
                    {events.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <EventStatusDot status={e.status} />
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.resource_type}</code>
                          <span className="text-muted-foreground">{e.action_type}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {e.resource_perma_key.slice(0, 8)}…
                          </span>
                          {e.retry_count > 0 ? (
                            <Badge variant="outline" className="text-[10px]">
                              retry {e.retry_count}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(e.event_timestamp), { addSuffix: true })}
                        </div>
                        {e.error_message ? (
                          <div className="w-full text-xs text-destructive font-mono break-all">{e.error_message}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="syncs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Background sync log</CardTitle>
                <CardDescription>
                  Hourly watchdog, drift reconciler, and any manually-triggered full syncs.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!syncData?.recent || syncData.recent.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No sync runs recorded yet.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {syncData.recent.map((r: any) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <SyncStatusDot status={r.status} />
                          <span className="font-medium">{r.sync_type}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.records_created != null ? `${r.records_created} ok` : null}
                            {r.records_failed > 0 ? ` · ${r.records_failed} failed` : null}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}

function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string
  value: number | string
  sub: React.ReactNode
  icon: React.ReactNode
  tone: "ok" | "warn" | "err"
}) {
  const toneClass =
    tone === "err"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : ""
  return (
    <Card className={toneClass}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  )
}

function SubBadge({ status, failureCount }: { status: string; failureCount: number }) {
  if (status === "active" && failureCount === 0) {
    return <Badge variant="outline" className="border-green-600/50 text-green-700">active</Badge>
  }
  if (status === "active" && failureCount > 0) {
    return <Badge variant="outline" className="border-amber-600/50 text-amber-700">degraded · {failureCount}</Badge>
  }
  if (status === "failing" || status === "cancelled") {
    return <Badge variant="destructive">{status}</Badge>
  }
  return <Badge variant="outline">{status}</Badge>
}

function EventStatusDot({ status }: { status: string }) {
  const color =
    status === "processed"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-destructive"
        : status === "processing"
          ? "bg-blue-500 animate-pulse"
          : "bg-muted-foreground/40"
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />
}

function SyncStatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-destructive"
        : status === "running"
          ? "bg-blue-500 animate-pulse"
          : "bg-muted-foreground/40"
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />
}
