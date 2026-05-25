"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import {
  Users,
  FileText,
  Link2,
  AlertCircle,
  Search as SearchIcon,
  Filter as FilterIcon,
  ExternalLink,
  Network,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { KpiCard, FormBadge, fmtNumber } from "./tax-shared"
import { cn } from "@/lib/utils"

// ── Client row shape ─────────────────────────────────────────────────
type ClientRow = {
  id: string
  proconnect_client_id: string | null
  proconnect_entity_id: string | null
  top_level_entity_id: string | null
  client_type: string | null
  client_state: string | null
  display_name: string | null
  business_name: string | null
  name_for_matching: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  zip: string | null
  tax_id: string | null
  created_at: string | null
  updated_at: string | null
  return_count: number
  amended_count: number
  last_activity_at: string | null
  preparers: string[]
  return_forms: Array<{
    form: string
    count: number
    latestYear: number | null
    latestStatus: string | null
    latestEfile: string | null
    latestPreparer: string | null
    latestUpdatedAt: string | null
  }>
  mapping: {
    internal_client_id: string
    karbon_client_id: string | null
    ignition_client_id: string | null
    karbon_url: string | null
    linked_systems: string[]
    link_count: number
  } | null
}

type ApiResponse = {
  clients: ClientRow[]
  stats: {
    totalClients: number
    persons: number
    organizations: number
    withReturns: number
    withoutReturns: number
    totalReturns: number
    totalAmended: number
    linkedToKarbon: number
    linkedToIgnition: number
    unmappedToHub: number
    byState: Record<string, number>
    subEntities: number
  }
  pagination: {
    page: number
    pageSize: number
    totalPages: number
    totalRows: number
    hasNext: boolean
    hasPrev: boolean
  }
}

const fetcher = (u: string) =>
  fetch(u).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<ApiResponse>
  })

