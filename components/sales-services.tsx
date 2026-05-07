"use client"

/**
 * Sales > Services catalog
 * ────────────────────────────────────────────────────────────────────────
 * Browse the Ignition service catalog with usage and revenue metrics. Each
 * row shows where a service has been pitched (proposalCount), how often it's
 * been won (acceptedCount), and how much revenue it has driven.
 *
 * Pure client-side filter/sort because the catalog is small (~158 rows).
 */

import { useMemo, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import useSWR from "swr"
import {
  Search as SearchIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  RefreshCcw,
  Filter as FilterIcon,
  Briefcase,
  CircleDollarSign,
  Zap,
  Layers,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { MultiSelectChip } from "@/components/sales/filter-chips"
import {
  classifyService,
  SERVICE_LINE_META,
  type ServiceLine,
} from "@/lib/sales/service-line-classifier"

interface ServiceRow {
  ignition_service_id: string
  name: string
  description: string | null
  category: string | null
  billing_type: string | null
  default_price: number | null
  currency: string
  is_active: boolean
  proposalCount: number
  acceptedCount: number
  lostCount: number
  totalRevenue: number
  acceptedRevenue: number
  units: number
  avgPrice: number | null
  billingFrequencies: string[]
}
interface ServicesResponse {
  services: ServiceRow[]
  dimensions: {
    categories: string[]
    billingTypes: string[]
  }
  stats: {
    totalServices: number
    activeServices: number
    totalRevenue: number
    acceptedRevenue: number
    totalProposalLines: number
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function fmtMoney(n: number | null | undefined, currency = "USD", digits = 0) {
  const v = Number(n) || 0
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
    }).format(v)
  } catch {
    return `$${v.toLocaleString()}`
  }
}
function titleCase(s: string | null | undefined) {
  if (!s) return ""
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function SalesServices() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const search = searchParams.get("search") || ""
  const category = (searchParams.get("category") || "").split(",").filter(Boolean)
  const billingType = (searchParams.get("billingType") || "").split(",").filter(Boolean)
  const serviceLine = (searchParams.get("serviceLine") || "")
    .split(",")
    .filter(Boolean) as ServiceLine[]
  const activeOnly = searchParams.get("activeOnly") === "true"
  const pitchedOnly = searchParams.get("pitchedOnly") === "true"
  const sortBy = searchParams.get("sortBy") || "totalRevenue"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"

  const [searchInput, setSearchInput] = useState(search)

  // Service-line and pitched-only filtering happens client-side because the
  // values aren't on the catalog row directly — they're derived from the
  // service name (classifier) and proposal usage stats. Keeping it in JS
  // also means we don't need to touch the API contract for these two.
  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    if (search) sp.set("search", search)
    if (category.length) sp.set("category", category.join(","))
    if (billingType.length) sp.set("billingType", billingType.join(","))
    if (activeOnly) sp.set("activeOnly", "true")
    sp.set("sortBy", sortBy)
    sp.set("sortDir", sortDir)
    return sp.toString()
  }, [search, category, billingType, activeOnly, sortBy, sortDir])

  const { data, error, isLoading, mutate } = useSWR<ServicesResponse>(
    `/api/sales/services?${queryString}`,
    fetcher,
    { keepPreviousData: true },
  )

  // Derive each row's service line on the fly using the shared classifier.
  // The classifier uses the service name (and falls back to a generic
  // "advisory" bucket if nothing matches) so we always have a value to
  // filter against. Memoized so re-renders that don't change the data
  // don't re-classify ~150 rows.
  const classifiedServices = useMemo(() => {
    return (data?.services ?? []).map((s) => ({
      ...s,
      serviceLine: classifyService(s.name),
    }))
  }, [data?.services])

  // Apply the two client-side filters that aren't part of the API contract.
  const visibleServices = useMemo(() => {
    return classifiedServices.filter((s) => {
      if (serviceLine.length && !serviceLine.includes(s.serviceLine)) return false
      if (pitchedOnly && s.proposalCount === 0) return false
      return true
    })
  }, [classifiedServices, serviceLine, pitchedOnly])

  function updateParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k)
      else sp.set(k, v)
    }
    router.replace(`${pathname}?${sp.toString()}`)
  }

  function toggleSort(field: string) {
    if (sortBy === field) {
      updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" })
    } else {
      updateParams({ sortBy: field, sortDir: "desc" })
    }
  }

  const activeFilterCount =
    (search ? 1 : 0) +
    category.length +
    billingType.length +
    serviceLine.length +
    (activeOnly ? 1 : 0) +
    (pitchedOnly ? 1 : 0)

  // Service-line dropdown options are derived from the classifier metadata
  // so they show in a sensible order (Tax → Bookkeeping → … → Advisory).
  const serviceLineOptions = useMemo(
    () => Object.keys(SERVICE_LINE_META) as ServiceLine[],
    [],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Services</h1>
        <p className="text-sm text-muted-foreground">
          {data
            ? `${visibleServices.length.toLocaleString()} of ${data.stats.totalServices.toLocaleString()} services`
            : "Loading services…"}
          {data && activeFilterCount > 0
            ? ` matching ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}`
            : ""}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Catalog Size"
          value={data ? data.stats.totalServices.toLocaleString() : "—"}
          subtitle={
            data ? `${data.stats.activeServices.toLocaleString()} active` : ""
          }
          icon={Layers}
          tone="stone"
        />
        <KpiCard
          label="Proposal Lines"
          value={data ? data.stats.totalProposalLines.toLocaleString() : "—"}
          subtitle="line items across proposals"
          icon={Briefcase}
          tone="blue"
        />
        <KpiCard
          label="Total Pitched"
          value={data ? fmtMoney(data.stats.totalRevenue) : "—"}
          subtitle="across all proposals"
          icon={CircleDollarSign}
          tone="amber"
        />
        <KpiCard
          label="Accepted Revenue"
          value={data ? fmtMoney(data.stats.acceptedRevenue) : "—"}
          subtitle="from won deals"
          icon={Zap}
          tone="emerald"
        />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") updateParams({ search: searchInput || null })
              }}
              placeholder="Search service name, description, category…"
              className="pl-8"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateParams({ search: searchInput || null })}
          >
            Search
          </Button>

          <MultiSelectChip
            label="Service line"
            // The ServiceLine type values ("Tax", "Accounting", "Advisory",
            // "Other") are already the human-readable labels, so we pass
            // them as plain strings — same shape as Category and Billing.
            options={serviceLineOptions}
            value={serviceLine}
            onChange={(v) =>
              updateParams({
                serviceLine: v.length ? v.join(",") : null,
              })
            }
          />
          <MultiSelectChip
            label="Category"
            options={data?.dimensions.categories || []}
            value={category}
            onChange={(v) => updateParams({ category: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Billing"
            options={data?.dimensions.billingTypes || []}
            value={billingType}
            onChange={(v) => updateParams({ billingType: v.length ? v.join(",") : null })}
          />

          <label className="flex items-center gap-2 text-sm px-2">
            <Switch
              checked={activeOnly}
              onCheckedChange={(v) => updateParams({ activeOnly: v ? "true" : null })}
            />
            Active only
          </label>
          <label className="flex items-center gap-2 text-sm px-2">
            {/* Hide unused services so users can focus on the catalog
                items that are actually being pitched. */}
            <Switch
              checked={pitchedOnly}
              onCheckedChange={(v) => updateParams({ pitchedOnly: v ? "true" : null })}
            />
            Pitched only
          </label>

          {activeFilterCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput("")
                router.replace(pathname)
              }}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Clear ({activeFilterCount})
            </Button>
          ) : null}

          <Button variant="ghost" size="sm" onClick={() => mutate()} className="ml-auto">
            <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b">
                <tr className="text-xs uppercase text-muted-foreground">
                  <SortableHeader
                    field="name"
                    label="Service"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    field="category"
                    label="Category"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="text-left px-3 py-2 font-medium">Billing</th>
                  <SortableHeader
                    field="default_price"
                    label="Default Price"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="avgPrice"
                    label="Avg Sold"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="proposalCount"
                    label="Proposals"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="acceptedCount"
                    label="Won"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="totalRevenue"
                    label="Total Pitched"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="acceptedRevenue"
                    label="Accepted"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {isLoading && !data ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={9} className="px-3 py-3">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-rose-600">
                      Failed to load services.
                    </td>
                  </tr>
                ) : visibleServices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                      <FilterIcon className="h-6 w-6 mx-auto mb-2 opacity-40" />
                      No services match the current filters.
                    </td>
                  </tr>
                ) : (
                  visibleServices.map((s) => {
                    const winRate =
                      s.proposalCount > 0
                        ? Math.round((s.acceptedCount / s.proposalCount) * 100)
                        : null
                    return (
                      <tr key={s.ignition_service_id} className="border-b hover:bg-stone-50/60">
                        <td className="px-3 py-2 max-w-[260px]">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-stone-900 truncate">{s.name}</span>
                            {!s.is_active ? (
                              <Badge variant="outline" className="text-[10px] h-4 px-1">
                                inactive
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            {/* Service-line tag mirrors the chip filter so
                                people understand which bucket each row falls
                                into. Colors come from the shared classifier
                                metadata so Tax = blue, Accounting = emerald,
                                Advisory = amber, Other = stone — consistent
                                with the dashboard breakdown chart. */}
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] h-4 px-1 font-normal",
                                SERVICE_LINE_META[s.serviceLine].bg,
                                SERVICE_LINE_META[s.serviceLine].text,
                                SERVICE_LINE_META[s.serviceLine].border,
                              )}
                            >
                              {s.serviceLine}
                            </Badge>
                            {s.description ? (
                              <span className="text-xs text-muted-foreground truncate">
                                {s.description}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-700">
                          {s.category || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-stone-700">{titleCase(s.billing_type) || "—"}</span>
                            {s.billingFrequencies.length > 0 ? (
                              <span className="text-muted-foreground">
                                {s.billingFrequencies.map(titleCase).join(", ")}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.default_price !== null
                            ? fmtMoney(s.default_price, s.currency)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {s.avgPrice !== null ? fmtMoney(s.avgPrice, s.currency) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.proposalCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className="text-emerald-700 font-medium">
                            {s.acceptedCount.toLocaleString()}
                          </span>
                          {winRate !== null ? (
                            <span className="text-xs text-muted-foreground ml-1">
                              {winRate}%
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtMoney(s.totalRevenue, s.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-800">
                          {fmtMoney(s.acceptedRevenue, s.currency)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  subtitle?: string
  icon: any
  tone: "stone" | "emerald" | "amber" | "rose" | "blue"
}) {
  const toneStyles: Record<string, string> = {
    stone: "text-stone-900 bg-stone-100",
    emerald: "text-emerald-900 bg-emerald-100",
    amber: "text-amber-900 bg-amber-100",
    rose: "text-rose-900 bg-rose-100",
    blue: "text-blue-900 bg-blue-100",
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn("p-2 rounded-md", toneStyles[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </div>
          <div className="text-xl font-semibold tabular-nums truncate">{value}</div>
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function SortableHeader({
  field,
  label,
  sortBy,
  sortDir,
  onSort,
  align = "left",
}: {
  field: string
  label: string
  sortBy: string
  sortDir: "asc" | "desc"
  onSort: (field: string) => void
  align?: "left" | "right"
}) {
  const active = sortBy === field
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th className={cn("font-medium px-3 py-2", align === "right" ? "text-right" : "text-left")}>
      <button
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-stone-900 transition-colors",
          active ? "text-stone-900" : "",
        )}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  )
}

// `MultiSelectChip` now lives in components/sales/filter-chips.tsx so that
// every Sales surface (Proposals, Invoices, Services, Recurring Revenue)
// shares one consistent chip experience. Imported at the top of the file.
