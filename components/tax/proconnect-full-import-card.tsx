"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  Database,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Play,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"

// Status snapshot returned by /api/proconnect/sync (GET)
type SyncStatus = {
  ok: boolean
  sync: {
    lastSync: {
      id: string
      status: string
      startedAt: string
      completedAt: string | null
      clientsSynced: number
      engagementsSynced: number
      customStatusesSynced: number
      errorMessage: string | null
    } | null
    consecutiveFailures: number
    totals: {
      clients: number
      engagements: number
    }
  }
  oauth: {
    hasToken: boolean
    isExpired: boolean
    needsRefresh: boolean
  }
}

// Result returned by /api/proconnect/sync (POST)
type SyncRunResult = {
  ok: boolean
  syncLogId?: string
  clientsSynced?: number
  engagementsSynced?: number
  customStatusesSynced?: number
  totalClients?: number
  errorCount?: number
  errors?: string[]
  duration?: string
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function timeAgo(iso: string | null | undefined): string {
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

function formatExact(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function ProconnectFullImportCard() {
  const { data, error, isLoading, mutate } = useSWR<SyncStatus>(
    "/api/proconnect/sync",
    fetcher,
    { refreshInterval: 15_000 }
  )

  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<SyncRunResult | null>(null)

  const lastSync = data?.sync?.lastSync ?? null
  const consecutiveFailures = data?.sync?.consecutiveFailures ?? 0
  const totals = data?.sync?.totals ?? { clients: 0, engagements: 0 }
  const oauthOk = data?.oauth?.hasToken && !data?.oauth?.isExpired

  async function runImport() {
    setRunning(true)
    setLastResult(null)
    const toastId = toast.loading(
      "Running full ProConnect import — this may take 2–5 minutes...",
      { duration: Infinity }
    )

    try {
      const res = await fetch("/api/proconnect/sync", { method: "POST" })
      const json: SyncRunResult = await res.json()
      setLastResult(json)

      if (!res.ok || !json.ok) {
        toast.error(`Import failed: ${json.error ?? "unknown error"}`, {
          id: toastId,
          duration: 8000,
        })
      } else {
        toast.success(
          `Imported ${json.clientsSynced ?? 0} clients, ${json.engagementsSynced ?? 0} engagements, ${json.customStatusesSynced ?? 0} statuses in ${json.duration ?? "?"}`,
          { id: toastId, duration: 8000 }
        )
      }
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`, {
        id: toastId,
        duration: 8000,
      })
      setLastResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
      mutate()
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error || !data?.ok) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="size-5" />
            Could not load import status
          </CardTitle>
          <CardDescription>
            {error?.message ?? "API returned an error response."}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // Status pill for the most recent run
  const lastStatusBadge = !lastSync ? (
    <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground gap-1">
      <Clock className="size-3" /> Never run
    </Badge>
  ) : lastSync.status === "completed" ? (
    <Badge
      variant="outline"
      className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1"
    >
      <CheckCircle2 className="size-3" /> Last: completed
    </Badge>
  ) : lastSync.status === "running" ? (
    <Badge
      variant="outline"
      className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1"
    >
      <Loader2 className="size-3 animate-spin" /> Running
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-destructive/40 bg-destructive/10 text-destructive gap-1"
    >
      <AlertTriangle className="size-3" /> Last: {lastSync.status}
    </Badge>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-primary" />
            One-time full import
          </CardTitle>
          <CardDescription>
            Pull every client, every engagement (TY 2021–2026), and every custom
            status from ProConnect into the Hub. Use this once after connecting,
            then let the nightly cron handle ongoing changes.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lastStatusBadge}
          <Button size="icon" variant="ghost" onClick={() => mutate()} aria-label="Refresh">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ─── Action ─── */}
        <div className="flex flex-wrap items-center gap-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!oauthOk || running}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Importing...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 size-4" /> Run full import
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Run full ProConnect import?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will fetch every client and every engagement for tax years
                  2021–2026 from ProConnect and upsert them into Supabase. Existing
                  rows are updated, not duplicated. Expect 2–5 minutes of runtime.
                  Webhook updates and the nightly cron will continue to work
                  during and after the import.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={runImport}>
                  Start import
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {!oauthOk && (
            <span className="text-xs text-muted-foreground">
              Connect ProConnect first (above) to enable this button.
            </span>
          )}

          {consecutiveFailures > 0 && (
            <Badge
              variant="outline"
              className="border-destructive/40 bg-destructive/10 text-destructive gap-1"
            >
              <AlertTriangle className="size-3" />
              {consecutiveFailures} consecutive failure{consecutiveFailures === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        <Separator />

        {/* ─── Current totals in DB ─── */}
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Clients in Hub" value={totals.clients.toLocaleString()} />
          <Stat label="Engagements in Hub" value={totals.engagements.toLocaleString()} />
        </div>

        {/* ─── Last run details ─── */}
        {lastSync && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-sm font-medium">Most recent run</div>
              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Started" value={formatExact(lastSync.startedAt)} hint={timeAgo(lastSync.startedAt)} />
                <Meta
                  label="Completed"
                  value={formatExact(lastSync.completedAt)}
                  hint={lastSync.completedAt ? timeAgo(lastSync.completedAt) : "in progress"}
                />
                <Meta label="Status" value={lastSync.status} />
                <Meta label="Clients synced" value={lastSync.clientsSynced.toLocaleString()} />
                <Meta label="Engagements synced" value={lastSync.engagementsSynced.toLocaleString()} />
                <Meta label="Custom statuses synced" value={lastSync.customStatusesSynced.toLocaleString()} />
              </div>
              {lastSync.errorMessage && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <span className="font-medium">Error:</span> {lastSync.errorMessage}
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── Result of just-finished run ─── */}
        {lastResult && lastResult.ok && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            <div className="font-medium">Import complete</div>
            <div className="mt-1 text-xs">
              {lastResult.clientsSynced ?? 0} clients,{" "}
              {lastResult.engagementsSynced ?? 0} engagements,{" "}
              {lastResult.customStatusesSynced ?? 0} statuses in{" "}
              {lastResult.duration ?? "?"}.
              {(lastResult.errorCount ?? 0) > 0 &&
                ` ${lastResult.errorCount} per-row errors (see Most recent run).`}
            </div>
          </div>
        )}
        {lastResult && !lastResult.ok && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <div className="font-medium">Import failed</div>
            <div className="mt-1 text-xs">{lastResult.error ?? "Unknown error"}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Meta({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
      {hint && <div className="text-muted-foreground">{hint}</div>}
    </div>
  )
}
