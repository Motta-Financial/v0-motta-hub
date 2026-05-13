"use client"

import useSWR from "swr"
import { useMemo } from "react"
import {
  Users,
  TrendingUp,
  DollarSign,
  ArrowDownCircle,
  ArrowUpCircle,
  Receipt,
} from "lucide-react"
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
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  KpiCard,
  EfileBadge,
  fmtMoney,
  fmtMoneyCompact,
  fmtNumber,
  EmptyChartFallback,
} from "./tax-shared"
import { cn } from "@/lib/utils"

// ── 1040-specific row shape ──────────────────────────────────────────
// We need fields the unified shape doesn't carry — filing_status, the
// schedule flags, dependent counts — so we read the `raw` payload that
// the API tucks onto every row. Wrapping it in a typed accessor keeps
// the rest of the component honest about which columns it touches.
type IndividualReturn = {
  id: string
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
  efile_status: string | null
  amended: boolean | null
  preparer: string | null
  revenue: number | null // wages_salaries_tips
  income: number | null // AGI
  tax: number | null // total_tax
  refund: number | null
  amount_owed: number | null
  raw: {
    filing_status?: string | null
    taxpayer_occupation?: string | null
    taxable_income?: number | string | null
    federal_tax_withheld?: number | string | null
    qualified_business_income_deduction?: number | string | null
    total_itemized_or_standard_deduction?: number | string | null
    has_schedule_c?: boolean | null
    has_schedule_e?: boolean | null
    qualifying_children_count?: number | null
    other_dependents_count?: number | null
  }
}

const fetcher = (u: string) =>
  fetch(u).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<{
      returns: IndividualReturn[]
      stats: { totalReturns: number; totalRefunds: number; totalTax: number; totalOwed: number }
    }>
  })

const FILING_STATUS_COLOR: Record<string, string> = {
  "Married filing jointly": "#3B82F6",
  "Single": "#14B8A6",
  "Head of household": "#8B5CF6",
  "Married filing separately": "#F59E0B",
  "Qualifying widow(er)": "#EC4899",
}

