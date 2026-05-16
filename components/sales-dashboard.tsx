"use client"

/**
 * Sales Dashboard
 * ─────────────────────────────────────────────────────────────────────────
 * Single-page analytics view over the Ignition proposal export.
 *
 * Data flow:
 *   1. Filters live in URL query params (so the view is shareable / bookmarkable)
 *   2. SWR hits /api/sales/dashboard with those params
 *   3. Server returns the filtered proposal set + filter-dimension catalog
 *   4. Client computes every KPI/chart/table from the filtered set
 *
 * The aggregation layer is deliberately client-side: with ~900 proposals the
 * full filtered dataset is a few hundred KB and lets the user toggle filter
 * chips with no network round-trip per click.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import useSWR from "swr"
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Legend,
  Cell,
} from "recharts"
import { format, parseISO, startOfYear } from "date-fns"
import {
  ChevronDown,
  X,
  Search as SearchIcon,
  TrendingUp,
  Trophy,
  Hourglass,
  XCircle,
  CalendarDays,
  Repeat2,
  RefreshCcw,
  ExternalLink,
  Filter as FilterIcon,
  Calculator,
  FileText,
  Lightbulb,
  MoreHorizontal,
  ChevronRight,
  PieChart,
  Wallet,
  Receipt,
  Banknote,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import { SalesUSMap, type StateData } from "@/components/sales-us-map"
import { ProposalStateEdit } from "@/components/sales/proposal-state-edit"
import {
  SERVICE_LINE_META,
  type ServiceLine,
} from "@/lib/sales/service-line-classifier"

// ── Types matching /api/sales/dashboard response ──────────────────────────
interface ProposalService {
  id: string
  service_name: string
  /**
   * Canonical-catalog label resolved server-side. UI surfaces should use
   * this so historical naming variants (e.g. "Outsourced | Tax Prep
   * (1120s): S-Corporation") collapse into the canonical
   * "Tax Prep — S-Corp (1120s)" row. Falls back to `service_name` when
   * the line item doesn't match any catalog entry, so it's always safe
   * to render directly without a `??`.
   */
  display_name: string
  canonical_id: string | null
  description: string | null
  quantity: number | null
  unit_price: number | null
  total_amount: number
  currency: string | null
  billing_frequency: string | null
  billing_type: string | null
  status: string | null
  ordinal: number | null
}

interface ServiceLineData {
  serviceLine: ServiceLine
  revenue: number
  count: number
  topServices: Array<{ name: string; revenue: number; count: number }>
}
interface Proposal {
  proposal_id: string
  proposal_number: string | null
  title: string | null
  status: string
  client_name: string | null
  client_email: string | null
  client_display: string
  organization_id: string | null
  contact_id: string | null
  entity_kind: "organization" | "contact" | null
  state: string | null
  city: string | null
  country: string | null
  /** Where state came from — drives which table the inline editor writes to. */
  state_source: "organization" | "contact" | "ignition_client" | null
  ignition_client_id: string | null
  total_value: number
  one_time_total: number
  recurring_total: number
  recurring_frequency: string | null
  annualized_recurring: number
  currency: string
  sent_at: string | null
  accepted_at: string | null
  completed_at: string | null
  lost_at: string | null
  lost_reason: string | null
  archived_at: string | null
  client_partner: string | null
  client_manager: string | null
  proposal_sent_by: string | null
  billing_starts_on: string | null
  effective_start_date: string | null
  last_event_at: string | null
  created_at: string | null
  services: ProposalService[]
}
interface DashboardResponse {
  proposals: Proposal[]
  totalUnfiltered: number
  dimensions: {
    states: string[]
    partners: string[]
    managers: string[]
    sentBy: string[]
    statuses: string[]
  }
  serviceLines: ServiceLineData[]
  stateBreakdown: StateData[]
  /**
   * Authoritative MRR/ARR roll-up from the curated `motta_recurring_revenue`
   * table — same source as the dedicated /sales/recurring-revenue page.
   * Used by the "Annualized Recurring" KPI so the two surfaces never disagree.
   * Always reflects the current snapshot (not subject to the dashboard's
   * date filter), since the curated CSV represents engagements in force today.
   */
  recurringSummary: {
    mrr: number
    arr: number
    one_time_total: number
    distinct_clients: number
    service_lines: number
  }
  /**
   * Payouts (collected cash) roll-up, scoped to the same date window
   * as the proposal set. Sourced from `ignition_payments.paid_at`
   * because `ignition_disbursals` is the legacy Zapier-fed table and
   * is effectively empty in production.
   */
  payouts: {
    count: number
    gross: number
    fees: number
    net: number
    distinctClients: number
    byMonth: Array<{
      month: string
      count: number
      gross: number
      net: number
      fees: number
    }>
    topClients: Array<{
      ignition_client_id: string
      name: string
      kind: "organization" | "contact" | null
      id: string | null
      payment_count: number
      gross: number
      net: number
    }>
  }
}

const fetcher = (url: string): Promise<DashboardResponse> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to load sales data")
    return r.json()
  })

