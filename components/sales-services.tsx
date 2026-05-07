"use client"

/**
 * Sales > Services catalog
 * ────────────────────────────────────────────────────────────────────────
 * Browse Motta's services with usage and revenue metrics. Two view modes,
 * controlled by the "View" toggle in the filter bar:
 *
 *   • Canonical (default) — one row per *canonical* service, with stats
 *     rolled up across every alias and naming variant. This is the right
 *     view for sales analysis: all four ways someone wrote
 *     "Tax Preparation (1040)" collapse to a single row showing the true
 *     count and revenue.
 *
 *   • Catalog — one row per Ignition catalog entry (the legacy view).
 *     Useful when you need to manage the catalog itself or audit pricing.
 *
 * Pure client-side filter/sort beyond what the API already supports —
 * volumes are tiny (~170 catalog rows, ~50 canonical services).
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
  ChevronDown,
  ChevronRight,
  Link2,
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
  SERVICE_LINE_META,
  type ServiceLine,
} from "@/lib/sales/service-line-classifier"

// ── Types ─────────────────────────────────────────────────────────────

interface CatalogRow {
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
  serviceLine: ServiceLine
  /** Canonical id this row collapses into (null for unmatched names). */
  canonicalId: string | null
  canonicalLabel: string | null
}

interface CanonicalRow {
  id: string
  label: string
  serviceLine: ServiceLine
  /** Whether this is a known canonical (vs. an unmatched `raw:…` row). */
  isCanonical: boolean
  description: string | null
  catalogVariants: Array<{
    ignition_service_id: string
    name: string
    default_price: number | null
    currency: string
    is_active: boolean
    category: string | null
    billing_type: string | null
  }>
  proposalNameVariants: Array<{ name: string; count: number }>
  catalogCount: number
  variantCount: number
  proposalCount: number
  acceptedCount: number
  lostCount: number
  totalRevenue: number
  acceptedRevenue: number
  units: number
  avgPrice: number | null
  currency: string
  billingFrequencies: string[]
  isActive: boolean
  categories: string[]
  billingTypes: string[]
}

