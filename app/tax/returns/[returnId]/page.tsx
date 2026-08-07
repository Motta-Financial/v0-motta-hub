"use client"

/**
 * Return-data viewer — /tax/returns/[returnId]?clientId=...
 *
 * Read-only browser over the Phase 1 export snapshot for one return:
 * engagement context, snapshot metadata (version / e-file items /
 * series versions), and the flattened field cells grouped by series.
 * A "Refresh from ProConnect" button forces a fresh export via
 * POST /api/proconnect/returns/[returnId]/data.
 *
 * While Intuit has the Phase 1 data endpoints blocked (403
 * scope_missing) this page shows the blocked empty-state instead of
 * silently rendering nothing — same messaging as the /tax/settings
 * connection card.
 */

import { use, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  FileText,
  Pencil,
  RefreshCw,
  Table2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { FieldEditSheet, type EditTarget } from "@/components/tax/field-edit-sheet"
import { lookupFieldDescription } from "@/lib/proconnect/series-code-lookup"

type Cell = {
  series_id: string
  prefix_id: string
  code_id: string
  suffix_id: string
  val: string | null
  description: string | null
  src: string | null
  tsj: string | null
  scope: string | null
}

type ReturnDetail = {
  returnId: string
  engagement: Record<string, unknown> | null
  snapshot: {
    exported_at: string | null
    deleted_at: string | null
    version: string | null
    return_name: string | null
    client_name: string | null
    tax_year: number | null
    return_type: string | null
    efile_items: Array<{ efileId: string; included: boolean }>
    series_versions: Array<{ series: string; version: string }>
  } | null
  cellCount: number
  seriesCount: number
  cellsBySeries: Record<string, Cell[]>
}

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`)
  return r.json()
}

/** proconnect_engagements.efile_latest — see lib/proconnect/sync.EfileLatest. */
type EfileLatestRow = {
  status?: string | null
  userMessage?: string | null
  filingType?: string | null
  filingLevel?: string | null
  jurisdiction?: string | null
  statusUpdateTimestamp?: string | null
  errorCodes?: string[] | null
}

/**
 * E-file state for the header line.
 *
 * Shows Intuit's own `userMessage` ("Rejected") over the raw code
 * ("ACK_REJECTED") when we have it, and — this is the part that matters —
 * names the filing the status belongs to whenever it isn't the return's own
 * regular filing. A rejected EXTENSION rendered as a bare "Rejected" on a
 * 1120 row reads as a rejected return, which is a materially different fact
 * for the preparer looking at this page.
 */
function EfileSummary({
  status,
  latest,
}: {
  status: string | null
  latest: EfileLatestRow | null | undefined
}) {
  const code = latest?.status || status
  if (!code) return null

  const label = latest?.userMessage || code
  const isState = latest?.filingLevel === "flState"
  // Name the filing type whenever it isn't the plain return — EXTENSION and
  // AMENDED both appear in live data, and both change what the status means.
  const kind =
    latest?.filingType && latest.filingType !== "REGULAR"
      ? latest.filingType.toLowerCase()
      : null
  const scope = [isState ? latest?.jurisdiction || "state" : "federal", kind]
    .filter(Boolean)
    .join(" ")
  const codes = latest?.errorCodes?.length ? ` · ${latest.errorCodes.join(", ")}` : ""

  return (
    <span>
      E-file: {label}
      {latest ? ` (${scope})` : ""}
      {codes}
    </span>
  )
}

export default function ReturnDataPage({
  params,
}: {
  params: Promise<{ returnId: string }>
}) {
  const { returnId } = use(params)
  const searchParams = useSearchParams()
  const clientId = searchParams.get("clientId")
  const [refreshing, setRefreshing] = useState(false)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)

  const { data, error, isLoading, mutate } = useSWR<ReturnDetail>(
    `/api/proconnect/returns/${returnId}`,
    fetcher,
  )

  async function refreshFromProConnect() {
    if (!clientId) {
      toast.error("Missing clientId — open this page from the returns table")
      return
    }
    setRefreshing(true)
    try {
      const res = await fetch(`/api/proconnect/returns/${returnId}/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const kind = body?.error?.kind
        toast.error(
          kind === "scope_missing"
            ? "Export rejected by Intuit — the app is not yet allow-listed for the Phase 1 data endpoints."
            : `Export failed: ${kind ?? body?.error ?? res.status}`,
        )
      } else {
        toast.success("Snapshot refreshed from ProConnect")
        mutate()
      }
    } finally {
      setRefreshing(false)
    }
  }

  const eng = (data?.engagement ?? {}) as Record<string, string | number | null>
  const title =
    data?.snapshot?.return_name ??
    (eng.engagement_name as string) ??
    "Tax return"
  const clientName =
    data?.snapshot?.client_name ?? (eng.client_display_name as string) ?? null
  const is1040 = (data?.snapshot?.return_type ?? eng.return_type) === "IND"

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/tax">
            <ArrowLeft className="mr-1 size-4" />
            Back to Tax
          </Link>
        </Button>
        <div className="flex gap-2">
          {is1040 && clientId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/tax/returns/${returnId}/1040?clientId=${clientId}`}>
                <FileText className="mr-1 size-4" />
                Form 1040 view
              </Link>
            </Button>
          )}
          <Button size="sm" onClick={refreshFromProConnect} disabled={refreshing || !clientId}>
            <RefreshCw className={`mr-1 size-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh from ProConnect
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Return not found</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {title}
                {data?.snapshot?.return_type && (
                  <Badge variant="secondary">{data.snapshot.return_type}</Badge>
                )}
                {(data?.snapshot?.tax_year ?? eng.tax_year) != null && (
                  <Badge variant="outline">TY {data?.snapshot?.tax_year ?? eng.tax_year}</Badge>
                )}
                {data?.snapshot?.deleted_at && (
                  <Badge variant="outline" className="border-destructive/40 text-destructive">
                    Deleted in ProConnect
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {clientName && <span>{clientName}</span>}
                {typeof eng.preparer_name === "string" && eng.preparer_name && (
                  <span>Preparer: {eng.preparer_name}</span>
                )}
                {typeof eng.status === "string" && eng.status && <span>Status: {eng.status}</span>}
                <EfileSummary
                  status={typeof eng.efile_status === "string" ? eng.efile_status : null}
                  latest={eng.efile_latest as EfileLatestRow | null | undefined}
                />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.snapshot ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3.5" />
                    Snapshot exported {new Date(data.snapshot.exported_at!).toLocaleString()}
                  </span>
                  <span>{data.cellCount.toLocaleString()} field cells</span>
                  <span>{data.seriesCount} series</span>
                  {data.snapshot.version && (
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      v {data.snapshot.version.slice(0, 8)}…
                    </code>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">No snapshot yet.</p>
                    <p className="text-xs opacity-90">
                      Return field data has not been exported from ProConnect. If
                      &ldquo;Refresh from ProConnect&rdquo; fails with a scope error, exports are
                      still blocked pending Intuit allow-listing — see the Phase 1 status
                      on <Link className="underline" href="/tax/settings">/tax/settings</Link>.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {data && data.cellCount > 0 && (
            <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Table2 className="size-4 text-muted-foreground" />
                  Field data by series
                </CardTitle>
                <CardDescription>
                  Raw ProConnect series/prefix/code/suffix cells from the latest export.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(data.cellsBySeries).map(([seriesId, cells]) => {
                  // Find the version stamp for this series from the snapshot
                  const seriesVersion =
                    data.snapshot?.series_versions?.find((sv: { series: string; version: string }) => sv.series === seriesId)
                      ?.version ?? null

                  return (
                    <details key={seriesId} className="rounded-md border" open={data.seriesCount <= 3}>
                      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                        Series <code className="rounded bg-muted px-1">{seriesId}</code>{" "}
                        <span className="text-muted-foreground">({cells.length} cells)</span>
                      </summary>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-t bg-muted/50 text-left">
                              <th className="px-3 py-1.5 font-medium">Field</th>
                              <th className="px-3 py-1.5 font-medium">Value</th>
                              <th className="px-3 py-1.5 font-medium">Description</th>
                              <th className="px-3 py-1.5 font-medium">T/S/J</th>
                              <th className="px-3 py-1.5 font-medium">Source</th>
                              <th className="px-3 py-1.5" />
                            </tr>
                          </thead>
                          <tbody>
                            {cells.map((c, i) => {
                              // Determine which key the cell uses — prefer val, fall back to desc
                              const writeKey: "val" | "desc" = c.val !== null ? "val" : "desc"
                              const currentValue = c.val ?? c.description ?? null

                              return (
                                <tr key={i} className="border-t">
                                  <td className="px-3 py-1.5">
                                    {(() => {
                                      const entry = lookupFieldDescription(seriesId, c.code_id)
                                      return entry ? (
                                        <div>
                                          <span className="font-medium">{entry.description}</span>
                                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                                            {c.prefix_id}/{c.code_id}/{c.suffix_id}
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="font-mono text-muted-foreground">
                                          {c.prefix_id}/{c.code_id}/{c.suffix_id}
                                        </span>
                                      )
                                    })()}
                                  </td>
                                  <td className="max-w-56 truncate px-3 py-1.5">{c.val ?? "—"}</td>
                                  <td className="max-w-64 truncate px-3 py-1.5 text-muted-foreground">
                                    {c.description ?? "—"}
                                  </td>
                                  <td className="px-3 py-1.5">{c.tsj ?? "—"}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{c.src ?? "—"}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    {clientId && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-6"
                                        aria-label={`Edit ${c.prefix_id}/${c.code_id}/${c.suffix_id}`}
                                        onClick={() =>
                                          setEditTarget({
                                            returnId,
                                            clientId,
                                            seriesId,
                                            seriesVersion,
                                            prefixId: c.prefix_id,
                                            codeId: c.code_id,
                                            suffixId: c.suffix_id,
                                            writeKey,
                                            currentValue,
                                          })
                                        }
                                      >
                                        <Pencil className="size-4" />
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )
                })}
              </CardContent>
            </Card>

            <FieldEditSheet
              target={editTarget}
              open={editTarget !== null}
              onClose={() => setEditTarget(null)}
              onCommitSuccess={() => {
                setEditTarget(null)
                mutate()
              }}
            />
            </>
          )}
        </>
      )}
    </div>
  )
}