export function TaxIndividualClient() {
  const { data, isLoading, error } = useSWR(
    "/api/tax/returns?form=1040",
    fetcher,
  )

  // Derived metrics. Only 1040s carry filing_status, schedule flags
  // and dependents, so we calculate them here rather than asking the
  // generic returns endpoint to special-case the individual form.
  const derived = useMemo(() => {
    const rows = data?.returns ?? []
    const refundCount = rows.filter((r) => (r.refund ?? 0) > 0).length
    const oweCount = rows.filter((r) => (r.amount_owed ?? 0) > 0).length
    const avgRefund =
      refundCount > 0
        ? rows.reduce((s, r) => s + (r.refund ?? 0), 0) / refundCount
        : 0
    const avgAgi =
      rows.length > 0
        ? rows.reduce((s, r) => s + (r.income ?? 0), 0) / rows.length
        : 0
    const totalDependents = rows.reduce(
      (s, r) =>
        s +
        (r.raw.qualifying_children_count ?? 0) +
        (r.raw.other_dependents_count ?? 0),
      0,
    )
    const scheduleC = rows.filter((r) => r.raw.has_schedule_c).length
    const scheduleE = rows.filter((r) => r.raw.has_schedule_e).length

    // Filing-status mix for the donut.
    const filingMix = new Map<string, number>()
    for (const r of rows) {
      const fs = r.raw.filing_status ?? "(unknown)"
      filingMix.set(fs, (filingMix.get(fs) ?? 0) + 1)
    }

    // Refund vs. balance-due histogram. We bin in $5k buckets up to
    // $25k, then a final "$25k+" bucket — chosen by inspecting the
    // current data so most rows fall in the first 3 buckets.
    type Bin = { label: string; refunds: number; owed: number }
    const bins: Bin[] = [
      { label: "$0", refunds: 0, owed: 0 },
      { label: "$0–5k", refunds: 0, owed: 0 },
      { label: "$5k–10k", refunds: 0, owed: 0 },
      { label: "$10k–25k", refunds: 0, owed: 0 },
      { label: "$25k+", refunds: 0, owed: 0 },
    ]
    function placeBin(amount: number, key: "refunds" | "owed") {
      const a = Math.abs(amount)
      let idx = 0
      if (a === 0) idx = 0
      else if (a <= 5_000) idx = 1
      else if (a <= 10_000) idx = 2
      else if (a <= 25_000) idx = 3
      else idx = 4
      bins[idx][key] += 1
    }
    for (const r of rows) {
      if ((r.refund ?? 0) > 0) placeBin(r.refund ?? 0, "refunds")
      else if ((r.amount_owed ?? 0) > 0) placeBin(r.amount_owed ?? 0, "owed")
    }

    return {
      refundCount,
      oweCount,
      avgRefund,
      avgAgi,
      totalDependents,
      scheduleC,
      scheduleE,
      filingMix: Array.from(filingMix.entries()).map(([name, value]) => ({
        name,
        value,
      })),
      bins,
    }
  }, [data])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">
          Individual Tax (1040)
        </h1>
        <p className="text-sm text-muted-foreground">
          Form 1040 returns from ProConnect — AGI, filing status, refunds vs.
          balance due, and schedule C / E activity across the firm&apos;s
          individual clients.
        </p>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="1040 Returns"
          value={data ? fmtNumber(data.stats.totalReturns) : "—"}
          subtitle={
            data
              ? `${derived.totalDependents.toLocaleString()} dependents claimed`
              : ""
          }
          icon={Users}
          tone="stone"
        />
        <KpiCard
          label="Total Refunds Issued"
          value={data ? fmtMoney(data.stats.totalRefunds) : "—"}
          subtitle={
            data
              ? `${derived.refundCount} clients · avg ${fmtMoneyCompact(derived.avgRefund)}`
              : ""
          }
          icon={ArrowDownCircle}
          tone="emerald"
        />
        <KpiCard
          label="Total Owed"
          value={data ? fmtMoney(data.stats.totalOwed) : "—"}
          subtitle={data ? `${derived.oweCount} clients owe` : ""}
          icon={ArrowUpCircle}
          tone="rose"
        />
        <KpiCard
          label="Average AGI"
          value={data ? fmtMoney(derived.avgAgi) : "—"}
          subtitle={
            data
              ? `${derived.scheduleC} Sch C · ${derived.scheduleE} Sch E`
              : ""
          }
          icon={TrendingUp}
          tone="blue"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Receipt className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Refunds vs. balance due
              </h3>
              <span className="ml-auto text-xs text-muted-foreground">
                Client counts by amount bucket
              </span>
            </div>
            {data && data.returns.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={derived.bins}
                    margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E7E5E4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 6,
                        fontSize: 12,
                        border: "1px solid #E7E5E4",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                    <Bar
                      dataKey="refunds"
                      name="Refunds"
                      fill="#059669"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="owed"
                      name="Owed"
                      fill="#E11D48"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChartFallback message="No 1040 returns yet" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Filing status mix
              </h3>
            </div>
            {data && derived.filingMix.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={derived.filingMix}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="#fff"
                    >
                      {derived.filingMix.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={FILING_STATUS_COLOR[entry.name] || "#A8A29E"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) =>
                        `${v} return${v === 1 ? "" : "s"}`
                      }
                      contentStyle={{
                        borderRadius: 6,
                        fontSize: 12,
                        border: "1px solid #E7E5E4",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChartFallback message="No filing-status data" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 1040 Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && !data ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-700">
              Failed to load returns: {(error as Error).message}
            </div>
          ) : !data || data.returns.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No 1040 returns yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Taxpayer</TableHead>
                    <TableHead className="w-[80px]">Year</TableHead>
                    <TableHead>Filing status</TableHead>
                    <TableHead className="w-[120px]">E-file</TableHead>
                    <TableHead className="w-[110px]">Preparer</TableHead>
                    <TableHead className="text-right">Wages</TableHead>
                    <TableHead className="text-right">AGI</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Refund</TableHead>
                    <TableHead className="text-right">Owed</TableHead>
                    <TableHead className="text-center">Sch C/E</TableHead>
                    <TableHead className="text-center">Deps</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.returns.map((r) => {
                    const deps =
                      (r.raw.qualifying_children_count ?? 0) +
                      (r.raw.other_dependents_count ?? 0)
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium text-stone-900 text-sm">
                            {r.client_name || "—"}
                          </div>
                          {r.raw.taxpayer_occupation ? (
                            <div className="text-[11px] text-muted-foreground">
                              {r.raw.taxpayer_occupation}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {r.tax_year ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.raw.filing_status || "—"}
                        </TableCell>
                        <TableCell>
                          <EfileBadge status={r.efile_status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.preparer || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtMoneyCompact(r.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmtMoneyCompact(r.income)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtMoneyCompact(r.tax)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {r.refund != null ? fmtMoneyCompact(r.refund) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-rose-700">
                          {r.amount_owed != null
                            ? fmtMoneyCompact(r.amount_owed)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          <div className="flex justify-center gap-1">
                            {r.raw.has_schedule_c ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-violet-50 text-violet-900 border-violet-200"
                              >
                                C
                              </Badge>
                            ) : null}
                            {r.raw.has_schedule_e ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-indigo-50 text-indigo-900 border-indigo-200"
                              >
                                E
                              </Badge>
                            ) : null}
                            {!r.raw.has_schedule_c && !r.raw.has_schedule_e ? (
                              <span className="text-stone-300">—</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-center tabular-nums",
                            deps > 0 ? "text-stone-900 font-medium" : "text-stone-300",
                          )}
                        >
                          {deps > 0 ? deps : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
