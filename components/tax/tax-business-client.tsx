"use client"

import useSWR from "swr"
import { useMemo } from "react"
import {
  Building2,
  TrendingUp,
  DollarSign,
  Users,
  PieChart as PieChartIcon,
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
  FormBadge,
  EfileBadge,
  fmtMoney,
  fmtMoneyCompact,
  fmtNumber,
  EmptyChartFallback,
} from "./tax-shared"
import { cn } from "@/lib/utils"

// 1065 + 1120 + 1120S share the "business return" surface. Each form
// carries slightly different financials (1065 has partner capital
// movements, 1120 has officer compensation, 1120S has both), so we
// read the `raw` payload for form-specific cells. Pass-through forms
// (1065, 1120S) have no entity-level tax — the table renders "—" for
// those rather than implying $0 tax was owed.
type BusinessReturn = {
  id: string
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
  form: string
  efile_status: string | null
  amended: boolean | null
  revenue: number | null
  income: number | null
  tax: number | null
  refund: number | null
  amount_owed: number | null
  raw: {
    business_activity_code?: string | null
    k1_count?: number | null
    cost_of_goods_sold?: number | string | null
    gross_profit?: number | string | null
    total_deductions?: number | string | null
    depreciation?: number | string | null
    cash_distributions?: number | string | null
    partners_ending_capital?: number | string | null
    officer_compensation?: number | string | null
    compensation_of_officers?: number | string | null
    is_domestic_llc?: boolean | null
    is_domestic_general_partnership?: boolean | null
    is_domestic_limited_partnership?: boolean | null
    is_domestic_llp?: boolean | null
  }
}

const fetcher = (u: string) =>
  fetch(u).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<{
      returns: BusinessReturn[]
      stats: {
        totalReturns: number
        totalRevenue: number
        totalIncome: number
        totalTax: number
        byForm: Record<string, { count: number; revenue: number; income: number }>
      }
    }>
  })

const FORM_COLOR: Record<string, string> = {
  "1065": "#8B5CF6",
  "1120": "#6366F1",
  "1120S": "#14B8A6",
}

// Translate the four "is_domestic_*" boolean flags on a 1065 row into
// a single human entity-type label. Falls back to the form code when
// nothing's set.
function entityType(r: BusinessReturn): string {
  if (r.form === "1120") return "C-corp"
  if (r.form === "1120S") return "S-corp"
  if (r.raw.is_domestic_llc) return "LLC (1065)"
  if (r.raw.is_domestic_limited_partnership) return "LP"
  if (r.raw.is_domestic_general_partnership) return "GP"
  if (r.raw.is_domestic_llp) return "LLP"
  return r.form
}

export function TaxBusinessClient() {
  const { data, isLoading, error } = useSWR(
    "/api/tax/returns?form=business",
    fetcher,
  )

  const derived = useMemo(() => {
    const rows = data?.returns ?? []
    const totalK1s = rows.reduce((s, r) => s + (r.raw.k1_count ?? 0), 0)
    const totalDistributions = rows.reduce(
      (s, r) => s + Number(r.raw.cash_distributions ?? 0),
      0,
    )
    const totalDepreciation = rows.reduce(
      (s, r) => s + Number(r.raw.depreciation ?? 0),
      0,
    )

    const entityMix = new Map<string, number>()
    for (const r of rows) {
      const k = entityType(r)
      entityMix.set(k, (entityMix.get(k) ?? 0) + 1)
    }

    return {
      totalK1s,
      totalDistributions,
      totalDepreciation,
      entityMix: Array.from(entityMix.entries()).map(([name, value]) => ({
        name,
        value,
      })),
    }
  }, [data])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">
          Business Tax (1065 / 1120 / 1120S)
        </h1>
        <p className="text-sm text-muted-foreground">
          Partnership, C-corp, and S-corp returns from ProConnect — gross
          receipts, ordinary business income, K-1 counts, and entity-type
          distribution across the firm&apos;s business book.
        </p>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Business Returns"
          value={data ? fmtNumber(data.stats.totalReturns) : "—"}
          subtitle={
            data
              ? Object.entries(data.stats.byForm)
                  .map(([k, v]) => `${v.count} ${k}`)
                  .join(" · ")
              : ""
          }
          icon={Building2}
          tone="stone"
        />
        <KpiCard
          label="Total Gross Receipts"
          value={data ? fmtMoney(data.stats.totalRevenue) : "—"}
          subtitle="Across all business returns"
          icon={DollarSign}
          tone="emerald"
        />
        <KpiCard
          label="Ordinary Business Income"
          value={data ? fmtMoney(data.stats.totalIncome) : "—"}
          subtitle={
            data
              ? `${fmtMoney(derived.totalDistributions)} distributed to owners`
              : ""
          }
          icon={TrendingUp}
          tone={
            data && data.stats.totalIncome < 0 ? "rose" : "blue"
          }
        />
        <KpiCard
          label="K-1s Issued"
          value={data ? fmtNumber(derived.totalK1s) : "—"}
          subtitle={
            data
              ? `${derived.entityMix.length} entity type${
                  derived.entityMix.length === 1 ? "" : "s"
                }`
              : ""
          }
          icon={Users}
          tone="amber"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Gross receipts vs. ordinary income by form
              </h3>
            </div>
            {data && Object.keys(data.stats.byForm).length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={Object.entries(data.stats.byForm).map(([k, v]) => ({
                      form: k,
                      revenue: v.revenue,
                      income: v.income,
                    }))}
                    margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E7E5E4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="form"
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
                      name="Gross receipts"
                      fill="#6366F1"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="income"
                      name="Ordinary income"
                      fill="#14B8A6"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChartFallback message="No business returns yet" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <PieChartIcon className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Entity types
              </h3>
            </div>
            {data && derived.entityMix.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={derived.entityMix}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="#fff"
                    >
                      {derived.entityMix.map((entry, idx) => {
                        const palette = [
                          "#6366F1",
                          "#14B8A6",
                          "#8B5CF6",
                          "#F59E0B",
                          "#EC4899",
                        ]
                        return (
                          <Cell
                            key={entry.name}
                            fill={palette[idx % palette.length]}
                          />
                        )
                      })}
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
              <EmptyChartFallback message="No entity data" />
            )}
          </CardContent>
        </Card>
      </div>

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
              No business returns yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Form</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead className="w-[80px]">Year</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-[100px]">NAICS</TableHead>
                    <TableHead className="w-[120px]">E-file</TableHead>
                    <TableHead className="text-right">Gross receipts</TableHead>
                    <TableHead className="text-right">Ord. income</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Distributions</TableHead>
                    <TableHead className="text-right">K-1s</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.returns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <FormBadge form={r.form} />
                      </TableCell>
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
                      <TableCell className="tabular-nums">
                        {r.tax_year ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{entityType(r)}</TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {r.raw.business_activity_code || "—"}
                      </TableCell>
                      <TableCell>
                        <EfileBadge status={r.efile_status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMoneyCompact(r.revenue)}
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
                        {/* Pass-through (1065, 1120S) has no entity tax */}
                        {r.tax != null ? fmtMoneyCompact(r.tax) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-blue-700">
                        {r.raw.cash_distributions != null
                          ? fmtMoneyCompact(Number(r.raw.cash_distributions))
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.raw.k1_count ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
