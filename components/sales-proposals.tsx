"use client"

/**
 * Sales > Proposals listing
 * ────────────────────────────────────────────────────────────────────────
 * Server-paginated, filterable table of every Ignition proposal. Differs
 * from the Sales Dashboard in that this is a transactional list view —
 * users come here to find a specific proposal, sort by value, scan recent
 * activity. The Dashboard remains the analytics surface.
 *
 * URL state: page, search, status, sort. SWR re-fetches on any change.
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
} from "lucide-react"
import { ProposalEditSheet } from "@/components/sales/proposal-edit-sheet"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
}
interface ProposalsResponse {
  proposals: Proposal[]
  page: number
  pageSize: number
  total: number
  dimensions: {
    statuses: string[]
    partners: string[]
    managers: string[]
    sentBy: string[]
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
  const sortBy = searchParams.get("sortBy") || "created_at"
  const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc"

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
    sp.set("sortBy", sortBy)
    sp.set("sortDir", sortDir)
    return sp.toString()
  }, [page, search, status, partner, manager, sentBy, sortBy, sortDir])

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
    sentBy.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900">Proposals</h1>
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total.toLocaleString()} proposals` : "Loading proposals…"}
          {data && activeFilterCount > 0
            ? ` matching ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}`
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
                  <th className="text-right px-3 py-2 font-medium">Recurring/mo</th>
                  <th className="text-left px-3 py-2 font-medium">Owner</th>
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
                          {orgHref ? (
                            <Link href={orgHref} className="hover:underline font-medium">
                              {orgName}
                            </Link>
                          ) : (
                            <span className="font-medium">{orgName}</span>
                          )}
                          {p.client_email ? (
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {p.client_email}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 max-w-[260px] truncate text-stone-700">
                          {p.title || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={cn("border", tone)}>
                            {titleCase(p.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {fmtMoney(p.total_value, p.currency || "USD")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {p.recurring_total
                            ? fmtMoney(p.recurring_total, p.currency || "USD")
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {p.client_partner || p.proposal_sent_by || p.client_manager || "—"}
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