interface ServicesResponse {
  groupBy: "canonical" | "catalog"
  services: (CanonicalRow | CatalogRow)[]
  catalogServices: CatalogRow[]
  canonicalServices: CanonicalRow[]
  dimensions: {
    categories: string[]
    billingTypes: string[]
    serviceLines: ServiceLine[]
  }
  stats: {
    totalServices: number
    activeServices: number
    canonicalServices: number
    canonicalCovered: number
    totalRevenue: number
    acceptedRevenue: number
    totalProposalLines: number
    duplicateGroups: number
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

// ── Component ─────────────────────────────────────────────────────────

export function SalesServices() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const groupBy = (searchParams.get("groupBy") || "canonical") as
    | "canonical"
    | "catalog"
  const search = searchParams.get("search") || ""
  const category = (searchParams.get("category") || "").split(",").filter(Boolean)
  const billingType = (searchParams.get("billingType") || "")
    .split(",")
    .filter(Boolean)
  const serviceLine = (searchParams.get("serviceLine") || "")
    .split(",")
    .filter(Boolean) as ServiceLine[]
  const activeOnly = searchParams.get("activeOnly") === "true"
  const pitchedOnly = searchParams.get("pitchedOnly") === "true"
  const sortBy = searchParams.get("sortBy") || "totalRevenue"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"

  const [searchInput, setSearchInput] = useState(search)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Build the API query string. We push every filter to the server so the
  // canonical and catalog rollups are always consistent regardless of
  // which view is active.
  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set("groupBy", groupBy)
    if (search) sp.set("search", search)
    if (category.length) sp.set("category", category.join(","))
    if (billingType.length) sp.set("billingType", billingType.join(","))
    if (serviceLine.length) sp.set("serviceLine", serviceLine.join(","))
    if (activeOnly) sp.set("activeOnly", "true")
    sp.set("sortBy", sortBy)
    sp.set("sortDir", sortDir)
    return sp.toString()
  }, [
    groupBy,
    search,
    category,
    billingType,
    serviceLine,
    activeOnly,
    sortBy,
    sortDir,
  ])

  const { data, error, isLoading, mutate } = useSWR<ServicesResponse>(
    `/api/sales/services?${queryString}`,
    fetcher,
    { keepPreviousData: true },
  )

  // `pitchedOnly` is the only filter that lives client-side because it
  // depends on `proposalCount`, which is computed *after* aggregation.
  // Doing it server-side would mean shipping it through the catalog and
  // canonical aggregators twice — not worth it for a single boolean.
  const visibleRows = useMemo(() => {
    const list = data?.services ?? []
    if (!pitchedOnly) return list
    return list.filter((row) => (row as any).proposalCount > 0)
  }, [data?.services, pitchedOnly])

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

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activeFilterCount =
    (search ? 1 : 0) +
    category.length +
    billingType.length +
    serviceLine.length +
    (activeOnly ? 1 : 0) +
    (pitchedOnly ? 1 : 0)

  const serviceLineOptions: ServiceLine[] = ["Tax", "Accounting", "Advisory", "Other"]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Services</h1>
        <p className="text-sm text-muted-foreground">
          {data
            ? groupBy === "canonical"
              ? `${visibleRows.length.toLocaleString()} of ${data.stats.canonicalServices.toLocaleString()} canonical services`
              : `${visibleRows.length.toLocaleString()} of ${data.stats.totalServices.toLocaleString()} catalog services`
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
          subtitle={data ? `${data.stats.activeServices.toLocaleString()} active` : ""}
          icon={Layers}
          tone="stone"
        />
        <KpiCard
          label="Consolidated Services"
          value={
            data
              ? data.stats.canonicalCovered.toLocaleString()
              : "—"
          }
          // "Duplicate groups" = canonical services that fold in two or
          // more distinct names. It's the most concrete signal of how
          // much consolidation actually happened.
          subtitle={
            data
              ? `${data.stats.duplicateGroups.toLocaleString()} consolidated groups`
              : ""
          }
          icon={Link2}
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
              placeholder="Search service name, alias, description…"
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

          {/* View toggle: Canonical (default) ↔ Catalog */}
          <div className="inline-flex rounded-md border bg-stone-50 p-0.5 text-xs">
            <button
              onClick={() => updateParams({ groupBy: null })}
              className={cn(
                "px-2 py-1 rounded font-medium transition-colors",
                groupBy === "canonical"
                  ? "bg-stone-900 text-stone-50"
                  : "text-stone-600 hover:text-stone-900",
              )}
              title="Roll up duplicates into canonical services"
            >
              Canonical
            </button>
            <button
              onClick={() => updateParams({ groupBy: "catalog" })}
              className={cn(
                "px-2 py-1 rounded font-medium transition-colors",
                groupBy === "catalog"
                  ? "bg-stone-900 text-stone-50"
                  : "text-stone-600 hover:text-stone-900",
              )}
              title="One row per Ignition catalog entry"
            >
              Catalog
            </button>
          </div>

          <MultiSelectChip
            label="Service line"
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
            onChange={(v) =>
              updateParams({ category: v.length ? v.join(",") : null })
            }
          />
          <MultiSelectChip
            label="Billing"
            options={data?.dimensions.billingTypes || []}
            value={billingType}
            onChange={(v) =>
              updateParams({ billingType: v.length ? v.join(",") : null })
            }
          />

          <label className="flex items-center gap-2 text-sm px-2">
            <Switch
              checked={activeOnly}
              onCheckedChange={(v) =>
                updateParams({ activeOnly: v ? "true" : null })
              }
            />
            Active only
          </label>
          <label className="flex items-center gap-2 text-sm px-2">
            <Switch
              checked={pitchedOnly}
              onCheckedChange={(v) =>
                updateParams({ pitchedOnly: v ? "true" : null })
              }
            />
            Pitched only
          </label>

          {activeFilterCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput("")
                router.replace(`${pathname}?groupBy=${groupBy}`)
              }}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Clear ({activeFilterCount})
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => mutate()}
            className="ml-auto"
          >
            <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {groupBy === "canonical" ? (
              <CanonicalTable
                rows={visibleRows as CanonicalRow[]}
                isLoading={isLoading && !data}
                error={!!error}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
              />
            ) : (
              <CatalogTable
                rows={visibleRows as CatalogRow[]}
                isLoading={isLoading && !data}
                error={!!error}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Canonical view ────────────────────────────────────────────────────

function CanonicalTable({
  rows,
  isLoading,
  error,
  expanded,
  toggleExpanded,
  sortBy,
  sortDir,
  onSort,
}: {
  rows: CanonicalRow[]
  isLoading: boolean
  error: boolean
  expanded: Set<string>
  toggleExpanded: (id: string) => void
  sortBy: string
  sortDir: "asc" | "desc"
  onSort: (field: string) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-stone-50 border-b">
        <tr className="text-xs uppercase text-muted-foreground">
          <th className="text-left px-3 py-2 font-medium w-8" aria-label="Expand" />
          <SortableHeader
            field="label"
            label="Canonical Service"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortableHeader
            field="variantCount"
            label="Variants"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="avgPrice"
            label="Avg Sold"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="proposalCount"
            label="Proposals"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="acceptedCount"
            label="Won"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="totalRevenue"
            label="Total Pitched"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="acceptedRevenue"
            label="Accepted"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
        </tr>
      </thead>
      <tbody>
        {isLoading ? (
          Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} className="border-b">
              <td colSpan={8} className="px-3 py-3">
                <Skeleton className="h-5 w-full" />
              </td>
            </tr>
          ))
        ) : error ? (
          <tr>
            <td colSpan={8} className="px-3 py-6 text-center text-rose-600">
              Failed to load services.
            </td>
          </tr>
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
              <FilterIcon className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No services match the current filters.
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const isOpen = expanded.has(row.id)
            const winRate =
              row.proposalCount > 0
                ? Math.round((row.acceptedCount / row.proposalCount) * 100)
                : null
            const meta = SERVICE_LINE_META[row.serviceLine]
            return (
              <CanonicalRowFragment
                key={row.id}
                row={row}
                isOpen={isOpen}
                onToggle={() => toggleExpanded(row.id)}
                winRate={winRate}
                meta={meta}
              />
            )
          })
        )}
      </tbody>
    </table>
  )
}

