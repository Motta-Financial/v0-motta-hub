"use client"

/**
 * RelationshipsClient — the /tax/relationships review queue.
 *
 * Lists every relationship surfaced by the scanner with its score and
 * supporting signals, and lets reviewers Confirm / Reject / open the
 * pair in the client view. Confirmed and rejected rows are also
 * browsable via the status filter so the queue doubles as an audit
 * trail.
 *
 * Design intent (mobile-first):
 *   - Header strip: title + scan trigger (admin-only feel) + filter
 *     chips for status and relationship type.
 *   - Mainline: a single table with a generous "Evidence" column that
 *     summarizes the supporting signal sources. We deliberately avoid
 *     a side panel because reviewers tend to triage in batches and
 *     need to see many rows at once.
 */

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Network, RefreshCw, Check, X, ExternalLink, Search as SearchIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type RelationshipRow = {
  id: string
  status: "needs_review" | "confirmed" | "rejected"
  confidence: number
  relationship_type: string
  direction: string
  individual_proconnect_client_id: string
  business_proconnect_client_id: string
  individual_display_name: string | null
  business_display_name: string | null
  individual_tax_id_last4: string | null
  business_tax_id_last4: string | null
  source_engagement_id: string | null
  notes: string | null
  signal_count: number
  signal_sources: string[] | null
  signal_kinds: string[] | null
  updated_at: string
}

const fetcher = async (url: string): Promise<{ relationships: RelationshipRow[] }> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const STATUS_TABS: Array<{ value: "needs_review" | "confirmed" | "rejected" | "all"; label: string }> = [
  { value: "needs_review", label: "Needs review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
]

function formatRelType(value: string): string {
  switch (value) {
    case "k1_issuer":
      return "K-1 issuer"
    case "schedule_c_owner":
      return "Schedule C"
    case "owner":
      return "Owner"
    case "officer":
      return "Officer"
    case "related":
      return "Related"
    default:
      return value
  }
}

function formatSignalSource(value: string): string {
  switch (value) {
    case "schedule_e":
      return "Sch E"
    case "schedule_c":
      return "Sch C"
    case "k1":
      return "K-1"
    case "business_owners":
      return "Business owners"
    case "hub_contact_organizations":
      return "Hub link"
    case "hub_organization_officers":
      return "Hub officers"
    case "hub_organization_shareholders":
      return "Hub shareholders"
    case "legacy_id":
      return "Legacy ID"
    case "manual":
      return "Manual"
    default:
      return value
  }
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const tone =
    confidence >= 0.85
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : confidence >= 0.65
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : "bg-rose-100 text-rose-900 border-rose-200"
  return (
    <Badge variant="outline" className={tone}>
      {(confidence * 100).toFixed(0)}%
    </Badge>
  )
}

export function RelationshipsClient() {
  const [status, setStatus] = useState<"needs_review" | "confirmed" | "rejected" | "all">(
    "needs_review",
  )
  const [search, setSearch] = useState("")
  const [scanning, setScanning] = useState(false)
  const [scanReport, setScanReport] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const url = `/api/tax/relationships?status=${status}&limit=300`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
  })

  const filtered = useMemo(() => {
    const rows = data?.relationships ?? []
    if (!search.trim()) return rows
    const needle = search.toLowerCase()
    return rows.filter((r) =>
      [
        r.individual_display_name,
        r.business_display_name,
        r.relationship_type,
        ...(r.signal_sources ?? []),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    )
  }, [data, search])

  async function runScan() {
    setScanning(true)
    setScanReport(null)
    try {
      const res = await fetch("/api/tax/relationships/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "scan failed")
      const r = json.report
      setScanReport(
        `Scanned ${r.signals_emitted} signals → ${r.groups_scored} groups (${r.relationships_inserted} new, ${r.auto_confirmed} auto-confirmed, ${r.needs_review} for review)${
          r.empty_phase1 ? " — Phase 1 cells empty, hub-only" : ""
        }`,
      )
      await mutate()
    } catch (err) {
      setScanReport(err instanceof Error ? err.message : "scan failed")
    } finally {
      setScanning(false)
    }
  }

  async function review(id: string, action: "confirm" | "reject") {
    setBusyId(id)
    try {
      const res = await fetch("/api/tax/relationships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? "review failed")
      }
      await mutate()
    } catch (err) {
      console.error("[v0] review failed", err)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold leading-tight text-foreground text-balance">
              Tax client relationships
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Surfaces K-1 issuers, owners, officers, and other links discovered
              from ProConnect returns and the hub graph. Auto-confirms strong
              identifier matches; ambiguous evidence lands here for review.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search names, sources..."
              className="w-64 pl-9"
            />
          </div>
          <Button onClick={runScan} disabled={scanning} variant="default">
            <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning..." : "Run scan"}
          </Button>
        </div>
      </header>

      {scanReport ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-muted-foreground">
          {scanReport}
        </div>
      ) : null}

      <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Score</TableHead>
                <TableHead>Individual</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead className="w-48 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-destructive">
                    Failed to load: {String(error)}
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No relationships in this view yet. Run a scan to populate.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => {
                  const sources = row.signal_sources ?? []
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <ConfidenceBadge confidence={row.confidence} />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/tax/clients/${row.individual_proconnect_client_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {row.individual_display_name ?? row.individual_proconnect_client_id}
                        </Link>
                        {row.individual_tax_id_last4 ? (
                          <div className="text-xs leading-relaxed text-muted-foreground">
                            SSN •••{row.individual_tax_id_last4}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/tax/clients/${row.business_proconnect_client_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {row.business_display_name ?? row.business_proconnect_client_id}
                        </Link>
                        {row.business_tax_id_last4 ? (
                          <div className="text-xs leading-relaxed text-muted-foreground">
                            EIN •••{row.business_tax_id_last4}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{formatRelType(row.relationship_type)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {sources.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            sources.map((s) => (
                              <Badge key={s} variant="outline" className="text-xs">
                                {formatSignalSource(s)}
                              </Badge>
                            ))
                          )}
                          <span className="text-xs text-muted-foreground">
                            {row.signal_count} signal{row.signal_count === 1 ? "" : "s"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {row.status !== "confirmed" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === row.id}
                              onClick={() => review(row.id, "confirm")}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Confirm
                            </Button>
                          ) : null}
                          {row.status !== "rejected" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === row.id}
                              onClick={() => review(row.id, "reject")}
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Reject
                            </Button>
                          ) : null}
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={`/tax/clients/${row.individual_proconnect_client_id}`}
                              aria-label="Open individual"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
