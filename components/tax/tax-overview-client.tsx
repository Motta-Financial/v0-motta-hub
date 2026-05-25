"use client"

import useSWR from "swr"
import Link from "next/link"
import {
  Users,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Building2,
  Heart,
  User,
  ArrowRight,
  RefreshCw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts"
import {
  KpiCard,
  FormBadge,
  EfileBadge,
  fmtNumber,
} from "@/components/tax/tax-shared"

// ── Tax Department Overview ──────────────────────────────────────────
// Lives at /tax (the parent of the four sub-pages). Pulls 100% from
// /api/tax/overview, which in turn rolls up directly off ProConnect's
// proconnect_engagements / proconnect_clients tables. No Karbon work
// items reach this surface — that's by design after the operator's
// 5/22 review: "ensure the dashboard is pulling from live ProConnect."

type OverviewResponse = {
  totalEngagements: number
  totalClients: number
  personClients: number
  orgClients: number
  currentTaxYear: number
  currentYearReturns: number
  unassignedReturns: number
  byForm: Record<string, number>
  byYear: Record<string, number>
  byCategory: { individual: number; business: number; nonprofit: number; other: number }
  byEfileStatus: Record<string, number>
  customStatusList: Array<{ name: string; count: number; color: string | null }>
  preparerLeaderboard: Array<{ name: string; count: number }>
  yearFormSeries: Array<Record<string, number | string>>
  formsTracked: string[]
  profileMapping: { distinct: number; mapped: number; unmapped: number }
  lastSync: {
    id: string
    status: string
    startedAt: string
    completedAt: string | null
    clientsSynced: number | null
    engagementsSynced: number | null
    errorMessage: string | null
  } | null
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

// Stable pastel palette for the form-mix chart. Keeps the same colour
// per form across pageloads so users build muscle memory.
const FORM_COLORS: Record<string, string> = {
  "1040": "#60a5fa",
  "1065": "#a78bfa",
  "1120": "#818cf8",
  "1120S": "#5eead4",
  "990": "#fbbf24",
  Unknown: "#a8a29e",
}

const CATEGORY_COLORS = {
  individual: "#60a5fa",
  business: "#a78bfa",
  nonprofit: "#fbbf24",
  other: "#a8a29e",
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never"
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "never"
  const seconds = Math.floor((Date.now() - t) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function TaxOverviewClient() {
  const { data, error, isLoading, mutate } = useSWR<OverviewResponse>(
    "/api/tax/overview",
    fetcher,
    { refreshInterval: 60_000 }, // gentle live-refresh; the heavy sync
    // is gated by the ProConnect cron, not this dashboard.
  )

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <div className="font-medium">Could not load Tax overview</div>
              <div className="text-sm text-muted-foreground">{error.message}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-9 w-72" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    )
  }

  const lastCompleted = data.lastSync?.completedAt
  const syncOk = data.lastSync?.status === "success"

  // Pie data for form mix
  const formPie = Object.entries(data.byForm)
    .map(([form, count]) => ({ name: form, value: count }))
    .sort((a, b) => b.value - a.value)

  // Pie data for category split (Individual / Business / Non-profit)
  const categoryPie = [
    { name: "Individual", value: data.byCategory.individual, key: "individual" },
    { name: "Business", value: data.byCategory.business, key: "business" },
    { name: "Non-profit", value: data.byCategory.nonprofit, key: "nonprofit" },
    { name: "Other", value: data.byCategory.other, key: "other" },
  ].filter((c) => c.value > 0)

  return (
    <div className="p-6 space-y-6">
      {/* ── Header + freshness pill ───────────────────────────────── */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tax Department</h1>
          <p className="text-sm text-muted-foreground">
            Live ProConnect data —{" "}
            <span className="font-medium text-foreground">
              {fmtNumber(data.totalEngagements)}
            </span>{" "}
            engagements across{" "}
            <span className="font-medium text-foreground">
              {fmtNumber(data.totalClients)}
            </span>{" "}
            clients.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              syncOk
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }
          >
            <span
              className={`h-2 w-2 rounded-full mr-2 ${
                syncOk ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            ProConnect synced {relativeTime(lastCompleted)}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => mutate()}
            className="h-8"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </header>

      {/* ── Headline KPIs ─────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Total Returns"
          value={fmtNumber(data.totalEngagements)}
          subtitle={`${fmtNumber(data.currentYearReturns)} for TY ${data.currentTaxYear}`}
          icon={FileText}
          tone="stone"
        />
        <KpiCard
          label="Tax Clients"
          value={fmtNumber(data.totalClients)}
          subtitle={`${fmtNumber(data.personClients)} ind. · ${fmtNumber(data.orgClients)} org`}
          icon={Users}
          tone="blue"
        />
        <KpiCard
          label="E-filed"
          value={fmtNumber(data.byEfileStatus["(filed)"] || 0)}
          subtitle={`${fmtNumber(data.byEfileStatus["(not filed)"] || 0)} not filed`}
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Unassigned"
          value={fmtNumber(data.unassignedReturns)}
          subtitle={
            data.profileMapping.mapped > 0
              ? `${fmtNumber(data.profileMapping.mapped)} of ${fmtNumber(data.profileMapping.distinct)} preparers mapped`
              : `${fmtNumber(data.profileMapping.distinct)} preparers need mapping`
          }
          icon={Clock}
          tone={data.unassignedReturns > 100 ? "amber" : "stone"}
        />
      </section>

      {/* ── Profile-mapping warning (only if anything unmapped) ───── */}
      {data.profileMapping.unmapped > 0 ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-amber-900">
              <div className="font-medium">
                {data.profileMapping.unmapped} of {data.profileMapping.distinct}{" "}
                ProConnect preparer profiles aren&apos;t mapped to a team
                member yet.
              </div>
              <p className="mt-1 text-amber-900/90">
                ProConnect&apos;s API only ships preparer GUIDs (not names or
                emails), so each profile has to be linked once. Until then,
                returns assigned to those IDs show as{" "}
                <span className="font-medium">&quot;(unassigned)&quot;</span>.
              </p>
              <Link
                href="/tax/settings"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
              >
                Open Preparer Mapping
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Subpage navigation ────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <SubpageCard
          href="/tax/clients"
          icon={Users}
          title="All Clients"
          subtitle={`${fmtNumber(data.totalClients)} clients in ProConnect`}
        />
        <SubpageCard
          href="/tax/individual"
          icon={User}
          title="Individual"
          subtitle={`${fmtNumber(data.byCategory.individual)} 1040 returns`}
        />
        <SubpageCard
          href="/tax/business"
          icon={Building2}
          title="Business"
          subtitle={`${fmtNumber(data.byCategory.business)} 1065/1120/1120S`}
        />
        <SubpageCard
          href="/tax/nonprofit"
          icon={Heart}
          title="Non-profit"
          subtitle={`${fmtNumber(data.byCategory.nonprofit)} 990 returns`}
        />
      </section>

      {/* ── Charts ────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Returns by Tax Year</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.yearFormSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {data.formsTracked.map((form) => (
                  <Bar
                    key={form}
                    dataKey={form}
                    stackId="forms"
                    fill={FORM_COLORS[form] || "#a8a29e"}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Form Mix</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={formPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {formPie.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={FORM_COLORS[entry.name] || "#a8a29e"}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── E-file status breakdown ───────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">E-file Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(data.byEfileStatus)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => {
                const pct = (count / data.totalEngagements) * 100
                return (
                  <div key={status} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <EfileBadge status={status === "(not filed)" ? null : status} />
                      <span className="tabular-nums text-muted-foreground">
                        {fmtNumber(count)}{" "}
                        <span className="text-xs">({pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-stone-600 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </CardContent>
        </Card>

        {/* ── Custom status (firm workflow) ─────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workflow Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.customStatusList.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No custom workflow statuses set in ProConnect.
              </div>
            ) : (
              data.customStatusList.slice(0, 8).map((s) => {
                const pct = (s.count / data.totalEngagements) * 100
                return (
                  <div
                    key={s.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color || "#a8a29e" }}
                      />
                      <span className="truncate">{s.name}</span>
                    </div>
                    <span className="tabular-nums text-muted-foreground flex-shrink-0">
                      {fmtNumber(s.count)}{" "}
                      <span className="text-xs">({pct.toFixed(1)}%)</span>
                    </span>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Preparer leaderboard ───────────────────────────────────�� */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Preparers (active)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.preparerLeaderboard.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No assigned preparers yet — once admins map ProConnect profile
              IDs to team members in the{" "}
              <code className="px-1 py-0.5 rounded bg-stone-50 border text-xs">
                proconnect_profiles
              </code>{" "}
              table, names will appear here.
            </div>
          ) : (
            <div className="space-y-2">
              {data.preparerLeaderboard.map((p, i) => {
                const max = data.preparerLeaderboard[0].count
                const pct = (p.count / max) * 100
                return (
                  <div key={p.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums w-5">
                          {i + 1}.
                        </span>
                        <span className="font-medium truncate">{p.name}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {fmtNumber(p.count)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Footer: data provenance ──────────────────────────────── */}
      <footer className="text-xs text-muted-foreground pt-2 border-t border-stone-100">
        Data source: Intuit ProConnect API (proconnect_engagements_enriched view).
        Sync runs daily at 06:00 UTC; last successful run completed{" "}
        {relativeTime(lastCompleted)}{" "}
        ({fmtNumber(data.lastSync?.engagementsSynced || 0)} engagements,{" "}
        {fmtNumber(data.lastSync?.clientsSynced || 0)} clients).
        {data.lastSync?.errorMessage ? (
          <span className="text-rose-700"> · {data.lastSync.errorMessage}</span>
        ) : null}
      </footer>
    </div>
  )
}

// ── Subpage navigation card ──────────────────────────────────────────
// Compact link tile that lets the user jump from the parent overview
// straight into the corresponding detail page. Uses the same KPI-card
// visual rhythm so the page feels like a single composition.
function SubpageCard({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string
  icon: typeof Users
  title: string
  subtitle: string
}) {
  return (
    <Link href={href} className="block group">
      <Card className="transition-colors group-hover:border-stone-300 group-hover:bg-stone-50/50">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-md bg-stone-100 text-stone-700">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{title}</div>
            <div className="text-xs text-muted-foreground truncate">
              {subtitle}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
        </CardContent>
      </Card>
    </Link>
  )
}

// FormBadge / EfileBadge from tax-shared.tsx are intentionally re-exported
// downstream rather than wrapped here — see those primitives for the
// canonical badge palette.
export { FormBadge }
