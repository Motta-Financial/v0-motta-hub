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
} from "lucide-react"
import { InvoiceEditSheet } from "@/components/sales/invoice-edit-sheet"
import { IgnitionLiveBadge } from "@/components/sales/ignition-live-badge"
import {
  MultiSelectChip,
  RangeChip,
  DateRangeChip,
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
  }
  dimensions: {
    statuses: string[]
    states: string[]
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-900 border-emerald-200",
  sent: "bg-blue-100 text-blue-900 border-blue-200",
  outstanding: "bg-amber-100 text-amber-900 border-amber-200",
  overdue: "bg-rose-100 text-rose-900 border-rose-200",
  voided: "bg-stone-100 text-stone-500 border-stone-200",
  draft: "bg-stone-100 text-stone-700 border-stone-200",
}

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

  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set("page", String(page))
    sp.set("pageSize", String(pageSize))
    if (search) sp.set("search", search)
    if (status.length) sp.set("status", status.join(","))
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
    status.length +
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
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Invoiced"
          value={data ? fmtMoney(data.stats.totalAmount) : "—"}
          subtitle={data ? `${data.stats.total} invoices` : ""}
          icon={Receipt}
          tone="stone"
        />
        <KpiCard
          label="Paid"
          value={data ? fmtMoney(data.stats.totalPaid) : "—"}
          subtitle={
            data
              ? `${(data.stats.byStatus["paid"] || 0).toLocaleString()} invoices`
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
              ? `${(
                  (data.stats.byStatus["sent"] || 0) +
                  (data.stats.byStatus["outstanding"] || 0)
                ).toLocaleString()} invoices`
              : ""
          }
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="Overdue"
          value={data ? `${(data.stats.byStatus["overdue"] || 0).toLocaleString()}` : "—"}
          subtitle="invoices past due"
          icon={AlertCircle}
          tone="rose"
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

          <MultiSelectChip
            label="Status"
            options={data?.dimensions.statuses || []}
            value={status}
            onChange={(v) => updateParams({ status: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="State"
            options={data?.dimensions.states || []}
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
        statuses={data?.dimensions.statuses || []}
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
