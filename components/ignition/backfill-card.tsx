"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  AlertCircle,
  CheckCircle2,
  CloudDownload,
  Loader2,
  XCircle,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const RESOURCE_LABELS: Record<string, string> = {
  clients: "Clients",
  contacts: "Contacts",
  deal_stages: "Deal stages",
  deals: "Deals",
  services: "Services",
  proposals: "Proposals",
  invoices: "Invoices",
  payments: "Payments",
  collections: "Collections",
}

const RESOURCE_ORDER = [
  "clients",
  "contacts",
  "deal_stages",
  "deals",
  "services",
  "proposals",
  "invoices",
  "payments",
  "collections",
]

type ResourceResult = {
  resource: string
  fetched: number
  upserted: number
  pages: number
  durationMs: number
  errors: string[]
}

type SyncStatus = {
  connection: {
    lastSyncedAt: string | null
    lastSyncStartedAt: string | null
    lastSyncError: string | null
    isRunning: boolean
  } | null
  lastRun: {
    id: string
    status: string
    startedAt: string | null
    completedAt: string | null
    recordsFetched: number | null
    recordsUpserted: number | null
    recordsFailed: number | null
    // The route stuffs the full per-resource results into error_details
    // (a jsonb column) so we can render a breakdown without standing up
    // a new history table just for that.
    results: ResourceResult[] | null
  } | null
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "—"
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

/**
 * BackfillCard
 *
 * Renders the "Reporting API backfill" panel inside the Connection tab.
 * - Triggers POST /api/ignition/sync to run a full or per-resource backfill.
 * - Polls GET /api/ignition/sync for status; when a sync is in flight, the
 *   refresh interval drops to 3s so progress feels live.
 * - Per-resource results from the most recent run are rendered as a table
 *   so admins can see which endpoint contributed what to the totals.
 */
export function IgnitionBackfillCard() {
  const { toast } = useToast()
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(RESOURCE_ORDER))

  const { data, mutate, isLoading } = useSWR<SyncStatus>(
    "/api/ignition/sync",
    fetcher,
    {
      refreshInterval: (latest) =>
        latest?.connection?.isRunning || running ? 3000 : 30_000,
      revalidateOnFocus: true,
    },
  )

  const isRunning = running || data?.connection?.isRunning === true
  const lastRun = data?.lastRun
  const conn = data?.connection

  // Map per-resource results from the last run keyed by resource name for
  // quick lookup when rendering the table.
  const resultsByResource = useMemo<Record<string, ResourceResult>>(() => {
    const out: Record<string, ResourceResult> = {}
    for (const r of lastRun?.results ?? []) {
      out[r.resource] = r
    }
    return out
  }, [lastRun])

  function toggleResource(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(RESOURCE_ORDER))
  }
  function selectNone() {
    setSelected(new Set())
  }

  async function runBackfill() {
    if (selected.size === 0) {
      toast({
        title: "No resources selected",
        description: "Pick at least one resource to sync.",
        variant: "destructive",
      })
      return
    }
    setRunning(true)
    // Optimistically reflect the running state in the UI right away.
    mutate(
      (prev) =>
        prev
          ? {
              ...prev,
              connection: prev.connection
                ? {
                    ...prev.connection,
                    isRunning: true,
                    lastSyncStartedAt: new Date().toISOString(),
                  }
                : prev.connection,
            }
          : prev,
      { revalidate: false },
    )

    try {
      const body =
        selected.size === RESOURCE_ORDER.length
          ? {}
          : { resources: Array.from(selected) }
      const res = await fetch("/api/ignition/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.message || json?.error || `HTTP ${res.status}`)
      }
      const summary = json.summary
      toast({
        title: "Backfill complete",
        description: `Fetched ${summary.totalFetched}, upserted ${summary.totalUpserted}${
          summary.totalErrors > 0 ? `, ${summary.totalErrors} error(s)` : ""
        }.`,
      })
    } catch (err: any) {
      toast({
        title: "Backfill failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      })
    } finally {
      setRunning(false)
      mutate()
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CloudDownload className="h-4 w-4" />
              Reporting API backfill
            </CardTitle>
            <CardDescription>
              Pull data directly from Ignition&apos;s Reporting API into the hub
              database. Idempotent — running it again only refreshes changed
              rows.
            </CardDescription>
          </div>
          <StatusBadge status={lastRun?.status} isRunning={isRunning} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Resource selector */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Resources
            </span>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                className="text-stone-600 underline-offset-2 hover:underline"
                onClick={selectAll}
                disabled={isRunning}
              >
                Select all
              </button>
              <span className="text-stone-300">|</span>
              <button
                type="button"
                className="text-stone-600 underline-offset-2 hover:underline"
                onClick={selectNone}
                disabled={isRunning}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-3">
            {RESOURCE_ORDER.map((r) => {
              const checked = selected.has(r)
              return (
                <label
                  key={r}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                    checked
                      ? "border-stone-300 bg-stone-50 text-stone-900"
                      : "border-stone-200 bg-white text-stone-600 hover:border-stone-300"
                  } ${isRunning ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-stone-700"
                    checked={checked}
                    onChange={() => toggleResource(r)}
                    disabled={isRunning}
                  />
                  <span className="flex-1">{RESOURCE_LABELS[r] || r}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Action row */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="space-y-0.5 text-xs text-stone-600">
            <div>
              <span className="font-medium text-stone-700">Last sync:</span>{" "}
              {formatDateTime(conn?.lastSyncedAt)}
            </div>
            {conn?.lastSyncError ? (
              <div className="text-rose-700">
                <span className="font-medium">Last error:</span>{" "}
                {conn.lastSyncError}
              </div>
            ) : null}
          </div>
          <Button onClick={runBackfill} disabled={isRunning || isLoading}>
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <CloudDownload className="mr-2 h-4 w-4" />
                Run backfill
              </>
            )}
          </Button>
        </div>

        {/* Per-resource results table */}
        {lastRun?.results && lastRun.results.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-stone-200">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Resource</th>
                  <th className="px-3 py-2 text-right font-medium">Fetched</th>
                  <th className="px-3 py-2 text-right font-medium">Upserted</th>
                  <th className="px-3 py-2 text-right font-medium">Pages</th>
                  <th className="px-3 py-2 text-right font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {RESOURCE_ORDER.map((resource) => {
                  const r = resultsByResource[resource]
                  if (!r) return null
                  const hasErrors = r.errors.length > 0
                  return (
                    <tr key={resource} className="border-t border-stone-200">
                      <td className="px-3 py-2 font-medium text-stone-800">
                        {RESOURCE_LABELS[resource] || resource}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.fetched}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.upserted}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-500">{r.pages}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-500">
                        {formatDuration(r.durationMs)}
                      </td>
                      <td className="px-3 py-2">
                        {hasErrors ? (
                          <span
                            title={r.errors.join("; ")}
                            className="inline-flex items-center gap-1 text-rose-700"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {r.errors.length} error{r.errors.length === 1 ? "" : "s"}
                          </span>
                        ) : r.fetched === 0 ? (
                          <span className="inline-flex items-center gap-1 text-stone-500">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Empty
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-stone-50 text-stone-700">
                <tr>
                  <td className="px-3 py-2 text-xs font-medium uppercase tracking-wide">
                    Run total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {lastRun.recordsFetched ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {lastRun.recordsUpserted ?? 0}
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-right text-xs text-stone-500">
                    {formatDateTime(lastRun.completedAt) }
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-500">
                    {(lastRun.recordsFailed ?? 0) > 0
                      ? `${lastRun.recordsFailed} error(s)`
                      : "No errors"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
            No backfill has been run yet. Pick the resources to sync and click{" "}
            <span className="font-medium text-stone-700">Run backfill</span>.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({
  status,
  isRunning,
}: {
  status: string | undefined
  isRunning: boolean
}) {
  if (isRunning) {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Syncing
      </Badge>
    )
  }
  if (status === "success") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Healthy
      </Badge>
    )
  }
  if (status === "partial") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
        <AlertCircle className="mr-1 h-3 w-3" />
        Partial
      </Badge>
    )
  }
  if (status === "running") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Syncing
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600">
      Not run yet
    </Badge>
  )
}
