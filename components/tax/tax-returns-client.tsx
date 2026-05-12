"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  FileText,
  CheckCircle2,
  Clock,
  TrendingUp,
  DollarSign,
  Filter as FilterIcon,
  Search as SearchIcon,
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
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
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
  FormBadge,
  EfileBadge,
  fmtMoney,
  fmtMoneyCompact,
  fmtNumber,
  EmptyChartFallback,
} from "./tax-shared"
import { cn } from "@/lib/utils"

const FORM_OPTIONS = ["all", "1040", "1065", "1120", "1120S", "990"] as const

type UnifiedReturn = {
  id: string
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
  form: string
  return_status: string | null
  efile_status: string | null
  amended: boolean | null
  revenue: number | null
  income: number | null
  tax: number | null
  refund: number | null
  amount_owed: number | null
  updated_at: string | null
}

type ReturnsResponse = {
  returns: UnifiedReturn[]
  stats: {
    totalReturns: number
    totalRevenue: number
    totalIncome: number
    totalTax: number
    totalRefunds: number
    totalOwed: number
    byForm: Record<string, { count: number; revenue: number; income: number }>
    byYear: Record<string, number>
    byEfileStatus: Record<string, number>
  }
}

const fetcher = (u: string) =>
  fetch(u).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<ReturnsResponse>
  })

// Form pie palette — keeps the unified table's FormBadge consistent
// with the dashboard donut so a partner glancing at both sees the
// same colour vocabulary.
const FORM_COLOR: Record<string, string> = {
  "1040": "#3B82F6",
  "1065": "#8B5CF6",
  "1120": "#6366F1",
  "1120S": "#14B8A6",
  "990": "#F59E0B",
}

export function TaxReturnsClient() {
  const [form, setForm] = useState<(typeof FORM_OPTIONS)[number]>("all")
  const [taxYear, setTaxYear] = useState<string>("all")
  const [search, setSearch] = useState("")

  const params = new URLSearchParams()
  params.set("form", form)
  if (taxYear !== "all") params.set("taxYear", taxYear)

  const { data, isLoading, error } = useSWR(
    `/api/tax/returns?${params.toString()}`,
    fetcher,
  )

  // Client-side text filter — server already paginates, this just
  // narrows by name/PC id/form/status without a round trip.
  const filtered = useMemo(() => {
    if (!data?.returns) return []
    const q = search.trim().toLowerCase()
    if (!q) return data.returns
    return data.returns.filter((r) => {
      return (
        r.client_name?.toLowerCase().includes(q) ||
        r.proconnect_client_id?.toLowerCase().includes(q) ||
        r.form.toLowerCase().includes(q) ||
        r.efile_status?.toLowerCase().includes(q)
      )
    })
  }, [data, search])

  // Available years for the year filter chip — derived from the data
  // so we don't hardcode a year list that drifts as PC adds rows.
  const availableYears = useMemo(() => {
    if (!data?.stats?.byYear) return [] as string[]
    return Object.keys(data.stats.byYear)
      .filter((y) => y !== "(unknown)")
      .sort((a, b) => Number(b) - Number(a))
  }, [data])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">
          Tax Returns
        </h1>
        <p className="text-sm text-muted-foreground">
          Unified view of every ProConnect return — individual (1040),
          partnership (1065), C-corp (1120), S-corp (1120S), and nonprofit
          (990) — with filing status, financials, and direct drill-in to
          each client&apos;s record.
        </p>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Returns"
          value={data ? fmtNumber(data.stats.totalReturns) : "—"}
          subtitle={
            data
              ? `${Object.keys(data.stats.byForm).length} form type${
                  Object.keys(data.stats.byForm).length === 1 ? "" : "s"
                }`
              : ""
          }
          icon={FileText}
          tone="stone"
        />
        <KpiCard
          label="Filed (e-file accepted)"
          value={
            data
              ? fmtNumber(
                  Object.entries(data.stats.byEfileStatus)
                    .filter(([k]) => /accept|complete|filed/i.test(k))
                    .reduce((sum, [, v]) => sum + v, 0),
                )
              : "—"
          }
          subtitle="Accepted by IRS"
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Pending / Not Filed"
          value={
            data
              ? fmtNumber(
                  (data.stats.byEfileStatus["(not filed)"] || 0) +
                    Object.entries(data.stats.byEfileStatus)
                      .filter(([k]) => /pending|progress|review|transmit/i.test(k))
                      .reduce((sum, [, v]) => sum + v, 0),
                )
              : "—"
          }
          subtitle="Awaiting filing"
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="Total Tax (1040 + 1120)"
          value={data ? fmtMoney(data.stats.totalTax) : "—"}
          subtitle="Pass-through forms excluded"
          icon={DollarSign}
          tone="blue"
        />
      </div>

      {/* Charts strip — form mix and tax-year mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Revenue by form
              </h3>
              <span className="ml-auto text-xs text-muted-foreground">
                Total revenue across all returns
              </span>
            </div>
            {data && Object.keys(data.stats.byForm).length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={Object.entries(data.stats.byForm).map(([k, v]) => ({
                      form: k,
                      revenue: v.revenue,
                      count: v.count,
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
                    <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]}>
                      {Object.keys(data.stats.byForm).map((k) => (
                        <Cell key={k} fill={FORM_COLOR[k] || "#A8A29E"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChartFallback message="No returns in the filtered window" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">Form mix</h3>
            </div>
            {data && Object.keys(data.stats.byForm).length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(data.stats.byForm).map(([k, v]) => ({
                        name: k,
                        value: v.count,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="#fff"
                    >
                      {Object.keys(data.stats.byForm).map((k) => (
                        <Cell key={k} fill={FORM_COLOR[k] || "#A8A29E"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => `${v} return${v === 1 ? "" : "s"}`}
                      contentStyle={{
                        borderRadius: 6,
                        fontSize: 12,
                        border: "1px solid #E7E5E4",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChartFallback message="No returns yet" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filter row */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <FilterIcon className="h-4 w-4 text-stone-500 ml-1" />
          <div className="flex items-center gap-1">
            {FORM_OPTIONS.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={form === f ? "default" : "outline"}
                onClick={() => setForm(f)}
                className="h-7 px-2 text-xs"
              >
                {f === "all" ? "All forms" : f}
              </Button>
            ))}
          </div>
          <div className="h-5 w-px bg-stone-200 mx-1" />
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={taxYear === "all" ? "default" : "outline"}
              onClick={() => setTaxYear("all")}
              className="h-7 px-2 text-xs"
            >
              All years
            </Button>
            {availableYears.map((y) => (
              <Button
                key={y}
                size="sm"
                variant={taxYear === y ? "default" : "outline"}
                onClick={() => setTaxYear(y)}
                className="h-7 px-2 text-xs"
              >
                {y}
              </Button>
            ))}
          </div>
          <div className="relative ml-auto w-72">
            <SearchIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client, ID, or status…"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Returns table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && !data ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-700">
              Failed to load returns: {(error as Error).message}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No returns match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Form</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="w-[80px]">Year</TableHead>
                    <TableHead className="w-[130px]">E-file</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Income</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Refund</TableHead>
                    <TableHead className="text-right">Owed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <FormBadge form={r.form} />
                          {r.amended ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-amber-50 text-amber-900 border-amber-200"
                            >
                              amended
                            </Badge>
                          ) : null}
                        </div>
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
                      <TableCell>
                        <EfileBadge status={r.efile_status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMoneyCompact(r.revenue)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          r.income != null && r.income < 0
                            ? "text-rose-700"
                            : "",
                        )}
                      >
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
