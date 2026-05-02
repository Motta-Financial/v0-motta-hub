"use client"

/**
 * Sales > Recurring Revenue
 * ────────────────────────────────────────────────────────────────────────
 * Curated MRR / ARR view for Accounting and Tax. Sourced from
 * `motta_recurring_revenue`, which is the partner-maintained authoritative
 * list (CSV-seeded). Ignition data is intentionally not used here because
 * many one-time engagements show up there with monthly billing schedules.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  TrendingUp,
  Repeat,
  Users,
  CircleDollarSign,
  Search as SearchIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calculator,
  Briefcase,
  ArrowLeft,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type DepartmentKey = "All" | "Accounting" | "Tax"

interface RecurringRow {
  id: string
  department: "Accounting" | "Tax"
  service_type: string
  client_name: string
  cadence: "Monthly" | "Quarterly"
  service_fee: number
  one_time_fee: number
}

interface RecurringResponse {
  totals: {
    mrr: number
    arr: number
    one_time_total: number
    distinct_clients: number
    service_lines: number
    avg_mrr_per_client: number
  }
  departments: Array<{
    department: "Accounting" | "Tax"
    mrr: number
    arr: number
    one_time_total: number
    service_lines: number
    client_count: number
  }>
  serviceBreakdown: Array<{
    department: "Accounting" | "Tax"
    service_type: string
    mrr: number
    arr: number
    one_time_total: number
    service_lines: number
    client_count: number
  }>
  clients: Array<{
    department: "Accounting" | "Tax"
    client_name: string
    normalized_name: string
    service_types: string[]
    cadences: string[]
    mrr: number
    arr: number
    one_time_total: number
    service_lines: number
  }>
  rows: RecurringRow[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0)
}

function fmtPrecise(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0)
}

const DEPT_BADGE: Record<string, string> = {
  Accounting: "bg-blue-100 text-blue-900 border-blue-200",
  Tax: "bg-emerald-100 text-emerald-900 border-emerald-200",
}

export function SalesRecurringRevenue() {
  const { data, isLoading } = useSWR<RecurringResponse>(
    "/api/sales/recurring-revenue",
    fetcher,
  )

  const [dept, setDept] = useState<DepartmentKey>("All")
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<
    "client_name" | "mrr" | "arr" | "service_lines"
  >("mrr")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const filteredClients = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    let list = data.clients
    if (dept !== "All") list = list.filter((c) => c.department === dept)
    if (q)
      list = list.filter(
        (c) =>
          c.client_name.toLowerCase().includes(q) ||
          c.service_types.some((s) => s.toLowerCase().includes(q)),
      )
    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      switch (sortBy) {
        case "client_name":
          return a.client_name.localeCompare(b.client_name) * dir
        case "arr":
          return (a.arr - b.arr) * dir
        case "service_lines":
          return (a.service_lines - b.service_lines) * dir
        case "mrr":
        default:
          return (a.mrr - b.mrr) * dir
      }
    })
    return list
  }, [data, dept, search, sortBy, sortDir])

  const filteredService = useMemo(() => {
    if (!data) return []
    let list = data.serviceBreakdown
    if (dept !== "All") list = list.filter((s) => s.department === dept)
    return list
  }, [data, dept])

  const visibleTotals = useMemo(() => {
    if (!data) return null
    if (dept === "All") return data.totals
    const subset = data.departments.find((d) => d.department === dept)
    if (!subset) {
      return {
        mrr: 0,
        arr: 0,
        one_time_total: 0,
        distinct_clients: 0,
        service_lines: 0,
        avg_mrr_per_client: 0,
      }
    }
    const distinct = new Set(
      data.clients
        .filter((c) => c.department === dept)
        .map((c) => c.normalized_name),
    ).size
    return {
      mrr: subset.mrr,
      arr: subset.arr,
      one_time_total: subset.one_time_total,
      distinct_clients: distinct,
      service_lines: subset.service_lines,
      avg_mrr_per_client: distinct > 0 ? subset.mrr / distinct : 0,
    }
  }, [data, dept])

  const maxServiceMrr = useMemo(
    () => Math.max(1, ...filteredService.map((s) => s.mrr)),
    [filteredService],
  )

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(col)
      setSortDir(col === "client_name" ? "asc" : "desc")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Link
          href="/sales"
          className="text-sm text-muted-foreground hover:text-stone-900 transition-colors flex items-center gap-1.5 w-fit"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Sales
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">
              Recurring Revenue
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl mt-1">
              Authoritative monthly recurring revenue across Accounting and Tax
              service lines. Sourced from the partner-maintained CSV — Ignition
              one-time engagements are excluded.
            </p>
          </div>
          {data && (
            <div className="flex flex-col items-end gap-0.5">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Total MRR
              </div>
              <div className="text-3xl font-semibold tabular-nums text-stone-900">
                {fmt(data.totals.mrr)}
              </div>
              <div className="text-xs text-muted-foreground">
                {fmt(data.totals.arr)} annualized
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={dept === "All" ? "Combined MRR" : `${dept} MRR`}
          value={visibleTotals ? fmt(visibleTotals.mrr) : null}
          subtitle={
            visibleTotals
              ? `${fmtPrecise(visibleTotals.mrr)} per month`
              : undefined
          }
          icon={Repeat}
          tone="emerald"
        />
        <KpiCard
          label="Annualized (ARR)"
          value={visibleTotals ? fmt(visibleTotals.arr) : null}
          subtitle="MRR × 12 + Quarterly × 4"
          icon={TrendingUp}
          tone="blue"
        />
        <KpiCard
          label="Recurring Clients"
          value={
            visibleTotals
              ? visibleTotals.distinct_clients.toLocaleString()
              : null
          }
          subtitle={
            visibleTotals
              ? `${visibleTotals.service_lines} service lines`
              : undefined
          }
          icon={Users}
          tone="stone"
        />
        <KpiCard
          label="Avg MRR / Client"
          value={
            visibleTotals ? fmt(visibleTotals.avg_mrr_per_client) : null
          }
          subtitle={
            visibleTotals && visibleTotals.one_time_total > 0
              ? `${fmt(visibleTotals.one_time_total)} one-time`
              : undefined
          }
          icon={CircleDollarSign}
          tone="amber"
        />
      </div>

      {/* Department tabs */}
      <Tabs value={dept} onValueChange={(v) => setDept(v as DepartmentKey)}>
        <TabsList>
          <TabsTrigger value="All" className="gap-2">
            All
            {data && (
              <Badge variant="outline" className="font-normal">
                {data.totals.distinct_clients}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="Accounting" className="gap-2">
            <Calculator className="h-3.5 w-3.5" />
            Accounting
            {data && (
              <Badge variant="outline" className="font-normal">
                {data.departments.find((d) => d.department === "Accounting")
                  ?.client_count ?? 0}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="Tax" className="gap-2">
            <Briefcase className="h-3.5 w-3.5" />
            Tax
            {data && (
              <Badge variant="outline" className="font-normal">
                {data.departments.find((d) => d.department === "Tax")
                  ?.client_count ?? 0}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={dept} className="flex flex-col gap-6 mt-6">
          {/* Service-type breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By service line</CardTitle>
              <CardDescription>
                Monthly contribution per service. Quarterly fees are normalized
                to monthly (÷ 3).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isLoading || !data ? (
                <>
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </>
              ) : filteredService.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No service lines found for this filter.
                </p>
              ) : (
                filteredService.map((s) => {
                  const pct = (s.mrr / maxServiceMrr) * 100
                  return (
                    <div
                      key={`${s.department}-${s.service_type}`}
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0",
                              DEPT_BADGE[s.department],
                            )}
                          >
                            {s.department}
                          </Badge>
                          <span className="font-medium text-stone-900 truncate">
                            {s.service_type}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            · {s.client_count}{" "}
                            {s.client_count === 1 ? "client" : "clients"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 tabular-nums">
                          <span className="text-xs text-muted-foreground">
                            {fmt(s.arr)} / yr
                          </span>
                          <span className="font-semibold text-stone-900">
                            {fmt(s.mrr)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            s.department === "Accounting"
                              ? "bg-blue-500"
                              : "bg-emerald-500",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Client table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Clients</CardTitle>
              <CardDescription>
                {data
                  ? `${filteredClients.length} of ${data.clients.length} recurring clients`
                  : "Loading…"}
              </CardDescription>
              <div className="relative pt-2">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/4 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search clients or service types…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 border-y border-stone-200 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <SortableTh
                        col="client_name"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onClick={() => handleSort("client_name")}
                        className="px-4"
                      >
                        Client
                      </SortableTh>
                      <th className="text-left font-medium px-3 py-2">Dept</th>
                      <th className="text-left font-medium px-3 py-2">
                        Service Lines
                      </th>
                      <th className="text-left font-medium px-3 py-2">
                        Cadence
                      </th>
                      <SortableTh
                        col="mrr"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onClick={() => handleSort("mrr")}
                        align="right"
                      >
                        MRR
                      </SortableTh>
                      <SortableTh
                        col="arr"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onClick={() => handleSort("arr")}
                        align="right"
                      >
                        ARR
                      </SortableTh>
                      <th className="text-right font-medium px-3 py-2 pr-4">
                        One-time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading || !data ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-stone-100">
                          <td colSpan={7} className="px-4 py-3">
                            <Skeleton className="h-5" />
                          </td>
                        </tr>
                      ))
                    ) : filteredClients.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-12 text-center text-muted-foreground"
                        >
                          No clients match your filters.
                        </td>
                      </tr>
                    ) : (
                      filteredClients.map((c) => (
                        <tr
                          key={`${c.department}-${c.normalized_name}`}
                          className="border-b border-stone-100 hover:bg-stone-50/60 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-medium text-stone-900">
                            {c.client_name}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge
                              variant="outline"
                              className={cn(DEPT_BADGE[c.department])}
                            >
                              {c.department}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {c.service_types.map((st) => (
                                <Badge
                                  key={st}
                                  variant="outline"
                                  className="font-normal text-xs bg-stone-50"
                                >
                                  {st}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {c.cadences.join(" + ")}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-stone-900">
                            {fmt(c.mrr)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-stone-700">
                            {fmt(c.arr)}
                          </td>
                          <td className="px-3 py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                            {c.one_time_total > 0 ? fmt(c.one_time_total) : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {data && filteredClients.length > 0 && (
                    <tfoot className="bg-stone-50 border-t-2 border-stone-300 font-semibold text-stone-900">
                      <tr>
                        <td
                          className="px-4 py-2.5 text-xs uppercase tracking-wide"
                          colSpan={4}
                        >
                          {dept === "All" ? "Combined" : dept} subtotal ·{" "}
                          {filteredClients.length} clients
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {fmt(
                            filteredClients.reduce((s, c) => s + c.mrr, 0),
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {fmt(
                            filteredClients.reduce((s, c) => s + c.arr, 0),
                          )}
                        </td>
                        <td className="px-3 py-2.5 pr-4 text-right tabular-nums">
                          {fmt(
                            filteredClients.reduce(
                              (s, c) => s + c.one_time_total,
                              0,
                            ),
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SortableTh({
  col,
  sortBy,
  sortDir,
  onClick,
  children,
  align = "left",
  className,
}: {
  col: string
  sortBy: string
  sortDir: "asc" | "desc"
  onClick: () => void
  children: React.ReactNode
  align?: "left" | "right"
  className?: string
}) {
  const active = sortBy === col
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <th
      className={cn(
        "font-medium py-2 cursor-pointer select-none hover:text-stone-900 transition-colors",
        align === "right" ? "text-right pr-3" : "text-left px-3",
        className,
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1",
          align === "right" && "justify-end w-full",
        )}
      >
        {children}
        <Icon
          className={cn(
            "h-3 w-3",
            active ? "text-stone-900" : "text-stone-400",
          )}
        />
      </span>
    </th>
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
  value: string | null
  subtitle?: string
  icon: any
  tone: "stone" | "emerald" | "amber" | "blue"
}) {
  const toneStyles: Record<string, string> = {
    stone: "text-stone-900 bg-stone-100",
    emerald: "text-emerald-900 bg-emerald-100",
    amber: "text-amber-900 bg-amber-100",
    blue: "text-blue-900 bg-blue-100",
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn("p-2 rounded-md shrink-0", toneStyles[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </div>
          {value ? (
            <div className="text-xl font-semibold tabular-nums truncate">
              {value}
            </div>
          ) : (
            <Skeleton className="h-6 w-24 mt-1" />
          )}
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">
              {subtitle}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
