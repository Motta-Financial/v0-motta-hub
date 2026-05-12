"use client"

import useSWR from "swr"
import { useMemo } from "react"
import { Landmark, TrendingUp, DollarSign, Wallet, ArrowDown } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
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

// ── 990 row shape ────────────────────────────────────────────────────
// Form 990 has three return_subtypes: full 990, 990-EZ, and 990-PF
// (private foundation). The PF subtype is the only one with an
// entity-level tax (excise tax on net investment income), and the EZ
// subtype has its own set of revenue/expense columns. We surface all
// three on the table, gracefully showing — for fields a row doesn't
// have.
type NonprofitReturn = {
  id: string
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
  efile_status: string | null
  amended: boolean | null
  revenue: number | null // total_revenue
  income: number | null // revenue_less_expenses (operating surplus)
  tax: number | null // pf_tax_due (PF only)
  raw: {
    return_subtype?: string | null
    ein?: string | null
    total_expenses?: number | string | null
    total_assets_end?: number | string | null
    total_liabilities_end?: number | string | null
    net_assets_end?: number | string | null
    ez_total_revenue?: number | string | null
    ez_total_expenses?: number | string | null
    ez_net_assets_end?: number | string | null
    pf_net_assets_end?: number | string | null
  }
}

const fetcher = (u: string) =>
  fetch(u).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<{
      returns: NonprofitReturn[]
      stats: { totalReturns: number; totalRevenue: number; totalIncome: number }
    }>
  })

export function TaxNonprofitClient() {
  const { data, isLoading, error } = useSWR(
    "/api/tax/returns?form=990",
    fetcher,
  )

  const derived = useMemo(() => {
    const rows = data?.returns ?? []
    const totalExpenses = rows.reduce(
      (s, r) => s + Number(r.raw.total_expenses ?? r.raw.ez_total_expenses ?? 0),
      0,
    )
    const totalNetAssets = rows.reduce(
      (s, r) =>
        s +
        Number(
          r.raw.net_assets_end ??
            r.raw.ez_net_assets_end ??
            r.raw.pf_net_assets_end ??
            0,
        ),
      0,
    )
    // Expense ratio per org for the bar chart.
    const expenseChart = rows
      .map((r) => {
        const exp = Number(
          r.raw.total_expenses ?? r.raw.ez_total_expenses ?? 0,
        )
        return {
          name: (r.client_name || "—").slice(0, 24),
          revenue: r.revenue ?? 0,
          expenses: exp,
        }
      })
      .filter((d) => d.revenue > 0 || d.expenses > 0)

    return { totalExpenses, totalNetAssets, expenseChart }
  }, [data])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">
          Nonprofit Tax (990)
        </h1>
        <p className="text-sm text-muted-foreground">
          Form 990 returns from ProConnect — revenue, expenses, net assets,
          and operating surplus for nonprofit clients. Includes 990, 990-EZ,
          and 990-PF (private foundation) subtypes.
        </p>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="990 Returns"
          value={data ? fmtNumber(data.stats.totalReturns) : "—"}
          subtitle="Tax-exempt organizations"
          icon={Landmark}
          tone="stone"
        />
        <KpiCard
          label="Total Revenue"
          value={data ? fmtMoney(data.stats.totalRevenue) : "—"}
          subtitle="Across all 990 filers"
          icon={DollarSign}
          tone="emerald"
        />
        <KpiCard
          label="Total Expenses"
          value={data ? fmtMoney(derived.totalExpenses) : "—"}
          subtitle={
            data && data.stats.totalRevenue > 0
              ? `${Math.round(
                  (derived.totalExpenses / data.stats.totalRevenue) * 100,
                )}% of revenue`
              : ""
          }
          icon={ArrowDown}
          tone="amber"
        />
        <KpiCard
          label="Total Net Assets"
          value={data ? fmtMoney(derived.totalNetAssets) : "—"}
          subtitle={
            data
              ? `Operating surplus: ${fmtMoney(data.stats.totalIncome)}`
              : ""
          }
          icon={Wallet}
          tone="blue"
        />
      </div>

      {/* Chart: revenue vs. expenses by org */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">
              Revenue vs. expenses
            </h3>
            <span className="ml-auto text-xs text-muted-foreground">
              Per nonprofit organization
            </span>
          </div>
          {derived.expenseChart.length > 0 ? (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={derived.expenseChart}
                  margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#E7E5E4"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtMoneyCompact(v as number)}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                  />
                  <Tooltip
                    formatter={(v: number) => fmtMoney(v)}
                    contentStyle={{
                      borderRadius: 6,
                      fontSize: 12,
                      border: "1px solid #E7E5E4",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    fill="#059669"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Expenses"
                    fill="#F59E0B"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChartFallback message="No 990 returns yet" />
          )}
        </CardContent>
      </Card>

      {/* Returns Table */}
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
              No 990 returns yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead className="w-[100px]">EIN</TableHead>
                    <TableHead className="w-[100px]">Subtype</TableHead>
                    <TableHead className="w-[80px]">Year</TableHead>
                    <TableHead className="w-[120px]">E-file</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Surplus</TableHead>
                    <TableHead className="text-right">Net assets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.returns.map((r) => {
                    const expenses = Number(
                      r.raw.total_expenses ?? r.raw.ez_total_expenses ?? 0,
                    )
                    const netAssets = Number(
                      r.raw.net_assets_end ??
                        r.raw.ez_net_assets_end ??
                        r.raw.pf_net_assets_end ??
                        0,
                    )
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium text-stone-900 text-sm">
                            {r.client_name || "—"}
                          </div>
                          {r.proconnect_client_id ? (
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {r.proconnect_client_id}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {r.raw.ein || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-amber-50 text-amber-900 border-amber-200"
                          >
                            {r.raw.return_subtype || "990"}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {r.tax_year ?? "—"}
                        </TableCell>
                        <TableCell>
                          <EfileBadge status={r.efile_status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtMoneyCompact(r.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {expenses > 0 ? fmtMoneyCompact(expenses) : "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-medium",
                            r.income != null && r.income < 0
                              ? "text-rose-700"
                              : "text-emerald-700",
                          )}
                        >
                          {fmtMoneyCompact(r.income)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {netAssets > 0 ? fmtMoneyCompact(netAssets) : "—"}
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
