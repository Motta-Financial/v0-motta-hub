"use client"

/**
 * ReturnRelationshipChip — tiny inline indicator for the returns
 * table. Fetches the relationships endpoint for a given proconnect
 * client id and shows a count chip linking to the relationships
 * filtered by that client.
 *
 * SWR de-dupes the request URL across rows, so a returns page with
 * dozens of rows for the same client only fires one HTTP request.
 */

import useSWR from "swr"
import Link from "next/link"
import { Network } from "lucide-react"

import { Badge } from "@/components/ui/badge"

type Resp = {
  ok: boolean
  as_individual: Array<{ status: string }>
  as_business: Array<{ status: string }>
}

const fetcher = async (url: string): Promise<Resp> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function ReturnRelationshipChip({ clientId }: { clientId: string | null }) {
  const { data } = useSWR(
    clientId ? `/api/tax/clients/${clientId}/relationships` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  if (!clientId || !data) return <span className="text-xs text-muted-foreground">—</span>
  const total = data.as_individual.length + data.as_business.length
  if (total === 0) return <span className="text-xs text-muted-foreground">—</span>
  const needs = [
    ...data.as_individual.filter((r) => r.status === "needs_review"),
    ...data.as_business.filter((r) => r.status === "needs_review"),
  ].length
  return (
    <Link
      href={`/tax/relationships?clientId=${clientId}`}
      className="inline-flex items-center gap-1"
      aria-label={`${total} relationships`}
    >
      <Badge
        variant="outline"
        className={
          needs > 0
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }
      >
        <Network className="mr-1 h-3 w-3" />
        {total}
        {needs > 0 ? <span className="ml-1 text-[10px]">({needs})</span> : null}
      </Badge>
    </Link>
  )
}
