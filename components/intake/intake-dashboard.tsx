"use client"

/**
 * Intake Dashboard — analytics view of the Jotform intake pipeline.
 *
 * The /sales/intake page is the operational queue (one row per
 * submission, triage controls, search). This dashboard answers the
 * "what's happening?" questions a partner asks each week:
 *   • how many submissions came in this month vs the trailing 12,
 *   • where are leads stuck in the funnel,
 *   • which services / states / referrers / professionals dominate.
 *
 * Data source: GET /api/jotform/intake/dashboard (server-aggregated).
 *
 * Design notes:
 *   • Solid colors only — no gradients. Brand greens reserved for
 *     conversion-positive series (Converted, Linked).
 *   • Every chart is keyboard-focusable via its parent <Card>.
 *   • Lists at the bottom are click-through filters — clicking a row
 *     deep-links to /sales/intake?<param>=<value> with the matching
 *     filter pre-applied.
 */

import useSWR from "swr"
import Link from "next/link"
import { useMemo } from "react"
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Inbox,
  Link2,
  RefreshCw,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Bucket {
  key: string
  count: number
}

interface DashboardPayload {
  totals: {
    total: number
    new: number
    contacted: number
    qualified: number
    converted: number
    declined: number
    linkedToClient: number
    withKarbonWorkItem: number
    thisMonth: number
    last30: number
  }
  byStatus: Bucket[]
  byFocus: Bucket[]
  byState: Bucket[]
  byService: Bucket[]
  byReferral: Bucket[]
  byMonth: Bucket[]
  byProfessional: Array<{ id: string; name: string; count: number }>
}

// Solid brand-aligned palette. Index 0 is the primary brand olive,
// the rest are supporting neutrals + a single accent. Keeping the
// list short prevents accidental rainbow charts.
const PALETTE = ["#A8C566", "#5b7028", "#0f172a", "#64748b", "#e2e8f0"]

const STATUS_COLOR: Record<string, string> = {
  new: "#f59e0b",
  contacted: "#3b82f6",
  qualified: "#8b5cf6",
  converted: "#A8C566",
  declined: "#94a3b8",
}

const FOCUS_LABEL = (key: string) =>
  key === "Both Personal & Business" ? "Both" : key.replace(" Only", "")

const MONTH_LABEL = (key: string) => {
  // key is YYYY-MM
  const [y, m] = key.split("-")
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString("en-US", { month: "short" })
}

