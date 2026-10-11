"use client"

/**
 * Prospect list — the page behind the sidebar's Clients → Prospects.
 *
 * Shows every prospect captured with the Prospect Form, newest first, with
 * a search box and a status filter. A row opens /prospects/[id], where the
 * triage, Karbon work item and ProConnect actions live. Status colours come
 * from the detail page so the two never disagree.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { STATUS_OPTIONS } from "./prospect-detail"

interface ProspectRow {
  id: string
  created_at: string
  submitter_full_name: string | null
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_email: string | null
  business_name: string | null
  service_focus: string | null
  services_requested: string[] | null
  lead_status: string | null
  karbon_work_item_key: string | null
  contact_id: string | null
  organization_id: string | null
  created_by_name: string | null
  assigned_to_name: string | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const displayName = (p: ProspectRow) =>
  p.submitter_full_name ||
  [p.submitter_first_name, p.submitter_last_name].filter(Boolean).join(" ") ||
  p.business_name ||
  "Unnamed prospect"

export function ProspectList() {
  const router = useRouter()
  const { data, isLoading, error } = useSWR<{ prospects?: ProspectRow[]; error?: string }>(
    "/api/prospects",
    fetcher,
    { revalidateOnFocus: false },
  )
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string>("all")

  const all = data?.prospects ?? []
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((p) => {
      if (status !== "all" && (p.lead_status ?? "new") !== status) return false
      if (!q) return true
      return [displayName(p), p.business_name, p.submitter_email, p.assigned_to_name]
        .some((v) => v?.toLowerCase().includes(q))
    })
  }, [all, search, status])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of all) c[p.lead_status ?? "new"] = (c[p.lead_status ?? "new"] ?? 0) + 1
    return c
  }, [all])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Prospects</h1>
          <p className="text-sm text-muted-foreground">
            Prospects the team captured with the Prospect Form. Open one to triage it, create its Karbon
            work item, or start its ProConnect return.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/prospects/new">
            <Plus className="mr-1.5 h-4 w-4" />
            New prospect
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, business, email, owner"
            className="pl-8"
          />
        </div>
        {[{ value: "all", label: "All" }, ...STATUS_OPTIONS].map((opt) => {
          const n = opt.value === "all" ? all.length : counts[opt.value] ?? 0
          return (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={status === opt.value ? "default" : "outline"}
              onClick={() => setStatus(opt.value)}
            >
              {opt.label}
              <span className="ml-1.5 text-xs opacity-70">{n}</span>
            </Button>
          )
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Prospect</th>
                <th className="px-3 py-3 font-medium">Business</th>
                <th className="px-3 py-3 font-medium">Focus</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Owner</th>
                <th className="px-3 py-3 font-medium">Karbon</th>
                <th className="px-3 py-3 text-right font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    Loading prospects…
                  </td>
                </tr>
              )}
              {!isLoading && (error || data?.error) && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-destructive">
                    Couldn't load prospects{data?.error ? `: ${data.error}` : "."}
                  </td>
                </tr>
              )}
              {!isLoading && !error && !data?.error && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {all.length ? "No prospects match the current filters." : "No prospects yet."}
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const opt = STATUS_OPTIONS.find((o) => o.value === (p.lead_status ?? "new"))
                return (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/prospects/${p.id}`)}
                    className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-3">
                      <Link
                        href={`/prospects/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-foreground hover:underline"
                      >
                        {displayName(p)}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{p.submitter_email ?? "no email"}</div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{p.business_name ?? "—"}</td>
                    <td className="px-3 py-3 capitalize text-muted-foreground">{p.service_focus ?? "—"}</td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className={cn("font-medium", opt?.className)}>
                        {opt?.label ?? p.lead_status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {p.assigned_to_name ?? p.created_by_name ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{p.karbon_work_item_key ? "Created" : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
