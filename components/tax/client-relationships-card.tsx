"use client"

/**
 * ClientRelationshipsCard — surfaces the relationship graph on a tax
 * client's profile. Shows two stacked sections:
 *
 *   1. "As individual" — businesses where this client is a K-1 issuer,
 *      Schedule-C owner, partner, etc.
 *   2. "As business" — individuals linked to this business as
 *      owners/officers/etc.
 *
 * Auto-confirmed and confirmed rows render normally. `needs_review`
 * rows get a subtle amber tint and inline Confirm/Reject buttons so
 * the reviewer doesn't have to context-switch to the queue page.
 *
 * The card is intentionally compact — it only renders when there's
 * relationship data, so a clean profile stays clean.
 */

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Network, Check, X, ExternalLink } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

type Row = {
  id: string
  status: "needs_review" | "confirmed" | "rejected"
  confidence: number
  relationship_type: string
  individual_proconnect_client_id: string
  business_proconnect_client_id: string
  individual_display_name: string | null
  business_display_name: string | null
  signal_count: number
  signal_sources: string[] | null
}

type Resp = {
  ok: boolean
  as_individual: Row[]
  as_business: Row[]
}

const fetcher = async (url: string): Promise<Resp> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function relTypeLabel(value: string): string {
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

function sourceLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Hub Contact Organizations", "Hub link")
}

function RelationshipRow({
  row,
  perspective,
  onChanged,
}: {
  row: Row
  perspective: "individual" | "business"
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  // The "other side" name relative to the profile we're rendering on.
  const other =
    perspective === "individual"
      ? {
          name: row.business_display_name ?? row.business_proconnect_client_id,
          id: row.business_proconnect_client_id,
        }
      : {
          name: row.individual_display_name ?? row.individual_proconnect_client_id,
          id: row.individual_proconnect_client_id,
        }

  async function review(action: "confirm" | "reject") {
    setBusy(true)
    try {
      const res = await fetch("/api/tax/relationships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: row.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      onChanged()
    } catch (err) {
      console.error("[v0] inline review failed", err)
    } finally {
      setBusy(false)
    }
  }

  const needsReview = row.status === "needs_review"

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
        needsReview ? "border-amber-200 bg-amber-50/60" : "border-border bg-background"
      }`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{relTypeLabel(row.relationship_type)}</Badge>
          <Link
            href={`/tax/clients/${other.id}`}
            className="truncate font-medium text-foreground hover:underline"
          >
            {other.name}
          </Link>
          <Badge
            variant="outline"
            className={
              row.confidence >= 0.85
                ? "border-emerald-200 bg-emerald-100 text-emerald-900"
                : "border-amber-200 bg-amber-100 text-amber-900"
            }
          >
            {(row.confidence * 100).toFixed(0)}%
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
          {(row.signal_sources ?? []).slice(0, 4).map((s) => (
            <Badge key={s} variant="outline" className="text-[10px]">
              {sourceLabel(s)}
            </Badge>
          ))}
          <span>
            {row.signal_count} signal{row.signal_count === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {needsReview ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => review("confirm")}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => review("reject")}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Reject
            </Button>
          </>
        ) : (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-900">
            Confirmed
          </Badge>
        )}
        <Button asChild size="sm" variant="ghost" aria-label="Open">
          <Link href={`/tax/clients/${other.id}`}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  )
}

export function ClientRelationshipsCard({ clientId }: { clientId: string }) {
  const { data, isLoading, mutate } = useSWR(
    `/api/tax/clients/${clientId}/relationships`,
    fetcher,
    { revalidateOnFocus: false },
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-primary" />
            Relationships
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  const asInd = data?.as_individual ?? []
  const asBiz = data?.as_business ?? []
  const total = asInd.length + asBiz.length
  if (total === 0) return null // nothing to show — keep the profile clean

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-primary" />
          Relationships
        </CardTitle>
        <Link
          href={`/tax/relationships?clientId=${clientId}`}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Review all
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {asInd.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              As individual
            </h3>
            <div className="flex flex-col gap-2">
              {asInd.map((r) => (
                <RelationshipRow
                  key={r.id}
                  row={r}
                  perspective="individual"
                  onChanged={() => mutate()}
                />
              ))}
            </div>
          </section>
        ) : null}
        {asBiz.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              As business
            </h3>
            <div className="flex flex-col gap-2">
              {asBiz.map((r) => (
                <RelationshipRow
                  key={r.id}
                  row={r}
                  perspective="business"
                  onChanged={() => mutate()}
                />
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}
