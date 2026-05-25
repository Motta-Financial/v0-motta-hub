"use client"

import { useMemo, useState, useEffect } from "react"
import useSWR from "swr"
import {
  FileText,
  CheckCircle2,
  Clock,
  Filter as FilterIcon,
  Search as SearchIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
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
  fmtNumber,
  EmptyChartFallback,
} from "./tax-shared"

const FORM_OPTIONS = ["all", "1040", "1065", "1120", "1120S", "990"] as const

type UnifiedReturn = {
  id: string
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
  form: string
  efile_status: string | null
  preparer: string | null
  user_defined_status_name: string | null
  user_defined_status_color: string | null
  proconnect_modified_at: string | null
}

type Pagination = {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

type ReturnsResponse = {
  returns: UnifiedReturn[]
  stats: {
    totalReturns: number
    efiledCount: number
    pendingCount: number
    byForm: Record<string, { count: number }>
    byYear: Record<string, number>
  }
  pagination: Pagination
  availableYears: number[]
}

const fetcher = (u: string) =>
  fetch(u).then(async (r) => {
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<ReturnsResponse>
  })

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
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset to page 1 on search change
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [form, taxYear])

  const params = new URLSearchParams()
  params.set("form", form)
  params.set("page", String(page))
  if (taxYear !== "all") params.set("taxYear", taxYear)
  if (debouncedSearch) params.set("search", debouncedSearch)

  const { data, isLoading, error } = useSWR(
    `/api/tax/returns?${params.toString()}`,
    fetcher,
  )

  const availableYears = data?.availableYears ?? []

  // Form mix for pie chart
  const formMixData = useMemo(() => {
    if (!data?.stats?.byForm) return []
    return Object.entries(data.stats.byForm).map(([name, val]) => ({
      name,
      value: val.count,
    }))
  }, [data])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">Tax Returns</h1>
        <p className="text-sm text-muted-foreground">
          Unified view of every ProConnect return — individual (1040),
          partnership (1065), C-corp (1120), S-corp (1120S), and nonprofit (990)
          — with filing status and direct drill-in to each client&apos;s record.
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
          label="E-Filed"
          value={data ? fmtNumber(data.stats.efiledCount) : "—"}
          subtitle="Accepted / Complete"
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Pending / Not Filed"
          value={data ? fmtNumber(data.stats.pendingCount) : "—"}
          subtitle="Awaiting filing"
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="This Year"
          value={
            data && availableYears[0]
              ? fmtNumber(data.stats.byYear[String(availableYears[0])] ?? 0)
              : "—"
          }
          subtitle={availableYears[0] ? `Tax year ${availableYears[0]}` : ""}
          icon={FileText}
          tone="blue"
        />
      </div>

      {/* Chart: form mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-1">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">Form mix</h3>
            </div>
            {formMixData.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={formMixData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="#fff"
                    >
                      {formMixData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={FORM_COLOR[entry.name] || "#A8A29E"}
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
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChartFallback message="No returns yet" />
            )}
          </CardContent>
        </Card>

        {/* Year breakdown */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-stone-500" />
              <h3 className="text-sm font-semibold text-stone-900">
                Returns by tax year
              </h3>
            </div>
            {data && Object.keys(data.stats.byYear).length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {Object.entries(data.stats.byYear)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([year, count]) => (
                    <div
                      key={year}
                      className="text-center p-3 rounded-lg bg-stone-50 border border-stone-100"
                    >
                      <div className="text-lg font-semibold text-stone-900">
                        {fmtNumber(count)}
                      </div>
                      <div className="text-xs text-muted-foreground">{year}</div>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyChartFallback message="No year data" />
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
            {availableYears.slice(0, 6).map((y) => (
              <Button
                key={y}
                size="sm"
                variant={taxYear === String(y) ? "default" : "outline"}
                onClick={() => setTaxYear(String(y))}
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
              placeholder="Search by client, ID, or preparer…"
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
          ) : !data || data.returns.length === 0 ? (
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
                    <TableHead className="w-[160px]">Status</TableHead>
                    <TableHead className="w-[130px]">E-file</TableHead>
                    <TableHead className="w-[120px]">Preparer</TableHead>
                    <TableHead className="w-[140px]">Modified</TableHead>
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
                      <TableCell>
                        {r.user_defined_status_name ? (
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{
                              backgroundColor: r.user_defined_status_color
                                ? `${r.user_defined_status_color}20`
                                : undefined,
                              borderColor:
                                r.user_defined_status_color || undefined,
                              color: r.user_defined_status_color || undefined,
                            }}
                          >
                            {r.user_defined_status_name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <EfileBadge status={r.efile_status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.preparer || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {r.proconnect_modified_at
                          ? new Date(r.proconnect_modified_at).toLocaleDateString()
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

      {/* Pagination */}
      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <div className="text-sm text-muted-foreground">
            Showing {(page - 1) * data.pagination.pageSize + 1}–
            {Math.min(page * data.pagination.pageSize, data.pagination.totalCount)}{" "}
            of {fmtNumber(data.pagination.totalCount)} returns
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!data.pagination.hasPrev}
              className="h-8 px-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <div className="flex items-center gap-1 mx-2">
              {Array.from(
                { length: Math.min(5, data.pagination.totalPages) },
                (_, i) => {
                  let pageNum: number
                  if (data.pagination.totalPages <= 5) {
                    pageNum = i + 1
                  } else if (page <= 3) {
                    pageNum = i + 1
                  } else if (page >= data.pagination.totalPages - 2) {
                    pageNum = data.pagination.totalPages - 4 + i
                  } else {
                    pageNum = page - 2 + i
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={page === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      className="h-8 w-8 p-0"
                    >
                      {pageNum}
                    </Button>
                  )
                },
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
              disabled={!data.pagination.hasNext}
              className="h-8 px-2"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
