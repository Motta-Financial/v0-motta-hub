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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

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
  const activeOnly = searchParams.get("activeOnly") === "true"
  const sortBy = searchParams.get("sortBy") || "totalRevenue"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"

  const [searchInput, setSearchInput] = useState(search)

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
    (activeOnly ? 1 : 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Services</h1>
        <p className="text-sm text-muted-foreground">
          {data
            ? `${data.services.length.toLocaleString()} of ${data.stats.totalServices.toLocaleString()} services`
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
                ) : data && data.services.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                      <FilterIcon className="h-6 w-6 mx-auto mb-2 opacity-40" />
                      No services match the current filters.
                    </td>
                  </tr>
                ) : (
                  data?.services.map((s) => {
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
                          {s.description ? (
                            <div className="text-xs text-muted-foreground truncate">
                              {s.description}
                            </div>
                          ) : null}
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

function MultiSelectChip({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            value.length > 0 ? "border-stone-900 bg-stone-50" : "",
          )}
        >
          <FilterIcon className="h-3.5 w-3.5" />
          {label}
          {value.length > 0 ? (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {value.length}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64" align="start">
        <Command>
          <CommandInput placeholder={`Filter ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const active = value.includes(opt)
                return (
                  <CommandItem
                    key={opt}
                    onSelect={() => {
                      onChange(active ? value.filter((v) => v !== opt) : [...value, opt])
                    }}
                  >
                    <span
                      className={cn(
                        "mr-2 inline-block h-3 w-3 rounded-sm border",
                        active ? "bg-stone-900 border-stone-900" : "border-stone-300",
                      )}
                    />
                    {titleCase(opt)}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