export function IntakeDashboard() {
  const { data, isLoading, mutate } = useSWR<DashboardPayload>(
    "/api/jotform/intake/dashboard",
    fetcher,
    { refreshInterval: 60_000 },
  )

  const conversionRate = useMemo(() => {
    if (!data?.totals?.total) return 0
    return Math.round((data.totals.converted / data.totals.total) * 100)
  }, [data])

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance">
            Intake Dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
            A live view of every prospect submitting the Motta intake form on{" "}
            <span className="font-medium text-foreground">mottafinancial.com/intake-form</span>.
            Use the queue at <Link href="/sales/intake" className="underline underline-offset-2">/sales/intake</Link>{" "}
            to action individual rows.
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

      {/* ───────────────── KPIs ───────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="All-time submissions"
          value={data?.totals.total ?? 0}
          icon={Inbox}
          accent="text-foreground"
        />
        <KpiCard
          label="This month"
          value={data?.totals.thisMonth ?? 0}
          icon={TrendingUp}
          accent="text-sky-600"
        />
        <KpiCard
          label="Conversion rate"
          value={`${conversionRate}%`}
          icon={Target}
          accent="text-[#5b7028]"
          subtitle={`${data?.totals.converted ?? 0} converted`}
        />
        <KpiCard
          label="Linked to client"
          value={data?.totals.linkedToClient ?? 0}
          icon={Link2}
          accent="text-emerald-600"
          subtitle={`${(data?.totals.total ?? 0) - (data?.totals.linkedToClient ?? 0)} unlinked`}
        />
      </div>

      {/* ───────────────── Inflow + Funnel ───────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">
              Submissions — last 12 months
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(data?.byMonth ?? []).map((b) => ({
                    month: MONTH_LABEL(b.key),
                    Submissions: b.count,
                  }))}
                  margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Submissions"
                    stroke="#A8C566"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#5b7028" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {(["new", "contacted", "qualified", "converted", "declined"] as const).map((s) => {
                const v = data?.totals[s] ?? 0
                const total = Math.max(data?.totals.total ?? 0, 1)
                const pct = Math.round((v / total) * 100)
                return (
                  <li key={s}>
                    <Link
                      href={`/sales/intake?status=${s}`}
                      className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground"
                    >
                      <span className="capitalize">{s}</span>
                      <span className="tabular-nums">
                        {v} <span className="text-muted-foreground/70">· {pct}%</span>
                      </span>
                    </Link>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: STATUS_COLOR[s],
                        }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ───────────────── Service mix + Focus ───────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">Top services requested</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(data?.byService ?? []).map((b) => ({
                    service: b.key.length > 28 ? `${b.key.slice(0, 26)}…` : b.key,
                    full: b.key,
                    count: b.count,
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                >
                  <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="service"
                    width={170}
                    tick={{ fontSize: 12, fill: "#0f172a" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                    formatter={(value: number, _name, props) => [value, props.payload?.full]}
                    labelFormatter={() => ""}
                  />
                  <Bar dataKey="count" fill="#A8C566" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Service focus</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(data?.byFocus ?? []).map((b) => ({
                      name: FOCUS_LABEL(b.key),
                      value: b.count,
                    }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {(data?.byFocus ?? []).map((_b, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {(data?.byFocus ?? []).map((b, i) => (
                <li key={b.key} className="flex items-center justify-between">
                  <Link
                    href={`/sales/intake?focus=${encodeURIComponent(b.key)}`}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                    />
                    {FOCUS_LABEL(b.key)}
                  </Link>
                  <span className="tabular-nums text-foreground">{b.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ───────────────── Top lists ───────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ListCard
          title="Top states"
          items={data?.byState ?? []}
          hrefFor={(k) => `/sales/intake?state=${encodeURIComponent(k)}`}
          isLoading={isLoading}
        />
        <ListCard
          title="Top referral sources"
          items={data?.byReferral ?? []}
          hrefFor={(k) => `/sales/intake?referral=${encodeURIComponent(k)}`}
          isLoading={isLoading}
        />
        <ListCard
          title="Most-requested professionals"
          items={(data?.byProfessional ?? []).map((p) => ({ key: p.name, count: p.count, id: p.id }))}
          hrefFor={(_k, item) =>
            item && "id" in item && item.id
              ? `/sales/intake?professional=${item.id}`
              : "/sales/intake"
          }
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardContent className="flex items-center justify-between p-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-[#5b7028]" />
            {data?.totals.withKarbonWorkItem ?? 0} of {data?.totals.total ?? 0} submissions have a Karbon work item.
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link href="/sales/intake">
              Open queue
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
  subtitle,
}: {
  label: string
  value: number | string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  subtitle?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md bg-muted", accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          {subtitle && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

function ListCard({
  title,
  items,
  hrefFor,
  isLoading,
}: {
  title: string
  items: Array<Bucket & { id?: string }>
  hrefFor: (key: string, item?: Bucket & { id?: string }) => string
  isLoading: boolean
}) {
  const total = items.reduce((s, b) => s + b.count, 0) || 1
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((b) => {
              const pct = Math.round((b.count / total) * 100)
              return (
                <li key={b.key}>
                  <Link
                    href={hrefFor(b.key, b)}
                    className="flex items-center justify-between text-sm hover:text-foreground"
                  >
                    <span className="truncate pr-2 text-foreground">{b.key}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {b.count}
                      <span className="ml-1 text-muted-foreground/70">{pct}%</span>
                    </span>
                  </Link>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#A8C566]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
