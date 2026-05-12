"use client"

/**
 * Sales > Recurring Revenue
 * ────────────────────────────────────────────────────────────────────────
 * Live MRR / ARR view for Accounting and Tax sourced directly from the
 * Ignition feed via the raw `payload.services` JSON on `ignition_proposals`
 * — not the normalized `ignition_proposal_services` table, which is
 * populated by an incomplete sync and drops services for ~460 of the
 * firm's active proposals. Reading from the payload guarantees the page
 * shows the same line items partners see inside Ignition.
 *
 * The classification + frequency policy lives in
 * `lib/sales/ignition-recurring.ts`. Tax engagements are treated as
 * one-time regardless of how Ignition records the cadence (installment-
 * billed returns are common). Numbers refresh whenever an Ignition sync
 * runs (cron every 15 min, plus a manual "Sync now" button in the header).
 *
 * The partner-maintained `motta_recurring_revenue` CSV is still queried
 * by the API for a "Not in Ignition yet" gap callout — clients the team
 * tracks as recurring but who haven't been moved onto Ignition yet. The
 * CSV is reference data, not the source of truth for MRR.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import {
  TrendingUp,
  Repeat,
  Users,
  CircleDollarSign,
  Search as SearchIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calculator,
  Briefcase,
  ArrowLeft,
  RefreshCw,
  Zap,
  AlertCircle,
  Sparkles,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { US_STATE_NAMES } from "@/lib/sales/us-geo"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DateRangeChip,
  MultiSelectChip,
  RangeChip,
} from "@/components/sales/filter-chips"
import { X } from "lucide-react"

type DepartmentKey = "All" | "Accounting" | "Tax"
type Lifecycle = "accepted" | "pipeline" | "lost" | "all"

/**
 * Per-lifecycle copy. Centralized so the page header, KPIs, tooltips
 * and the headline number all stay aligned when users swap tabs.
 *
 *   accepted — the live recurring book; what's currently producing
 *              revenue. This is the default and matches the dashboard's
 *              historical behavior.
 *   pipeline — proposals out in the world that haven't closed yet.
 *              MRR here is "what we could see if these are accepted".
 *   lost     — declined deals. MRR here is "recurring revenue we
 *              missed out on".
 *   all      — every non-archived proposal, regardless of state.
 */
const LIFECYCLE_META: Record<
  Lifecycle,
  {
    label: string
    pageTitle: string
    description: string
    mrrLabel: (dept: DepartmentKey) => string
    arrLabel: string
    clientsLabel: string
    onboardingLabel: string
    headlineTotalLabel: string
    headlineSubtitle: (arr: string) => string
    badgeTone: string
    showGapDiagnostic: boolean
    showLiveBadge: boolean
  }
> = {
  accepted: {
    label: "Accepted",
    pageTitle: "Recurring Revenue",
    description:
      "Live MRR / ARR across Accounting and Tax, aggregated from accepted Ignition proposals at the service-line level. Monthly fees roll into MRR; quarterly fees contribute fee ÷ 3.",
    mrrLabel: (dept) => (dept === "All" ? "Combined MRR" : `${dept} MRR`),
    arrLabel: "Annualized (ARR)",
    clientsLabel: "Recurring Clients",
    onboardingLabel: "Onboarding & Optimization",
    headlineTotalLabel: "Total MRR",
    headlineSubtitle: (arr) => `${arr} annualized`,
    badgeTone: "bg-emerald-50 border-emerald-200 text-emerald-900",
    showGapDiagnostic: true,
    showLiveBadge: true,
  },
  pipeline: {
    label: "Pipeline",
    pageTitle: "Pipeline Recurring Revenue",
    description:
      "Potential MRR / ARR from proposals currently in flight (sent, awaiting acceptance, or draft). These numbers represent what could come into the recurring book if every open proposal closes — useful for sales forecasting.",
    mrrLabel: (dept) =>
      dept === "All" ? "Potential MRR" : `${dept} Potential MRR`,
    arrLabel: "Potential ARR",
    clientsLabel: "Prospective Clients",
    onboardingLabel: "Potential Onboarding",
    headlineTotalLabel: "Potential MRR",
    headlineSubtitle: (arr) => `${arr} potential annualized`,
    badgeTone: "bg-amber-50 border-amber-200 text-amber-900",
    showGapDiagnostic: false,
    showLiveBadge: false,
  },
  lost: {
    label: "Lost",
    pageTitle: "Lost Recurring Revenue",
    description:
      "MRR / ARR on proposals that were lost. This is recurring revenue the firm did NOT capture — useful for analyzing which engagements are slipping through and at what value.",
    mrrLabel: (dept) => (dept === "All" ? "Lost MRR" : `${dept} Lost MRR`),
    arrLabel: "Lost ARR",
    clientsLabel: "Lost Clients",
    onboardingLabel: "Lost Onboarding",
    headlineTotalLabel: "Lost MRR",
    headlineSubtitle: (arr) => `${arr} annualized lost`,
    badgeTone: "bg-rose-50 border-rose-200 text-rose-900",
    showGapDiagnostic: false,
    showLiveBadge: false,
  },
  all: {
    label: "All",
    pageTitle: "All Proposals · Recurring View",
    description:
      "Recurring revenue rolled up across every non-archived proposal regardless of state. Combines accepted, pipeline, and lost into a single view so you can see the whole book of potential and realized recurring revenue.",
    mrrLabel: (dept) => (dept === "All" ? "All MRR" : `${dept} MRR (All)`),
    arrLabel: "All ARR",
    clientsLabel: "All Clients",
    onboardingLabel: "All Onboarding",
    headlineTotalLabel: "Combined MRR",
    headlineSubtitle: (arr) => `${arr} combined annualized`,
    badgeTone: "bg-stone-100 border-stone-300 text-stone-800",
    showGapDiagnostic: false,
    showLiveBadge: false,
  },
}

