"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fmtMoneyCompact } from "@/components/tax/tax-shared"

/**
 * Multi-year financial trend chart for the Tax Profile.
 *
 * The Tax Profile API returns parallel `Record<year, value>` maps for
 * income / AGI / total tax / refund. We merge those into a single
 * sorted series and render an AreaChart so a partner can see the
 * client's financial trajectory at a glance — the same shape Motta
 * already uses on /tax/overview's "Returns by year" chart, kept
 * deliberately consistent so the two surfaces feel like one product.
 *
 * Color rules: stone is the neutral total-income baseline; blue is
 * AGI (matches /tax/individual); rose is total tax (negative
 * connotation); emerald is refund (positive). We intentionally
 * stay inside the existing 5-color tax palette — no new colors.
 */
export function TaxFinancialTrendChart({
  incomeTrend,
  agiTrend,
  taxTrend,
  refundTrend,
}: {
  incomeTrend: Record<string, number>
  agiTrend: Record<string, number>
  taxTrend: Record<string, number>
  refundTrend: Record<string, number>
}) {
  // Merge year keys from all four series so partial data still graphs.
  const years = Array.from(
    new Set([
      ...Object.keys(incomeTrend),
      ...Object.keys(agiTrend),
      ...Object.keys(taxTrend),
      ...Object.keys(refundTrend),
    ]),
  )
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b)

  if (years.length < 2) {
    // One data point doesn't make a trend — fall back to a small
    // numeric grid so the section never feels empty.
    return null
  }

  const data = years.map((year) => ({
    year: String(year),
    income: incomeTrend[year] ?? null,
    agi: agiTrend[year] ?? null,
    tax: taxTrend[year] ?? null,
    refund: refundTrend[year] ?? null,
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Multi-Year Financial Trend</CardTitle>
        <p className="text-xs text-muted-foreground">
          Income, AGI, total tax, and refund by tax year — sourced from
          ProConnect 1040 filings.
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="fillIncome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#78716c" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#78716c" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillAgi" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillTax" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillRefund" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#78716c" />
              <YAxis
                tickFormatter={(v) => fmtMoneyCompact(v)}
                tick={{ fontSize: 12 }}
                stroke="#78716c"
                width={70}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  fmtMoneyCompact(value),
                  name,
                ]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #e7e5e4",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="income"
                name="Total Income"
                stroke="#78716c"
                fill="url(#fillIncome)"
                strokeWidth={2}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="agi"
                name="AGI"
                stroke="#3b82f6"
                fill="url(#fillAgi)"
                strokeWidth={2}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="tax"
                name="Total Tax"
                stroke="#f43f5e"
                fill="url(#fillTax)"
                strokeWidth={2}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="refund"
                name="Refund"
                stroke="#10b981"
                fill="url(#fillRefund)"
                strokeWidth={2}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
