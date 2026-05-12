"use client"

import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ── Shared helpers ───────────────────────────────────────────────────
// The five Tax child pages all consume slightly different cuts of
// ProConnect data but share the same vocabulary for "money", "year",
// "status badge", and "KPI card". Centralizing those primitives here
// keeps the surfaces visually identical and lets us tune them in one
// place (e.g. a future request to change the badge palette).

export function fmtMoney(
  n: number | null | undefined,
  currency = "USD",
): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `$${Math.round(v).toLocaleString()}`
  }
}

// Compact money for chart axes and dense tables: $1.2k, $25k, $1.4M.
// Returns dollar amounts at most precision needed to be readable on a
// single line at ~50px width.
export function fmtMoneyCompact(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const sign = v < 0 ? "-" : ""
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`
  return `${sign}$${Math.round(abs)}`
}

export function fmtNumber(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return "—"
  return v.toLocaleString()
}

// ── KPI card ─────────────────────────────────────────────────────────
// Mirrors the Invoices / Payments / Proposals KPI card so the Tax
// pages feel like a peer surface, not a separate product. Tone is
// chosen by the page based on the metric's semantic — emerald for
// "won/refunded", rose for "owed/lost", amber for "pending", stone
// for neutral totals.
export function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone = "stone",
}: {
  label: string
  value: string
  subtitle?: string
  icon: LucideIcon
  tone?: "stone" | "emerald" | "amber" | "rose" | "blue"
}) {
  const toneStyles: Record<string, string> = {
    stone: "text-stone-900 bg-stone-100",
    emerald: "text-emerald-900 bg-emerald-100",
    amber: "text-amber-900 bg-amber-100",
    rose: "text-rose-900 bg-rose-100",
    blue: "text-blue-900 bg-blue-100",
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={cn("p-2 rounded-md", toneStyles[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </div>
          <div className="text-xl font-semibold tabular-nums truncate">
            {value}
          </div>
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

// ── Status / form badges ─────────────────────────────────────────────
// Each form gets a stable colour so a partner reading a mixed table
// can spot "this is a 1040 row" without parsing the form column.
const FORM_TONE: Record<string, string> = {
  "1040": "bg-blue-100 text-blue-900 border-blue-200",
  "1065": "bg-violet-100 text-violet-900 border-violet-200",
  "1120": "bg-indigo-100 text-indigo-900 border-indigo-200",
  "1120S": "bg-teal-100 text-teal-900 border-teal-200",
  "990": "bg-amber-100 text-amber-900 border-amber-200",
}

export function FormBadge({ form }: { form: string }) {
  const tone = FORM_TONE[form] || "bg-stone-100 text-stone-900 border-stone-200"
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", tone)}>
      {form}
    </Badge>
  )
}

// Coloured efile status badge. ProConnect uses status strings like
// "Accepted", "Rejected", "Pending", "Transmitted" — we map them to
// emerald/rose/amber/blue so the table reads at a glance. Unknown
// strings get the neutral stone treatment instead of being hidden.
export function EfileBadge({
  status,
}: {
  status: string | null | undefined
}) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-stone-500 border-stone-200">
        not filed
      </Badge>
    )
  }
  const lower = status.toLowerCase()
  let tone = "bg-stone-100 text-stone-900 border-stone-200"
  if (/accept|complete|filed/.test(lower))
    tone = "bg-emerald-100 text-emerald-900 border-emerald-200"
  else if (/reject|fail|error/.test(lower))
    tone = "bg-rose-100 text-rose-900 border-rose-200"
  else if (/pending|progress|review/.test(lower))
    tone = "bg-amber-100 text-amber-900 border-amber-200"
  else if (/transmit|sent/.test(lower))
    tone = "bg-blue-100 text-blue-900 border-blue-200"
  return (
    <Badge variant="outline" className={cn("text-[11px]", tone)}>
      {status}
    </Badge>
  )
}

// Empty-state for charts when there's no data in the filtered window.
// Keeps the card height stable so the dashboard doesn't reflow when a
// year filter excludes everything.
export function EmptyChartFallback({
  message,
  className,
}: {
  message: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "h-[200px] flex items-center justify-center text-sm text-muted-foreground",
        className,
      )}
    >
      {message}
    </div>
  )
}