interface RecurringRow {
  id: string
  department: "Accounting" | "Tax"
  service_type: string
  client_name: string
  cadence: "Monthly" | "Quarterly"
  service_fee: number
  one_time_fee: number
}

interface RecurringResponse {
  source?: "ignition" | "curated"
  lifecycle?: Lifecycle
  lifecycleCounts?: {
    accepted: number | null
    pipeline: number | null
    lost: number | null
    all: number | null
  }
  lastSyncedAt?: string | null
  totals: {
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    distinct_clients: number
    service_lines: number
    avg_mrr_per_client: number
    active_proposals?: number
  }
  departments: Array<{
    department: "Accounting" | "Tax"
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    service_lines: number
    client_count: number
  }>
  serviceBreakdown: Array<{
    department: "Accounting" | "Tax"
    service_type: string
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    service_lines: number
    client_count: number
  }>
  clients: Array<{
    department: "Accounting" | "Tax"
    client_name: string
    normalized_name: string
    organization_id?: string | null
    contact_id?: string | null
    service_types: string[]
    cadences: string[]
    partners?: string[]
    managers?: string[]
    sent_by?: string[]
    proposal_numbers?: string[]
    state?: string | null
    mrr: number
    arr: number
    one_time_total: number
    onboarding_total?: number
    service_lines: number
    proposal_count?: number
    effective_start_date?: string | null
  }>
  dimensions?: {
    partners: string[]
    managers: string[]
    sentBy: string[]
    states: string[]
  }
  rows: RecurringRow[]
  not_in_ignition?: Array<{
    department: "Accounting" | "Tax"
    client_name: string
    normalized_name: string
    service_types: string[]
    mrr: number
  }>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0)
}

function fmtPrecise(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0)
}

const DEPT_BADGE: Record<string, string> = {
  Accounting: "bg-blue-100 text-blue-900 border-blue-200",
  Tax: "bg-emerald-100 text-emerald-900 border-emerald-200",
}

