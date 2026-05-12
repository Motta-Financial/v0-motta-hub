"use client"

/**
 * Sales > Recurring Revenue
 * ────────────────────────────────────────────────────────────────────────
 * Live MRR / ARR view for Accounting and Tax sourced directly from the
 * Ignition feed via the raw `payload.services` JSON on `ignition_proposals`
 * — not the normalized `ignition_proposal_services` table, which is
 * populated by an incomplete sync and drops services for ~460 of the
 * firm's active proposals. Reading from the payload guarantees the page
 * shows the same line items partners see inside Ignition.
 *
 * The classification + frequency policy lives in
 * `lib/sales/ignition-recurring.ts`. Tax engagements are treated as
 * one-time regardless of how Ignition records the cadence (installment-
 * billed returns are common). Numbers refresh whenever an Ignition sync
 * runs (cron every 15 min, plus a manual "Sync now" button in the header).
 *
 * The partner-maintained `motta_recurring_revenue` CSV is still queried
 * by the API for a "Not in Ignition yet" gap callout — clients the team
 * tracks as recurring but who haven't been moved onto Ignition yet. The
 * CSV is reference data, not the source of truth for MRR.
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
  RefreshCw,
  Zap,
  AlertCircle,
  Sparkles,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MultiSelectChip, RangeChip } from "@/components/sales/filter-chips"
import { X } from "lucide-react"

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
  source?: "ignition" | "curated"
  lastSyncedAt?: string | null
  totals: {
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    distinct_clients: number
    service_lines: number
    avg_mrr_per_client: number
    active_proposals?: number
  }
  departments: Array<{
    department: "Accounting" | "Tax"
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    service_lines: number
    client_count: number
  }>
  serviceBreakdown: Array<{
    department: "Accounting" | "Tax"
    service_type: string
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    service_lines: number
    client_count: number
  }>
  clients: Array<{
    department: "Accounting" | "Tax"
    client_name: string
    normalized_name: string
    organization_id?: string | null
    contact_id?: string | null
    service_types: string[]
    cadences: string[]
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    service_lines: number
    proposal_count?: number
    effective_start_date?: string | null
  }>
  rows: RecurringRow[]
  not_in_ignition?: Array<{
    department: "Accounting" | "Tax"
    client_name: string
    normalized_name: string
    service_types: string[]
    mrr: number
  }>
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
  // Auto-revalidate every minute so the page reflects new Ignition data
  // without forcing a hard reload. Combined with the 60s `revalidate` on
  // the API route, this gives a max ~2 minute staleness in the worst case.
  const { data, isLoading, mutate } = useSWR<RecurringResponse>(
    "/api/sales/recurring-revenue",
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  // Manual "Sync from Ignition" button — POST to /api/ignition/sync which
  // triggers a full backfill, then we revalidate the SWR cache so the
  // new numbers pop into the page without a navigation.
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  async function triggerSync() {
    if (syncing) return
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch("/api/ignition/sync", { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Sync failed (${res.status})`)
      }
      // Give Ignition's reporting API a beat to surface the changes
      // before we re-pull the aggregate. The cron usually finishes in
      // under 30s but we don't wait the full duration — `mutate` will
      // fetch the latest state regardless.
      await new Promise((r) => setTimeout(r, 1500))
      await mutate()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed")
      console.error("[sales/recurring-revenue] manual sync failed:", err)
    } finally {
      setSyncing(false)
    }
  }

  const [dept, setDept] = useState<DepartmentKey>("All")
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<
    "client_name" | "mrr" | "arr" | "service_lines"
  >("mrr")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  // Cadence / service-type / MRR-range filters live in local state (not the
  // URL) because this surface is a focused drilldown — users are typically
  // filtering ad-hoc rather than sharing links. Keep it simple.
  const [cadence, setCadence] = useState<string[]>([])
  const [serviceType, setServiceType] = useState<string[]>([])
  // MRR range mirrors RangeChip's contract — strings ("" means "no
  // bound"). We coerce to numbers at filter-time.
  const [mrrMin, setMrrMin] = useState("")
  const [mrrMax, setMrrMax] = useState("")

  // Cadence/service-type option lists derived from the loaded rows so the
  // dropdown only shows values that exist in the data after the
  // department-tab filter is applied.
  const cadenceOptions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const c of data.clients) {
      if (dept !== "All" && c.department !== dept) continue
      for (const cad of c.cadences) set.add(cad)
    }
    return [...set].sort()
  }, [data, dept])

  const serviceTypeOptions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const c of data.clients) {
      if (dept !== "All" && c.department !== dept) continue
      for (const st of c.service_types) set.add(st)
    }
    return [...set].sort()
  }, [data, dept])

  const activeFilterCount =
    (search ? 1 : 0) +
    cadence.length +
    serviceType.length +
    (mrrMin ? 1 : 0) +
    (mrrMax ? 1 : 0)

  function clearAllFilters() {
    setSearch("")
    setCadence([])
    setServiceType([])
    setMrrMin("")
    setMrrMax("")
  }

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
    // Cadence: at least one of the client's cadences is selected.
    if (cadence.length) {
      list = list.filter((c) =>
        c.cadences.some((cad) => cadence.includes(cad)),
      )
    }
    // Service Type: at least one of the client's service types matches.
    if (serviceType.length) {
      list = list.filter((c) =>
        c.service_types.some((st) => serviceType.includes(st)),
      )
    }
    // MRR range: inclusive on both ends so $0 as a min still includes
    // legitimate $0 cases (rare but possible). Empty string means "no
    // bound". `Number("")` is 0, so we test the raw string first.
    if (mrrMin !== "") {
      const lo = Number(mrrMin)
      if (!Number.isNaN(lo)) list = list.filter((c) => c.mrr >= lo)
    }
    if (mrrMax !== "") {
      const hi = Number(mrrMax)
      if (!Number.isNaN(hi)) list = list.filter((c) => c.mrr <= hi)
    }
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
  }, [data, dept, search, sortBy, sortDir, cadence, serviceType, mrrMin, mrrMax])

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
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold text-stone-900">
                Recurring Revenue
              </h1>
              {/* Live-source pill. Always rendered (even while loading) so
                  the page reads "live from Ignition" the moment it mounts.
                  The pulsing green dot signals real-time freshness; the
                  timestamp tells you exactly when the last Ignition sync
                  landed. */}
              <Badge
                variant="outline"
                className="gap-1.5 bg-emerald-50 border-emerald-200 text-emerald-900 font-normal h-6"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Live from Ignition
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Live MRR / ARR across Accounting and Tax, aggregated from active
              Ignition proposals at the service-line level. Monthly fees roll
              into MRR; quarterly fees contribute fee ÷ 3. The
              <span className="font-medium text-stone-900">
                {" "}
                Onboarding &amp; Optimization{" "}
              </span>
              column captures one-time setup fees billed alongside recurring
              engagements.
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {data?.lastSyncedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3" />
                  Synced {formatDistanceToNow(new Date(data.lastSyncedAt), { addSuffix: true })}
                </span>
              ) : data ? (
                <span className="inline-flex items-center gap-1.5 text-amber-700">
                  <AlertCircle className="h-3 w-3" />
                  No Ignition connection synced yet
                </span>
              ) : null}
              {data?.totals.active_proposals ? (
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="h-3 w-3" />
                  {data.totals.active_proposals} active proposals
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={triggerSync}
                disabled={syncing}
              >
                <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
                {syncing ? "Syncing…" : "Sync from Ignition"}
              </Button>
            </div>
            {syncError ? (
              <p className="text-xs text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3" />
                {syncError}
              </p>
            ) : null}
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
              {(data.totals.onboarding_total ?? 0) > 0 ? (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {fmt(data.totals.onboarding_total ?? 0)} onboarding fees
                </div>
              ) : null}
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
          label="Onboarding & Optimization"
          value={
            data
              ? fmt(
                  dept === "All"
                    ? data.totals.onboarding_total ?? 0
                    : data.departments.find((d) => d.department === dept)
                        ?.onboarding_total ?? 0,
                )
              : null
          }
          subtitle={
            visibleTotals
              ? `${fmt(visibleTotals.avg_mrr_per_client)} avg MRR / client`
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
              {/* Filter chip rail. Shows the same MultiSelect/Range chips
                  used elsewhere on Sales so the experience is consistent. */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <MultiSelectChip
                  label="Cadence"
                  options={cadenceOptions}
                  value={cadence}
                  onChange={setCadence}
                />
                <MultiSelectChip
                  label="Service type"
                  options={serviceTypeOptions}
                  value={serviceType}
                  onChange={setServiceType}
                />
                <RangeChip
                  label="MRR"
                  min={mrrMin}
                  max={mrrMax}
                  onChange={({ min, max }) => {
                    setMrrMin(min)
                    setMrrMax(max)
                  }}
                />
                {activeFilterCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="h-9"
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Clear ({activeFilterCount})
                  </Button>
                ) : null}
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
                      <th
                        className="text-right font-medium px-3 py-2"
                        title="One-time setup / clean-up / optimization fees billed alongside the recurring engagement"
                      >
                        Onboarding
                      </th>
                      <th
                        className="text-right font-medium px-3 py-2 pr-4"
                        title="Other one-time line items on the same Ignition proposals"
                      >
                        Other 1x
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading || !data ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-stone-100">
                          <td colSpan={8} className="px-4 py-3">
                            <Skeleton className="h-5" />
                          </td>
                        </tr>
                      ))
                    ) : filteredClients.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
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
                          {/* Onboarding & Optimization fees, separate from
                              the catch-all one-time bucket. Highlighted in
                              amber when present so partners can scan for
                              recently onboarded engagements. */}
                          <td
                            className={cn(
                              "px-3 py-2.5 text-right tabular-nums",
                              (c.onboarding_total ?? 0) > 0
                                ? "text-amber-900 font-medium"
                                : "text-muted-foreground",
                            )}
                          >
                            {(c.onboarding_total ?? 0) > 0
                              ? fmt(c.onboarding_total ?? 0)
                              : "—"}
                          </td>
                          {/* "Other 1x" = total one-time MINUS onboarding.
                              Avoids double-counting because onboarding is a
                              subset of one_time_total on the server side. */}
                          <td className="px-3 py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                            {c.one_time_total - (c.onboarding_total ?? 0) > 0
                              ? fmt(c.one_time_total - (c.onboarding_total ?? 0))
                              : "—"}
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
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-900">
                          {fmt(
                            filteredClients.reduce(
                              (s, c) => s + (c.onboarding_total ?? 0),
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-3 py-2.5 pr-4 text-right tabular-nums">
                          {fmt(
                            filteredClients.reduce(
                              (s, c) =>
                                s + (c.one_time_total - (c.onboarding_total ?? 0)),
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

          {/* ── Gap diagnostic: curated clients NOT in Ignition yet ──────
              The partner team maintains a CSV list of every client they
              consider on a recurring engagement. Some haven't been
              proposed through Ignition yet — those don't show in the
              live totals above but are visible here so the team can
              close the gap. Filtered to the active department tab. */}
          {data?.not_in_ignition && data.not_in_ignition.length > 0 ? (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-700" />
                  Not in Ignition yet
                </CardTitle>
                <CardDescription>
                  Clients on the curated CSV list with no active Ignition
                  proposal. Send a proposal through Ignition to bring them
                  into the live totals above.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-amber-100/40 border-y border-amber-200 text-xs uppercase tracking-wide text-amber-900">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">
                          Client
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Dept
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Service Lines
                        </th>
                        <th className="text-right font-medium px-3 py-2 pr-4">
                          Curated MRR
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.not_in_ignition
                        .filter((c) => dept === "All" || c.department === dept)
                        .slice(0, 25)
                        .map((c) => (
                          <tr
                            key={`gap-${c.normalized_name}-${c.department}`}
                            className="border-b border-amber-100 hover:bg-amber-50/60"
                          >
                            <td className="px-4 py-2 font-medium text-stone-900">
                              {c.client_name}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="outline"
                                className={cn(DEPT_BADGE[c.department])}
                              >
                                {c.department}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {c.service_types.join(", ") || "—"}
                            </td>
                            <td className="px-3 py-2 pr-4 text-right tabular-nums text-stone-700">
                              {fmt(c.mrr)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {data.not_in_ignition.filter(
                  (c) => dept === "All" || c.department === dept,
                ).length > 25 ? (
                  <p className="text-xs text-muted-foreground px-4 pt-2">
                    Showing 25 of{" "}
                    {
                      data.not_in_ignition.filter(
                        (c) => dept === "All" || c.department === dept,
                      ).length
                    }{" "}
                    gap clients.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
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