export function TaxClientsClient() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | "PERSON" | "ORGANIZATION">("all")
  const [stateFilter, setStateFilter] = useState<string>("all")

  // Debounce search input
  const handleSearchChange = (value: string) => {
    setSearch(value)
    // Reset to page 1 when search changes
    setPage(1)
    // Debounce the actual search
    clearTimeout((window as unknown as { searchTimeout?: NodeJS.Timeout }).searchTimeout)
    ;(window as unknown as { searchTimeout?: NodeJS.Timeout }).searchTimeout = setTimeout(() => {
      setDebouncedSearch(value)
    }, 300)
  }

  // Build URL with query params
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    params.set("page", String(page))
    if (debouncedSearch) params.set("search", debouncedSearch)
    if (typeFilter !== "all") params.set("type", typeFilter)
    if (stateFilter !== "all") params.set("state", stateFilter)
    return `/api/tax/clients?${params.toString()}`
  }, [page, debouncedSearch, typeFilter, stateFilter])

  const { data, isLoading, error } = useSWR(apiUrl, fetcher)

  // Reset to page 1 when filters change
  const handleTypeFilterChange = (t: "all" | "PERSON" | "ORGANIZATION") => {
    setTypeFilter(t)
    setPage(1)
  }

  const handleStateFilterChange = (s: string) => {
    setStateFilter(s)
    setPage(1)
  }

  const stateOptions = useMemo(() => {
    const keys = Object.keys(data?.stats.byState || {})
    return keys.sort((a, b) => {
      if (a === "ACTIVE") return -1
      if (b === "ACTIVE") return 1
      return a.localeCompare(b)
    })
  }, [data])

  const pagination = data?.pagination

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">
          ProConnect Clients
        </h1>
        <p className="text-sm text-muted-foreground">
          The full ProConnect client roster, enriched with the returns we have
          on file and cross-system links to the Motta Hub master record
          (Karbon, Ignition).
        </p>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Clients"
          value={data ? fmtNumber(data.stats.totalClients) : "—"}
          subtitle={
            data
              ? `${fmtNumber(data.stats.persons)} persons · ${fmtNumber(data.stats.organizations)} orgs`
              : ""
          }
          icon={Users}
          tone="stone"
        />
        <KpiCard
          label="With Returns On File"
          value={data ? fmtNumber(data.stats.withReturns) : "—"}
          subtitle={
            data
              ? `${fmtNumber(data.stats.totalReturns)} returns total${
                  data.stats.totalAmended > 0
                    ? ` · ${data.stats.totalAmended} amended`
                    : ""
                }`
              : ""
          }
          icon={FileText}
          tone="emerald"
        />
        <KpiCard
          label="Linked to Karbon"
          value={data ? fmtNumber(data.stats.linkedToKarbon) : "—"}
          subtitle={
            data ? `${fmtNumber(data.stats.linkedToIgnition)} also in Ignition` : ""
          }
          icon={Link2}
          tone="blue"
        />
        <KpiCard
          label="Unmapped to Hub"
          value={data ? fmtNumber(data.stats.unmappedToHub) : "—"}
          subtitle={
            data
              ? `${fmtNumber(data.stats.subEntities)} sub-entit${data.stats.subEntities === 1 ? "y" : "ies"} in roster`
              : "Needs cross-system match"
          }
          icon={AlertCircle}
          tone={data && data.stats.unmappedToHub > 0 ? "amber" : "stone"}
        />
      </div>

      {/* Filter row */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <FilterIcon className="h-4 w-4 text-stone-500 ml-1" />
          <div className="flex items-center gap-1">
            {(["all", "PERSON", "ORGANIZATION"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={typeFilter === t ? "default" : "outline"}
                onClick={() => handleTypeFilterChange(t)}
                className="h-7 px-2 text-xs"
              >
                {t === "all"
                  ? "All types"
                  : t === "PERSON"
                    ? "Individuals"
                    : "Organizations"}
              </Button>
            ))}
          </div>
          {stateOptions.length > 1 && (
            <div className="flex items-center gap-1 border-l pl-2 ml-1">
              <Button
                size="sm"
                variant={stateFilter === "all" ? "default" : "outline"}
                onClick={() => handleStateFilterChange("all")}
                className="h-7 px-2 text-xs"
              >
                All status
              </Button>
              {stateOptions.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={stateFilter === s ? "default" : "outline"}
                  onClick={() => handleStateFilterChange(s)}
                  className="h-7 px-2 text-xs"
                >
                  {s.charAt(0) + s.slice(1).toLowerCase()}{" "}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {data?.stats.byState[s] ?? 0}
                  </span>
                </Button>
              ))}
            </div>
          )}
          <div className="relative ml-auto w-72">
            <SearchIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by name, email, ID, or tax ID…"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Clients Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && !data ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-700">
              Failed to load clients: {(error as Error).message}
            </div>
          ) : data?.clients.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No clients match the current filters.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead className="w-[110px]">Type</TableHead>
                      <TableHead className="w-[90px]">Status</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Returns on file</TableHead>
                      <TableHead className="w-[130px]">Preparer(s)</TableHead>
                      <TableHead className="w-[120px]">Last activity</TableHead>
                      <TableHead>Hub linkage</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.clients.map((c) => {
                      const isSubEntity =
                        !!c.proconnect_entity_id &&
                        !!c.top_level_entity_id &&
                        c.proconnect_entity_id !== c.top_level_entity_id
                      return (
                        <TableRow key={c.id}>
                          <TableCell>
                            <Link
                              href={`/tax/clients/${c.proconnect_client_id}`}
                              className="font-medium text-stone-900 text-sm hover:text-blue-700 hover:underline transition-colors"
                            >
                              {c.display_name || c.business_name || "—"}
                            </Link>
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="text-[11px] text-muted-foreground font-mono inline-flex items-center gap-1 cursor-help">
                                    PC · {c.proconnect_client_id || "—"}
                                    {isSubEntity ? (
                                      <Network className="h-3 w-3 text-violet-500" />
                                    ) : null}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="right"
                                  className="max-w-[360px] font-mono text-[10px] leading-relaxed"
                                >
                                  <div>
                                    <span className="text-muted-foreground">entity</span>{" "}
                                    {c.proconnect_entity_id || "—"}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">top-level</span>{" "}
                                    {c.top_level_entity_id || "—"}
                                  </div>
                                  {isSubEntity ? (
                                    <div className="mt-1 text-violet-300">
                                      Sub-entity of a parent record
                                    </div>
                                  ) : null}
                                  {c.name_for_matching ? (
                                    <div className="mt-1">
                                      <span className="text-muted-foreground">match-key</span>{" "}
                                      {c.name_for_matching}
                                    </div>
                                  ) : null}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            {c.tax_id ? (
                              <div className="text-[11px] text-muted-foreground font-mono">
                                TIN · {c.tax_id}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                c.client_type === "PERSON"
                                  ? "bg-blue-50 text-blue-900 border-blue-200"
                                  : "bg-violet-50 text-violet-900 border-violet-200"
                              )}
                            >
                              {c.client_type === "PERSON"
                                ? "Individual"
                                : "Organization"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                c.client_state === "ACTIVE"
                                  ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                                  : "bg-stone-50 text-stone-700 border-stone-200"
                              )}
                            >
                              {c.client_state
                                ? c.client_state.charAt(0) +
                                  c.client_state.slice(1).toLowerCase()
                                : "—"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {c.email ? (
                              <div className="text-xs text-stone-700">
                                {c.email}
                              </div>
                            ) : null}
                            {c.phone ? (
                              <div className="text-xs text-muted-foreground">
                                {c.phone}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-stone-700">
                              {[c.city, c.state].filter(Boolean).join(", ") || "—"}
                            </div>
                            {c.zip ? (
                              <div className="text-[11px] text-muted-foreground font-mono">
                                {c.zip}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {c.return_count === 0 ? (
                              <span className="text-xs text-stone-400">
                                No returns
                              </span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1">
                                {c.return_forms.map((f) => (
                                  <div
                                    key={f.form}
                                    className="flex items-center gap-1"
                                    title={`${f.count} ${f.form} return${f.count === 1 ? "" : "s"} · latest ${f.latestYear ?? ""}${f.latestPreparer ? ` · ${f.latestPreparer}` : ""}`}
                                  >
                                    <FormBadge form={f.form} />
                                    {f.count > 1 ? (
                                      <span className="text-[10px] text-muted-foreground">
                                        ×{f.count}
                                      </span>
                                    ) : null}
                                  </div>
                                ))}
                                {c.amended_count > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] bg-amber-50 text-amber-900 border-amber-200"
                                  >
                                    {c.amended_count} amended
                                  </Badge>
                                ) : null}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.preparers.length === 0 ? (
                              <span className="text-xs text-stone-400">—</span>
                            ) : c.preparers.length === 1 ? (
                              <span className="text-xs text-stone-700">
                                {c.preparers[0]}
                              </span>
                            ) : (
                              <span
                                className="text-xs text-stone-700"
                                title={c.preparers.join(", ")}
                              >
                                {c.preparers[0]}{" "}
                                <span className="text-muted-foreground">
                                  +{c.preparers.length - 1}
                                </span>
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.last_activity_at ? (
                              <div
                                className="text-xs text-stone-700 tabular-nums"
                                title={`Latest return activity · ${new Date(c.last_activity_at).toLocaleString()}`}
                              >
                                {new Date(c.last_activity_at).toLocaleDateString()}
                              </div>
                            ) : (
                              <div className="text-xs text-stone-400">—</div>
                            )}
                            {c.updated_at ? (
                              <div
                                className="text-[10px] text-muted-foreground tabular-nums"
                                title={`ProConnect record updated · ${new Date(c.updated_at).toLocaleString()}`}
                              >
                                rec {new Date(c.updated_at).toLocaleDateString()}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {c.mapping ? (
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-emerald-50 text-emerald-900 border-emerald-200"
                                >
                                  {c.mapping.link_count}-system
                                </Badge>
                                <Link
                                  href={`/admin/master-client-mapping?q=${encodeURIComponent(
                                    c.mapping.internal_client_id
                                  )}`}
                                  className="text-[11px] text-blue-700 hover:underline inline-flex items-center gap-0.5"
                                >
                                  View in hub
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </div>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-amber-50 text-amber-900 border-amber-200"
                              >
                                Unmapped
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Link href={`/tax/clients/${c.proconnect_client_id}`}>
                              <Button variant="outline" size="sm" className="h-7 text-xs">
                                View Profile
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{" "}
                    {Math.min(pagination.page * pagination.pageSize, pagination.totalRows)} of{" "}
                    {fmtNumber(pagination.totalRows)} clients
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={!pagination.hasPrev}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {/* Page numbers */}
                    {Array.from({ length: Math.min(7, pagination.totalPages) }, (_, i) => {
                      // Show pages around current page
                      let pageNum: number
                      if (pagination.totalPages <= 7) {
                        pageNum = i + 1
                      } else if (pagination.page <= 4) {
                        pageNum = i + 1
                      } else if (pagination.page >= pagination.totalPages - 3) {
                        pageNum = pagination.totalPages - 6 + i
                      } else {
                        pageNum = pagination.page - 3 + i
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={pageNum === pagination.page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPage(pageNum)}
                          className="h-8 w-8 p-0 text-xs"
                        >
                          {pageNum}
                        </Button>
                      )
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      disabled={!pagination.hasNext}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