export function SalesRecurringRevenue() {
  // ── URL-driven filter state ───────────────────────────────────────────
  // Every filter on this page is reflected in the query string so the
  // view is shareable / refresh-safe / browser-back-button friendly.
  // Same pattern as `/sales/proposals`. Local React state is reserved for
  // ephemeral UI (the search input draft, sync flags, etc).
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Lifecycle: which slice of the proposal pipeline this view is
  // showing. Defaults to "accepted" so the page opens to the live
  // recurring book — matches what users expect from the dashboard's
  // original behavior.
  const lifecycleParam = (searchParams.get("lifecycle") ?? "accepted") as Lifecycle
  const lifecycle: Lifecycle = (["accepted", "pipeline", "lost", "all"] as const).includes(
    lifecycleParam,
  )
    ? lifecycleParam
    : "accepted"
  const meta = LIFECYCLE_META[lifecycle]

  function updateParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k)
      else sp.set(k, v)
    }
    // `replace` instead of `push` so chip toggles don't pollute history.
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  // Auto-revalidate every minute so the page reflects new Ignition data
  // without forcing a hard reload. Combined with the 60s `revalidate` on
  // the API route, this gives a max ~2 minute staleness in the worst case.
  const { data, isLoading, mutate } = useSWR<RecurringResponse>(
    `/api/sales/recurring-revenue?lifecycle=${lifecycle}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  // Manual "Sync from Ignition" button — POST to /api/ignition/sync which
  // triggers a full backfill, then we revalidate the SWR cache so the
  // new numbers pop into the page without a navigation.
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  async function triggerSync() {
    if (syncing) return
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch("/api/ignition/sync", { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Sync failed (${res.status})`)
      }
      // Give Ignition's reporting API a beat to surface the changes
      // before we re-pull the aggregate. The cron usually finishes in
      // under 30s but we don't wait the full duration — `mutate` will
      // fetch the latest state regardless.
      await new Promise((r) => setTimeout(r, 1500))
      await mutate()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed")
      console.error("[sales/recurring-revenue] manual sync failed:", err)
    } finally {
      setSyncing(false)
    }
  }

  // Department + sort + every filter live in the URL. Sensible defaults:
  //   - dept   = "All"
  //   - sortBy = "mrr" desc (biggest book at the top)
  //   - hideZero = "1" (hide $0 MRR rows, since this surface is for the
  //     live recurring book — users almost never want to see rows that
  //     contribute zero to the headline number; they can toggle it off
  //     when needed)
  const dept = (searchParams.get("dept") ?? "All") as DepartmentKey
  const searchUrl = searchParams.get("q") ?? ""
  const sortBy = (searchParams.get("sortBy") ?? "mrr") as
    | "client_name"
    | "mrr"
    | "arr"
    | "service_lines"
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"

  const cadence = (searchParams.get("cadence") ?? "").split(",").filter(Boolean)
  const serviceType = (searchParams.get("serviceType") ?? "")
    .split(",")
    .filter(Boolean)
  const partner = (searchParams.get("partner") ?? "").split(",").filter(Boolean)
  const manager = (searchParams.get("manager") ?? "").split(",").filter(Boolean)
  const sentBy = (searchParams.get("sentBy") ?? "").split(",").filter(Boolean)
  const stateF = (searchParams.get("state") ?? "").split(",").filter(Boolean)

  const mrrMin = searchParams.get("mrrMin") ?? ""
  const mrrMax = searchParams.get("mrrMax") ?? ""
  const arrMin = searchParams.get("arrMin") ?? ""
  const arrMax = searchParams.get("arrMax") ?? ""

  const onboardingOnly = searchParams.get("hasOnboarding") === "1"
  const otherOneTimeOnly = searchParams.get("hasOther1x") === "1"

  // Accepted-date range filter. Empty by default; uses the client
  // roll-up's `effective_start_date` (earliest accepted_at across the
  // client's accepted proposals). The DateRangeChip's `field` prop is
  // hard-wired to "effective_start_date" since there's only one date on
  // the client roll-up — no field-selector needed.
  const dateFrom = searchParams.get("dateFrom") ?? ""
  const dateTo = searchParams.get("dateTo") ?? ""

  // Default ON — users opening the page expect to see the live recurring
  // book, not $0 placeholders. The URL only tracks the OFF state so
  // first-load is clean. Set "hideZero=0" to disable.
  const hideZero = searchParams.get("hideZero") !== "0"

  // Local draft state for the freeform search box so users can type
  // freely; the URL only updates on Enter or blur to avoid thrashing
  // the router on every keystroke.
  const [searchDraft, setSearchDraft] = useState(searchUrl)
  useEffect(() => setSearchDraft(searchUrl), [searchUrl])

  // Cadence/service-type option lists derived from the loaded rows so the
  // dropdown only shows values that exist in the data after the
  // department-tab filter is applied.
  const cadenceOptions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const c of data.clients) {
      if (dept !== "All" && c.department !== dept) continue
      for (const cad of c.cadences) set.add(cad)
    }
    return [...set].sort()
  }, [data, dept])

  const serviceTypeOptions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    for (const c of data.clients) {
      if (dept !== "All" && c.department !== dept) continue
      for (const st of c.service_types) set.add(st)
    }
    return [...set].sort()
  }, [data, dept])

  // Partner/manager/sent-by/state options also derived from the loaded
  // data so the dropdowns only show values that actually appear in the
  // current lifecycle slice. Falls back to the API-side `dimensions`
  // block when the data hasn't filtered yet.
  const partnerOptions = useMemo(
    () => data?.dimensions?.partners ?? [],
    [data],
  )
  const managerOptions = useMemo(
    () => data?.dimensions?.managers ?? [],
    [data],
  )
  const sentByOptions = useMemo(() => data?.dimensions?.sentBy ?? [], [data])
  const stateOptions = useMemo(() => data?.dimensions?.states ?? [], [data])

  const activeFilterCount =
    (searchUrl ? 1 : 0) +
    cadence.length +
    serviceType.length +
    partner.length +
    manager.length +
    sentBy.length +
    stateF.length +
    (mrrMin ? 1 : 0) +
    (mrrMax ? 1 : 0) +
    (arrMin ? 1 : 0) +
    (arrMax ? 1 : 0) +
    (onboardingOnly ? 1 : 0) +
    (otherOneTimeOnly ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    // hideZero is on by default, so it only counts as "active" when the
    // user has explicitly turned it OFF (which surfaces $0 rows).
    (hideZero ? 0 : 1)

  function clearAllFilters() {
    updateParams({
      q: null,
      cadence: null,
      serviceType: null,
      partner: null,
      manager: null,
      sentBy: null,
      state: null,
      mrrMin: null,
      mrrMax: null,
      arrMin: null,
      arrMax: null,
      hasOnboarding: null,
      hasOther1x: null,
      dateFrom: null,
      dateTo: null,
      hideZero: null,
    })
  }

  const filteredClients = useMemo(() => {
    if (!data) return []
    const q = searchUrl.trim().toLowerCase()
    let list = data.clients
    if (dept !== "All") list = list.filter((c) => c.department === dept)
    // Broadened freeform match: client name, service-line chips, partner,
    // manager, sent-by, organization id, and proposal numbers. Lets users
    // type a partner's name or a proposal # straight into the search box.
    if (q)
      list = list.filter((c) => {
        const hay = [
          c.client_name,
          c.normalized_name,
          ...(c.service_types ?? []),
          ...(c.partners ?? []),
          ...(c.managers ?? []),
          ...(c.sent_by ?? []),
          ...(c.proposal_numbers ?? []),
          c.state ?? "",
        ]
          .join(" ")
          .toLowerCase()
        return hay.includes(q)
      })
    // Cadence: at least one of the client's cadences is selected.
    if (cadence.length) {
      list = list.filter((c) =>
        c.cadences.some((cad) => cadence.includes(cad)),
      )
    }
    // Service Type: at least one of the client's service types matches.
    if (serviceType.length) {
      list = list.filter((c) =>
        c.service_types.some((st) => serviceType.includes(st)),
      )
    }
    // Partner / Manager / Sent-by: at least one selected value appears in
    // the client's roll-up. Clients with mixed engagements (rare) match
    // if any of their proposals were touched by the chosen person.
    if (partner.length) {
      list = list.filter((c) =>
        (c.partners ?? []).some((p) => partner.includes(p)),
      )
    }
    if (manager.length) {
      list = list.filter((c) =>
        (c.managers ?? []).some((m) => manager.includes(m)),
      )
    }
    if (sentBy.length) {
      list = list.filter((c) =>
        (c.sent_by ?? []).some((s) => sentBy.includes(s)),
      )
    }
    // State: "(unknown)" matches clients with no resolved state, mirroring
    // the proposals page's sentinel value.
    if (stateF.length) {
      list = list.filter((c) => {
        const s = c.state ?? "(unknown)"
        return stateF.includes(s)
      })
    }
    // MRR range: inclusive on both ends so $0 as a min still includes
    // legitimate $0 cases (rare but possible). Empty string means "no
    // bound". `Number("")` is 0, so we test the raw string first.
    if (mrrMin !== "") {
      const lo = Number(mrrMin)
      if (!Number.isNaN(lo)) list = list.filter((c) => c.mrr >= lo)
    }
    if (mrrMax !== "") {
      const hi = Number(mrrMax)
      if (!Number.isNaN(hi)) list = list.filter((c) => c.mrr <= hi)
    }
    // ARR range — same shape as MRR.
    if (arrMin !== "") {
      const lo = Number(arrMin)
      if (!Number.isNaN(lo)) list = list.filter((c) => c.arr >= lo)
    }
    if (arrMax !== "") {
      const hi = Number(arrMax)
      if (!Number.isNaN(hi)) list = list.filter((c) => c.arr <= hi)
    }
    // "Has onboarding fee" / "Has other one-time" quick toggles. Onboarding
    // is a subset of one_time_total, so "Other 1x" must back-out the
    // onboarding portion to avoid double-counting.
    if (onboardingOnly) {
      list = list.filter((c) => (c.onboarding_total ?? 0) > 0)
    }
    if (otherOneTimeOnly) {
      list = list.filter(
        (c) => c.one_time_total - (c.onboarding_total ?? 0) > 0,
      )
    }
    // Accepted-date range. Compares the client roll-up's
    // `effective_start_date` (earliest accepted_at across all of the
    // client's accepted proposals) against the URL ISO dates. Both ends
    // are inclusive.
    if (dateFrom) {
      list = list.filter(
        (c) => !!c.effective_start_date && c.effective_start_date >= dateFrom,
      )
    }
    if (dateTo) {
      // Pad the upper bound to end-of-day so "2024-12-31" includes
      // any timestamp on that day, not just midnight.
      const toCutoff = `${dateTo}T23:59:59.999Z`
      list = list.filter(
        (c) => !!c.effective_start_date && c.effective_start_date <= toCutoff,
      )
    }
    // Hide $0 MRR rows by default — matches the page's purpose (it's a
    // recurring-revenue surface, not a proposal log). Users can flip it
    // off via the chip.
    if (hideZero) {
      list = list.filter((c) => c.mrr > 0)
    }
    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      switch (sortBy) {
        case "client_name":
          return a.client_name.localeCompare(b.client_name) * dir
        case "arr":
          return (a.arr - b.arr) * dir
        case "service_lines":
          return (a.service_lines - b.service_lines) * dir
        case "mrr":
        default:
          return (a.mrr - b.mrr) * dir
      }
    })
    return list
  }, [
    data,
    dept,
    searchUrl,
    sortBy,
    sortDir,
    cadence,
    serviceType,
    partner,
    manager,
    sentBy,
    stateF,
    mrrMin,
    mrrMax,
    arrMin,
    arrMax,
    onboardingOnly,
    otherOneTimeOnly,
    dateFrom,
    dateTo,
    hideZero,
  ])

  const filteredService = useMemo(() => {
    if (!data) return []
    let list = data.serviceBreakdown
    if (dept !== "All") list = list.filter((s) => s.department === dept)
    return list
  }, [data, dept])

  const visibleTotals = useMemo(() => {
    if (!data) return null
    if (dept === "All") return data.totals
    const subset = data.departments.find((d) => d.department === dept)
    if (!subset) {
      return {
        mrr: 0,
        arr: 0,
        one_time_total: 0,
        distinct_clients: 0,
        service_lines: 0,
        avg_mrr_per_client: 0,
      }
    }
    const distinct = new Set(
      data.clients
        .filter((c) => c.department === dept)
        .map((c) => c.normalized_name),
    ).size
    return {
      mrr: subset.mrr,
      arr: subset.arr,
      one_time_total: subset.one_time_total,
      distinct_clients: distinct,
      service_lines: subset.service_lines,
      avg_mrr_per_client: distinct > 0 ? subset.mrr / distinct : 0,
    }
  }, [data, dept])

  const maxServiceMrr = useMemo(
    () => Math.max(1, ...filteredService.map((s) => s.mrr)),
    [filteredService],
  )

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" })
    } else {
      updateParams({
        sortBy: col,
        sortDir: col === "client_name" ? "asc" : "desc",
      })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Link
          href="/sales"
          className="text-sm text-muted-foreground hover:text-stone-900 transition-colors flex items-center gap-1.5 w-fit"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Sales
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold text-stone-900">
                {meta.pageTitle}
              </h1>
              {/* Lifecycle pill. For the Accepted view we show the pulsing
                  "Live from Ignition" badge that signals real-time data
                  freshness; for Pipeline / Lost / All we show a static
                  pill in the lifecycle's tone so the view is clearly
                  labeled as a different slice. */}
              {meta.showLiveBadge ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1.5 font-normal h-6",
                    meta.badgeTone,
                  )}
                >
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Live from Ignition
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={cn("font-normal h-6", meta.badgeTone)}
                >
                  {meta.label} view
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground max-w-3xl">
              {meta.description}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {data?.lastSyncedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3" />
                  Synced {formatDistanceToNow(new Date(data.lastSyncedAt), { addSuffix: true })}
                </span>
              ) : data ? (
                <span className="inline-flex items-center gap-1.5 text-amber-700">
                  <AlertCircle className="h-3 w-3" />
                  No Ignition connection synced yet
                </span>
              ) : null}
              {data?.totals.active_proposals ? (
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="h-3 w-3" />
                  {data.totals.active_proposals} active proposals
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={triggerSync}
                disabled={syncing}
              >
                <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
                {syncing ? "Syncing…" : "Sync from Ignition"}
              </Button>
            </div>
            {syncError ? (
              <p className="text-xs text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3" />
                {syncError}
              </p>
            ) : null}
          </div>
          {data && (
            <div className="flex flex-col items-end gap-0.5">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                {meta.headlineTotalLabel}
              </div>
              <div className="text-3xl font-semibold tabular-nums text-stone-900">
                {fmt(data.totals.mrr)}
              </div>
              <div className="text-xs text-muted-foreground">
                {meta.headlineSubtitle(fmt(data.totals.arr))}
              </div>
              {(data.totals.onboarding_total ?? 0) > 0 ? (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {fmt(data.totals.onboarding_total ?? 0)} onboarding fees
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Lifecycle tabs — mirrors the Sales Dashboard's status grouping
          so the two surfaces feel like the same product. Accepted is the
          default (live recurring book); Pipeline shows what's in flight,
          Lost shows what we missed, and All combines everything for a
          full-funnel recurring view. */}
      <Tabs
        value={lifecycle}
        onValueChange={(v) =>
          // Default lifecycle ("accepted") drops out of the URL to keep
          // the canonical link clean.
          updateParams({ lifecycle: v === "accepted" ? null : v })
        }
      >
        <TabsList>
          <TabsTrigger value="accepted" className="gap-2">
            Accepted
            {data?.lifecycleCounts?.accepted != null && (
              <Badge variant="outline" className="font-normal">
                {data.lifecycleCounts.accepted}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-2">
            Pipeline
            {data?.lifecycleCounts?.pipeline != null && (
              <Badge variant="outline" className="font-normal">
                {data.lifecycleCounts.pipeline}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="lost" className="gap-2">
            Lost
            {data?.lifecycleCounts?.lost != null && (
              <Badge variant="outline" className="font-normal">
                {data.lifecycleCounts.lost}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-2">
            All
            {data?.lifecycleCounts?.all != null && (
              <Badge variant="outline" className="font-normal">
                {data.lifecycleCounts.all}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Headline KPIs — labels swap to lifecycle-appropriate copy so a
          partner viewing the Pipeline tab sees "Potential MRR" rather
          than the live-book "Combined MRR" framing. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={meta.mrrLabel(dept)}
          value={visibleTotals ? fmt(visibleTotals.mrr) : null}
          subtitle={
            visibleTotals
              ? `${fmtPrecise(visibleTotals.mrr)} per month`
              : undefined
          }
          icon={Repeat}
          tone={
            lifecycle === "lost"
              ? "rose"
              : lifecycle === "pipeline"
                ? "amber"
                : "emerald"
          }
        />
        <KpiCard
          label={meta.arrLabel}
          value={visibleTotals ? fmt(visibleTotals.arr) : null}
          subtitle="MRR × 12 + Quarterly × 4"
          icon={TrendingUp}
          tone="blue"
        />
        <KpiCard
          label={meta.clientsLabel}
          value={
            visibleTotals
              ? visibleTotals.distinct_clients.toLocaleString()
              : null
          }
          subtitle={
            visibleTotals
              ? `${visibleTotals.service_lines} service lines`
              : undefined
          }
          icon={Users}
          tone="stone"
        />
        <KpiCard
          label={meta.onboardingLabel}
          value={
            data
              ? fmt(
                  dept === "All"
                    ? data.totals.onboarding_total ?? 0
                    : data.departments.find((d) => d.department === dept)
                        ?.onboarding_total ?? 0,
                )
              : null
          }
          subtitle={
            visibleTotals
              ? `${fmt(visibleTotals.avg_mrr_per_client)} avg MRR / client`
              : undefined
          }
          icon={CircleDollarSign}
          tone="amber"
        />
      </div>

      {/* Department tabs */}
      <Tabs
        value={dept}
        onValueChange={(v) => updateParams({ dept: v === "All" ? null : v })}
      >
        <TabsList>
          <TabsTrigger value="All" className="gap-2">
            All
            {data && (
              <Badge variant="outline" className="font-normal">
                {data.totals.distinct_clients}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="Accounting" className="gap-2">
            <Calculator className="h-3.5 w-3.5" />
            Accounting
            {data && (
              <Badge variant="outline" className="font-normal">
                {data.departments.find((d) => d.department === "Accounting")
                  ?.client_count ?? 0}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="Tax" className="gap-2">
            <Briefcase className="h-3.5 w-3.5" />
            Tax
            {data && (
              <Badge variant="outline" className="font-normal">
                {data.departments.find((d) => d.department === "Tax")
                  ?.client_count ?? 0}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={dept} className="flex flex-col gap-6 mt-6">
          {/* Service-type breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By service line</CardTitle>
              <CardDescription>
                Monthly contribution per service. Quarterly fees are normalized
                to monthly (÷ 3).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isLoading || !data ? (
                <>
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </>
              ) : filteredService.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No service lines found for this filter.
                </p>
              ) : (
                filteredService.map((s) => {
                  const pct = (s.mrr / maxServiceMrr) * 100
                  return (
                    <div
                      key={`${s.department}-${s.service_type}`}
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0",
                              DEPT_BADGE[s.department],
                            )}
                          >
                            {s.department}
                          </Badge>
                          <span className="font-medium text-stone-900 truncate">
                            {s.service_type}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            · {s.client_count}{" "}
                            {s.client_count === 1 ? "client" : "clients"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 tabular-nums">
                          <span className="text-xs text-muted-foreground">
                            {fmt(s.arr)} / yr
                          </span>
                          <span className="font-semibold text-stone-900">
                            {fmt(s.mrr)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            s.department === "Accounting"
                              ? "bg-blue-500"
                              : "bg-emerald-500",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Client table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Clients</CardTitle>
              <CardDescription>
                {data
                  ? `${filteredClients.length} of ${data.clients.length} recurring clients`
                  : "Loading…"}
              </CardDescription>
              <div className="relative pt-2">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/4 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  // Broadened to match client name, service-line chips,
                  // partner, manager, sent-by, proposal numbers, and
                  // state. Same search box as before — just smarter.
                  placeholder="Search client, partner, manager, proposal #, state…"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateParams({ q: searchDraft.trim() || null })
                    }
                  }}
                  onBlur={() => {
                    // Commit draft on blur too, so users who tab away
                    // don't lose what they typed.
                    if (searchDraft !== searchUrl) {
                      updateParams({ q: searchDraft.trim() || null })
                    }
                  }}
                  className="pl-9 h-9"
                />
              </div>
              {/* Filter chip rail. Same MultiSelect/Range chips used
                  elsewhere on Sales so the experience is consistent. All
                  state is persisted to the URL for shareable / refresh-
                  safe views. */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <MultiSelectChip
                  label="Cadence"
                  options={cadenceOptions}
                  value={cadence}
                  onChange={(v) =>
                    updateParams({ cadence: v.length ? v.join(",") : null })
                  }
                />
                <MultiSelectChip
                  label="Service type"
                  options={serviceTypeOptions}
                  value={serviceType}
                  onChange={(v) =>
                    updateParams({
                      serviceType: v.length ? v.join(",") : null,
                    })
                  }
                />
                <MultiSelectChip
                  label="Partner"
                  options={partnerOptions}
                  value={partner}
                  onChange={(v) =>
                    updateParams({ partner: v.length ? v.join(",") : null })
                  }
                />
                <MultiSelectChip
                  label="Manager"
                  options={managerOptions}
                  value={manager}
                  onChange={(v) =>
                    updateParams({ manager: v.length ? v.join(",") : null })
                  }
                />
                <MultiSelectChip
                  label="Sent by"
                  options={sentByOptions}
                  value={sentBy}
                  onChange={(v) =>
                    updateParams({ sentBy: v.length ? v.join(",") : null })
                  }
                />
                <MultiSelectChip
                  label="State"
                  options={stateOptions}
                  value={stateF}
                  // Show the full state name in the picker but keep the
                  // 2-letter abbr in the URL — matches the proposals page.
                  formatLabel={(v) =>
                    v === "(unknown)"
                      ? "(no state on file)"
                      : US_STATE_NAMES[v] || v
                  }
                  onChange={(v) =>
                    updateParams({ state: v.length ? v.join(",") : null })
                  }
                />
                <RangeChip
                  label="MRR"
                  min={mrrMin}
                  max={mrrMax}
                  onChange={({ min, max }) =>
                    updateParams({
                      mrrMin: min || null,
                      mrrMax: max || null,
                    })
                  }
                />
                <RangeChip
                  label="ARR"
                  min={arrMin}
                  max={arrMax}
                  step={1000}
                  onChange={({ min, max }) =>
                    updateParams({
                      arrMin: min || null,
                      arrMax: max || null,
                    })
                  }
                />
                <DateRangeChip
                  label="Accepted"
                  from={dateFrom}
                  to={dateTo}
                  field="effective_start_date"
                  onChange={({ from, to }) =>
                    updateParams({
                      dateFrom: from || null,
                      dateTo: to || null,
                    })
                  }
                />
                {/* Quick boolean toggles — implemented as buttons rather
                    than chips so the active-state is visually obvious
                    at a glance. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateParams({ hasOnboarding: onboardingOnly ? null : "1" })
                  }
                  className={cn(
                    "h-9 gap-1",
                    onboardingOnly ? "border-stone-900 bg-stone-50" : "",
                  )}
                >
                  Has onboarding
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateParams({ hasOther1x: otherOneTimeOnly ? null : "1" })
                  }
                  className={cn(
                    "h-9 gap-1",
                    otherOneTimeOnly ? "border-stone-900 bg-stone-50" : "",
                  )}
                >
                  Has other 1x
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    // hideZero defaults to ON — clicking flips it OFF (and
                    // we set `hideZero=0` explicitly so the default doesn't
                    // re-apply on refresh).
                    updateParams({ hideZero: hideZero ? "0" : null })
                  }
                  className={cn(
                    "h-9 gap-1",
                    !hideZero ? "border-stone-900 bg-stone-50" : "",
                  )}
                  title={
                    hideZero
                      ? "Currently hiding $0 MRR rows. Click to show them."
                      : "Currently showing $0 MRR rows. Click to hide them."
                  }
                >
                  {hideZero ? "Hiding $0 MRR" : "Showing $0 MRR"}
                </Button>
                {activeFilterCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="h-9"
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Clear (
                    {activeFilterCount})
                  </Button>
                ) : null}
              </div>
              {/* Active-filter pill bar. Surfaces every selected value as
                  a removable pill so users can see (and undo) individual
                  filters without re-opening each chip popover. Hidden
                  when nothing is active. */}
              {activeFilterCount > 0 ? (
                <ActiveFilterBar
                  pills={[
                    ...(searchUrl
                      ? [
                          {
                            key: `q:${searchUrl}`,
                            label: `Search: "${searchUrl}"`,
                            onRemove: () => updateParams({ q: null }),
                          },
                        ]
                      : []),
                    ...cadence.map((v) => ({
                      key: `cadence:${v}`,
                      label: `Cadence: ${v}`,
                      onRemove: () =>
                        updateParams({
                          cadence:
                            cadence.filter((x) => x !== v).join(",") || null,
                        }),
                    })),
                    ...serviceType.map((v) => ({
                      key: `serviceType:${v}`,
                      label: `Service: ${v}`,
                      onRemove: () =>
                        updateParams({
                          serviceType:
                            serviceType.filter((x) => x !== v).join(",") ||
                            null,
                        }),
                    })),
                    ...partner.map((v) => ({
                      key: `partner:${v}`,
                      label: `Partner: ${v}`,
                      onRemove: () =>
                        updateParams({
                          partner:
                            partner.filter((x) => x !== v).join(",") || null,
                        }),
                    })),
                    ...manager.map((v) => ({
                      key: `manager:${v}`,
                      label: `Manager: ${v}`,
                      onRemove: () =>
                        updateParams({
                          manager:
                            manager.filter((x) => x !== v).join(",") || null,
                        }),
                    })),
                    ...sentBy.map((v) => ({
                      key: `sentBy:${v}`,
                      label: `Sent by: ${v}`,
                      onRemove: () =>
                        updateParams({
                          sentBy:
                            sentBy.filter((x) => x !== v).join(",") || null,
                        }),
                    })),
                    ...stateF.map((v) => ({
                      key: `state:${v}`,
                      label: `State: ${
                        v === "(unknown)"
                          ? "Unknown"
                          : US_STATE_NAMES[v] || v
                      }`,
                      onRemove: () =>
                        updateParams({
                          state:
                            stateF.filter((x) => x !== v).join(",") || null,
                        }),
                    })),
                    ...(mrrMin || mrrMax
                      ? [
                          {
                            key: "mrrRange",
                            label: `MRR: ${formatRange(mrrMin, mrrMax, "$")}`,
                            onRemove: () =>
                              updateParams({ mrrMin: null, mrrMax: null }),
                          },
                        ]
                      : []),
                    ...(arrMin || arrMax
                      ? [
                          {
                            key: "arrRange",
                            label: `ARR: ${formatRange(arrMin, arrMax, "$")}`,
                            onRemove: () =>
                              updateParams({ arrMin: null, arrMax: null }),
                          },
                        ]
                      : []),
                    ...(onboardingOnly
                      ? [
                          {
                            key: "hasOnboarding",
                            label: "Has onboarding",
                            onRemove: () =>
                              updateParams({ hasOnboarding: null }),
                          },
                        ]
                      : []),
                    ...(otherOneTimeOnly
                      ? [
                          {
                            key: "hasOther1x",
                            label: "Has other 1x",
                            onRemove: () => updateParams({ hasOther1x: null }),
                          },
                        ]
                      : []),
                    ...(dateFrom || dateTo
                      ? [
                          {
                            key: "dateRange",
                            label: `Accepted: ${dateFrom || "…"} → ${dateTo || "…"}`,
                            onRemove: () =>
                              updateParams({
                                dateFrom: null,
                                dateTo: null,
                              }),
                          },
                        ]
                      : []),
                    ...(!hideZero
                      ? [
                          {
                            key: "showZero",
                            label: "Showing $0 MRR",
                            onRemove: () => updateParams({ hideZero: null }),
                          },
                        ]
                      : []),
                  ]}
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 border-y border-stone-200 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <SortableTh
                        col="client_name"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onClick={() => handleSort("client_name")}
                        className="px-4"
                      >
                        Client
                      </SortableTh>
                      <th className="text-left font-medium px-3 py-2">Dept</th>
                      <th className="text-left font-medium px-3 py-2">
                        Service Lines
                      </th>
                      <th className="text-left font-medium px-3 py-2">
                        Cadence
                      </th>
                      <SortableTh
                        col="mrr"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onClick={() => handleSort("mrr")}
                        align="right"
                      >
                        MRR
                      </SortableTh>
                      <SortableTh
                        col="arr"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onClick={() => handleSort("arr")}
                        align="right"
                      >
                        ARR
                      </SortableTh>
                      <th
                        className="text-right font-medium px-3 py-2"
                        title="One-time setup / clean-up / optimization fees billed alongside the recurring engagement"
                      >
                        Onboarding
                      </th>
                      <th
                        className="text-right font-medium px-3 py-2 pr-4"
                        title="Other one-time line items on the same Ignition proposals"
                      >
                        Other 1x
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading || !data ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-stone-100">
                          <td colSpan={8} className="px-4 py-3">
                            <Skeleton className="h-5" />
                          </td>
                        </tr>
                      ))
                    ) : filteredClients.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-12 text-center text-muted-foreground"
                        >
                          No clients match your filters.
                        </td>
                      </tr>
                    ) : (
                      filteredClients.map((c) => (
                        <tr
                          key={`${c.department}-${c.normalized_name}`}
                          className="border-b border-stone-100 hover:bg-stone-50/60 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-medium text-stone-900">
                            {c.client_name}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge
                              variant="outline"
                              className={cn(DEPT_BADGE[c.department])}
                            >
                              {c.department}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {c.service_types.map((st) => (
                                <Badge
                                  key={st}
                                  variant="outline"
                                  className="font-normal text-xs bg-stone-50"
                                >
                                  {st}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {c.cadences.join(" + ")}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-stone-900">
                            {fmt(c.mrr)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-stone-700">
                            {fmt(c.arr)}
                          </td>
                          {/* Onboarding & Optimization fees, separate from
                              the catch-all one-time bucket. Highlighted in
                              amber when present so partners can scan for
                              recently onboarded engagements. */}
                          <td
                            className={cn(
                              "px-3 py-2.5 text-right tabular-nums",
                              (c.onboarding_total ?? 0) > 0
                                ? "text-amber-900 font-medium"
                                : "text-muted-foreground",
                            )}
                          >
                            {(c.onboarding_total ?? 0) > 0
                              ? fmt(c.onboarding_total ?? 0)
                              : "—"}
                          </td>
                          {/* "Other 1x" = total one-time MINUS onboarding.
                              Avoids double-counting because onboarding is a
                              subset of one_time_total on the server side. */}
                          <td className="px-3 py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                            {c.one_time_total - (c.onboarding_total ?? 0) > 0
                              ? fmt(c.one_time_total - (c.onboarding_total ?? 0))
                              : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {data && filteredClients.length > 0 && (
                    <tfoot className="bg-stone-50 border-t-2 border-stone-300 font-semibold text-stone-900">
                      <tr>
                        <td
                          className="px-4 py-2.5 text-xs uppercase tracking-wide"
                          colSpan={4}
                        >
                          {dept === "All" ? "Combined" : dept} subtotal ·{" "}
                          {filteredClients.length} clients
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {fmt(
                            filteredClients.reduce((s, c) => s + c.mrr, 0),
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {fmt(
                            filteredClients.reduce((s, c) => s + c.arr, 0),
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-900">
                          {fmt(
                            filteredClients.reduce(
                              (s, c) => s + (c.onboarding_total ?? 0),
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-3 py-2.5 pr-4 text-right tabular-nums">
                          {fmt(
                            filteredClients.reduce(
                              (s, c) =>
                                s + (c.one_time_total - (c.onboarding_total ?? 0)),
                              0,
                            ),
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── Gap diagnostic: curated clients NOT in Ignition yet ──────
              The partner team maintains a CSV list of every client they
              consider on a recurring engagement. Some haven't been
              proposed through Ignition yet — those don't show in the
              live totals above but are visible here so the team can
              close the gap. Filtered to the active department tab.
              Only shown in the Accepted view — the curated CSV is a
              proxy for the live recurring book, so it doesn't apply to
              Pipeline / Lost / All views. */}
          {meta.showGapDiagnostic &&
          data?.not_in_ignition &&
          data.not_in_ignition.length > 0 ? (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-700" />
                  Not in Ignition yet
                </CardTitle>
                <CardDescription>
                  Clients on the curated CSV list with no active Ignition
                  proposal. Send a proposal through Ignition to bring them
                  into the live totals above.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-amber-100/40 border-y border-amber-200 text-xs uppercase tracking-wide text-amber-900">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">
                          Client
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Dept
                        </th>
                        <th className="text-left font-medium px-3 py-2">
                          Service Lines
                        </th>
                        <th className="text-right font-medium px-3 py-2 pr-4">
                          Curated MRR
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.not_in_ignition
                        .filter((c) => dept === "All" || c.department === dept)
                        .slice(0, 25)
                        .map((c) => (
                          <tr
                            key={`gap-${c.normalized_name}-${c.department}`}
                            className="border-b border-amber-100 hover:bg-amber-50/60"
                          >
                            <td className="px-4 py-2 font-medium text-stone-900">
                              {c.client_name}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="outline"
                                className={cn(DEPT_BADGE[c.department])}
                              >
                                {c.department}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {c.service_types.join(", ") || "—"}
                            </td>
                            <td className="px-3 py-2 pr-4 text-right tabular-nums text-stone-700">
                              {fmt(c.mrr)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {data.not_in_ignition.filter(
                  (c) => dept === "All" || c.department === dept,
                ).length > 25 ? (
                  <p className="text-xs text-muted-foreground px-4 pt-2">
                    Showing 25 of{" "}
                    {
                      data.not_in_ignition.filter(
                        (c) => dept === "All" || c.department === dept,
                      ).length
                    }{" "}
                    gap clients.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SortableTh({
  col,
  sortBy,
  sortDir,
  onClick,
  children,
  align = "left",
  className,
}: {
  col: string
  sortBy: string
  sortDir: "asc" | "desc"
  onClick: () => void
  children: React.ReactNode
  align?: "left" | "right"
  className?: string
}) {
  const active = sortBy === col
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <th
      className={cn(
        "font-medium py-2 cursor-pointer select-none hover:text-stone-900 transition-colors",
        align === "right" ? "text-right pr-3" : "text-left px-3",
        className,
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1",
          align === "right" && "justify-end w-full",
        )}
      >
        {children}
        <Icon
          className={cn(
            "h-3 w-3",
            active ? "text-stone-900" : "text-stone-400",
          )}
        />
      </span>
    </th>
  )
}

/**
 * ActiveFilterBar — horizontal row of removable filter pills.
 *
 * One pill per selected filter value (every entry in a multiselect gets
 * its own pill so individual values can be dropped without re-opening
 * the chip). The bar is intentionally lightweight — no popovers, no
 * dropdowns; the user just clicks the × on a pill to remove that single
 * value. Wrapping is allowed so a long list flows onto multiple rows
 * rather than overflowing.
 */
function ActiveFilterBar({
  pills,
}: {
  pills: { key: string; label: string; onRemove: () => void }[]
}) {
  if (pills.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500 mr-1">
        Active
      </span>
      {pills.map((pill) => (
        <button
          key={pill.key}
          type="button"
          onClick={pill.onRemove}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-stone-300 bg-stone-50 text-stone-800 text-xs hover:bg-stone-100 hover:border-stone-400 transition-colors"
        >
          <span className="truncate max-w-[16rem]">{pill.label}</span>
          <X className="h-3 w-3 text-stone-500" />
        </button>
      ))}
    </div>
  )
}

/** Format a numeric min/max range as a compact pill label. */
function formatRange(min: string, max: string, prefix = "") {
  if (min && max) return `${prefix}${min} – ${prefix}${max}`
  if (min) return `≥ ${prefix}${min}`
  if (max) return `≤ ${prefix}${max}`
  return "—"
}

function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  label: string
  value: string | null
  subtitle?: string
  icon: any
  tone: "stone" | "emerald" | "amber" | "blue" | "rose"
}) {
  const toneStyles: Record<string, string> = {
    stone: "text-stone-900 bg-stone-100",
    emerald: "text-emerald-900 bg-emerald-100",
    amber: "text-amber-900 bg-amber-100",
    blue: "text-blue-900 bg-blue-100",
    rose: "text-rose-900 bg-rose-100",
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn("p-2 rounded-md shrink-0", toneStyles[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </div>
          {value ? (
            <div className="text-xl font-semibold tabular-nums truncate">
              {value}
            </div>
          ) : (
            <Skeleton className="h-6 w-24 mt-1" />
          )}
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">
              {subtitle}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
