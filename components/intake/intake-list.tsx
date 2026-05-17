"use client"

/**
 * Intake Submissions list — every Jotform "Motta | Intake Form" entry
 * the firm has received, with triage workflow on top.
 *
 * Layout: page header → KPI cards (total / new / converted / this
 * month) → status filter tabs → search + service-focus filter →
 * sortable table → side sheet with full submission detail.
 *
 * Data: SWR-fetched from `/api/jotform/intake`. Mutations route through
 * `/api/jotform/intake/[id]` (PATCH) and revalidate the list after
 * success so the table always reflects the latest triage state without
 * a full page reload.
 */

import { useMemo, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import useSWR from "swr"
import { JotformStatusCard } from "./jotform-status-card"
import {
  Building2,
  CalendarDays,
  Inbox,
  Link2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  TrendingUp,
  UserCheck,
  X,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { IntakeDetailSheet } from "./intake-detail-sheet"

// ─────────────────────────────────────────────────────────────────────────────
// Row shape (must match `GET /api/jotform/intake` projection)
// ─────────────────────────────────────────────────────────────────────────────

export interface IntakeRow {
  id: string
  jotform_submission_id: string
  jotform_created_at: string | null
  submitter_full_name: string | null
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_email: string | null
  submitter_phone: string | null
  submitter_state: string | null
  services_requested: string[] | null
  service_focus: string | null
  entity_types: string[] | null
  business_name: string | null
  business_revenue_range: string | null
  business_summary: string | null
  lead_status: string | null
  triage_notes: string | null
  assigned_to_id: string | null
  contact_id: string | null
  organization_id: string | null
  link_method: "auto_email" | "auto_business_name" | "auto_name" | "manual" | null
  linked_at: string | null
  lead_id: string | null
  // New filterable columns added in migration 100. `referral_source`
  // is the free-text "who sent you our way?" answer; the
  // `preferred_*` pair are the prospect's pick of teammate (text
  // they typed/selected + the resolved FK, when we could match it).
  referral_source: string | null
  preferred_team_member: string | null
  preferred_team_member_id: string | null
  assignedTo: { id: string; name: string; avatarUrl: string | null } | null
  // The Motta professional the prospect explicitly asked for on the
  // intake form. May or may not equal `assignedTo` (a triager can
  // re-assign to a different owner without losing the prospect's
  // original choice). `null` when the prospect skipped the question
  // or chose someone we couldn't resolve to an active teammate.
  preferredProfessional: {
    id: string
    name: string
    avatarUrl: string | null
    heroProfileSlug: string | null
  } | null
  // Resolved by /api/jotform/intake — surfaces the matched
  // contact/organization name so the row can deep-link to the client
  // profile without a second round-trip.
  linkedClient: { type: "contact" | "organization"; id: string; name: string } | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─────────────────────────────────────────────────────────────────────────────
// Status presentation
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_VALUES = ["new", "contacted", "qualified", "converted", "declined"] as const
type StatusValue = (typeof STATUS_VALUES)[number]

const STATUS_LABEL: Record<StatusValue, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  declined: "Declined",
}

const STATUS_BADGE: Record<StatusValue, string> = {
  new: "bg-amber-50 text-amber-700 border-amber-200",
  contacted: "bg-sky-50 text-sky-700 border-sky-200",
  qualified: "bg-indigo-50 text-indigo-700 border-indigo-200",
  converted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  declined: "bg-slate-50 text-slate-600 border-slate-200",
}

function statusBadge(value: string | null) {
  const v = (value ?? "new") as StatusValue
  const cls = STATUS_BADGE[v] ?? STATUS_BADGE.new
  return (
    <Badge variant="outline" className={cn("font-medium", cls)}>
      {STATUS_LABEL[v] ?? v}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function initialsFor(row: IntakeRow): string {
  const f = row.submitter_first_name?.[0] ?? ""
  const l = row.submitter_last_name?.[0] ?? ""
  const out = `${f}${l}`.trim()
  if (out) return out.toUpperCase()
  const name = row.submitter_full_name ?? row.business_name ?? "?"
  return name.slice(0, 2).toUpperCase()
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function formatRelative(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function isThisMonth(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function IntakeList() {
  const searchParams = useSearchParams()
  const [statusTab, setStatusTab] = useState<"all" | StatusValue>("all")
  const [focus, setFocus] = useState<string>("all")
  // Filter for the linked-client column. "all" hides the filter,
  // "yes" shows only rows already auto-matched or manually pinned,
  // "no" surfaces the unlinked queue for triage. Server-side filter
  // keeps the row count honest.
  const [linked, setLinked] = useState<"all" | "yes" | "no">("all")
  // Column-level filters added 2026-05 alongside the new columns.
  // They piggyback on /api/jotform/intake's server filters so the row
  // count and KPI totals stay honest. Defaults are "all" / empty.
  const [stateFilter, setStateFilter] = useState<string>("all")
  const [referralFilter, setReferralFilter] = useState<string>("")
  // "all" → no filter; "none" → submissions with no resolved
  // professional; UUID → that specific teammate.
  const [professionalFilter, setProfessionalFilter] = useState<string>("all")
  // Date-range filter on jotform_created_at. We keep these as strings
  // for `<input type="date">` round-tripping; the API treats `to` as
  // inclusive-end-of-day.
  const [fromDate, setFromDate] = useState<string>("")
  const [toDate, setToDate] = useState<string>("")
  // Initialize search from URL param (supports deep-linking from Daily Briefing)
  const [search, setSearch] = useState(searchParams.get("search") || "")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Sync search state if URL param changes (e.g., navigating back)
  useEffect(() => {
    const urlSearch = searchParams.get("search") || ""
    if (urlSearch && urlSearch !== search) {
      setSearch(urlSearch)
    }
  }, [searchParams])

  const qs = new URLSearchParams()
  if (statusTab !== "all") qs.set("status", statusTab)
  if (focus !== "all") qs.set("focus", focus)
  if (linked !== "all") qs.set("linked", linked)
  if (stateFilter !== "all") qs.set("state", stateFilter)
  if (referralFilter.trim()) qs.set("referral", referralFilter.trim())
  if (professionalFilter !== "all") qs.set("professional", professionalFilter)
  if (fromDate) qs.set("from", fromDate)
  if (toDate) qs.set("to", toDate)
  if (search.trim()) qs.set("search", search.trim())

  const swrKey = `/api/jotform/intake?${qs.toString()}`
  const { data, isLoading, mutate } = useSWR<{ rows: IntakeRow[]; count: number }>(
    swrKey,
    fetcher,
    { revalidateOnFocus: false },
  )
  const rows = data?.rows ?? []

  // Headline metrics — computed against the *current filtered* set so
  // the cards stay in sync with what the table is showing. The "All
  // time" card is the absolute total regardless of filter.
  const { data: totalsData } = useSWR<{ rows: IntakeRow[]; count: number }>(
    "/api/jotform/intake?limit=1000",
    fetcher,
    { revalidateOnFocus: false },
  )
  const allRows = totalsData?.rows ?? []
  const kpis = useMemo(() => {
    const total = allRows.length
    const newCount = allRows.filter((r) => (r.lead_status ?? "new") === "new").length
    const converted = allRows.filter((r) => r.lead_status === "converted").length
    const thisMonth = allRows.filter((r) => isThisMonth(r.jotform_created_at)).length
    return { total, newCount, converted, thisMonth }
  }, [allRows])

  // Distinct states + professionals across ALL submissions, used to
  // populate the column-filter selects. Built off the unfiltered row
  // set so the option lists don't shrink as the user narrows the
  // table — that would create the confusing UX of "the option I
  // picked just disappeared".
  const stateOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of allRows) if (r.submitter_state) set.add(r.submitter_state)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [allRows])
  const professionalOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of allRows) {
      if (r.preferredProfessional) map.set(r.preferredProfessional.id, r.preferredProfessional.name)
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [allRows])

  // Whether ANY column filter is active — drives the "Clear filters"
  // affordance so the user can reset the table in one click.
  const hasColumnFilters =
    stateFilter !== "all" ||
    referralFilter.trim() !== "" ||
    professionalFilter !== "all" ||
    fromDate !== "" ||
    toDate !== ""

  function clearColumnFilters() {
    setStateFilter("all")
    setReferralFilter("")
    setProfessionalFilter("all")
    setFromDate("")
    setToDate("")
  }

  return (
    <div className="space-y-6">
      {/* ───────────────────────── Header ───────────────────────── */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Intake Submissions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
            Every prospect who fills out the embedded Jotform on{" "}
            <span className="font-medium text-foreground">mottafinancial.com/intake-form</span>{" "}
            lands here in real time. Triage status, assign an owner, and convert qualified leads into Karbon
            contacts.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          className="gap-2 self-start md:self-auto"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {/*
       * Jotform Integration status — sits between the page header
       * and the KPIs so an admin opening this page can confirm in
       * one glance that the webhook is registered, deliveries are
       * landing, and there are no rogue endpoints attached to the
       * form (the n8n one was deleted, but if anyone re-adds a test
       * webhook later this card will flag it in amber).
       */}
      <JotformStatusCard />

      {/* ───────────────────────── KPIs ───────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="All-time submissions" value={kpis.total} icon={Inbox} accent="text-foreground" />
        <KpiCard label="Awaiting triage" value={kpis.newCount} icon={Sparkles} accent="text-amber-600" />
        <KpiCard label="Converted" value={kpis.converted} icon={TrendingUp} accent="text-emerald-600" />
        <KpiCard label="This month" value={kpis.thisMonth} icon={CalendarDays} accent="text-sky-600" />
      </div>

      {/* ───────────────────────── Filters ───────────────────────── */}
      {/* Two-row filter strip:
       *   Row 1 — primary triage filters (status tabs, service focus,
       *           linked-client toggle, free-text search).
       *   Row 2 — column-level filters surfaced as their own row so
       *           the page reads like a database table view: "filter
       *           by State / Referral / Professional / Date range".
       *   The Clear button only appears when at least one column
       *   filter is active so the strip stays uncluttered.
       */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as typeof statusTab)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {STATUS_VALUES.map((s) => (
                  <TabsTrigger key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-end">
              <Select value={focus} onValueChange={setFocus}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="Service focus" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All service focuses</SelectItem>
                  <SelectItem value="Personal Only">Personal Only</SelectItem>
                  <SelectItem value="Business Only">Business Only</SelectItem>
                  <SelectItem value="Both Personal & Business">Both Personal &amp; Business</SelectItem>
                </SelectContent>
              </Select>

              {/* Linked-client filter. Defaults to "all" so the queue
                  shows everything; switching to "no" is the typical CSM
                  workflow ("show me submissions that still need a
                  client manually pinned"). */}
              <Select value={linked} onValueChange={(v) => setLinked(v as typeof linked)}>
                <SelectTrigger className="w-full md:w-[170px]">
                  <SelectValue placeholder="Client link" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All submissions</SelectItem>
                  <SelectItem value="yes">Linked to client</SelectItem>
                  <SelectItem value="no">Unlinked</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative w-full md:w-[260px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, email, business…"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {/* Row 2 — column-level filters */}
          <div className="flex flex-col gap-2 border-t pt-3 md:flex-row md:flex-wrap md:items-center">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground md:mr-1">
              Filter columns
            </span>

            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-full md:w-[170px]">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {stateOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={professionalFilter} onValueChange={setProfessionalFilter}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Motta professional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any professional</SelectItem>
                <SelectItem value="none">No selection</SelectItem>
                {professionalOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={referralFilter}
              onChange={(e) => setReferralFilter(e.target.value)}
              placeholder="Referral source…"
              className="w-full md:w-[200px]"
            />

            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full md:w-[150px]"
                aria-label="From date"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full md:w-[150px]"
                aria-label="To date"
              />
            </div>

            {hasColumnFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearColumnFilters}
                className="gap-1.5 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ───────────────────────── Table ───────────────────────── */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Submitter</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Focus</th>
                <th className="px-4 py-3 font-medium">Services</th>
                <th className="px-4 py-3 font-medium">Referral Source</th>
                <th className="px-4 py-3 font-medium">Motta Professional</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                    Loading submissions…
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                    No submissions match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/40 last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-muted text-xs font-medium">
                          {initialsFor(row)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {row.submitter_full_name ?? row.business_name ?? "Unknown"}
                        </div>
                        <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {row.submitter_email ?? "no email"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.linkedClient ? (
                      <a
                        href={
                          row.linkedClient.type === "contact"
                            ? `/contacts/${row.linkedClient.id}`
                            : `/organizations/${row.linkedClient.id}`
                        }
                        // Stop the row click handler so clicking the
                        // chip jumps to the client profile instead of
                        // opening the side sheet.
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                        title={`Linked via ${row.link_method ?? "manual"}`}
                      >
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{row.linkedClient.name}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unlinked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.submitter_state ? (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{row.submitter_state}</span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.service_focus ?? "—"}</td>
                  <td className="px-4 py-3">
                    {row.services_requested && row.services_requested.length > 0 ? (
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {row.services_requested.slice(0, 3).map((s) => (
                          <Badge key={s} variant="secondary" className="font-normal">
                            {s}
                          </Badge>
                        ))}
                        {row.services_requested.length > 3 && (
                          <Badge variant="secondary" className="font-normal">
                            +{row.services_requested.length - 3}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.referral_source ? (
                      <span
                        className="block max-w-[200px] truncate"
                        title={row.referral_source}
                      >
                        {row.referral_source}
                      </span>
                    ) : (
                      <span className="text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* Motta Professional column. Three render branches:
                        (1) resolved FK → green chip linking to the
                            teammate directory (no per-teammate route
                            exists; clicking lands on /teammates which
                            scrolls to the row);
                        (2) unresolved free-text answer → italic
                            muted hint so the triager can still see
                            who the prospect named;
                        (3) prospect skipped the question → em-dash. */}
                    {row.preferredProfessional ? (
                      <a
                        href="/teammates"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-[#A8C566]/40 bg-[#A8C566]/10 px-2 py-0.5 text-xs font-medium text-[#5b7028] hover:bg-[#A8C566]/20"
                        title={`Prospect requested ${row.preferredProfessional.name}`}
                      >
                        <UserCheck className="h-3 w-3 shrink-0" />
                        <span className="truncate">{row.preferredProfessional.name}</span>
                      </a>
                    ) : row.preferred_team_member ? (
                      <span
                        className="block max-w-[180px] truncate text-xs italic text-muted-foreground"
                        title={`Prospect typed "${row.preferred_team_member}" — no match`}
                      >
                        {row.preferred_team_member}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{statusBadge(row.lead_status)}</td>
                  <td className="px-4 py-3">
                    {row.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          {row.assignedTo.avatarUrl ? (
                            <AvatarImage src={row.assignedTo.avatarUrl} alt={row.assignedTo.name} />
                          ) : null}
                          <AvatarFallback className="bg-muted text-[10px]">
                            {row.assignedTo.name
                              .split(" ")
                              .map((n) => n[0])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{row.assignedTo.name}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-sm text-foreground">{formatDate(row.jotform_created_at)}</div>
                    <div className="text-xs text-muted-foreground">{formatRelative(row.jotform_created_at)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ───────────────────────── Detail Sheet ───────────────────────── */}
      <IntakeDetailSheet
        submissionId={selectedId}
        open={selectedId != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        onChanged={() => mutate()}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI card subcomponent
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  accent: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md bg-muted", accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// Re-exported icons for downstream callers
export { MapPin, Phone, Tag }
