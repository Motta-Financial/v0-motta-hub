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
} from "lucide-react"
import { ProposalEditSheet } from "@/components/sales/proposal-edit-sheet"
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
            options={data?.dimensions.statuses || []}
            value={status}
            onChange={(v) => updateParams({ status: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="State"
            options={data?.dimensions.states || []}
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
            options={(data?.dimensions.canonicalServices || []).map((c) => c.id)}
            value={canonicalService}
            formatLabel={(id) =>
              data?.dimensions.canonicalServices.find((c) => c.id === id)?.label ?? id
            }
            onChange={(v) =>
              updateParams({ canonicalService: v.length ? v.join(",") : null })
            }
          />
          <MultiSelectChip
            label="Service Line"
            options={data?.dimensions.serviceLines || []}
            value={serviceLine}
            // Pass through verbatim: the values are already user-facing
            // ("Tax", "Accounting", "Advisory", "Other").
            formatLabel={(v) => v}
            onChange={(v) => updateParams({ serviceLine: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Partner"
            options={data?.dimensions.partners || []}
            value={partner}
            onChange={(v) => updateParams({ partner: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Manager"
            options={data?.dimensions.managers || []}
            value={manager}
            onChange={(v) => updateParams({ manager: v.length ? v.join(",") : null })}
          />
          <MultiSelectChip
            label="Sent by"
            options={data?.dimensions.sentBy || []}
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
                    const orgHref = p.organization_id ? `/clients/${p.organization_id}` : null
                    const tone = STATUS_TONE[p.status || ""] || "bg-stone-100 text-stone-700 border-stone-200"
                    return (
                      <tr key={p.proposal_id} className="border-b hover:bg-stone-50/60">
                        <td className="px-3 py-2 font-mono text-xs">{p.proposal_number || p.proposal_id.slice(0, 8)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {orgHref ? (
                              <Link href={orgHref} className="hover:underline font-medium">
                                {orgName}
                              </Link>
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
                            {orgHref ? (
                              <Link
                                href={orgHref}
                                className="text-stone-500 hover:text-stone-900 p-1"
                                title="Open client"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
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
