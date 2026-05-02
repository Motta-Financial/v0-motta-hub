"use client"

/**
 * Sales > Invoices listing
 * ────────────────────────────────────────────────────────────────────────
 * Server-paginated invoice table with KPI strip showing total billed, paid,
 * and outstanding across the full set (not the current page). Stripe invoice
 * IDs link out to the Stripe dashboard when present.
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
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
}
interface InvoicesResponse {
  invoices: Invoice[]
  page: number
  pageSize: number
  total: number
  stats: {
    total: number
    totalAmount: number
    totalPaid: number
    totalOutstanding: number
    byStatus: Record<string, number>
  }
  dimensions: {
    statuses: string[]
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
  const sortBy = searchParams.get("sortBy") || "invoice_date"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"

  const [searchInput, setSearchInput] = useState(search)

  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set("page", String(page))
    sp.set("pageSize", String(pageSize))
    if (search) sp.set("search", search)
    if (status.length) sp.set("status", status.join(","))
    sp.set("sortBy", sortBy)
    sp.set("sortDir", sortDir)
    return sp.toString()
  }, [page, search, status, sortBy, sortDir])

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
  const activeFilterCount = (search ? 1 : 0) + status.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total.toLocaleString()} invoices` : "Loading invoices…"}
          {data && activeFilterCount > 0
            ? ` matching ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}`
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
              placeholder="Search invoice # or proposal #…"
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
                          {orgHref ? (
                            <Link href={orgHref} className="hover:underline font-medium">
                              {orgName}
                            </Link>
                          ) : (
                            <span className="font-medium">{orgName}</span>
                          )}
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
                          {inv.stripe_invoice_id ? (
                            <a
                              href={`https://dashboard.stripe.com/invoices/${inv.stripe_invoice_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-stone-500 hover:text-stone-900"
                              title="View in Stripe"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
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
