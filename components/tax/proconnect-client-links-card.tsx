"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Sparkles,
  User,
  Wand2,
  X,
} from "lucide-react"
import { toast } from "sonner"

type Candidate = {
  kind: "contact" | "organization"
  id: string
  full_name?: string | null
  name?: string | null
  primary_email: string | null
  state: string | null
  status: string | null
  ein?: string | null
  ssn_last_four?: string | null
  score: number
  signals: string[]
}

type Row = {
  proconnect: {
    proconnect_client_id: string
    client_type: string
    email: string | null
    first_name: string | null
    last_name: string | null
    business_name: string | null
    display_name: string | null
    state: string | null
    tax_id: string | null
  }
  candidates: Candidate[]
  autoApply: Candidate | null
}

type ApiResponse = {
  rows: Row[]
  matcher_version: string
  autoApplyCount: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const SIGNAL_LABEL: Record<string, string> = {
  ein: "EIN",
  ssn_last4: "SSN last-4",
  email: "email",
  name_exact: "name exact",
  name_normalized: "name normalized",
  name_trigram: "name fuzzy",
  state_last_name: "state + last name",
}

function candidateLabel(c: Candidate) {
  return c.kind === "contact" ? c.full_name || "(unnamed)" : c.name || "(unnamed)"
}

export function ProconnectClientLinksCard() {
  const { data, isLoading, mutate } = useSWR<ApiResponse>(
    "/api/tax/client-links?status=unmapped&limit=500",
    fetcher,
    { revalidateOnFocus: false },
  )
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [autoLinking, setAutoLinking] = useState(false)
  const [filter, setFilter] = useState<"all" | "person" | "business">("all")

  async function handleAction(
    row: Row,
    candidate: Candidate,
    action: "apply" | "reject",
  ) {
    const key = `${row.proconnect.proconnect_client_id}:${candidate.id}:${action}`
    setBusyKey(key)
    try {
      const res = await fetch("/api/tax/client-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          proconnect_client_id: row.proconnect.proconnect_client_id,
          candidate_id: candidate.id,
          candidate_kind: candidate.kind,
          score: candidate.score,
          signals: candidate.signals,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(`Failed: ${j.error || res.status}`)
        return
      }
      toast.success(action === "apply" ? "Linked" : "Rejected")
      await mutate()
    } finally {
      setBusyKey(null)
    }
  }

  async function handleAutoLink() {
    setAutoLinking(true)
    try {
      const res = await fetch("/api/tax/client-links/auto-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(`Auto-link failed: ${j.error || res.status}`)
        return
      }
      if ((j.applied ?? 0) === 0) {
        toast.info("No high-confidence matches available right now.")
      } else {
        toast.success(`Auto-linked ${j.applied} of ${j.auto_applicable}.`)
      }
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-link failed")
    } finally {
      setAutoLinking(false)
    }
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ProConnect ↔ Hub Client Links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }

  const visibleRows = data.rows.filter((r) => {
    if (filter === "all") return true
    if (filter === "person") return r.proconnect.client_type === "PERSON"
    return (
      r.proconnect.client_type === "BUSINESS" ||
      r.proconnect.client_type === "ORGANIZATION"
    )
  })

  const autoCount = data.autoApplyCount
  const totalUnmapped = data.rows.length
  const noCandidatesCount = data.rows.filter(
    (r) => r.candidates.length === 0,
  ).length

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              ProConnect ↔ Hub Client Links
              {totalUnmapped === 0 ? (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  All linked
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {totalUnmapped} unmapped
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              ProConnect tax clients without a Hub master profile. The
              fuzzy matcher uses EIN, SSN-last-4, email, and entity-suffix-
              normalized name + trigram similarity. Inactive / Deleted Hub
              records are kept eligible.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border bg-card p-0.5 text-xs">
              {(["all", "person", "business"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded px-2 py-1 capitalize ${
                    filter === f
                      ? "bg-stone-900 text-stone-50"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            {autoCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAutoLink}
                disabled={autoLinking}
                className="gap-1"
                title="Apply all high-confidence (>= 0.85, clear winner) matches in one shot"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Auto-link {autoCount}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {totalUnmapped === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Every ProConnect client is linked to a Hub master profile.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Showing {visibleRows.length} of {totalUnmapped} unmapped (
              {noCandidatesCount} have no candidate; create the Hub record
              first or accept that they only exist in ProConnect).
            </p>
            {visibleRows.map((row) => (
              <UnmappedRow
                key={row.proconnect.proconnect_client_id}
                row={row}
                busyKey={busyKey}
                onAction={handleAction}
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function UnmappedRow({
  row,
  busyKey,
  onAction,
}: {
  row: Row
  busyKey: string | null
  onAction: (
    row: Row,
    candidate: Candidate,
    action: "apply" | "reject",
  ) => void
}) {
  const pc = row.proconnect
  const isBiz =
    pc.client_type === "BUSINESS" || pc.client_type === "ORGANIZATION"
  const Icon = isBiz ? Building2 : User
  const top = row.candidates[0]
  const isAuto = !!row.autoApply

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">
              {pc.display_name ||
                pc.business_name ||
                `${pc.first_name ?? ""} ${pc.last_name ?? ""}`.trim() ||
                "(unnamed)"}
            </span>
            <Badge variant="outline" className="text-[10px] uppercase">
              {pc.client_type}
            </Badge>
            {isAuto && (
              <Badge className="gap-1 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
                <Sparkles className="h-3 w-3" />
                auto-applicable
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <code className="font-mono">{pc.proconnect_client_id}</code>
            {pc.email && <span>{pc.email}</span>}
            {pc.state && <span>state: {pc.state}</span>}
            {pc.tax_id && <span>tax id on file</span>}
          </div>
        </div>
      </div>

      {row.candidates.length === 0 ? (
        <p className="mt-2 rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          No Hub candidates above the similarity threshold. Create the
          Hub record from the contact page, or skip — this client may
          only exist in ProConnect.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {row.candidates.map((c) => {
            const applyKey = `${pc.proconnect_client_id}:${c.id}:apply`
            const rejectKey = `${pc.proconnect_client_id}:${c.id}:reject`
            const isTop = c === top
            return (
              <div
                key={`${c.kind}:${c.id}`}
                className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs ${
                  isTop && isAuto
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-stone-200"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{candidateLabel(c)}</span>
                    {c.status && c.status.toLowerCase() !== "active" && (
                      <span className="rounded-sm bg-stone-200 px-1 py-px text-[9px] uppercase tracking-wider text-stone-600">
                        {c.status}
                      </span>
                    )}
                    <span className="tabular-nums text-stone-500">
                      score {c.score.toFixed(2)}
                    </span>
                    {c.signals.map((s) => (
                      <span
                        key={s}
                        className="rounded-sm bg-stone-100 px-1.5 py-px text-[10px] uppercase tracking-wide text-stone-600"
                      >
                        {SIGNAL_LABEL[s] || s}
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.primary_email || "no email"}
                    {c.state ? ` · ${c.state}` : ""}
                    {c.ein ? ` · EIN on file` : ""}
                    {c.ssn_last_four ? ` · SSN ****${c.ssn_last_four}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2"
                    disabled={busyKey === applyKey}
                    onClick={() => onAction(row, c, "apply")}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-muted-foreground"
                    disabled={busyKey === rejectKey}
                    onClick={() => onAction(row, c, "reject")}
                    title="Don't suggest this pair again"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
