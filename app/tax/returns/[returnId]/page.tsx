"use client"

/**
 * Return-data viewer — /tax/returns/[returnId]?clientId=...
 *
 * Browser over the Phase 1 export snapshot for one return: engagement
 * context, snapshot metadata (version / e-file items / series versions),
 * and the flattened field cells grouped by series. A "Refresh from
 * ProConnect" button forces a fresh export via
 * POST /api/proconnect/returns/[returnId]/data.
 *
 * Each cell row opens `FieldEditSheet` for a single-field write —
 * dryRun, then an explicit confirm, then a commit whose success is
 * judged on the server's post-write verification and never on Intuit's
 * own summary counts. See the sheet for why.
 *
 * The 403 empty-state is still rendered, but it no longer means "Intuit
 * has us blocked" — that was a wrong URL, resolved 2026-07-27 (Export)
 * and 2026-08-07 (Import). A 403 here now means a genuine scope or
 * ownership problem, and the messaging matches the /tax/settings card.
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
  Lock,
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

/**
 * Post-e-file edit lock — lib/proconnect/efile-lock.LockDecision.
 *
 * Cosmetic here. The API serves an advisory verdict computed from cached
 * filings; the import route re-derives it live and is what actually refuses
 * a write. Never treat a `locked: false` from this page as permission.
 */
type LockDecision = {
  locked: boolean
  code: string
  reason: string
  failedClosed: boolean
  filing: {
    filingType?: string | null
    filingLevel?: string | null
    jurisdiction?: string | null
    statusUpdateTimestamp?: string | null
    confirmationNumber?: string | null
  } | null
}

type ReturnDetail = {
  returnId: string
  engagement: Record<string, unknown> | null
  lock: LockDecision | null
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

/**
 * Why this return cannot be edited. Shown once, at the top of the field
 * table, rather than as a tooltip on each of ~5,000 disabled pencils.
 */
function LockBanner({ lock }: { lock: LockDecision }) {
  const f = lock.filing
  const scope = f
    ? [
        f.filingLevel === "flState" ? f.jurisdiction || "state" : "federal",
        (f.filingType || "").toLowerCase(),
      ]
        .filter(Boolean)
        .join(" ")
    : null

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
      <Lock className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">
          {lock.failedClosed ? "Editing is locked pending review" : "This return has been filed"}
        </p>
        <p className="text-xs opacity-90">
          {lock.reason}
          {scope ? ` (${scope})` : ""}
          {f?.confirmationNumber ? ` · confirmation ${f.confirmationNumber}` : ""}
        </p>
      </div>
    </div>
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
  // Cosmetic gate. The server refuses a locked write regardless of what this
  // says; the point of hiding the pencil is that a preparer shouldn't have
  // to be told no after typing. Defaults to locked while the verdict is
  // still loading, so the control never flashes enabled on a filed return.
  const locked = data?.lock ? data.lock.locked : true

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
                {locked && data.lock && <LockBanner lock={data.lock} />}
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
                                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                                    {c.prefix_id}/{c.code_id}/{c.suffix_id}
                                  </td>
                                  <td className="max-w-56 truncate px-3 py-1.5">{c.val ?? "—"}</td>
                                  <td className="max-w-64 truncate px-3 py-1.5 text-muted-foreground">
                                    {c.description ?? "—"}
                                  </td>
                                  <td className="px-3 py-1.5">{c.tsj ?? "—"}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{c.src ?? "—"}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    {clientId && !locked && (
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