function CanonicalRowFragment({
  row,
  isOpen,
  onToggle,
  winRate,
  meta,
}: {
  row: CanonicalRow
  isOpen: boolean
  onToggle: () => void
  winRate: number | null
  meta: typeof SERVICE_LINE_META[ServiceLine]
}) {
  return (
    <>
      <tr
        className={cn(
          "border-b hover:bg-stone-50/60",
          row.variantCount > 1 ? "" : "",
        )}
      >
        <td className="px-2 py-2 align-top">
          {/* Always show the chevron — clicking it expands the variants
              panel. We expose it for every canonical row, even those
              with one variant, so users can quickly confirm what's
              folded in (or that nothing is). */}
          <button
            onClick={onToggle}
            className="p-1 rounded hover:bg-stone-200 text-muted-foreground"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        </td>
        <td className="px-3 py-2 max-w-[320px] align-top">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className="font-medium text-stone-900 truncate text-left hover:underline"
            >
              {row.label}
            </button>
            {!row.isCanonical ? (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1 border-amber-200 bg-amber-50 text-amber-800"
                title="No canonical mapping yet — using the raw line item name"
              >
                unmapped
              </Badge>
            ) : null}
            {!row.isActive && row.catalogCount > 0 ? (
              <Badge variant="outline" className="text-[10px] h-4 px-1">
                inactive
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] h-4 px-1 font-normal",
                meta.bg,
                meta.text,
                meta.border,
              )}
            >
              {row.serviceLine}
            </Badge>
            {row.categories.slice(0, 2).map((c) => (
              <span
                key={c}
                className="text-[10px] text-muted-foreground border rounded px-1 py-0.5"
              >
                {c}
              </span>
            ))}
            {row.description ? (
              <span className="text-xs text-muted-foreground truncate">
                {row.description}
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums align-top">
          <div className="flex flex-col items-end">
            <span className="text-stone-900 font-medium">
              {row.variantCount.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {row.catalogCount} catalog
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground align-top">
          {row.avgPrice !== null ? fmtMoney(row.avgPrice, row.currency) : "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums align-top">
          {row.proposalCount.toLocaleString()}
        </td>
        <td className="px-3 py-2 text-right tabular-nums align-top">
          <span className="text-emerald-700 font-medium">
            {row.acceptedCount.toLocaleString()}
          </span>
          {winRate !== null ? (
            <span className="text-xs text-muted-foreground ml-1">{winRate}%</span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right tabular-nums align-top">
          {fmtMoney(row.totalRevenue, row.currency)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-800 align-top">
          {fmtMoney(row.acceptedRevenue, row.currency)}
        </td>
      </tr>
      {isOpen ? (
        <tr className="bg-stone-50/60 border-b">
          <td className="px-3 py-3" />
          <td colSpan={7} className="px-3 py-3 text-xs">
            <CanonicalVariantPanel row={row} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function CanonicalVariantPanel({ row }: { row: CanonicalRow }) {
  return (
    <div className="flex flex-col gap-3">
      {row.catalogVariants.length > 0 ? (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
            Catalog variants ({row.catalogVariants.length})
          </div>
          <ul className="flex flex-col gap-1">
            {row.catalogVariants.map((v) => (
              <li
                key={v.ignition_service_id}
                className="flex items-center gap-2 text-stone-700"
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {v.ignition_service_id.slice(0, 8)}
                </span>
                <span className="flex-1">{v.name}</span>
                <span className="text-muted-foreground">
                  {titleCase(v.billing_type) || "—"}
                </span>
                <span className="tabular-nums text-stone-900">
                  {v.default_price !== null
                    ? fmtMoney(v.default_price, v.currency)
                    : "—"}
                </span>
                {!v.is_active ? (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    inactive
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.proposalNameVariants.length > 0 ? (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
            Names seen on proposals ({row.proposalNameVariants.length})
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {row.proposalNameVariants.map((v) => (
              <li
                key={v.name}
                className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 bg-stone-50/80"
              >
                <span className="text-stone-700">{v.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  ×{v.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.catalogVariants.length === 0 &&
      row.proposalNameVariants.length === 0 ? (
        <div className="text-muted-foreground italic">
          No variants recorded yet.
        </div>
      ) : null}
    </div>
  )
}

// ── Catalog view (legacy) ─────────────────────────────────────────────

function CatalogTable({
  rows,
  isLoading,
  error,
  sortBy,
  sortDir,
  onSort,
}: {
  rows: CatalogRow[]
  isLoading: boolean
  error: boolean
  sortBy: string
  sortDir: "asc" | "desc"
  onSort: (field: string) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-stone-50 border-b">
        <tr className="text-xs uppercase text-muted-foreground">
          <SortableHeader
            field="name"
            label="Service"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortableHeader
            field="category"
            label="Category"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
          <th className="text-left px-3 py-2 font-medium">Billing</th>
          <SortableHeader
            field="default_price"
            label="Default Price"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="avgPrice"
            label="Avg Sold"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="proposalCount"
            label="Proposals"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="acceptedCount"
            label="Won"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="totalRevenue"
            label="Total Pitched"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
          <SortableHeader
            field="acceptedRevenue"
            label="Accepted"
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            align="right"
          />
        </tr>
      </thead>
      <tbody>
        {isLoading ? (
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
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
              <FilterIcon className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No services match the current filters.
            </td>
          </tr>
        ) : (
          rows.map((s) => {
            const winRate =
              s.proposalCount > 0
                ? Math.round((s.acceptedCount / s.proposalCount) * 100)
                : null
            const meta = SERVICE_LINE_META[s.serviceLine]
            return (
              <tr
                key={s.ignition_service_id}
                className="border-b hover:bg-stone-50/60"
              >
                <td className="px-3 py-2 max-w-[260px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900 truncate">
                      {s.name}
                    </span>
                    {!s.is_active ? (
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        inactive
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] h-4 px-1 font-normal",
                        meta.bg,
                        meta.text,
                        meta.border,
                      )}
                    >
                      {s.serviceLine}
                    </Badge>
                    {/* Hint that this catalog row is mapped to a canonical
                        — gives the user a shortcut to understand which
                        bucket it'll roll into. */}
                    {s.canonicalLabel ? (
                      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                        <Link2 className="h-3 w-3" /> {s.canonicalLabel}
                      </span>
                    ) : null}
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
                    <span className="text-stone-700">
                      {titleCase(s.billing_type) || "—"}
                    </span>
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
  )
}

// ── Shared cells ──────────────────────────────────────────────────────

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
    <th
      className={cn(
        "font-medium px-3 py-2",
        align === "right" ? "text-right" : "text-left",
      )}
    >
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

// `MultiSelectChip` lives in components/sales/filter-chips.tsx so the
// chip experience is consistent across every Sales surface.
