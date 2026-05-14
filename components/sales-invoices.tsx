"use client"

/**
 * Sales > Invoices listing
 * ────────────────────────────────────────────────────────────────────────
 * Server-paginated invoice table with KPI strip showing total billed, paid,
 * and outstanding across the full set (not the current page). Stripe invoice
 * IDs link out to the Stripe dashboard when present.
 *
 * URL state covers every filter (page, search, status, state, amount range,
 * date range/field, sort) so the view is shareable and reload-stable.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import useSWR from "swr"
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
  Receipt,
  CheckCircle2,
  Clock,
  AlertCircle,
  Pencil,
  MapPin,
  TrendingUp,
  CalendarClock,
  Timer,
  Users,
} from "lucide-react"
import { InvoiceEditSheet } from "@/components/sales/invoice-edit-sheet"
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

interface Invoice {
  ignition_invoice_id: string
  invoice_number: string | null
  status: string | null
  amount: number | null
  amount_paid: number | null
  amount_outstanding: number | null
  currency: string | null
  invoice_date: string | null
  due_date: string | null
  sent_at: string | null
  paid_at: string | null
  voided_at: string | null
  stripe_invoice_id: string | null
  proposal_id: string | null
  organization_id: string | null
  contact_id: string | null
  organizations: { id: string; name: string } | null
  contacts: { id: string; full_name: string } | null
  /** Geographic state resolved via org → contact → ignition_client. */
  state: string | null
  city: string | null
}
interface AgingBucket {
  count: number
  amount: number
}
interface InvoicesResponse {
  invoices: Invoice[]
  page: number
  pageSize: number
  total: number
  totalUnfiltered: number
  stats: {
    total: number
    totalAmount: number
    totalPaid: number
    totalOutstanding: number
    byStatus: Record<string, number>
    /** Count of invoices with outstanding balance + past-due date —
     *  broader than `byStatus.overdue` because it includes `issued` /
     *  `outstanding` rows the Ignition Reporting API hasn't refreshed
     *  yet. This is the metric the KPIs use. */
    overdueCount: number
    overdueAmount: number
    /** paid / billed across the entire history. */
    collectionRate: number
    /** Median days from invoice_date → paid_at. Null when nothing has
     *  been paid yet. */
    medianDaysToPay: number | null
    aging: {
      current: AgingBucket
      d1to30: AgingBucket
      d31to60: AgingBucket
      d61to90: AgingBucket
      d90plus: AgingBucket
    }
  }
  dimensions: {
    statuses: string[]
    states: string[]
  }
  /** Last 12 months bucketed on invoice_date. Always 12 entries (zero-
   *  filled for inactive months) so the chart spans a stable window. */
  trend: Array<{
    month: string
    billed: number
    paid: number
    outstanding: number
    count: number
  }>
  /** Top 10 clients by outstanding balance — the page's collection
   *  priority list. */
  topOutstanding: Array<{
    key: string
    name: string
    id: string | null
    kind: "organization" | "contact" | null
    count: number
    billed: number
    outstanding: number
  }>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Status values actually observed in production (1,051 invoices):
// paid, outstanding, overdue, issued, open, voided, draft. The legacy
// `sent` value still appears in older docs/migrations so we keep its
// tone for safety.
const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-900 border-emerald-200",
  issued: "bg-blue-100 text-blue-900 border-blue-200",
  sent: "bg-blue-100 text-blue-900 border-blue-200",
  open: "bg-blue-50 text-blue-800 border-blue-200",
  outstanding: "bg-amber-100 text-amber-900 border-amber-200",
  overdue: "bg-rose-100 text-rose-900 border-rose-200",
  voided: "bg-stone-100 text-stone-500 border-stone-200",
  draft: "bg-stone-100 text-stone-700 border-stone-200",
}

// Lifecycle buckets surfaced by the quick-chip toolbar above the table.
// They map to a *set* of underlying statuses rather than 1:1 because
// Ignition emits multiple synonyms ("issued"/"sent"/"open" all mean
// "billed but not yet collected").
const STATUS_BUCKETS = {
  all: { label: "All", statuses: null as null | string[] },
  paid: { label: "Paid", statuses: ["paid"] },
  open: {
    label: "Open",
    // "Open" = invoice is live but not paid yet — includes the
    // outstanding/issued/sent/open synonyms but excludes overdue
    // (which has its own chip) and voided/draft (terminal/in-progress).
    statuses: ["outstanding", "issued", "sent", "open"],
  },
  overdue: { label: "Overdue", statuses: ["overdue"] },
  voided: { label: "Voided", statuses: ["voided"] },
  draft: { label: "Draft", statuses: ["draft"] },
} as const
type BucketKey = keyof typeof STATUS_BUCKETS

