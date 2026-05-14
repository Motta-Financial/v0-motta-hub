"use client"

/**
 * Sales > Payments listing
 * ────────────────────────────────────────────────────────────────────────
 * Server-paginated payment table with KPI strip showing gross collected,
 * processing fees, net revenue, and refunds across the full set (not the
 * current page). Stripe charge IDs link out to the Stripe dashboard when
 * present.
 *
 * Mirrors the architecture of SalesInvoices and SalesProposals: URL state
 * for every filter (page, search, status, state, amount range, date
 * range, sort) and an IgnitionLiveBadge in the header so users can verify
 * the data is being pulled from the live Reporting API feed.
 *
 * Payments don't carry direct FKs to organization/contact — the server
 * route resolves the client via the linked invoice's organization_id /
 * contact_id / ignition_client_id chain.
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
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
  Filter as FilterIcon,
  Wallet,
  TrendingDown,
  TrendingUp,
  Users,
  MapPin,
  Info,
  Timer,
  PieChart as PieChartIcon,
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

interface Payment {
  ignition_payment_id: string
  payment_status: string | null
  amount: number | null
  fees: number | null
  net_amount: number | null
  currency: string
  payment_method: string | null
  paid_at: string | null
  refunded_at: string | null
  refund_amount: number | null
  stripe_charge_id: string | null
  stripe_payment_intent_id: string | null
  ignition_invoice_id: string | null
  invoice_number: string | null
  proposal_id: string | null
  organization_id: string | null
  contact_id: string | null
  organization: { id: string; name: string } | null
  contact: { id: string; full_name: string } | null
  client_name: string | null
  state: string | null
  city: string | null
}
interface PaymentsResponse {
  payments: Payment[]
  page: number
  pageSize: number
  total: number
  totalUnfiltered: number
  stats: {
    total: number
    totalAmount: number
    totalFees: number
    totalNet: number
    totalRefunded: number
    byStatus: Record<string, number>
  }
  analytics: {
    /** Monthly trend across the past 12 months, in chronological order. */
    trend: Array<{
      month: string // "YYYY-MM"
      count: number
      gross: number
      net: number
      fees: number
    }>
    /** Top 10 clients by gross collected within the filtered window. */
    topClients: Array<{
      key: string
      name: string
      orgId: string | null
      contactId: string | null
      count: number
      gross: number
      net: number
    }>
    /** Median days from invoice issuance → payment, within the window. */
    medianDaysToCollect: number | null
  }
  dimensions: {
    statuses: string[]
    states: string[]
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Ignition's real payment_status values are `disbursed` (paid out to
// the practice's bank), `collected` (received but not yet disbursed),
// and `uncollected` (client owes). We tone-map them rather than using
// generic Stripe-like buckets.
const STATUS_TONE: Record<string, string> = {
  disbursed: "bg-emerald-100 text-emerald-900 border-emerald-200",
  collected: "bg-blue-100 text-blue-900 border-blue-200",
  uncollected: "bg-amber-100 text-amber-900 border-amber-200",
  refunded: "bg-rose-100 text-rose-900 border-rose-200",
  failed: "bg-rose-100 text-rose-900 border-rose-200",
  "(none)": "bg-stone-100 text-stone-500 border-stone-200",
}

const PAYMENT_DATE_FIELDS: DateFieldOption[] = [
  { value: "paid_at", label: "Paid date" },
]

function fmtMoney(n: number | null | undefined, currency = "USD") {
  const v = Number(n) || 0
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return `$${v.toLocaleString()}`
  }
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

export function SalesPayments() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const page = Number.parseInt(searchParams.get("page") || "1", 10) || 1
  const pageSize = 50
  const search = searchParams.get("search") || ""
  const status = (searchParams.get("status") || "").split(",").filter(Boolean)
  const state = (searchParams.get("state") || "").split(",").filter(Boolean)
  const minAmount = searchParams.get("minAmount") || ""
  const maxAmount = searchParams.get("maxAmount") || ""
  // YTD default on paid_at. 625 of 1,531 payments are YTD — a natural
  // "what have we collected this year so far" framing matches how
  // partners read this surface.
  const ytdStart = `${new Date().getFullYear()}-01-01`
  const dateField = searchParams.get("dateField") || "paid_at"
  const dateFrom = searchParams.get("dateFrom") || ytdStart
  const dateTo = searchParams.get("dateTo") || ""
  const sortBy = searchParams.get("sortBy") || "paid_at"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"
  const userSetDateRange =
    !!searchParams.get("dateFrom") || !!searchParams.get("dateTo")

  const [searchInput, setSearchInput] = useState(search)

  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set("page", String(page))
    sp.set("pageSize", String(pageSize))
    if (search) sp.set("search", search)
    if (status.length) sp.set("status", status.join(","))
    if (state.length) sp.set("state", state.join(","))
    if (minAmount) sp.set("minAmount", minAmount)
    if (maxAmount) sp.set("maxAmount", maxAmount)
    // dateField is always paid_at today (the only field Reporting API
    // exposes) but be explicit so the server side never silently
    // defaults to a different column.
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
    state,
    minAmount,
    maxAmount,
    dateField,
    dateFrom,
    dateTo,
    sortBy,
    sortDir,
  ])

  const { data, error, isLoading, mutate } = useSWR<PaymentsResponse>(
    `/api/sales/payments?${queryString}`,
    fetcher,
    { keepPreviousData: true },
  )

  function updateParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k)
      else sp.set(k, v)
    }
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
    state.length +
    (minAmount || maxAmount ? 1 : 0) +
    (userSetDateRange ? 1 : 0)

  // The original layout had a "Refunded" KPI tile sourced from
  // `refund_amount` + `refunded_at`. Both fields are present on the
  // table schema but the Ignition Reporting API never populates them
  // (0/1,531 rows in production), so the tile always rendered $0 and
  // misled users. We replace it with "Unique Clients" — a roll-up over
  // the resolved client_name on the current filtered set, which gives a
  // useful "how many distinct relationships paid us" signal.
  const uniqueClientCount = data
    ? new Set(
        data.payments
          .map(
            (p) =>
              p.organization_id || p.contact_id || p.client_name || null,
          )
          .filter((v): v is string => !!v),
      ).size
    : 0
  const avgPaymentSize =
    data && data.stats.total > 0 ? data.stats.totalAmount / data.stats.total : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-stone-900">Payments</h1>
          <IgnitionLiveBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total.toLocaleString()} payments` : "Loading payments…"}
          {data && activeFilterCount > 0
            ? ` matching ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} (of ${data.totalUnfiltered.toLocaleString()})`
            : ""}
        </p>
        {/* Quick-pick range presets. The default view is YTD; partners
            who want a tighter (MTD/QTD) or wider (Last 12mo / All time)
            framing can flip it with a single click. The active preset
            stays highlighted so the page always shows "what window am
            I looking at" without having to inspect the Date chip. */}
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

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Gross Collected"
          value={data ? fmtMoney(data.stats.totalAmount) : "—"}
          subtitle={data ? `${data.stats.total.toLocaleString()} payments` : ""}
          icon={Wallet}
          tone="stone"
        />
        <KpiCard
          label="Processing Fees"
          value={data ? fmtMoney(data.stats.totalFees) : "—"}
          subtitle={
            data && data.stats.totalAmount > 0
              ? `${((data.stats.totalFees / data.stats.totalAmount) * 100).toFixed(2)}% of gross`
              : ""
          }
          icon={TrendingDown}
          tone="amber"
        />
        <KpiCard
          label="Net Revenue"
          value={data ? fmtMoney(data.stats.totalNet) : "—"}
          subtitle={
            // Lead with median-days-to-collect when we have it — far
            // more actionable than the static "after Stripe fees"
            // descriptor. Falls back to the old descriptor when the
            // filtered window has no invoice/payment pairs (e.g.
            // MTD on day 1 of a month).
            data?.analytics.medianDaysToCollect != null
              ? `${data.analytics.medianDaysToCollect}d median to collect`
              : "after Stripe fees"
          }
          icon={TrendingUp}
          tone="emerald"
        />
        <KpiCard
          label="Unique Clients"
          value={data ? uniqueClientCount.toLocaleString() : "—"}
          subtitle={
            avgPaymentSize > 0
              ? `avg ${fmtMoney(avgPaymentSize)} / payment`
              : "distinct relationships paid"
          }
          icon={Users}
          tone="blue"
        />
      </div>

      {/* Charts Strip — monthly trend + status mix + top clients.
          Reads the analytics block from the API which is computed
          across the *currently filtered* window so the chart and the
          table below stay in sync. */}
      <PaymentsCharts data={data} isLoading={isLoading} />

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
              placeholder="Search payment ID, invoice #, or client…"
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
            formatLabel={(v) => (v === "(none)" ? "(no status)" : titleCase(v))}
            onChange={(v) => updateParams({ status: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="State"
            options={data?.dimensions?.states || []}
            value={state}
            formatLabel={(v) =>
              v === "(unknown)" ? "(no state on file)" : US_STATE_NAMES[v] || v
            }
            onChange={(v) => updateParams({ state: v.length ? v.join(",") : null })}
          />
          <RangeChip
            label="Amount"
            min={minAmount}
            max={maxAmount}
            onChange={({ min, max }) =>
              updateParams({
                minAmount: min || null,
                maxAmount: max || null,
              })
            }
          />
          <DateRangeChip
            label="Date"
            field={dateField}
            from={dateFrom}
            to={dateTo}
            fieldOptions={PAYMENT_DATE_FIELDS}
            onChange={({ from, to, field }) =>
              updateParams({
                dateField: field === "paid_at" ? null : field,
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
                    field="paid_at"
                    label="Paid"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="text-left px-3 py-2 font-medium">Client</th>
                  <th className="text-left px-3 py-2 font-medium">Invoice</th>
                  <SortableHeader
                    field="payment_status"
                    label="Status"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    field="amount"
                    label="Gross"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="fees"
                    label="Fees"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="net_amount"
                    label="Net"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  {/*
                    The trailing actions column previously hosted a
                    Stripe deep-link icon, but `stripe_charge_id` /
                    `stripe_payment_intent_id` are never populated by
                    the Ignition Reporting API (0/1,531 rows in prod).
                    Until Ignition starts wiring those through, we drop
                    the column entirely — empty space on every row is
                    noisier than a clean right edge.
                  */}
                </tr>
              </thead>
              <tbody>
                {isLoading && !data ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {/* colSpan now matches the 7 visible headers
                          (Paid / Client / Invoice / Status / Gross /
                          Fees / Net) after the Stripe-actions column
                          was retired above. */}
                      <td colSpan={7} className="px-3 py-3">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                ) : error ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-rose-600">
                      Failed to load payments.
                    </td>
                  </tr>
                ) : data && data.payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      <FilterIcon className="h-6 w-6 mx-auto mb-2 opacity-40" />
                      No payments match the current filters.
                    </td>
                  </tr>
                ) : (
                  data?.payments.map((p) => {
                    const clientName =
                      p.organization?.name || p.contact?.full_name || p.client_name || "—"
                    const orgHref = p.organization_id
                      ? `/clients/${p.organization_id}`
                      : p.contact_id
                        ? `/clients/${p.contact_id}`
                        : null
                    const statusKey = p.payment_status || "(none)"
                    const tone = STATUS_TONE[statusKey] || "bg-stone-100 text-stone-700 border-stone-200"
                    // Refunded indicator: the Reporting API doesn't
                    // populate refund_amount today, but if/when it does
                    // we'll surface a small inline pill. Until then the
                    // condition is always false so the badge is hidden.
                    const isRefunded = (p.refund_amount ?? 0) > 0
                    return (
                      <tr key={p.ignition_payment_id} className="border-b hover:bg-stone-50/60">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-stone-900">{fmtDate(p.paid_at)}</div>
                          <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[120px]">
                            {p.ignition_payment_id.replace(/^pypay_/, "")}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {orgHref ? (
                              <Link href={orgHref} className="hover:underline font-medium">
                                {clientName}
                              </Link>
                            ) : (
                              <span className="font-medium">{clientName}</span>
                            )}
                            {p.state ? (
                              <span
                                title={US_STATE_NAMES[p.state] || p.state}
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-stone-500 bg-stone-100 border border-stone-200 rounded px-1 py-0.5"
                              >
                                <MapPin className="h-2.5 w-2.5" />
                                {p.state}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {p.invoice_number || (p.ignition_invoice_id ? p.ignition_invoice_id.slice(0, 12) : "—")}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={cn("border", tone)}>
                            {titleCase(statusKey)}
                          </Badge>
                          {isRefunded ? (
                            <Badge
                              variant="outline"
                              className="ml-1 border bg-rose-50 text-rose-900 border-rose-200"
                            >
                              Refunded
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {fmtMoney(p.amount, p.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {p.fees != null ? fmtMoney(p.fees, p.currency) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">
                          {p.net_amount != null ? fmtMoney(p.net_amount, p.currency) : "—"}
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

      {/* Disbursals archive note */}
      <Card>
        <CardContent className="p-3 flex items-start gap-3 text-sm">
          <Info className="h-4 w-4 mt-0.5 text-stone-500 shrink-0" />
          <div className="text-stone-700">
            <span className="font-medium">Looking for disbursal batches?</span> The
            Ignition Reporting API doesn&apos;t expose payouts, so the historical
            disbursals archive (~53 batches from the retired Zapier feed) lives on the{" "}
            <Link
              href="/admin/ignition"
              className="text-stone-900 underline hover:no-underline"
            >
              Ignition admin page
            </Link>
            {" "}under the Reporting Data tab. Going forward, payout reconciliation should
            be done by grouping the rows above by paid date.
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

// ── Charts strip ───────────────────────────────────────────────────────
// Three-panel analytics row: monthly trend (12mo), status mix, and
// top-collected clients. All panels read from the API's `analytics`
// block which is computed against the same filter predicate the table
// uses — so when the user is on YTD the chart shows YTD, when they
// click MTD it switches to MTD, etc.
//
// Why we don't render method mix: payment_method is never populated by
// the Ignition Reporting API (verified 0/1,531 rows in prod), so a chart
// would always be a single grey wedge labelled "(none)". Until the
// upstream API starts wiring methods through we skip the panel entirely.
function PaymentsCharts({
  data,
  isLoading,
}: {
  data: PaymentsResponse | undefined
  isLoading: boolean
}) {
  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Skeleton className="h-[260px] lg:col-span-2" />
        <Skeleton className="h-[260px]" />
      </div>
    )
  }
  if (!data) return null

  const trendData = data.analytics.trend.map((t) => ({
    ...t,
    label: monthLabel(t.month),
  }))
  const trendIsEmpty = trendData.every((t) => t.gross === 0)

  // Sort status entries by count so the legend / colour order stays
  // stable across renders even as the underlying counts change.
  const statusEntries = Object.entries(data.stats.byStatus)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: trend (wide) + status mix (narrow) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Last 12 months · net collected
              </h3>
              <span className="ml-auto text-xs text-muted-foreground">
                stacked with processing fees
              </span>
            </div>
            {trendIsEmpty ? (
              <EmptyChartFallback message="No payments in the last 12 months" />
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
                    {/* Stack net + fees so the total bar height = gross
                        and the green vs amber split tells the
                        "what landed in our pocket" story at a glance. */}
                    <Bar
                      dataKey="net"
                      name="Net"
                      stackId="amt"
                      fill="#059669"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="fees"
                      name="Fees"
                      stackId="amt"
                      fill="#F59E0B"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <PieChartIcon className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">Status mix</h3>
            </div>
            {statusEntries.length === 0 ? (
              <EmptyChartFallback message="No payments yet" />
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
                        <Cell key={k} fill={statusColor(k)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, _name, item: any) => [
                        `${v} payment${v === 1 ? "" : "s"}`,
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

      {/* Row 2: top collected clients — list view (no chart) keeps it
          readable when names are long. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">
              Top collected clients
            </h3>
            <span className="ml-auto text-xs text-muted-foreground">
              {data.analytics.topClients.length === 0
                ? ""
                : `top ${data.analytics.topClients.length} by gross`}
            </span>
          </div>
          {data.analytics.topClients.length === 0 ? (
            <EmptyChartFallback message="No payments in the active window" />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
              {data.analytics.topClients.map((c) => {
                const href = c.orgId
                  ? `/clients/${c.orgId}`
                  : c.contactId
                    ? `/clients/${c.contactId}`
                    : null
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
                        {c.count} payment{c.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="tabular-nums text-emerald-700 font-semibold text-sm">
                      {fmtMoneyCompact(c.gross)}
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

// Compact-money formatter for chart axes: $1.2k, $25k, $1.4M. Keeps the
// y-axis readable when payment volumes span $0–$80k bars.
function fmtMoneyCompact(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

// Map "YYYY-MM" → short axis label. Includes a 2-digit year suffix when
// the 12-month window straddles a year boundary so the axis doesn't say
// "Jan…Dec…Jan" without context. Mirrors the helper on the invoices page.
function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  const d = new Date(y, m - 1, 1)
  const short = d.toLocaleDateString("en-US", { month: "short" })
  return m === 1 ? `${short} ${String(y).slice(-2)}` : short
}

// Tone colours for status pie slices. Mirrors the badge palette so the
// chart and the table rows reinforce the same colour vocabulary.
function statusColor(status: string): string {
  switch (status) {
    case "disbursed":
      return "#059669" // emerald — money landed in our bank
    case "collected":
      return "#3B82F6" // blue — received but not yet disbursed
    case "uncollected":
      return "#F59E0B" // amber — client still owes
    case "refunded":
    case "failed":
      return "#DC2626" // rose
    default:
      return "#A8A29E" // stone
  }
}