// ── Status palette (matches the rest of the platform) ────────────────────
// Source-of-truth statuses observed in `ignition_proposals.status`:
// accepted, completed, lost, awaiting_acceptance, archived, draft. We
// also keep `sent` and `revoked` entries for legacy/safety: the original
// Zapier-fed mapping briefly emitted `sent`, and the Reporting API
// occasionally surfaces `revoked` on cancelled engagements.
const STATUS_META: Record<string, { label: string; color: string; tone: string }> = {
  accepted:            { label: "Accepted",  color: "#3F7D58", tone: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  completed:           { label: "Completed", color: "#1F4E40", tone: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  awaiting_acceptance: { label: "Awaiting",  color: "#C97A2C", tone: "bg-amber-100 text-amber-800 border-amber-200" },
  sent:                { label: "Sent",      color: "#C97A2C", tone: "bg-amber-100 text-amber-800 border-amber-200" },
  draft:               { label: "Draft",     color: "#9C9285", tone: "bg-stone-100 text-stone-700 border-stone-200" },
  lost:                { label: "Lost",      color: "#A6433A", tone: "bg-rose-100 text-rose-800 border-rose-200" },
  archived:            { label: "Archived",  color: "#7A7164", tone: "bg-stone-200 text-stone-700 border-stone-300" },
  revoked:             { label: "Revoked",   color: "#7A4A3A", tone: "bg-stone-200 text-stone-700 border-stone-300" },
}
const statusMeta = (s: string) =>
  STATUS_META[s] ?? { label: s || "Unknown", color: "#7A7164", tone: "bg-stone-100 text-stone-700 border-stone-200" }

// Categorise a status into the high-level lifecycle bucket the KPIs roll
// up against. Centralised so the funnel/trend/KPIs can't drift apart.
const PIPELINE_STATUSES = new Set(["sent", "awaiting_acceptance", "draft"])
const WON_STATUSES = new Set(["accepted", "completed"])
const LOST_STATUSES = new Set(["lost"])

// ── Helpers ──────────────────────────────────────────────────────────────
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)
const fmtMoneyCompact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(n)
const fmtCount = (n: number) => new Intl.NumberFormat("en-US").format(n)
const fmtPct = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(n)

// Default date range: year-to-date. Sales reporting is run on a
// calendar-year cadence (annual quotas, year-end commission true-ups),
// so anchoring the dashboard at Jan 1 of the current year matches how
// the partners actually consume the numbers. Users can extend or
// shorten the window via the date range chip when they need to.
const defaultStart = format(startOfYear(new Date()), "yyyy-MM-dd")

export function SalesDashboard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // ── Filter state ── pulled from URL so reloads / shares preserve view ──
  // Default to `activity`: matches a proposal when ANY of its lifecycle
  // dates (accepted_at, lost_at, sent_at, created_at) falls in the
  // window. Earlier we defaulted to `accepted_at` which silently hid
  // every lost / draft / awaiting_acceptance row (those columns are
  // null until the proposal closes), so users couldn't see what was
  // actually in flight. The strict single-column modes are still
  // available via the Date tabs for users who want a pure "won YTD" or
  // "sent YTD" lens.
  const dateField =
    (searchParams.get("dateField") as
      | "activity"
      | "created_at"
      | "accepted_at"
      | "sent_at") || "activity"
  const startDate = searchParams.get("startDate") || defaultStart
  const endDate = searchParams.get("endDate") || ""
  const statusFilter = (searchParams.get("status") || "").split(",").filter(Boolean)
  const partnerFilter = (searchParams.get("partner") || "").split(",").filter(Boolean)
  const managerFilter = (searchParams.get("manager") || "").split(",").filter(Boolean)
  const sentByFilter = (searchParams.get("sentBy") || "").split(",").filter(Boolean)
  const stateFilter = (searchParams.get("state") || "").split(",").filter(Boolean)
  const minValue = searchParams.get("minValue") || ""
  const maxValue = searchParams.get("maxValue") || ""
  const search = searchParams.get("search") || ""

  // Search input is debounced locally before being mirrored to the URL,
  // otherwise every keystroke would trigger a refetch.
  const [searchInput, setSearchInput] = useState(search)

  // ── Table-local refinement state ──────────────────────────────────────
  // These are intentionally NOT URL-synced. They refine the already-
  // fetched proposal set in-place (no extra round-trip), and acting on
  // them feels instant — perfect for letting a partner quickly carve up
  // "show me only what I lost this year" without losing the rest of
  // the page's filter context.
  const [tableBucket, setTableBucket] = useState<
    "all" | "won" | "pipeline" | "lost" | "other"
  >("all")
  const [tableSearch, setTableSearch] = useState("")
  const [tableSortBy, setTableSortBy] = useState<
    "date" | "value" | "status" | "proposal" | "client"
  >("date")
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc")
  const toggleTableSort = (col: typeof tableSortBy) => {
    if (tableSortBy === col) {
      setTableSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setTableSortBy(col)
      // Value/date columns are most useful as "biggest first"; text
      // columns default to A→Z which matches user mental model.
      setTableSortDir(col === "proposal" || col === "client" ? "asc" : "desc")
    }
  }
  const resetTableFilters = () => {
    setTableBucket("all")
    setTableSearch("")
    setTableSortBy("date")
    setTableSortDir("desc")
  }

  // Updates a single param while preserving the rest. Empty string removes it.
  const setParam = (key: string, value: string | null) => {
    const sp = new URLSearchParams(searchParams.toString())
    if (!value) sp.delete(key)
    else sp.set(key, value)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  // Build the query string for SWR. Cache key changes when any filter changes,
  // so SWR will fetch the new dataset (with deduping for repeat requests).
  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set("dateField", dateField)
    if (startDate) sp.set("startDate", startDate)
    if (endDate) sp.set("endDate", endDate)
    if (statusFilter.length) sp.set("status", statusFilter.join(","))
    if (partnerFilter.length) sp.set("partner", partnerFilter.join(","))
    if (managerFilter.length) sp.set("manager", managerFilter.join(","))
    if (sentByFilter.length) sp.set("sentBy", sentByFilter.join(","))
    if (stateFilter.length) sp.set("state", stateFilter.join(","))
    if (minValue) sp.set("minValue", minValue)
    if (maxValue) sp.set("maxValue", maxValue)
    if (search) sp.set("search", search)
    return sp.toString()
  }, [
    dateField, startDate, endDate,
    statusFilter.join(","), partnerFilter.join(","), managerFilter.join(","),
    sentByFilter.join(","), stateFilter.join(","),
    minValue, maxValue, search,
  ])

  const { data, error, isLoading, mutate } = useSWR<DashboardResponse>(
    `/api/sales/dashboard?${queryString}`,
    fetcher,
    { keepPreviousData: true },
  )

  const proposals = data?.proposals ?? []

  // ── KPI aggregations ──────────────────────────────────────────────────
  // Note on recurring revenue: the "Annualized Recurring" KPI is NOT
  // computed here. It used to be `sum(p.annualized_recurring)` over
  // accepted proposals, which double-counted clients with multiple
  // historical renewals AND mis-classified annual engagements that
  // Ignition exports as monthly billing schedules ($300/mo × 12 priced
  // engagements showed as $300/mo recurring). The authoritative number
  // comes from `motta_recurring_revenue` via `data.recurringSummary` so
  // the dashboard and the dedicated /sales/recurring-revenue page always
  // agree. We still keep `oneTimeAccepted` here because that's a true
  // sum-of-proposals metric.
  const kpis = useMemo(() => {
    let totalCount = 0
    let acceptedCount = 0
    let acceptedValue = 0
    let pipelineValue = 0
    let pipelineCount = 0
    let lostValue = 0
    let lostCount = 0
    let awaitingCount = 0
    let awaitingValue = 0
    let draftCount = 0
    let oneTimeAccepted = 0
    let totalContractValue = 0

    for (const p of proposals) {
      totalCount++
      totalContractValue += p.total_value
      const s = p.status
      if (WON_STATUSES.has(s)) {
        acceptedCount++
        acceptedValue += p.total_value
        oneTimeAccepted += p.one_time_total
      } else if (PIPELINE_STATUSES.has(s)) {
        // "Pipeline" = anything still in motion. The live DB uses
        // `awaiting_acceptance` (60+ rows) for sent-but-undecided —
        // matching only on the legacy `sent` value showed an empty
        // Pipeline KPI even on dashboards where the partner had ~30
        // open deals.
        pipelineCount++
        pipelineValue += p.total_value
        if (s === "awaiting_acceptance" || s === "sent") {
          awaitingCount++
          awaitingValue += p.total_value
        } else if (s === "draft") {
          draftCount++
        }
      } else if (LOST_STATUSES.has(s)) {
        lostCount++
        lostValue += p.total_value
      }
    }

    // Win rate is calculated against decided proposals only (won + lost)
    // since pipeline rows are still in flight and shouldn't dilute the
    // metric.
    const decided = acceptedCount + lostCount
    const winRate = decided > 0 ? acceptedCount / decided : 0
    const avgDealSize = acceptedCount > 0 ? acceptedValue / acceptedCount : 0

    return {
      totalCount, totalContractValue,
      acceptedCount, acceptedValue, oneTimeAccepted, avgDealSize,
      pipelineCount, pipelineValue,
      awaitingCount, awaitingValue,
      draftCount,
      lostCount, lostValue,
      winRate,
    }
  }, [proposals])

  // ── Status funnel (counts + sums) ─────────────────────────────────────
  const funnelData = useMemo(() => {
    // Order reflects the actual lifecycle stages we see in production
    // (awaiting_acceptance is the post-send / pre-decision state) plus
    // legacy `sent` as a fallback.
    const order = [
      "draft",
      "sent",
      "awaiting_acceptance",
      "accepted",
      "completed",
      "lost",
      "revoked",
      "archived",
    ]
    const map = new Map<string, { status: string; count: number; value: number }>()
    for (const p of proposals) {
      const cur = map.get(p.status) ?? { status: p.status, count: 0, value: 0 }
      cur.count += 1
      cur.value += p.total_value
      map.set(p.status, cur)
    }
    return order
      .filter((s) => map.has(s))
      .map((s) => map.get(s)!)
      .concat(
        [...map.entries()]
          .filter(([s]) => !order.includes(s))
          .map(([, v]) => v),
      )
  }, [proposals])

  // ── YoY monthly accepted revenue (firm-growth view) ───────────────────
  //
  // What this chart answers: "are we growing month-over-month vs last
  // year?". To make growth obvious we pin to `accepted_at` (the date
  // revenue was actually won) regardless of which dateField the user
  // picked elsewhere on the page — the comparison is about realised
  // revenue, not pipeline activity, so it should NOT swing when the
  // user flips between "Created / Sent / Accepted" date modes for the
  // table & KPIs.
  //
  // The two compared years are auto-detected from the dataset: we take
  // the latest year that has any accepted proposals as "current year"
  // and the year before as "prior year". This means the chart works
  // whether the dashboard is filtered to the last 90 days, YTD, or all
  // time — as long as both years are present in the filter window the
  // comparison is meaningful, and if only one year is present the
  // other series renders at zero (still useful: it shows the firm is
  // brand-new in that month/year).
  const yoyTrendData = useMemo(() => {
    // Find the two most recent years that have any accepted revenue.
    let currentYear = new Date().getFullYear()
    const yearsSeen = new Set<number>()
    for (const p of proposals) {
      if (!p.accepted_at) continue
      yearsSeen.add(parseISO(p.accepted_at).getFullYear())
    }
    if (yearsSeen.size > 0) {
      currentYear = Math.max(...Array.from(yearsSeen))
    }
    const priorYear = currentYear - 1

    // 12-month skeleton so empty months still render and the X axis is
    // always Jan → Dec. Recharts won't draw bars for months with both
    // values at 0, but the axis ticks stay anchored which makes the
    // chart visually consistent across filters.
    const months = Array.from({ length: 12 }, (_, i) => ({
      monthIdx: i,
      label: format(new Date(2000, i, 1), "MMM"),
      current: 0,
      prior: 0,
    }))

    for (const p of proposals) {
      if (!p.accepted_at) continue
      const d = parseISO(p.accepted_at)
      const y = d.getFullYear()
      const m = d.getMonth()
      if (y === currentYear) months[m].current += p.total_value
      else if (y === priorYear) months[m].prior += p.total_value
    }

    const currentTotal = months.reduce((s, x) => s + x.current, 0)
    const priorTotal = months.reduce((s, x) => s + x.prior, 0)
    const yoyPct = priorTotal > 0
      ? ((currentTotal - priorTotal) / priorTotal) * 100
      : null

    return { months, currentYear, priorYear, currentTotal, priorTotal, yoyPct }
  }, [proposals])

  // ── Sales by state ────────────────────────────────────────────────────
  const stateData = useMemo(() => {
    const map = new Map<string, { state: string; count: number; accepted: number; total: number }>()
    for (const p of proposals) {
      const k = p.state || "Unknown"
      const cur = map.get(k) ?? { state: k, count: 0, accepted: 0, total: 0 }
      cur.count += 1
      cur.total += p.total_value
      if (p.status === "accepted" || p.status === "completed") cur.accepted += p.total_value
      map.set(k, cur)
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)
  }, [proposals])

  // ── Top services by accepted-revenue (acceptance signals real revenue) ─
  // Buckets by `display_name` so historical naming variants roll up to one
  // canonical row. The API resolved the catalog label per line item; we
  // intentionally don't re-resolve here — keeping a single source of truth
  // (the server) prevents the client from drifting if the catalog evolves.
  const topServices = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number; avg: number }>()
    for (const p of proposals) {
      // Service-level revenue is only meaningful for proposals that closed.
      if (p.status !== "accepted" && p.status !== "completed") continue
      for (const s of p.services) {
        const key = s.display_name || s.service_name
        const cur = map.get(key) ?? { name: key, count: 0, revenue: 0, avg: 0 }
        cur.count += 1
        cur.revenue += s.total_amount
        map.set(key, cur)
      }
    }
    return Array.from(map.values())
      .map((s) => ({ ...s, avg: s.count > 0 ? s.revenue / s.count : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [proposals])

  // ── Top clients by accepted-value ──────────���──────────────────────────
  const topClients = useMemo(() => {
    const map = new Map<string, {
      key: string; name: string;
      kind: "organization" | "contact" | null;
      id: string | null;
      proposals: number; accepted: number; pipeline: number;
    }>()
    for (const p of proposals) {
      const key = `${p.entity_kind ?? "x"}:${p.organization_id ?? p.contact_id ?? p.client_display}`
      const cur = map.get(key) ?? {
        key,
        name: p.client_display,
        kind: p.entity_kind,
        id: p.organization_id ?? p.contact_id,
        proposals: 0,
        accepted: 0,
        pipeline: 0,
      }
      cur.proposals += 1
      if (WON_STATUSES.has(p.status)) cur.accepted += p.total_value
      if (PIPELINE_STATUSES.has(p.status)) cur.pipeline += p.total_value
      map.set(key, cur)
    }
    return Array.from(map.values())
      .filter((c) => c.accepted + c.pipeline > 0)
      .sort((a, b) => b.accepted - a.accepted)
      .slice(0, 10)
  }, [proposals])

  // ── Sales by partner (deal owners — partner > sentBy fallback) ────────
  const partnerData = useMemo(() => {
    const map = new Map<string, { name: string; accepted: number; pipeline: number; count: number }>()
    for (const p of proposals) {
      const owner = p.client_partner || p.proposal_sent_by || "Unassigned"
      const cur = map.get(owner) ?? { name: owner, accepted: 0, pipeline: 0, count: 0 }
      cur.count += 1
      if (WON_STATUSES.has(p.status)) cur.accepted += p.total_value
      if (PIPELINE_STATUSES.has(p.status)) cur.pipeline += p.total_value
      map.set(owner, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.accepted - a.accepted)
  }, [proposals])

  const activeFilterCount =
    statusFilter.length + partnerFilter.length + managerFilter.length +
    sentByFilter.length + stateFilter.length + (minValue ? 1 : 0) + (maxValue ? 1 : 0) + (search ? 1 : 0)

  const clearAllFilters = () => {
    const sp = new URLSearchParams()
    sp.set("dateField", dateField)
    sp.set("startDate", startDate)
    if (endDate) sp.set("endDate", endDate)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    setSearchInput("")
  }

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Sales Dashboard</h1>
          <p className="text-sm text-stone-600 mt-1">
            Won, in-flight, and lost proposals plus collected payouts across{" "}
            {fmtCount(data?.totalUnfiltered ?? 0)} active proposals
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-stone-600">
              <X className="h-3.5 w-3.5 mr-1" />
              Clear ({activeFilterCount})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => mutate()}
            disabled={isLoading}
          >
            <RefreshCcw className={cn("h-3.5 w-3.5 mr-1.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────── */}
      <Card className="border-stone-200">
        <CardContent className="p-4 space-y-3">
          {/* Date controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-stone-500" />
              <span className="text-sm font-medium text-stone-700">Date</span>
              <Tabs value={dateField} onValueChange={(v) => setParam("dateField", v)}>
                <TabsList className="h-8">
                  {/*
                    "Activity" is the default — matches any of the
                    lifecycle dates so lost / awaiting / draft rows
                    aren't silently filtered out of YTD views. The
                    single-column tabs still let users slice strictly
                    by "won YTD" or "sent YTD" when they need it.
                  */}
                  <TabsTrigger value="activity" className="text-xs px-2.5">Activity</TabsTrigger>
                  <TabsTrigger value="created_at" className="text-xs px-2.5">Created</TabsTrigger>
                  <TabsTrigger value="accepted_at" className="text-xs px-2.5">Accepted</TabsTrigger>
                  <TabsTrigger value="sent_at" className="text-xs px-2.5">Sent</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setParam("startDate", e.target.value || null)}
                className="h-8 w-[140px] text-xs"
              />
              <span className="text-stone-400 text-xs">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setParam("endDate", e.target.value || null)}
                className="h-8 w-[140px] text-xs"
              />
            </div>
            <div className="flex-1" />
            <div className="relative w-full sm:w-64">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
              <Input
                placeholder="Search clients, titles…"
                className="h-8 pl-7 text-xs"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value)
                  // Debounce by 300ms before pushing to URL.
                  // We use a simple setTimeout + closure since this runs at
                  // most a few times a second and avoids pulling in another lib.
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setParam("search", searchInput || null)
                }}
                onBlur={() => setParam("search", searchInput || null)}
              />
            </div>
          </div>

          {/* Multi-select filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterIcon className="h-4 w-4 text-stone-500" />
            <MultiSelectFilter
              label="Status"
              value={statusFilter}
              options={data?.dimensions?.statuses ?? []}
              onChange={(v) => setParam("status", v.length ? v.join(",") : null)}
              renderOption={(s) => (
                <Badge variant="outline" className={cn("text-xs", statusMeta(s).tone)}>
                  {statusMeta(s).label}
                </Badge>
              )}
            />
            <MultiSelectFilter
              label="State"
              value={stateFilter}
              options={data?.dimensions?.states ?? []}
              onChange={(v) => setParam("state", v.length ? v.join(",") : null)}
            />
            <MultiSelectFilter
              label="Partner"
              value={partnerFilter}
              options={data?.dimensions?.partners ?? []}
              onChange={(v) => setParam("partner", v.length ? v.join(",") : null)}
            />
            <MultiSelectFilter
              label="Manager"
              value={managerFilter}
              options={data?.dimensions?.managers ?? []}
              onChange={(v) => setParam("manager", v.length ? v.join(",") : null)}
            />
            <MultiSelectFilter
              label="Sent by"
              value={sentByFilter}
              options={data?.dimensions?.sentBy ?? []}
              onChange={(v) => setParam("sentBy", v.length ? v.join(",") : null)}
            />
            <ValueRangeFilter
              minValue={minValue}
              maxValue={maxValue}
              onChange={({ min, max }) => {
                setParam("minValue", min || null)
                setParam("maxValue", max || null)
              }}
            />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-800">
            Failed to load sales data: {String(error.message || error)}
          </CardContent>
        </Card>
      ) : null}

      {/* ── KPI cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total Proposals"
          value={fmtCount(kpis.totalCount)}
          sub={`${fmtMoneyCompact(kpis.totalContractValue)} contracted`}
          loading={isLoading}
        />
        <KpiCard
          icon={<Trophy className="h-4 w-4" />}
          label="Won"
          value={fmtMoney(kpis.acceptedValue)}
          sub={`${fmtCount(kpis.acceptedCount)} deals · avg ${fmtMoneyCompact(kpis.avgDealSize)}`}
          tone="emerald"
          loading={isLoading}
        />
        <KpiCard
          icon={<Hourglass className="h-4 w-4" />}
          label="Pipeline"
          value={fmtMoney(kpis.pipelineValue)}
          // Spell out the mix because "Pipeline" historically only
          // counted `sent`, missing the production `awaiting_acceptance`
          // status. Showing both numbers makes the discrepancy obvious
          // when partners ask why this differs from Ignition's UI.
          sub={
            kpis.draftCount > 0
              ? `${fmtCount(kpis.awaitingCount)} awaiting · ${fmtCount(kpis.draftCount)} draft`
              : `${fmtCount(kpis.pipelineCount)} awaiting / sent`
          }
          tone="amber"
          loading={isLoading}
        />
        <KpiCard
          icon={<Repeat2 className="h-4 w-4" />}
          label="Annualized Recurring"
          value={fmtMoney(data?.recurringSummary?.arr ?? 0)}
          // Pull the authoritative MRR/client count from the curated
          // `motta_recurring_revenue` table (same source as the
          // /sales/recurring-revenue page) so the two surfaces never
          // disagree. Date filters do NOT apply — this is a current
          // snapshot of engagements in force.
          sub={
            data?.recurringSummary
              ? `${fmtMoneyCompact(data.recurringSummary.mrr)}/mo · ${fmtCount(
                  data.recurringSummary.distinct_clients,
                )} clients`
              : "—"
          }
          tone="emerald"
          loading={isLoading}
        />
        <KpiCard
          icon={<XCircle className="h-4 w-4" />}
          label="Lost"
          value={fmtMoney(kpis.lostValue)}
          sub={`${fmtCount(kpis.lostCount)} deals`}
          tone="rose"
          loading={isLoading}
        />
        <KpiCard
          icon={<Trophy className="h-4 w-4" />}
          label="Win Rate"
          value={fmtPct(kpis.winRate)}
          sub={`${fmtCount(kpis.acceptedCount)}/${fmtCount(kpis.acceptedCount + kpis.lostCount)} decided`}
          tone="emerald"
          loading={isLoading}
        />
      </div>

      {/* ── Payouts (collected cash from clients in the same window) ──── */}
      <PayoutsSection payouts={data?.payouts} loading={isLoading} />

      {/* ── Service Line KPIs ─────────────────────────────────────────── */}
      <ServiceLineSection
        data={data?.serviceLines ?? []}
        loading={isLoading}
        totalAccepted={kpis.acceptedValue}
      />

      {/* ── Trend + Funnel ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-stone-200">
          <CardHeader className="pb-2">
            {/* Two-row header: title on top, YoY headline metrics on
                the right. The growth chip switches colour by sign so a
                glance tells you the direction even before reading the
                number. Negative growth uses the same red as the Lost
                series elsewhere on this dashboard for consistency. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium text-stone-700">
                  Monthly revenue — YoY growth
                </CardTitle>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Accepted proposal value · {yoyTrendData.currentYear} vs {yoyTrendData.priorYear}
                </p>
              </div>
              {!isLoading && (yoyTrendData.currentTotal > 0 || yoyTrendData.priorTotal > 0) && (
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-stone-500">YTD {yoyTrendData.currentYear}</div>
                    <div className="text-sm font-semibold text-stone-800">{fmtMoney(yoyTrendData.currentTotal)}</div>
                  </div>
                  {yoyTrendData.yoyPct !== null && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        yoyTrendData.yoyPct >= 0
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                      }`}
                      aria-label={`Year over year growth ${yoyTrendData.yoyPct.toFixed(1)} percent`}
                    >
                      <TrendingUp className={`h-3 w-3 ${yoyTrendData.yoyPct < 0 ? "rotate-180" : ""}`} />
                      {yoyTrendData.yoyPct >= 0 ? "+" : ""}
                      {yoyTrendData.yoyPct.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[280px]">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : yoyTrendData.currentTotal === 0 && yoyTrendData.priorTotal === 0 ? (
                <EmptyChart message="No accepted revenue in the selected window" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  {/* Grouped bars per month — current year (olive/emerald,
                      matches "Accepted" colour used elsewhere on this
                      dashboard) next to prior year (muted stone). Bar
                      grouping makes the YoY delta visually obvious for
                      each month without needing a tooltip. */}
                  <BarChart
                    data={yoyTrendData.months}
                    margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7E2DA" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#78716C" }} stroke="#D6CFC2" />
                    <YAxis
                      tickFormatter={(v) => fmtMoneyCompact(v as number)}
                      tick={{ fontSize: 11, fill: "#78716C" }}
                      stroke="#D6CFC2"
                      width={60}
                    />
                    <Tooltip
                      formatter={(v: number) => fmtMoney(v)}
                      contentStyle={{ borderRadius: 6, border: "1px solid #E7E2DA", fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Bar
                      dataKey="prior"
                      name={String(yoyTrendData.priorYear)}
                      fill="#C7B79B"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="current"
                      name={String(yoyTrendData.currentYear)}
                      fill="#3F7D58"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-700">Status funnel</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : funnelData.length === 0 ? (
              <EmptyChart message="No proposals match" />
            ) : (
              <ul className="flex flex-col gap-2">
                {funnelData.map((d) => {
                  const meta = statusMeta(d.status)
                  const max = Math.max(...funnelData.map((x) => x.count))
                  const pct = max > 0 ? (d.count / max) * 100 : 0
                  return (
                    <li key={d.status} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-stone-700">{meta.label}</span>
                        <span className="text-stone-500">
                          {fmtCount(d.count)} · {fmtMoneyCompact(d.value)}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: meta.color }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Interactive US Map ───────────────────────────────────────── */}
      <SalesUSMap data={data?.stateBreakdown ?? []} loading={isLoading} />

      {/* ── Partner Performance ───────────────────���───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-stone-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-700">
              Sales by owner
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : partnerData.length === 0 ? (
              <EmptyChart message="No deals attributed yet" />
            ) : (
              <ScrollArea className="h-[260px] pr-3">
                <ul className="flex flex-col gap-3">
                  {partnerData.map((p) => {
                    const max = Math.max(...partnerData.map((x) => x.accepted + x.pipeline)) || 1
                    return (
                      <li key={p.name}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-stone-800">{p.name}</span>
                          <span className="text-stone-500">{fmtCount(p.count)} proposals</span>
                        </div>
                        <div className="flex items-center gap-1 h-3">
                          <div
                            className="h-full bg-emerald-600 rounded-l"
                            style={{ width: `${(p.accepted / max) * 100}%` }}
                            title={`Won: ${fmtMoney(p.accepted)}`}
                          />
                          <div
                            className="h-full bg-amber-400 rounded-r"
                            style={{ width: `${(p.pipeline / max) * 100}%` }}
                            title={`Pipeline: ${fmtMoney(p.pipeline)}`}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-stone-500 mt-1">
                          <span>Won {fmtMoneyCompact(p.accepted)}</span>
                          <span>Pipeline {fmtMoneyCompact(p.pipeline)}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Top Services + Top Clients ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-stone-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-700">
              Top services · accepted revenue
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : topServices.length === 0 ? (
              <EmptyChart message="No accepted services in the selected window" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {topServices.map((s, i) => (
                  <li key={s.name} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-5 text-xs text-stone-400 tabular-nums">{i + 1}.</span>
                      <span className="text-sm text-stone-800 truncate">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="text-stone-500">{fmtCount(s.count)}×</span>
                      <span className="font-semibold text-stone-900 w-20 text-right tabular-nums">
                        {fmtMoneyCompact(s.revenue)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-700">
              Top clients · accepted value
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : topClients.length === 0 ? (
              <EmptyChart message="No accepted deals" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {topClients.map((c, i) => (
                  <li key={c.key} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-5 text-xs text-stone-400 tabular-nums">{i + 1}.</span>
                      <div className="min-w-0">
                        {c.id && c.kind ? (
                          <Link
                            href={`/clients/${c.kind === "organization" ? "org" : "contact"}/${c.id}`}
                            className="text-sm text-stone-800 hover:underline truncate block"
                          >
                            {c.name}
                          </Link>
                        ) : (
                          <span className="text-sm text-stone-800 truncate block">{c.name}</span>
                        )}
                        <span className="text-[11px] text-stone-500">
                          {c.kind === "organization" ? "Organization" : c.kind === "contact" ? "Contact" : "Unlinked"}
                          {" · "}
                          {fmtCount(c.proposals)} proposals
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-sm font-semibold text-stone-900 tabular-nums">
                        {fmtMoneyCompact(c.accepted)}
                      </span>
                      {c.pipeline > 0 ? (
                        <span className="text-[11px] text-amber-700 tabular-nums">
                          + {fmtMoneyCompact(c.pipeline)} pipeline
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Proposal table ────────────────────────────────────────────── */}
      <ProposalTable
        proposals={proposals}
        isLoading={isLoading}
        dateField={dateField}
        bucket={tableBucket}
        onBucketChange={setTableBucket}
        tableSearch={tableSearch}
        onTableSearchChange={setTableSearch}
        sortBy={tableSortBy}
        sortDir={tableSortDir}
        onSort={toggleTableSort}
        onReset={resetTableFilters}
        onProposalsMutate={mutate}
      />
    </div>
  )
}

// ── Proposal table (refined client-side from the already-fetched set) ────
//
// Lives below the page's URL-driven filter bar. The toolbar here adds
// lightweight refinements — lifecycle bucket chips, an inline search,
// and sortable column headers — without triggering an API refetch.
// Bucket chip counts are computed once on render so users see the size
// of each bucket up front.
type SortableTableField = "date" | "value" | "status" | "proposal" | "client"

function ProposalTable({
  proposals,
  isLoading,
  dateField,
  bucket,
  onBucketChange,
  tableSearch,
  onTableSearchChange,
  sortBy,
  sortDir,
  onSort,
  onReset,
  onProposalsMutate,
}: {
  proposals: Proposal[]
  isLoading: boolean
  dateField: "activity" | "created_at" | "accepted_at" | "sent_at"
  bucket: "all" | "won" | "pipeline" | "lost" | "other"
  onBucketChange: (b: "all" | "won" | "pipeline" | "lost" | "other") => void
  tableSearch: string
  onTableSearchChange: (v: string) => void
  sortBy: SortableTableField
  sortDir: "asc" | "desc"
  onSort: (col: SortableTableField) => void
  onReset: () => void
  onProposalsMutate: () => void
}) {
  // Per-row best-effort date — re-uses the same precedence as the row
  // body so sort ordering matches what users see in the Date column.
  const rowDate = (p: Proposal): string | null => {
    if (dateField === "accepted_at") return p.accepted_at ?? null
    if (dateField === "sent_at") return p.sent_at ?? null
    if (dateField === "created_at") return p.created_at ?? null
    return p.accepted_at || p.lost_at || p.sent_at || p.created_at || null
  }

  // Bucket counts: computed on the unfiltered set so the chips always
  // reflect the underlying mix (otherwise selecting "Won" would zero
  // out the other chips and the user couldn't see what they were
  // skipping).
  const bucketCounts = useMemo(() => {
    let won = 0, pipeline = 0, lost = 0, other = 0
    for (const p of proposals) {
      if (WON_STATUSES.has(p.status)) won++
      else if (PIPELINE_STATUSES.has(p.status)) pipeline++
      else if (LOST_STATUSES.has(p.status)) lost++
      else other++
    }
    return { all: proposals.length, won, pipeline, lost, other }
  }, [proposals])

  const refined = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    const filtered = proposals.filter((p) => {
      // Bucket gate
      if (bucket === "won" && !WON_STATUSES.has(p.status)) return false
      if (bucket === "pipeline" && !PIPELINE_STATUSES.has(p.status)) return false
      if (bucket === "lost" && !LOST_STATUSES.has(p.status)) return false
      if (
        bucket === "other" &&
        (WON_STATUSES.has(p.status) ||
          PIPELINE_STATUSES.has(p.status) ||
          LOST_STATUSES.has(p.status))
      ) {
        return false
      }
      // Text gate — proposal #, title, client display, partner name. The
      // page-level search is server-side and broader; this one is just
      // for narrowing the visible 250.
      if (q) {
        const hay = (
          (p.proposal_number || "") +
          " " +
          (p.title || "") +
          " " +
          (p.client_display || "") +
          " " +
          (p.client_partner || "") +
          " " +
          (p.proposal_sent_by || "")
        ).toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const dir = sortDir === "asc" ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "value":
          return ((a.total_value || 0) - (b.total_value || 0)) * dir
        case "status":
          return (a.status || "").localeCompare(b.status || "") * dir
        case "proposal":
          return (a.proposal_number || "").localeCompare(b.proposal_number || "") * dir
        case "client":
          return (a.client_display || "").localeCompare(b.client_display || "") * dir
        case "date":
        default: {
          const da = rowDate(a)
          const db = rowDate(b)
          // Nulls sort last regardless of direction so partners never
          // get a top row that has no date at all.
          if (!da && !db) return 0
          if (!da) return 1
          if (!db) return -1
          return (new Date(da).getTime() - new Date(db).getTime()) * dir
        }
      }
    })
    return sorted
    // rowDate is a stable closure over dateField only — safe to omit
    // from deps because dateField is already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals, bucket, tableSearch, sortBy, sortDir, dateField])

  const hasRefinement =
    bucket !== "all" ||
    tableSearch.trim().length > 0 ||
    sortBy !== "date" ||
    sortDir !== "desc"

  return (
    <Card className="border-stone-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-stone-700 flex items-center justify-between gap-2 flex-wrap">
          <span>
            Proposals · {fmtCount(refined.length)}
            {refined.length !== proposals.length ? (
              <span className="text-stone-400 font-normal">
                {" "}/ {fmtCount(proposals.length)}
              </span>
            ) : null}{" "}
            <span className="text-stone-400 font-normal">matching</span>
          </span>
          {hasRefinement ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="h-7 text-xs text-stone-500 hover:text-stone-900"
            >
              <X className="h-3 w-3 mr-1" />
              Reset table filters
            </Button>
          ) : null}
        </CardTitle>
      </CardHeader>

      {/* ── Table refinement toolbar ───────────────────────────────── */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-2 border-b border-stone-100">
        <div className="flex flex-wrap items-center gap-1">
          <TableBucketChip
            label="All"
            count={bucketCounts.all}
            active={bucket === "all"}
            onClick={() => onBucketChange("all")}
          />
          <TableBucketChip
            label="Won"
            count={bucketCounts.won}
            active={bucket === "won"}
            tone="emerald"
            onClick={() => onBucketChange("won")}
          />
          <TableBucketChip
            label="Pipeline"
            count={bucketCounts.pipeline}
            active={bucket === "pipeline"}
            tone="amber"
            onClick={() => onBucketChange("pipeline")}
          />
          <TableBucketChip
            label="Lost"
            count={bucketCounts.lost}
            active={bucket === "lost"}
            tone="rose"
            onClick={() => onBucketChange("lost")}
          />
          {bucketCounts.other > 0 ? (
            <TableBucketChip
              label="Other"
              count={bucketCounts.other}
              active={bucket === "other"}
              onClick={() => onBucketChange("other")}
            />
          ) : null}
        </div>

        <div className="relative ml-auto w-full sm:w-64">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
          <Input
            value={tableSearch}
            onChange={(e) => onTableSearchChange(e.target.value)}
            placeholder="Filter table (proposal, client, owner)…"
            className="h-8 pl-8 pr-7 text-xs"
          />
          {tableSearch ? (
            <button
              type="button"
              onClick={() => onTableSearchChange("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700"
              aria-label="Clear table search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : proposals.length === 0 ? (
          <div className="p-8 text-center text-sm text-stone-500">
            No proposals match the current filters.
          </div>
        ) : refined.length === 0 ? (
          // Distinct empty state when the table-local refinements
          // (chips / search) hid every row — the user can recover
          // by resetting just those, without losing the page's
          // top-of-screen filter context.
          <div className="p-8 text-center text-sm text-stone-500">
            <FilterIcon className="h-5 w-5 mx-auto mb-2 opacity-40" />
            No proposals match the table refinements.
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onReset}
                className="h-7 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Reset table filters
              </Button>
            </div>
          </div>
        ) : (
          <ScrollArea className="max-h-[600px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50 border-b border-stone-200 z-10">
                <tr className="text-xs text-stone-500 uppercase tracking-wide">
                  <SortHeaderCell
                    field="proposal"
                    label="Proposal"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortHeaderCell
                    field="client"
                    label="Client"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <th className="text-left px-4 py-2 font-medium">State</th>
                  <SortHeaderCell
                    field="status"
                    label="Status"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                  <SortHeaderCell
                    field="value"
                    label="Value"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                    align="right"
                  />
                  <th className="text-right px-4 py-2 font-medium">Recurring</th>
                  <th className="text-left px-4 py-2 font-medium">Owner</th>
                  <SortHeaderCell
                    field="date"
                    label="Date"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {refined.slice(0, 250).map((p) => {
                    const meta = statusMeta(p.status)
                    // In activity mode the column shows whichever
                    // lifecycle date best represents the row (won →
                    // accepted, lost → lost_at, otherwise the most
                    // recent event). The fixed-field modes show that
                    // exact column.
                    const dateStr =
                      dateField === "accepted_at" ? p.accepted_at
                      : dateField === "sent_at" ? p.sent_at
                      : dateField === "created_at" ? p.created_at
                      : (p.accepted_at || p.lost_at || p.sent_at || p.created_at)
                    return (
                      <tr key={p.proposal_id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col">
                            <span className="font-medium text-stone-900 text-xs">
                              {p.proposal_number || "(unnumbered)"}
                            </span>
                            <span className="text-stone-500 text-[11px] truncate max-w-[260px]">
                              {p.title || "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {p.organization_id || p.contact_id ? (
                            <Link
                              href={`/clients/${p.entity_kind === "organization" ? "org" : "contact"}/${p.organization_id || p.contact_id}`}
                              className="text-stone-800 hover:underline inline-flex items-center gap-1"
                            >
                              {p.client_display}
                              <ExternalLink className="h-3 w-3 text-stone-400" />
                            </Link>
                          ) : (
                            <span className="text-stone-600">{p.client_display}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-stone-600">
                          {/* Inline state-edit triggers a parent SWR
                              revalidation so the row reflects the
                              freshly persisted value without a full
                              page reload. */}
                          <ProposalStateEdit
                            proposalId={p.proposal_id}
                            value={p.state}
                            source={p.state_source}
                            onSaved={onProposalsMutate}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className={cn("text-[10px] capitalize", meta.tone)}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                          {fmtMoney(p.total_value)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-stone-600">
                          {p.recurring_total > 0 ? `${fmtMoneyCompact(p.recurring_total)}/mo` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-stone-600">
                          {p.client_partner || p.proposal_sent_by || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">
                          {dateStr ? format(parseISO(dateStr), "MMM d, yyyy") : "—"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {refined.length > 250 ? (
                <div className="p-3 text-center text-xs text-stone-500 border-t border-stone-100 bg-stone-50">
                  Showing first 250 of {fmtCount(refined.length)} matching proposals — refine filters to see more
                </div>
              ) : null}
            </ScrollArea>
          )}
        </CardContent>
      </Card>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

// Bucket chip used in the proposal-table toolbar. Each chip shows a
// count so partners can see the size of every lifecycle bucket up-front
// before drilling in.
function TableBucketChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  tone?: "emerald" | "amber" | "rose"
  onClick: () => void
}) {
  // Active style picks up the bucket's semantic colour so the active
  // state matches the status badges used in the table itself.
  const activeTone =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : tone === "amber"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : tone === "rose"
      ? "bg-rose-100 text-rose-800 border-rose-200"
      : "bg-stone-200 text-stone-800 border-stone-300"
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors",
        active
          ? activeTone
          : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-900",
      )}
      aria-pressed={active}
    >
      {label}
      <span
        className={cn(
          "tabular-nums text-[10px] px-1.5 py-0.5 rounded-sm font-semibold",
          active ? "bg-white/60" : "bg-stone-100 text-stone-500",
        )}
      >
        {fmtCount(count)}
      </span>
    </button>
  )
}

// Clickable column header with a tri-state sort indicator (idle ⇄ asc ⇄
// desc). Used by every sortable column in the proposal table so the
// interaction is consistent across columns.
function SortHeaderCell({
  field,
  label,
  sortBy,
  sortDir,
  onSort,
  align = "left",
}: {
  field: SortableTableField
  label: string
  sortBy: SortableTableField
  sortDir: "asc" | "desc"
  onSort: (field: SortableTableField) => void
  align?: "left" | "right"
}) {
  const isActive = sortBy === field
  const Icon = !isActive ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <th
      className={cn(
        "px-4 py-2 font-medium select-none",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 text-xs uppercase tracking-wide transition-colors",
          align === "right" ? "ml-auto flex-row-reverse" : "",
          isActive
            ? "text-stone-900"
            : "text-stone-500 hover:text-stone-800",
        )}
        aria-sort={
          isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        {label}
        <Icon
          className={cn(
            "h-3 w-3 transition-opacity",
            isActive ? "opacity-100" : "opacity-50",
          )}
        />
      </button>
    </th>
  )
}

function KpiCard({
  icon, label, value, sub, tone, loading,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone?: "emerald" | "amber" | "rose"
  loading?: boolean
}) {
  const toneClass =
    tone === "emerald" ? "text-emerald-700"
    : tone === "amber" ? "text-amber-700"
    : tone === "rose" ? "text-rose-700"
    : "text-stone-700"

  return (
    <Card className="border-stone-200">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-stone-500 text-[11px] uppercase tracking-wide font-medium">
          <span className={toneClass}>{icon}</span>
          {label}
        </div>
        <div className="mt-1.5">
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <div className="text-xl font-semibold text-stone-900 tabular-nums">{value}</div>
          )}
        </div>
        {sub ? <div className="text-[11px] text-stone-500 mt-0.5 truncate">{sub}</div> : null}
      </CardContent>
    </Card>
  )
}

function MultiSelectFilter({
  label, value, options, onChange, renderOption,
}: {
  label: string
  value: string[]
  options: string[]
  onChange: (v: string[]) => void
  renderOption?: (option: string) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-xs gap-1.5",
            value.length > 0 && "bg-stone-100 border-stone-300",
          )}
        >
          {label}
          {value.length > 0 ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
              {value.length}
            </Badge>
          ) : null}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-stone-500">
              No options
            </CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const active = value.includes(opt)
                return (
                  <CommandItem
                    key={opt}
                    onSelect={() => toggle(opt)}
                    className="flex items-center justify-between gap-2 text-xs cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-3.5 w-3.5 rounded-sm border flex items-center justify-center text-[10px]",
                          active
                            ? "bg-stone-900 border-stone-900 text-white"
                            : "border-stone-300",
                        )}
                      >
                        {active ? "✓" : ""}
                      </span>
                      {renderOption ? renderOption(opt) : <span className="capitalize">{opt}</span>}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
          {value.length > 0 ? (
            <div className="border-t border-stone-100 p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs justify-center text-stone-600"
                onClick={() => onChange([])}
              >
                Clear {label.toLowerCase()}
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ValueRangeFilter({
  minValue, maxValue, onChange,
}: {
  minValue: string
  maxValue: string
  onChange: (v: { min: string; max: string }) => void
}) {
  const [min, setMin] = useState(minValue)
  const [max, setMax] = useState(maxValue)
  const active = !!(minValue || maxValue)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-xs gap-1.5",
            active && "bg-stone-100 border-stone-300",
          )}
        >
          Value
          {active ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
              {minValue ? `≥${Number(minValue) >= 1000 ? `${Math.round(Number(minValue) / 1000)}k` : minValue}` : ""}
              {minValue && maxValue ? " " : ""}
              {maxValue ? `≤${Number(maxValue) >= 1000 ? `${Math.round(Number(maxValue) / 1000)}k` : maxValue}` : ""}
            </Badge>
          ) : null}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="text-xs font-medium text-stone-700 mb-2">Total proposal value</div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="Min"
            className="h-8 text-xs"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
          <span className="text-stone-400 text-xs">to</span>
          <Input
            type="number"
            placeholder="Max"
            className="h-8 text-xs"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setMin("")
              setMax("")
              onChange({ min: "", max: "" })
            }}
          >
            Clear
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => onChange({ min, max })}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-stone-500">
      {message}
    </div>
  )
}

// ── Service Line Section ─────────────────────────────────────────────────
const SERVICE_LINE_ICONS: Record<ServiceLine, React.ReactNode> = {
  Tax: <FileText className="h-4 w-4" />,
  Accounting: <Calculator className="h-4 w-4" />,
  Advisory: <Lightbulb className="h-4 w-4" />,
  Other: <MoreHorizontal className="h-4 w-4" />,
}

function ServiceLineSection({
  data,
  loading,
  totalAccepted,
}: {
  data: ServiceLineData[]
  loading: boolean
  totalAccepted: number
}) {
  const [expanded, setExpanded] = useState<ServiceLine | null>(null)

  if (loading) {
    return (
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stone-700 flex items-center gap-2">
            <PieChart className="h-4 w-4 text-stone-500" />
            Revenue by Service Line
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0)

  return (
    <Card className="border-stone-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-stone-700 flex items-center gap-2">
          <PieChart className="h-4 w-4 text-stone-500" />
          Revenue by Service Line
          <span className="text-xs font-normal text-stone-500 ml-auto">
            Accepted deals only
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-500">
            No service data available for the selected filters
          </div>
        ) : (
          <>
            {/* Service Line Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {(["Tax", "Accounting", "Advisory", "Other"] as ServiceLine[]).map((line) => {
                const lineData = data.find((d) => d.serviceLine === line)
                const meta = SERVICE_LINE_META[line]
                const pct = totalRevenue > 0 && lineData
                  ? (lineData.revenue / totalRevenue) * 100
                  : 0
                const isExpanded = expanded === line

                return (
                  <button
                    key={line}
                    onClick={() => setExpanded(isExpanded ? null : line)}
                    className={cn(
                      "relative overflow-hidden rounded-lg border p-3 text-left transition-all",
                      "hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-1",
                      isExpanded
                        ? `${meta.border} ${meta.bg} ring-2 ring-offset-1`
                        : `border-stone-200 hover:${meta.border}`,
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center",
                          meta.bg, meta.text,
                        )}
                      >
                        {SERVICE_LINE_ICONS[line]}
                      </div>
                      <span className="text-sm font-medium text-stone-800">{line}</span>
                      {lineData && (
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 ml-auto text-stone-400 transition-transform",
                            isExpanded && "rotate-90",
                          )}
                        />
                      )}
                    </div>

                    {lineData ? (
                      <>
                        <div className="text-lg font-semibold text-stone-900 tabular-nums">
                          {new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          }).format(lineData.revenue)}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-stone-500">
                            {lineData.count} services
                          </span>
                          <span className={cn("text-xs font-medium", meta.text)}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="mt-2 h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: meta.fill,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-stone-400 mt-1">No data</div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Expanded detail panel */}
            {expanded && (
              <div className="border border-stone-200 rounded-lg bg-stone-50/50 p-4">
                {(() => {
                  const lineData = data.find((d) => d.serviceLine === expanded)
                  if (!lineData) return null
                  const meta = SERVICE_LINE_META[expanded]

                  return (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className={cn("font-medium flex items-center gap-2", meta.text)}>
                          {SERVICE_LINE_ICONS[expanded]}
                          {expanded} Services
                        </h4>
                        <Badge variant="outline" className={cn("text-xs", meta.bg, meta.text, meta.border)}>
                          {lineData.topServices.length} service types
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {lineData.topServices.map((s, i) => (
                          <div
                            key={s.name}
                            className="flex items-center justify-between p-2 rounded-md bg-white border border-stone-100"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="w-5 text-xs text-stone-400 tabular-nums shrink-0">
                                {i + 1}.
                              </span>
                              <span className="text-sm text-stone-700 truncate">
                                {s.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-xs text-stone-500">{s.count}x</span>
                              <span className="text-sm font-medium text-stone-900 tabular-nums">
                                {new Intl.NumberFormat("en-US", {
                                  notation: "compact",
                                  style: "currency",
                                  currency: "USD",
                                  maximumFractionDigits: 1,
                                }).format(s.revenue)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// Quiet down react/no-unused — Cell is imported for potential future use in
// stacked bars (kept to avoid churn if we add segmented coloring back).
void Cell

// ── Payouts Section ──────────────────────────────────────────────────────
// Shows YTD collected cash alongside the proposal KPIs. The data is
// sourced from `ignition_payments.paid_at` (the legacy
// `ignition_disbursals` table is empty in prod) and shares the
// dashboard's date window — so when the partner narrows to "last 30
// days" they see proposals AND collections for the same window.
function PayoutsSection({
  payouts,
  loading,
}: {
  payouts: DashboardResponse["payouts"] | undefined
  loading: boolean
}) {
  if (loading || !payouts) {
    return (
      <Card className="border-stone-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stone-700 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-stone-500" />
            Payouts · collected cash
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-[220px] w-full mt-4" />
        </CardContent>
      </Card>
    )
  }

  const { count, gross, net, fees, distinctClients, byMonth, topClients } =
    payouts
  const feeRate = gross > 0 ? fees / gross : 0
  const chartData = byMonth.map((m) => ({
    ...m,
    label: format(parseISO(m.month + "-01"), "MMM yy"),
  }))

  return (
    <Card className="border-stone-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-stone-700 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-stone-500" />
          Payouts · collected cash
          <span className="text-xs font-normal text-stone-500 ml-auto">
            Same date window as proposals
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {count === 0 ? (
          <div className="py-8 text-center text-sm text-stone-500">
            No payments collected in the selected window.
          </div>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <PayoutTile
                icon={<Banknote className="h-4 w-4" />}
                label="Collected"
                value={fmtMoney(gross)}
                sub={`${fmtCount(count)} payments`}
                tone="emerald"
              />
              <PayoutTile
                icon={<Wallet className="h-4 w-4" />}
                label="Net to Motta"
                value={fmtMoney(net)}
                sub={`after processor fees`}
                tone="emerald"
              />
              <PayoutTile
                icon={<Receipt className="h-4 w-4" />}
                label="Processor fees"
                value={fmtMoney(fees)}
                sub={fmtPct(feeRate) + " of gross"}
                tone="rose"
              />
              <PayoutTile
                icon={<Users className="h-4 w-4" />}
                label="Clients paid"
                value={fmtCount(distinctClients)}
                sub={
                  distinctClients > 0
                    ? fmtMoney(gross / distinctClients) + " avg"
                    : "—"
                }
              />
            </div>

            {/* Trend + Top clients */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <div className="text-xs font-medium text-stone-600 mb-2">
                  Monthly collections
                </div>
                <div className="h-[220px]">
                  {chartData.length === 0 ? (
                    <EmptyChart message="No collections in this window" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartData}
                        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#E7E2DA"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#78716C" }}
                          stroke="#D6CFC2"
                        />
                        <YAxis
                          tickFormatter={(v) => fmtMoneyCompact(v as number)}
                          tick={{ fontSize: 11, fill: "#78716C" }}
                          stroke="#D6CFC2"
                          width={60}
                        />
                        <Tooltip
                          formatter={(v: number, name: string) => [
                            fmtMoney(v),
                            name === "net" ? "Net" : "Fees",
                          ]}
                          contentStyle={{
                            borderRadius: 6,
                            border: "1px solid #E7E2DA",
                            fontSize: 12,
                          }}
                          cursor={{ fill: "rgba(120,113,108,0.06)" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                        <Bar
                          dataKey="net"
                          stackId="a"
                          name="Net to Motta"
                          fill="#3F7D58"
                          radius={[0, 0, 0, 0]}
                        />
                        <Bar
                          dataKey="fees"
                          stackId="a"
                          name="Fees"
                          fill="#C97A2C"
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-stone-600 mb-2">
                  Top clients · collected
                </div>
                {topClients.length === 0 ? (
                  <EmptyChart message="No collections" />
                ) : (
                  <ul className="divide-y divide-stone-100 border border-stone-200 rounded-md overflow-hidden">
                    {topClients.map((c, i) => (
                      <li
                        key={c.ignition_client_id}
                        className="px-3 py-2 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="w-4 text-[11px] text-stone-400 tabular-nums">
                            {i + 1}.
                          </span>
                          {c.id && c.kind ? (
                            <Link
                              href={`/clients/${
                                c.kind === "organization" ? "org" : "contact"
                              }/${c.id}`}
                              className="text-xs text-stone-800 hover:underline truncate"
                            >
                              {c.name}
                            </Link>
                          ) : (
                            <span className="text-xs text-stone-800 truncate">
                              {c.name}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col items-end shrink-0">
                          <span className="text-xs font-semibold text-stone-900 tabular-nums">
                            {fmtMoneyCompact(c.gross)}
                          </span>
                          <span className="text-[10px] text-stone-500 tabular-nums">
                            {fmtCount(c.payment_count)} payments
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function PayoutTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone?: "emerald" | "amber" | "rose"
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
      ? "text-amber-700"
      : tone === "rose"
      ? "text-rose-700"
      : "text-stone-700"
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-3">
      <div className="flex items-center gap-1.5 text-stone-500 text-[11px] uppercase tracking-wide font-medium">
        <span className={toneClass}>{icon}</span>
        {label}
      </div>
      <div className="text-lg font-semibold text-stone-900 tabular-nums mt-1">
        {value}
      </div>
      {sub ? (
        <div className="text-[11px] text-stone-500 mt-0.5 truncate">{sub}</div>
      ) : null}
    </div>
  )
}