const INVOICE_DATE_FIELDS: DateFieldOption[] = [
  { value: "invoice_date", label: "Invoice date" },
  { value: "due_date", label: "Due date" },
  { value: "paid_at", label: "Paid date" },
  { value: "sent_at", label: "Sent date" },
  { value: "created_at", label: "Created" },
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
// Compact ($12.3K, $1.4M) variant for chart axes and dense KPI subtitles
// where the cents/fractions would just be noise.
function fmtMoneyCompact(n: number | null | undefined) {
  const v = Number(n) || 0
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v)
  } catch {
    return `$${v.toLocaleString()}`
  }
}
function fmtPct(n: number, digits = 0) {
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

export function SalesInvoices() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const page = Number.parseInt(searchParams.get("page") || "1", 10) || 1
  const pageSize = 50
  const search = searchParams.get("search") || ""
  const status = (searchParams.get("status") || "").split(",").filter(Boolean)
  // Lifecycle bucket chip selection. Stored in the URL alongside the
  // status multi-select chip so deep links from the dashboard can land
  // straight in the right bucket. When a bucket is active it OVERRIDES
  // any explicit status filter (the chip is conceptually a higher-level
  // selector — see resolution in `effectiveStatusFilter` below).
  const bucket = (searchParams.get("bucket") || "all") as BucketKey
  const state = (searchParams.get("state") || "").split(",").filter(Boolean)
  const minAmount = searchParams.get("minAmount") || ""
  const maxAmount = searchParams.get("maxAmount") || ""
  // Default to YTD on invoice_date. With 1,051 invoices in the database
  // and ~826 of them dated in the current year, a year-to-date view is
  // both useful out of the gate AND keeps the table from defaulting to
  // a wall of historical billing nobody is looking for.
  const ytdStart = `${new Date().getFullYear()}-01-01`
  const dateField = searchParams.get("dateField") || "invoice_date"
  const dateFrom = searchParams.get("dateFrom") || ytdStart
  const dateTo = searchParams.get("dateTo") || ""
  const sortBy = searchParams.get("sortBy") || "invoice_date"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"
  // Track whether the user EXPLICITLY set a date range. The YTD default
  // shouldn't count toward "active filters" — otherwise the page loads
  // showing a non-zero filter pill but no chip is visibly engaged.
  const userSetDateRange =
    !!searchParams.get("dateFrom") || !!searchParams.get("dateTo")

  const [searchInput, setSearchInput] = useState(search)
  const [editing, setEditing] = useState<Invoice | null>(null)

  // Resolve the active bucket to a status-list that the API understands.
  // When the user picks a chip, we forward those statuses to the server
  // rather than introducing a new query parameter — keeps the API
  // surface narrow and means deep links from external dashboards (which
  // pass `status=...` directly) keep working.
  const effectiveStatusFilter = useMemo(() => {
    if (bucket !== "all" && STATUS_BUCKETS[bucket].statuses) {
      return STATUS_BUCKETS[bucket].statuses as readonly string[]
    }
    return status
  }, [bucket, status])

  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set("page", String(page))
    sp.set("pageSize", String(pageSize))
    if (search) sp.set("search", search)
    if (effectiveStatusFilter.length)
      sp.set("status", (effectiveStatusFilter as readonly string[]).join(","))
    if (state.length) sp.set("state", state.join(","))
    if (minAmount) sp.set("minAmount", minAmount)
    if (maxAmount) sp.set("maxAmount", maxAmount)
    // Server defaults to invoice_date too, but we send it explicitly
    // in case the default ever drifts apart on either side.
    sp.set("dateField", dateField)
    if (dateFrom) sp.set("dateFrom", dateFrom)
    if (dateTo) sp.set("dateTo", dateTo)
    sp.set("sortBy", sortBy)
    sp.set("sortDir", sortDir)
    return sp.toString()
  }, [
    page,
    search,
    effectiveStatusFilter,
    state,
    minAmount,
    maxAmount,
    dateField,
    dateFrom,
    dateTo,
    sortBy,
    sortDir,
  ])

  const { data, error, isLoading, mutate } = useSWR<InvoicesResponse>(
    `/api/sales/invoices?${queryString}`,
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
    // Bucket chip and explicit status filter both contribute, but never
    // double-count: the bucket overrides status when set.
    (bucket !== "all" ? 1 : status.length) +
    state.length +
    (minAmount || maxAmount ? 1 : 0) +
    (userSetDateRange ? 1 : 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-stone-900">Invoices</h1>
          <IgnitionLiveBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total.toLocaleString()} invoices` : "Loading invoices…"}
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
          label="Total Invoiced"
          value={data ? fmtMoney(data.stats.totalAmount) : "—"}
          subtitle={
            data
              ? `${data.stats.total.toLocaleString()} invoices · ${
                  data.stats.medianDaysToPay !== null
                    ? `${Math.round(data.stats.medianDaysToPay)}d median to pay`
                    : "no payments yet"
                }`
              : ""
          }
          icon={Receipt}
          tone="stone"
        />
        <KpiCard
          label="Paid"
          value={data ? fmtMoney(data.stats.totalPaid) : "—"}
          subtitle={
            data
              ? `${fmtPct(
                  data.stats.collectionRate,
                  1,
                )} collection rate · ${(
                  data.stats.byStatus["paid"] || 0
                ).toLocaleString()} invoices`
              : ""
          }
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Outstanding"
          value={data ? fmtMoney(data.stats.totalOutstanding) : "—"}
          subtitle={
            data
              ? // Sum of every "live but unpaid" status — the production
                // mix uses both `outstanding` and `issued` (and rarely
                // `open` / `sent`). The previous version only counted
                // `sent`+`outstanding`, which under-reported by ~40%.
                `${(
                  (data.stats.byStatus["outstanding"] || 0) +
                  (data.stats.byStatus["issued"] || 0) +
                  (data.stats.byStatus["open"] || 0) +
                  (data.stats.byStatus["sent"] || 0)
                ).toLocaleString()} live invoices`
              : ""
          }
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="Overdue"
          // Show the dollar amount — far more actionable than a raw
          // count of overdue invoices, which was the previous KPI.
          value={data ? fmtMoney(data.stats.overdueAmount) : "—"}
          subtitle={
            data
              ? `${data.stats.overdueCount.toLocaleString()} invoices past due`
              : ""
          }
          icon={AlertCircle}
          tone="rose"
        />
      </div>

      {/* Charts Strip */}
      <InvoiceCharts data={data} isLoading={isLoading} />

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
              placeholder="Search invoice #, proposal #, client…"
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

          {/* Hide the granular Status multi-select when a bucket chip
              is active — the bucket already provides the same gate at
              a higher level, and showing both invites confusion (the
              dropdown would appear empty even though the table is
              filtered). */}
          {bucket === "all" ? (
            <MultiSelectChip
              label="Status"
              options={data?.dimensions?.statuses || []}
              value={status}
              onChange={(v) => updateParams({ status: v.length ? v.join(",") : null })}
            />
          ) : null}
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
            fieldOptions={INVOICE_DATE_FIELDS}
            onChange={({ from, to, field }) =>
              updateParams({
                dateField: field === "invoice_date" ? null : field,
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
                // `router.replace(pathname)` clears *all* search params
                // including the lifecycle bucket — exactly what we want
                // for a "Clear all" affordance.
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

      {/* Lifecycle bucket chips — fast filter for the table. Chip counts
          come from `byStatus` so the user can see the size of every
          bucket before drilling in. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(STATUS_BUCKETS) as BucketKey[]).map((key) => {
          const def = STATUS_BUCKETS[key]
          const count =
            !data
              ? null
              : key === "all"
              ? data.stats.total
              : key === "overdue"
              ? // Always show the *computed* overdue (date-based) count
                // — see KPI comment block.
                data.stats.overdueCount
              : (def.statuses ?? []).reduce(
                  (acc, s) => acc + (data.stats.byStatus[s] || 0),
                  0,
                )
          return (
            <BucketChip
              key={key}
              label={def.label}
              count={count}
              active={bucket === key}
              tone={
                key === "paid"
                  ? "emerald"
                  : key === "open"
                  ? "amber"
                  : key === "overdue"
                  ? "rose"
                  : undefined
              }
              onClick={() =>
                updateParams({
                  bucket: key === "all" ? null : key,
                  // Reset the multi-select status chip when a bucket is
                  // chosen — they conflict otherwise.
                  status: null,
                })
              }
            />
          )
        })}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b">
                <tr className="text-xs uppercase text-muted-foreground">
                  <SortableHeader
                    field="invoice_number"
                    label="Invoice #"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="text-left px-3 py-2 font-medium">Client</th>
                  <SortableHeader
                    field="status"
                    label="Status"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    field="amount"
                    label="Amount"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="amount_paid"
                    label="Paid"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="amount_outstanding"
                    label="Outstanding"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableHeader
                    field="invoice_date"
                    label="Date"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    field="due_date"
                    label="Due"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th />
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
                      Failed to load invoices.
                    </td>
                  </tr>
                ) : data && data.invoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                      <FilterIcon className="h-6 w-6 mx-auto mb-2 opacity-40" />
                      No invoices match the current filters.
                    </td>
                  </tr>
                ) : (
                  data?.invoices.map((inv) => {
                    const orgName = inv.organizations?.name || inv.contacts?.full_name || "—"
                    const orgHref = inv.organization_id
                      ? `/clients/${inv.organization_id}`
                      : inv.contact_id
                        ? `/clients/${inv.contact_id}`
                        : null
                    const tone = STATUS_TONE[inv.status || ""] || "bg-stone-100 text-stone-700 border-stone-200"
                    return (
                      <tr key={inv.ignition_invoice_id} className="border-b hover:bg-stone-50/60">
                        <td className="px-3 py-2 font-mono text-xs">
                          {inv.invoice_number || inv.ignition_invoice_id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {orgHref ? (
                              <Link href={orgHref} className="hover:underline font-medium">
                                {orgName}
                              </Link>
                            ) : (
                              <span className="font-medium">{orgName}</span>
                            )}
                            {inv.state ? (
                              <span
                                title={US_STATE_NAMES[inv.state] || inv.state}
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-stone-500 bg-stone-100 border border-stone-200 rounded px-1 py-0.5"
                              >
                                <MapPin className="h-2.5 w-2.5" />
                                {inv.state}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={cn("border", tone)}>
                            {titleCase(inv.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {fmtMoney(inv.amount, inv.currency || "USD")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                          {fmtMoney(inv.amount_paid, inv.currency || "USD")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {fmtMoney(inv.amount_outstanding, inv.currency || "USD")}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(inv.invoice_date)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(inv.due_date)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-stone-500 hover:text-stone-900"
                              onClick={() => setEditing(inv)}
                              title="Edit invoice"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {inv.stripe_invoice_id ? (
                              <a
                                href={`https://dashboard.stripe.com/invoices/${inv.stripe_invoice_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-stone-500 hover:text-stone-900 p-1"
                                title="View in Stripe"
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

      <InvoiceEditSheet
        invoice={editing}
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

// ── Lifecycle bucket chip ──────────────────────────────────────────────
// Matches the visual pattern used on the Sales Dashboard's proposal-
// table toolbar so the two surfaces feel like siblings.
function BucketChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number | null
  active: boolean
  tone?: "emerald" | "amber" | "rose"
  onClick: () => void
}) {
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
        {count === null ? "—" : count.toLocaleString()}
      </span>
    </button>
  )
}

