"use client"

import useSWR from "swr"
import { useState, useEffect } from "react"
import {
  Users,
  TrendingUp,
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
} from "./tax-shared"
import { cn } from "@/lib/utils"

type IndividualReturn = {
  id: string
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
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
  returns: IndividualReturn[]
  stats: {
    totalReturns: number
    efiledCount: number
    pendingCount: number
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

export function TaxIndividualClient() {
  const [taxYear, setTaxYear] = useState<string>("all")
  const [page, setPage] = useState(1)

  // Reset page when year changes
  useEffect(() => {
    setPage(1)
  }, [taxYear])

  const params = new URLSearchParams()
  params.set("form", "1040")
  params.set("page", String(page))
  if (taxYear !== "all") params.set("taxYear", taxYear)

  const { data, isLoading, error } = useSWR(
    `/api/tax/returns?${params.toString()}`,
    fetcher,
  )

  const availableYears = data?.availableYears ?? []

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900">
          Individual Tax (1040)
        </h1>
        <p className="text-sm text-muted-foreground">
          Form 1040 returns from ProConnect — filing status, refunds vs. balance
          due across the firm&apos;s individual clients.
        </p>
      </header>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="1040 Returns"
          value={data ? fmtNumber(data.stats.totalReturns) : "—"}
          subtitle="Individual tax returns"
          icon={Users}
          tone="stone"
        />
        <KpiCard
          label="E-Filed"
          value={data ? fmtNumber(data.stats.efiledCount) : "—"}
          subtitle="Accepted / Complete"
          icon={ArrowDownCircle}
          tone="emerald"
        />
        <KpiCard
          label="Pending"
          value={data ? fmtNumber(data.stats.pendingCount) : "—"}
          subtitle="Awaiting filing"
          icon={ArrowUpCircle}
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
          icon={TrendingUp}
          tone="blue"
        />
      </div>

      {/* Year filter */}
      <Card>
        <CardContent className="p-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-2">Tax Year:</span>
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
        </CardContent>
      </Card>

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
                    <TableHead className="w-[160px]">Status</TableHead>
                    <TableHead className="w-[120px]">E-file</TableHead>
                    <TableHead className="w-[110px]">Preparer</TableHead>
                    <TableHead className="w-[140px]">Modified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.returns.map((r) => (
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
