"use client"

/**
 * Sales > Proposals listing
 * ────────────────────────────────────────────────────────────────────────
 * Server-paginated, filterable table of every Ignition proposal. Differs
 * from the Sales Dashboard in that this is a transactional list view —
 * users come here to find a specific proposal, sort by value, scan recent
 * activity. The Dashboard remains the analytics surface.
 *
 * URL state covers every filter (page, search, status, partner, manager,
 * sentBy, state, serviceLine, value range, date range/field, sort) so the
 * view is shareable and browser-back-button friendly.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import useSWR from "swr"
import {
  Search as SearchIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
  Filter as FilterIcon,
  Pencil,
  MapPin,
  FileText,
  TrendingUp,
  CheckCircle2,
  Clock,
  XCircle,
  PieChart as PieChartIcon,
  Users,
  Target,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ProposalEditSheet } from "@/components/sales/proposal-edit-sheet"
import { IgnitionLiveBadge } from "@/components/sales/ignition-live-badge"
import {
  MultiSelectChip,
  RangeChip,
  DateRangeChip,
  DateRangePresets,
  type DateFieldOption,
} from "@/components/sales/filter-chips"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { US_STATE_NAMES } from "@/lib/sales/us-geo"
import { SERVICE_LINE_META, type ServiceLine } from "@/lib/sales/service-line-classifier"

interface Proposal {
  proposal_id: string
  proposal_number: string | null
  title: string | null
  status: string | null
  total_value: number | null
  one_time_total: number | null
  recurring_total: number | null
  recurring_frequency: string | null
  currency: string | null
  client_name: string | null
  client_email: string | null
  client_partner: string | null
  client_manager: string | null
  proposal_sent_by: string | null
  billing_starts_on: string | null
  sent_at: string | null
  accepted_at: string | null
  completed_at: string | null
  lost_at: string | null
  lost_reason: string | null
  created_at: string | null
  updated_at: string | null
  organization_id: string | null
  organizations: { id: string; name: string } | null
  /** Geographic state resolved via org → contact → ignition_client. */
  state: string | null
  city: string | null
  /** Service lines this proposal touches (Tax / Accounting / Advisory / Other). */
  service_lines: ServiceLine[]
  /** Direct link to the rendered proposal PDF (when Ignition has signed
   *  it). Populated for ~75% of proposals in practice. */
  signed_url: string | null
  /** Direct link to the proposal in the Ignition web app. ~98% populated. */
  ignition_url: string | null
  /** Direct link to the Ignition client page — used as the client-link
   *  fallback when we haven't matched the proposal to an internal
   *  organization yet (only ~31% of rows are matched). */
  ignition_client_url: string | null
  /** Ignition client slug (`cli_xxx`). */
  ignition_client_id: string | null
  /** Number of line items on this proposal. */
  service_count: number
  /** Whether ANY line item has a non-"one-time" billing frequency. Used
   *  to decide whether to render a "Recurring" badge — far more reliable
   *  than the proposal-level `recurring_total` column which is populated
   *  on only ~2% of rows. */
  has_recurring_line: boolean
}
interface ProposalsResponse {
  proposals: Proposal[]
  page: number
  pageSize: number
  total: number
  totalUnfiltered: number
  /** Aggregate KPIs computed over the *filtered* set so they reflect
   *  whatever the user is currently looking at (YTD by default). */
  stats: {
    total: number
    totalValue: number
    byStatus: Record<string, number>
    valueByStatus: Record<string, number>
    acceptedCount: number
    acceptedValue: number
    openCount: number
    openValue: number
    lostCount: number
    lostValue: number
    /** count-based: accepted / (accepted + lost). */
    winRate: number
    /** dollar-weighted: same idea but on value. Tends to be more
     *  flattering when small losses outnumber large wins, and more
     *  honest when a single huge loss skews the count rate. */
    valueWinRate: number
    /** acceptedValue / acceptedCount. */
    avgDealSize: number
    /** Median days from sent_at → accepted_at, integer. Null when the
     *  filtered window has no won proposals with both timestamps. */
    medianDaysToAccept: number | null
  }
  /** Last 12 months bucketed by primary status-event date. Pre-seeded
   *  with all 12 months so the chart axis stays stable on tight
   *  filters. */
  trend: Array<{
    month: string // "YYYY-MM"
    accepted: number
    lost: number
    open: number
    acceptedValue: number
    lostValue: number
    openValue: number
  }>
  /** Top 10 clients by accepted value within the filtered window. */
  topClients: Array<{
    key: string
    name: string
    orgId: string | null
    count: number
    acceptedValue: number
  }>
  dimensions: {
    statuses: string[]
    partners: string[]
    managers: string[]
    sentBy: string[]
    states: string[]
    serviceLines: string[]
    /**
     * Canonical service catalog (rolled-up de-duplicated names).
     * `id` is what we POST back as the filter value; `label` is what
     * the user picks in the dropdown.
     */
    canonicalServices: { id: string; label: string; serviceLine: string }[]
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const STATUS_TONE: Record<string, string> = {
  accepted: "bg-emerald-100 text-emerald-900 border-emerald-200",
  completed: "bg-emerald-100 text-emerald-900 border-emerald-200",
  sent: "bg-blue-100 text-blue-900 border-blue-200",
  draft: "bg-stone-100 text-stone-700 border-stone-200",
  lost: "bg-rose-100 text-rose-900 border-rose-200",
  declined: "bg-rose-100 text-rose-900 border-rose-200",
  archived: "bg-stone-100 text-stone-500 border-stone-200",
  revoked: "bg-amber-100 text-amber-900 border-amber-200",
}

const PROPOSAL_DATE_FIELDS: DateFieldOption[] = [
  { value: "created_at", label: "Created" },
  { value: "sent_at", label: "Sent" },
  { value: "accepted_at", label: "Accepted" },
  { value: "completed_at", label: "Completed" },
]

function fmtMoney(n: number | null | undefined, currency = "USD") {
  const v = Number(n) || 0
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `$${v.toLocaleString()}`
  }
}
// Compact-money formatter for chart axes and dense lists: $1.2k, $25k,
// $1.4M. Keeps the y-axis readable when value bars span $1k–$200k.
function fmtMoneyCompact(n: number | null | undefined): string {
  const v = Number(n) || 0
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}k`
  return `$${Math.round(v)}`
}
function fmtPct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(digits)}%`
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—"
  try {
    return new Date(s).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return s
  }
}
function titleCase(s: string | null | undefined) {
  if (!s) return ""
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function SalesProposals() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const page = Number.parseInt(searchParams.get("page") || "1", 10) || 1
  const pageSize = 50
  const search = searchParams.get("search") || ""
  const status = (searchParams.get("status") || "").split(",").filter(Boolean)
  const partner = (searchParams.get("partner") || "").split(",").filter(Boolean)
  const manager = (searchParams.get("manager") || "").split(",").filter(Boolean)
  const sentBy = (searchParams.get("sentBy") || "").split(",").filter(Boolean)
  const state = (searchParams.get("state") || "").split(",").filter(Boolean)
  const serviceLine = (searchParams.get("serviceLine") || "")
    .split(",")
    .filter(Boolean)
  // Canonical-service ids stored in URL — we resolve their human labels
  // from `data.dimensions.canonicalServices` once the response arrives.
  const canonicalService = (searchParams.get("canonicalService") || "")
    .split(",")
    .filter(Boolean)
  const minValue = searchParams.get("minValue") || ""
  const maxValue = searchParams.get("maxValue") || ""
  // Defaults: YTD on `accepted_at`. Sales partners read this page on a
  // calendar-year cadence, and `accepted_at` is the only date field that
  // actually reflects when revenue was won (`created_at` is import-
  // stamped from the historical Ignition migration and bunches into a
  // single day for most legacy rows).
  const ytdStart = `${new Date().getFullYear()}-01-01`
  const dateField = searchParams.get("dateField") || "accepted_at"
  const dateFrom = searchParams.get("dateFrom") || ytdStart
  const dateTo = searchParams.get("dateTo") || ""
  const sortBy = searchParams.get("sortBy") || "accepted_at"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"
  // A non-URL flag for "the user explicitly typed a date" so the
  // Clear Filters button can wipe the YTD default but the active-filter
  // counter doesn't include it (otherwise the chip count starts at 1
  // on first load, which is confusing).
  const userSetDateRange =
    !!searchParams.get("dateFrom") || !!searchParams.get("dateTo")

  const [searchInput, setSearchInput] = useState(search)
  const [editing, setEditing] = useState<Proposal | null>(null)

  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set("page", String(page))
    sp.set("pageSize", String(pageSize))
    if (search) sp.set("search", search)
    if (status.length) sp.set("status", status.join(","))
    if (partner.length) sp.set("partner", partner.join(","))
    if (manager.length) sp.set("manager", manager.join(","))
    if (sentBy.length) sp.set("sentBy", sentBy.join(","))
    if (state.length) sp.set("state", state.join(","))
    if (serviceLine.length) sp.set("serviceLine", serviceLine.join(","))
    if (canonicalService.length)
      sp.set("canonicalService", canonicalService.join(","))
    if (minValue) sp.set("minValue", minValue)
    if (maxValue) sp.set("maxValue", maxValue)
    // Always pass the resolved dateField — the server defaults to
    // created_at, but our UI default is accepted_at (see comment above).
    sp.set("dateField", dateField)
    if (dateFrom) sp.set("dateFrom", dateFrom)
    if (dateTo) sp.set("dateTo", dateTo)
    sp.set("sortBy", sortBy)
    sp.set("sortDir", sortDir)
    return sp.toString()
  }, [
    page,
    search,
    status,
    partner,
    manager,
    sentBy,
    state,
    serviceLine,
    canonicalService,
    minValue,
    maxValue,
    dateField,
    dateFrom,
    dateTo,
    sortBy,
    sortDir,
  ])

  const { data, error, isLoading, mutate } = useSWR<ProposalsResponse>(
    `/api/sales/proposals?${queryString}`,
    fetcher,
    { keepPreviousData: true },
  )

  function updateParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k)
      else sp.set(k, v)
    }
    // Reset page when filters change (but not when paging itself).
    if (!("page" in next)) sp.set("page", "1")
    router.replace(`${pathname}?${sp.toString()}`)
  }

  function toggleSort(field: string) {
    if (sortBy === field) {
      updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" })
    } else {
      updateParams({ sortBy: field, sortDir: "desc" })
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const activeFilterCount =
    (search ? 1 : 0) +
    status.length +
    partner.length +
    manager.length +
    sentBy.length +
    state.length +
    serviceLine.length +
    canonicalService.length +
    (minValue || maxValue ? 1 : 0) +
    // Only the user-set date range counts toward the "active filter"
    // tally — the YTD default doesn't, otherwise the page would load
    // showing "1 filter" with no chip visibly engaged.
    (userSetDateRange ? 1 : 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-stone-900">Proposals</h1>
          <IgnitionLiveBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total.toLocaleString()} proposals` : "Loading proposals…"}
          {data && activeFilterCount > 0
            ? ` matching ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} (of ${data.totalUnfiltered.toLocaleString()})`
            : ""}
        </p>
        {/* Quick-pick range presets. The default view is YTD on
            accepted_at; partners who want a tighter (MTD/QTD) or wider
            (Last 12mo / All time) framing can flip it with a single
            click. The active preset stays highlighted so the page
            always shows "what window am I looking at" without having
            to inspect the Date chip. */}
        <DateRangePresets
          from={dateFrom}
          to={dateTo}
          onChange={({ from, to }) =>
            updateParams({
              dateFrom: from || null,
              dateTo: to || null,
            })
          }
        />
      </div>

      {/* KPI Strip — aggregate metrics over the filtered set. Stays in
          sync with whatever date range / status / partner filters are
          active, so the four cards always describe the same slice the
          table is showing. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Pipeline Value"
          value={data ? fmtMoney(data.stats.totalValue) : "—"}
          subtitle={
            data
              ? `${data.stats.total.toLocaleString()} proposal${data.stats.total === 1 ? "" : "s"}${
                  data.stats.medianDaysToAccept != null
                    ? ` · ${data.stats.medianDaysToAccept}d median to accept`
                    : ""
                }`
              : ""
          }
          icon={Target}
          tone="stone"
        />
        <KpiCard
          label="Won"
          value={data ? fmtMoney(data.stats.acceptedValue) : "—"}
          subtitle={
            data
              ? // Show count-based win rate as the lead metric — it's
                // the rate partners quote in conversation. The
                // dollar-weighted rate is in the trend chart legend.
                `${data.stats.acceptedCount.toLocaleString()} accepted · ${
                  data.stats.acceptedCount + data.stats.lostCount > 0
                    ? `${fmtPct(data.stats.winRate)} win rate`
                    : "no decisions yet"
                }`
              : ""
          }
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="In Progress"
          value={data ? fmtMoney(data.stats.openValue) : "—"}
          subtitle={
            data
              ? `${data.stats.openCount.toLocaleString()} awaiting decision`
              : ""
          }
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="Lost"
          value={data ? fmtMoney(data.stats.lostValue) : "—"}
          subtitle={
            data
              ? data.stats.acceptedCount > 0
                ? `${data.stats.lostCount.toLocaleString()} declined · avg deal ${fmtMoneyCompact(data.stats.avgDealSize)}`
                : `${data.stats.lostCount.toLocaleString()} declined`
              : ""
          }
          icon={XCircle}
          tone="rose"
        />
      </div>

      {/* Charts Strip — monthly trend, status mix, top clients. Reads
          the same filtered set as the KPIs above. */}
      <ProposalsCharts data={data} isLoading={isLoading} />

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
              placeholder="Search client, title, proposal #, email…"
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
            label="Status"
            options={data?.dimensions?.statuses || []}
            value={status}
            onChange={(v) => updateParams({ status: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="State"
            options={data?.dimensions?.states || []}
            value={state}
            // The picker shows "Massachusetts" but the URL stores the abbr "MA"
            // so links remain compact and don't change when the lookup table grows.
            formatLabel={(v) => (v === "(unknown)" ? "(no state on file)" : US_STATE_NAMES[v] || v)}
            onChange={(v) => updateParams({ state: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Service"
            // Canonical (rolled-up) service catalog. We pass ids as
            // `options` and supply formatLabel so the dropdown shows
            // human names like "Tax Prep — Individual Federal (1040)"
            // rather than "tax-prep-1040". Selecting one or more
            // canonicals filters proposals whose line items rolled up
            // into ANY of those canonicals — handles the duplicate-name
            // problem (e.g. "Individual Tax Return (1040)" vs
            // "Tax | Prep (1040): Federal Return (Individual)" all
            // collapse into the same canonical id).
            options={(data?.dimensions?.canonicalServices || []).map((c) => c.id)}
            value={canonicalService}
            formatLabel={(id) =>
              data?.dimensions?.canonicalServices.find((c) => c.id === id)?.label ?? id
            }
            onChange={(v) =>
              updateParams({ canonicalService: v.length ? v.join(",") : null })
            }
          />
          <MultiSelectChip
            label="Service Line"
            options={data?.dimensions?.serviceLines || []}
            value={serviceLine}
            // Pass through verbatim: the values are already user-facing
            // ("Tax", "Accounting", "Advisory", "Other").
            formatLabel={(v) => v}
            onChange={(v) => updateParams({ serviceLine: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Partner"
            options={data?.dimensions?.partners || []}
            value={partner}
            onChange={(v) => updateParams({ partner: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Manager"
            options={data?.dimensions?.managers || []}
            value={manager}
            onChange={(v) => updateParams({ manager: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Sent by"
            options={data?.dimensions?.sentBy || []}
            value={sentBy}
            onChange={(v) => updateParams({ sentBy: v.length ? v.join(",") : null })}
          />
          <RangeChip
            label="Value"
            min={minValue}
            max={maxValue}
            onChange={({ min, max }) =>
              updateParams({
                minValue: min || null,
                maxValue: max || null,
              })
            }
          />
          <DateRangeChip
            label="Date"
            field={dateField}
            from={dateFrom}
            to={dateTo}
            fieldOptions={PROPOSAL_DATE_FIELDS}
            onChange={({ from, to, field }) =>
              updateParams({
                dateField: field === "created_at" ? null : field,
                dateFrom: from || null,
                dateTo: to || null,
              })
            }
          />

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
                    field="proposal_number"
                    label="Proposal #"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    field="client_name"
                    label="Client"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="text-left px-3 py-2 font-medium">Title</th>
                  <SortableHeader
                    field="status"
                    label="Status"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    field="total_value"
                    label="Value"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  {/*
                    Was previously "Recurring/mo" sourced from
                    proposal.recurring_total — only ~16 / 912 rows in
                    production have a non-null value, so the column was
                    blank for everyone. Service count is universally
                    populated and gives a stronger at-a-glance signal
                    about scope (a 6-line bundle vs a single-line
                    engagement).
                  */}
                  <th className="text-right px-3 py-2 font-medium">Services</th>
                  <th className="text-left px-3 py-2 font-medium">Sent by</th>
                  <SortableHeader
                    field="created_at"
                    label="Created"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    field="accepted_at"
                    label="Accepted"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {isLoading && !data ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={11} className="px-3 py-3">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-rose-600">
                      Failed to load proposals.
                    </td>
                  </tr>
                ) : data && data.proposals.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                      <FilterIcon className="h-6 w-6 mx-auto mb-2 opacity-40" />
                      No proposals match the current filters.
                    </td>
                  </tr>
                ) : (
                  data?.proposals.map((p) => {
                    const orgName = p.organizations?.name || p.client_name || "—"
                    // Internal client profile when we've matched the
                    // proposal to an organization (~31% of rows). Falls
                    // through to the Ignition client URL when unmatched
                    // so EVERY row gets a working client link — partners
                    // shouldn't have to bounce out to Ignition's UI just
                    // to find a client we already know about.
                    const orgHref = p.organization_id
                      ? `/clients/${p.organization_id}`
                      : null
                    const clientHref = orgHref ?? p.ignition_client_url
                    const clientLinkIsExternal = !orgHref && !!p.ignition_client_url
                    const tone = STATUS_TONE[p.status || ""] || "bg-stone-100 text-stone-700 border-stone-200"
                    return (
                      <tr key={p.proposal_id} className="border-b hover:bg-stone-50/60">
                        <td className="px-3 py-2 font-mono text-xs">{p.proposal_number || p.proposal_id.slice(0, 8)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {clientHref ? (
                              clientLinkIsExternal ? (
                                // External link to Ignition's client page —
                                // visually identical so the table reads
                                // consistently, but opens in a new tab.
                                <a
                                  href={clientHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline font-medium"
                                  title="Open in Ignition (no internal client match yet)"
                                >
                                  {orgName}
                                </a>
                              ) : (
                                <Link href={clientHref} className="hover:underline font-medium">
                                  {orgName}
                                </Link>
                              )
                            ) : (
                              <span className="font-medium">{orgName}</span>
                            )}
                            {p.state ? (
                              // The little state pill carries an icon to read
                              // as "location" rather than another generic tag.
                              // Title attribute spells out the full state name
                              // for users who don't know the abbreviation.
                              <span
                                title={US_STATE_NAMES[p.state] || p.state}
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-stone-500 bg-stone-100 border border-stone-200 rounded px-1 py-0.5"
                              >
                                <MapPin className="h-2.5 w-2.5" />
                                {p.state}
                              </span>
                            ) : null}
                          </div>
                          {p.client_email ? (
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {p.client_email}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 max-w-[260px] text-stone-700">
                          <div className="truncate">{p.title || "—"}</div>
                          {p.service_lines.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {p.service_lines.map((line) => {
                                const meta = SERVICE_LINE_META[line]
                                return (
                                  <span
                                    key={line}
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.5 rounded border",
                                      meta.bg,
                                      meta.text,
                                      meta.border,
                                    )}
                                  >
                                    {line}
                                  </span>
                                )
                              })}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={cn("border", tone)}>
                            {titleCase(p.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {fmtMoney(p.total_value, p.currency || "USD")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5 text-stone-700">
                            <span className="tabular-nums">{p.service_count}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.service_count === 1 ? "line" : "lines"}
                            </span>
                          </div>
                          {p.has_recurring_line ? (
                            <div className="text-[10px] text-emerald-700 font-medium mt-0.5">
                              Has recurring
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {/* In the live data `proposal_sent_by` is
                              populated on ~95% of rows, `client_partner`
                              on ~10%, `client_manager` on <1%. Prefer the
                              column that's actually filled in. */}
                          {p.proposal_sent_by ||
                            p.client_partner ||
                            p.client_manager ||
                            "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(p.created_at)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(p.accepted_at)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-stone-500 hover:text-stone-900"
                              onClick={() => setEditing(p)}
                              title="Edit proposal"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {p.signed_url ? (
                              // ~75% of proposals have a signed_url
                              // pointing at the rendered PDF; surface it
                              // here so reps can open the actual proposal
                              // without bouncing through Ignition's UI.
                              <a
                                href={p.signed_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-stone-500 hover:text-stone-900 p-1"
                                title="Open signed proposal PDF"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                            {p.ignition_url ? (
                              // ~98% of proposals have a direct link to
                              // the proposal page in Ignition's web app.
                              // Distinct from `signed_url` (the PDF) —
                              // this one opens the live editable proposal
                              // so partners can take action on it.
                              <a
                                href={p.ignition_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-stone-500 hover:text-stone-900 p-1"
                                title="Open proposal in Ignition"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>
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

      <ProposalEditSheet
        proposal={editing}
        statuses={data?.dimensions?.statuses || []}
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null)
        }}
        onSaved={() => mutate()}
      />

      {/* Pagination */}
      {data ? (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {data.page} of {totalPages} • {data.total.toLocaleString()} total
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── KPI card ─────────────────────────────────────────────────────────────
// Single-purpose card for the four-up dashboard strip. Mirrors the look
// used on the Invoices and Payments pages so the three sibling surfaces
// feel like one product.
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

// ── Charts strip ─────────────────────────────────────────────────────────
// Three-panel analytics row: monthly trend (won vs lost vs in-progress
// value), status mix donut, and top clients by accepted value. All
// three read the same `data.trend`, `data.stats.byStatus`, and
// `data.topClients` that the API computed against the *currently
// filtered* set, so the charts and the table below always describe the
// same slice.
function ProposalsCharts({
  data,
  isLoading,
}: {
  data: ProposalsResponse | undefined
  isLoading: boolean
}) {
  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Skeleton className="h-[260px] lg:col-span-2" />
        <Skeleton className="h-[260px]" />
        <Skeleton className="h-[200px] lg:col-span-3" />
      </div>
    )
  }
  if (!data) return null

  const trendData = data.trend.map((t) => ({
    ...t,
    label: monthLabel(t.month),
  }))
  const trendIsEmpty = trendData.every(
    (t) => t.acceptedValue === 0 && t.lostValue === 0 && t.openValue === 0,
  )

  // Sort status entries by count so legend colour order stays stable
  // across renders.
  const statusEntries = Object.entries(data.stats.byStatus)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Monthly trend */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Last 12 months · pipeline value
              </h3>
              <span className="ml-auto text-xs text-muted-foreground">
                {data.stats.valueWinRate > 0
                  ? `${fmtPct(data.stats.valueWinRate)} dollar win rate`
                  : "won / open / lost stacked"}
              </span>
            </div>
            {trendIsEmpty ? (
              <EmptyChartFallback message="No proposal activity in the last 12 months" />
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={trendData}
                    margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E7E5E4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => fmtMoneyCompact(v as number)}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      formatter={(v: number) => fmtMoney(v)}
                      labelClassName="text-xs"
                      contentStyle={{
                        borderRadius: 6,
                        fontSize: 12,
                        border: "1px solid #E7E5E4",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                    {/* Stack accepted + open + lost so total bar height
                        reads as "all proposals in this month" and the
                        three-colour split tells the won/working/lost
                        story at a glance. */}
                    <Bar
                      dataKey="acceptedValue"
                      name="Won"
                      stackId="amt"
                      fill="#059669"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="openValue"
                      name="In progress"
                      stackId="amt"
                      fill="#F59E0B"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="lostValue"
                      name="Lost"
                      stackId="amt"
                      fill="#E11D48"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status mix donut */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <PieChartIcon className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">Status mix</h3>
            </div>
            {statusEntries.length === 0 ? (
              <EmptyChartFallback message="No proposals yet" />
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusEntries.map(([k, v]) => ({
                        name: titleCase(k),
                        key: k,
                        value: v,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="#fff"
                    >
                      {statusEntries.map(([k]) => (
                        <Cell key={k} fill={proposalStatusColor(k)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, _name, item: any) => [
                        `${v} proposal${v === 1 ? "" : "s"}`,
                        item?.payload?.name,
                      ]}
                      contentStyle={{
                        borderRadius: 6,
                        fontSize: 12,
                        border: "1px solid #E7E5E4",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top clients by accepted value — list view (no chart) keeps
          long client names readable. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">
              Top clients by won value
            </h3>
            <span className="ml-auto text-xs text-muted-foreground">
              {data.topClients.length === 0
                ? ""
                : `top ${data.topClients.length} by accepted value`}
            </span>
          </div>
          {data.topClients.length === 0 ? (
            <EmptyChartFallback message="No accepted proposals in the active window" />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
              {data.topClients.map((c) => {
                const href = c.orgId ? `/clients/${c.orgId}` : null
                return (
                  <li
                    key={c.key}
                    className="flex items-center gap-2 py-1.5 text-sm border-b border-stone-100 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      {href ? (
                        <Link
                          href={href}
                          className="font-medium text-stone-900 hover:underline truncate block"
                          title={c.name}
                        >
                          {c.name}
                        </Link>
                      ) : (
                        <span
                          className="font-medium text-stone-700 truncate block"
                          title={c.name}
                        >
                          {c.name}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {c.count} accepted proposal{c.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="tabular-nums text-emerald-700 font-semibold text-sm">
                      {fmtMoneyCompact(c.acceptedValue)}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyChartFallback({ message }: { message: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

// Map "YYYY-MM" → short axis label. Includes a 2-digit year suffix on
// January so the axis doesn't say "Jan…Dec…Jan" without context across
// a year boundary.
function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  const d = new Date(y, m - 1, 1)
  const short = d.toLocaleDateString("en-US", { month: "short" })
  return m === 1 ? `${short} ${String(y).slice(-2)}` : short
}

// Pie-slice palette aligned to the STATUS_TONE badge classes so the
// chart and the table reinforce the same colour vocabulary. Won is
// emerald, in-flight is blue/amber, lost is rose, archived/revoked
// dimmer.
function proposalStatusColor(status: string): string {
  switch (status) {
    case "accepted":
    case "completed":
      return "#059669" // emerald — revenue won
    case "awaiting_acceptance":
      return "#3B82F6" // blue — out for signature
    case "sent":
      return "#60A5FA" // softer blue
    case "draft":
      return "#A8A29E" // stone — not yet sent
    case "revoked":
      return "#F59E0B" // amber — pulled back
    case "lost":
    case "declined":
      return "#E11D48" // rose — opportunity gone
    case "archived":
      return "#D6D3D1" // very light stone
    default:
      return "#A8A29E"
  }
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