// ── Charts strip ───────────────────────────────────────────────────────
// Four-panel analytics row: monthly trend, status mix, aging buckets,
// and top-outstanding clients. All panels read from the *unfiltered*
// API response so the analytics give a stable business overview even
// when filters narrow the table below.
function InvoiceCharts({
  data,
  isLoading,
}: {
  data: InvoicesResponse | undefined
  isLoading: boolean
}) {
  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Skeleton className="h-[260px] lg:col-span-2" />
        <Skeleton className="h-[260px]" />
        <Skeleton className="h-[220px] lg:col-span-2" />
        <Skeleton className="h-[220px]" />
      </div>
    )
  }
  if (!data) return null

  // Status pie data — sort to keep colours stable across renders so the
  // legend doesn't visually jitter when the underlying counts change.
  const statusEntries = Object.entries(data.stats.byStatus)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  // Aging table-shaped data for a horizontal bar chart. Order is
  // explicit (current → 90+) so the visual progression reads as
  // "ageing into trouble" left-to-right.
  const aging = data.stats.aging
  const agingData = [
    { bucket: "Current", count: aging.current.count, amount: aging.current.amount, fill: "#94A3B8" },
    { bucket: "1–30d", count: aging.d1to30.count, amount: aging.d1to30.amount, fill: "#FBBF24" },
    { bucket: "31–60d", count: aging.d31to60.count, amount: aging.d31to60.amount, fill: "#F59E0B" },
    { bucket: "61–90d", count: aging.d61to90.count, amount: aging.d61to90.amount, fill: "#EA580C" },
    { bucket: "90d+", count: aging.d90plus.count, amount: aging.d90plus.amount, fill: "#DC2626" },
  ]

  // Format the trend's "YYYY-MM" buckets into "Jan", "Feb", … for the
  // x-axis — keeps the labels short enough to render without rotation
  // even on narrow viewports.
  const trendData = data.trend.map((t) => ({
    ...t,
    label: monthLabel(t.month),
  }))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Monthly trend — wider so 12 months can breathe */}
      <Card className="lg:col-span-2">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">
              Last 12 months · billed vs collected
            </h3>
          </div>
          {data.trend.every((t) => t.billed === 0) ? (
            <EmptyChartFallback message="No invoices in the last 12 months" />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
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
                  {/* Stack paid + outstanding so the bar height equals
                      "billed" and the split tells the collection
                      story at a glance. */}
                  <Bar dataKey="paid" name="Paid" stackId="amt" fill="#059669" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="outstanding" name="Outstanding" stackId="amt" fill="#F59E0B" radius={[3, 3, 0, 0]} />
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
            <CalendarClock className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">Status mix</h3>
          </div>
          {statusEntries.length === 0 ? (
            <EmptyChartFallback message="No invoices yet" />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusEntries.map(([k, v]) => ({ name: titleCase(k), key: k, value: v }))}
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
                      `${v} invoice${v === 1 ? "" : "s"}`,
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

      {/* Aging buckets — horizontal bar */}
      <Card className="lg:col-span-2">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Timer className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">
              AR aging · outstanding by bucket
            </h3>
            {data.stats.overdueAmount > 0 ? (
              <span className="ml-auto text-xs text-rose-700 font-medium">
                {fmtMoney(data.stats.overdueAmount)} past due
              </span>
            ) : null}
          </div>
          {agingData.every((b) => b.amount === 0) ? (
            <EmptyChartFallback message="Nothing outstanding — fully collected" />
          ) : (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={agingData}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => fmtMoneyCompact(v as number)}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="bucket"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                  />
                  <Tooltip
                    formatter={(v: number, _name, item: any) => [
                      `${fmtMoney(v)} · ${item?.payload?.count ?? 0} invoices`,
                      item?.payload?.bucket,
                    ]}
                    contentStyle={{
                      borderRadius: 6,
                      fontSize: 12,
                      border: "1px solid #E7E5E4",
                    }}
                  />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {agingData.map((d) => (
                      <Cell key={d.bucket} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top outstanding clients */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">
              Top outstanding clients
            </h3>
          </div>
          {data.topOutstanding.length === 0 ? (
            <EmptyChartFallback message="No outstanding balances" />
          ) : (
            <ul className="divide-y divide-stone-100 -mx-1">
              {data.topOutstanding.slice(0, 7).map((c) => {
                const href =
                  c.id && c.kind === "organization"
                    ? `/clients/${c.id}`
                    : c.id && c.kind === "contact"
                    ? `/clients/${c.id}`
                    : null
                return (
                  <li
                    key={c.key}
                    className="flex items-center gap-2 py-1.5 px-1 text-sm"
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
                        <span className="font-medium text-stone-700 truncate block" title={c.name}>
                          {c.name}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {c.count} invoice{c.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="tabular-nums text-rose-700 font-semibold text-sm">
                      {fmtMoneyCompact(c.outstanding)}
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

// Map a "YYYY-MM" bucket to a short "Jan" / "Feb 25" label. We include
// a 2-digit year suffix when the window crosses year boundaries so the
// chart axis doesn't say "Jan…Dec…Jan" without context.
function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  const d = new Date(y, m - 1, 1)
  const monthShort = d.toLocaleDateString("en-US", { month: "short" })
  const thisYear = new Date().getFullYear()
  return y === thisYear ? monthShort : `${monthShort} ${String(y).slice(-2)}`
}

// Palette aligned with the table's STATUS_TONE so the pie legend and
// row badges read the same colour.
function statusColor(key: string): string {
  switch (key) {
    case "paid":
      return "#059669"
    case "issued":
    case "sent":
    case "open":
      return "#2563EB"
    case "outstanding":
      return "#F59E0B"
    case "overdue":
      return "#DC2626"
    case "voided":
      return "#A8A29E"
    case "draft":
      return "#78716C"
    default:
      return "#94A3B8"
  }
}
