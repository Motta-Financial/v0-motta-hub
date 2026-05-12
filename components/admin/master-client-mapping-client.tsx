"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  Search as SearchIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Building2,
  User as UserIcon,
  Network,
  Link2,
  Link2Off,
  Layers,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  })

type System = "KARBON" | "IGNITION" | "PROCONNECT"
const ALL_SYSTEMS: System[] = ["KARBON", "IGNITION", "PROCONNECT"]

type ClientType = "PERSON" | "ORGANIZATION"

interface Row {
  internal_client_id: string
  client_type: ClientType
  display_name: string
  primary_email: string | null
  karbon_client_id: string | null
  ignition_client_id: string | null
  proconnect_client_id: string | null
  karbon_url: string | null
  linked_systems: System[]
  link_count: number
  created_at: string
  updated_at: string
}

interface Stats {
  total_clients: number
  unlinked: number
  one_system: number
  two_systems: number
  three_systems: number
  has_karbon: number
  has_ignition: number
  has_proconnect: number
  persons: number
  organizations: number
}

interface ApiResponse {
  clients: Row[]
  page: number
  pageSize: number
  total: number
  stats: Stats
}

type SortField =
  | "display_name"
  | "link_count"
  | "client_type"
  | "created_at"
  | "updated_at"

export function MasterClientMappingClient() {
  const [q, setQ] = useState("")
  const [systems, setSystems] = useState<System[]>([])
  const [linkFilter, setLinkFilter] = useState<
    "all" | "linked" | "multi" | "unlinked"
  >("all")
  const [clientType, setClientType] = useState<"all" | ClientType>("all")
  const [sortBy, setSortBy] = useState<SortField>("display_name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Build the API URL. Memoized so SWR keys stay stable across
  // renders that don't change a filter.
  const url = useMemo(() => {
    const p = new URLSearchParams()
    if (q.trim()) p.set("q", q.trim())
    if (systems.length) p.set("systems", systems.join(","))
    if (linkFilter !== "all") p.set("linkFilter", linkFilter)
    if (clientType !== "all") p.set("clientType", clientType)
    p.set("sortBy", sortBy)
    p.set("sortDir", sortDir)
    p.set("page", String(page))
    p.set("pageSize", String(pageSize))
    return `/api/admin/master-client-mapping?${p.toString()}`
  }, [q, systems, linkFilter, clientType, sortBy, sortDir, page])

  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(url, fetcher, {
    keepPreviousData: true,
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1
  const activeFilterCount =
    (q ? 1 : 0) +
    (systems.length > 0 ? 1 : 0) +
    (linkFilter !== "all" ? 1 : 0) +
    (clientType !== "all" ? 1 : 0)

  function toggleSystem(s: System) {
    setSystems((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    )
    setPage(1)
  }

  function clearAll() {
    setQ("")
    setSystems([])
    setLinkFilter("all")
    setClientType("all")
    setPage(1)
  }

  function sortClick(field: SortField) {
    if (sortBy === field) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else {
      setSortBy(field)
      setSortDir(field === "display_name" || field === "client_type" ? "asc" : "desc")
    }
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {/* KPI strip — unfiltered totals so this header always reads as
          "what does the hub know about". Filters narrow the table
          below but never the KPI counts. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Clients"
          value={data ? data.stats.total_clients.toLocaleString() : "—"}
          subtitle={
            data
              ? `${data.stats.persons.toLocaleString()} people · ${data.stats.organizations.toLocaleString()} orgs`
              : ""
          }
          icon={Network}
          tone="stone"
        />
        <KpiCard
          label="Karbon"
          value={data ? data.stats.has_karbon.toLocaleString() : "—"}
          subtitle={data ? "linked to Karbon" : ""}
          icon={Layers}
          tone="emerald"
        />
        <KpiCard
          label="Ignition"
          value={data ? data.stats.has_ignition.toLocaleString() : "—"}
          subtitle={data ? "linked to Ignition" : ""}
          icon={Layers}
          tone="blue"
        />
        <KpiCard
          label="ProConnect"
          value={data ? data.stats.has_proconnect.toLocaleString() : "—"}
          subtitle={data ? "linked to ProConnect" : ""}
          icon={Layers}
          tone="violet"
        />
      </div>

      {/* Secondary coverage strip — distribution of how many systems
          each client touches. Tells the partner at a glance how
          consolidated the book is. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Link2Off className="h-4 w-4 text-stone-400" />
              <span className="text-muted-foreground">Unlinked</span>
              <span className="font-semibold tabular-nums">
                {data ? data.stats.unlinked.toLocaleString() : "—"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-stone-500" />
              <span className="text-muted-foreground">1 system</span>
              <span className="font-semibold tabular-nums">
                {data ? data.stats.one_system.toLocaleString() : "—"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-blue-600" />
              <span className="text-muted-foreground">2 systems</span>
              <span className="font-semibold tabular-nums">
                {data ? data.stats.two_systems.toLocaleString() : "—"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-emerald-600" />
              <span className="text-muted-foreground">All 3 systems</span>
              <span className="font-semibold tabular-nums">
                {data ? data.stats.three_systems.toLocaleString() : "—"}
              </span>
            </div>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={() => mutate()}
                disabled={isLoading}
              >
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }}
                placeholder="Search name, email, or any external ID…"
                className="pl-8"
              />
            </div>
            <Select
              value={clientType}
              onValueChange={(v) => {
                setClientType(v as "all" | ClientType)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="PERSON">People</SelectItem>
                <SelectItem value="ORGANIZATION">Organizations</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={linkFilter}
              onValueChange={(v) => {
                setLinkFilter(v as typeof linkFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All link counts</SelectItem>
                <SelectItem value="linked">Linked (1+)</SelectItem>
                <SelectItem value="multi">Multi-system (2+)</SelectItem>
                <SelectItem value="unlinked">Unlinked (0)</SelectItem>
              </SelectContent>
            </Select>
            {activeFilterCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X className="mr-1 h-3.5 w-3.5" />
                Clear ({activeFilterCount})
              </Button>
            ) : null}
          </div>

          {/* System filter chips — click to AND-include. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Must include:
            </span>
            {ALL_SYSTEMS.map((s) => {
              const active = systems.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSystem(s)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                    active
                      ? systemFilterActive(s)
                      : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50",
                  )}
                >
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    field="display_name"
                    label="Client"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={sortClick}
                  />
                  <SortableHead
                    field="client_type"
                    label="Type"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={sortClick}
                  />
                  <TableHead>Email</TableHead>
                  <TableHead>Karbon</TableHead>
                  <TableHead>Ignition</TableHead>
                  <TableHead>ProConnect</TableHead>
                  <SortableHead
                    field="link_count"
                    label="Links"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={sortClick}
                    align="right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {error ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-rose-700">
                      Failed to load: {String(error.message || error)}
                    </TableCell>
                  </TableRow>
                ) : isLoading && !data ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : !data || data.clients.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No clients match the active filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.clients.map((c) => (
                    <TableRow key={c.internal_client_id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/clients/${c.internal_client_id}`}
                          className="hover:underline text-stone-900"
                        >
                          {c.display_name}
                        </Link>
                        <div className="text-[10px] uppercase tracking-wide text-stone-400 font-mono mt-0.5">
                          {c.internal_client_id.slice(0, 8)}…
                        </div>
                      </TableCell>
                      <TableCell>
                        <ClientTypeBadge type={c.client_type} />
                      </TableCell>
                      <TableCell className="text-sm text-stone-700">
                        {c.primary_email || (
                          <span className="text-stone-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ExternalIdCell
                          value={c.karbon_client_id}
                          href={c.karbon_url}
                          systemLabel="Karbon"
                        />
                      </TableCell>
                      <TableCell>
                        <ExternalIdCell
                          value={c.ignition_client_id}
                          systemLabel="Ignition"
                        />
                      </TableCell>
                      <TableCell>
                        <ExternalIdCell
                          value={c.proconnect_client_id}
                          systemLabel="ProConnect"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <LinkCountBadge count={c.link_count} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data && data.total > pageSize ? (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–
                {Math.min(page * pageSize, data.total)} of {data.total.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm tabular-nums">
                  Page {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

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
  tone: "stone" | "emerald" | "blue" | "violet"
}) {
  const tones: Record<string, string> = {
    stone: "text-stone-900 bg-stone-100",
    emerald: "text-emerald-900 bg-emerald-100",
    blue: "text-blue-900 bg-blue-100",
    violet: "text-violet-900 bg-violet-100",
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn("p-2 rounded-md", tones[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </div>
          <div className="text-xl font-semibold tabular-nums">{value}</div>
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function ClientTypeBadge({ type }: { type: ClientType }) {
  return type === "PERSON" ? (
    <Badge variant="outline" className="gap-1 font-normal">
      <UserIcon className="h-3 w-3" />
      Person
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 font-normal">
      <Building2 className="h-3 w-3" />
      Organization
    </Badge>
  )
}

// Cell shows the external ID (monospace, truncated) with an optional
// click-through link. Karbon is the only system we have a direct URL
// for today — Ignition/ProConnect IDs are display-only because their
// deep-link URL shape isn't stored.
function ExternalIdCell({
  value,
  href,
  systemLabel,
}: {
  value: string | null
  href?: string | null
  systemLabel: string
}) {
  if (!value) return <span className="text-stone-300 text-sm">—</span>
  const body = (
    <span
      className="font-mono text-xs text-stone-700 truncate inline-block max-w-[160px] align-middle"
      title={`${systemLabel} ID: ${value}`}
    >
      {value}
    </span>
  )
  if (!href) return body
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:underline"
    >
      {body}
      <ExternalLink className="h-3 w-3 text-stone-400" />
    </a>
  )
}

function LinkCountBadge({ count }: { count: number }) {
  const tone =
    count === 0
      ? "bg-stone-100 text-stone-500"
      : count === 1
        ? "bg-stone-100 text-stone-700"
        : count === 2
          ? "bg-blue-100 text-blue-800"
          : "bg-emerald-100 text-emerald-800"
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums",
        tone,
      )}
    >
      {count}
    </span>
  )
}

function SortableHead({
  field,
  label,
  sortBy,
  sortDir,
  onSort,
  align = "left",
}: {
  field: SortField
  label: string
  sortBy: SortField
  sortDir: "asc" | "desc"
  onSort: (f: SortField) => void
  align?: "left" | "right"
}) {
  const active = sortBy === field
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-stone-900",
          active ? "text-stone-900 font-semibold" : "text-stone-600",
          align === "right" ? "flex-row-reverse" : "",
        )}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </TableHead>
  )
}

// Chip-active palette matches the LinkCountBadge tones so the
// filter-chip system reads as the same vocabulary as the row badges.
function systemFilterActive(s: System): string {
  switch (s) {
    case "KARBON":
      return "bg-emerald-100 text-emerald-900 border-emerald-300"
    case "IGNITION":
      return "bg-blue-100 text-blue-900 border-blue-300"
    case "PROCONNECT":
      return "bg-violet-100 text-violet-900 border-violet-300"
  }
}
