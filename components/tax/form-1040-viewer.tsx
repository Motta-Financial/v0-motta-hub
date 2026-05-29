"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import {
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  User,
  Building2,
  Calendar,
  Printer,
  Download,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Minus,
  Loader2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { fmtMoney, fmtNumber } from "@/components/tax/tax-shared"
import { cn } from "@/lib/utils"

type LineValue = {
  value: string | number | boolean | null
  line: {
    lineCode: string
    label: string
    shortLabel: string | null
    dataType: string
    section: string
    isComputed: boolean
    scheduleRef: string | null
    notes: string | null
  }
  source: "proconnect" | "computed" | "input"
}

type Form1040Response = {
  returnId: string
  taxYear: number
  clientName: string | null
  returnType: string | null
  version: number | null
  exportedAt: string | null
  lineCount: number
  mappedLineCount: number
  lines: Record<string, LineValue>
}

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    if (!r.ok) {
      const text = await r.text()
      throw new Error(text || `HTTP ${r.status}`)
    }
    return r.json() as Promise<Form1040Response>
  })

// Section display order and labels — keys match form_1040_lines.section
const CATEGORY_ORDER = [
  { key: "filing_status", label: "Filing Status" },
  { key: "digital_assets", label: "Digital Assets" },
  { key: "dependents", label: "Dependents" },
  { key: "income", label: "Income" },
  { key: "tax_credits", label: "Tax and Credits" },
  { key: "payments", label: "Payments" },
  { key: "refund", label: "Refund" },
  { key: "amount_owed", label: "Amount You Owe" },
  { key: "third_party", label: "Third Party Designee" },
  { key: "signature", label: "Sign Here" },
]

export function Form1040Viewer({
  returnId,
  taxYear = 2025,
  clientId,
}: {
  returnId: string
  taxYear?: number
  clientId?: string
}) {
  const { data, isLoading, error, mutate } = useSWR(
    `/api/forms/1040/${returnId}?taxYear=${taxYear}`,
    fetcher
  )
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Trigger a Phase 1 export from ProConnect, persist the snapshot, then
  // re-render the 1040 from the freshly cached cells. Lives here (not just
  // the API docs) so the "not exported yet" empty state is actionable.
  const handleExport = async () => {
    if (!clientId) return
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch(`/api/proconnect/returns/${returnId}/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      })
      const payload = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok) {
        const errObj = (payload as { error?: unknown }).error
        const kind =
          errObj && typeof errObj === "object"
            ? (errObj as { kind?: string }).kind
            : undefined
        if (kind === "scope_missing") {
          setExportError(
            "ProConnect hasn't granted this firm the tax-return data scope yet. An admin needs to re-consent before returns can be exported.",
          )
        } else if (typeof errObj === "string") {
          setExportError(errObj)
        } else if (errObj && typeof errObj === "object") {
          setExportError((errObj as { message?: string }).message || `Export failed (HTTP ${res.status})`)
        } else {
          setExportError(`Export failed (HTTP ${res.status})`)
        }
        return
      }
      // Snapshot + field cells persisted — refetch the rendered form.
      await mutate()
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed")
    } finally {
      setExporting(false)
    }
  }
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["income", "tax_credits", "payments", "refund", "amount_owed"])
  )
  const [showAllLines, setShowAllLines] = useState(false)

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Group lines by category
  const linesByCategory = useMemo(() => {
    if (!data?.lines) return new Map<string, LineValue[]>()

    const grouped = new Map<string, LineValue[]>()
    for (const [_, lineVal] of Object.entries(data.lines)) {
      const cat = lineVal.line.section
      if (!grouped.has(cat)) grouped.set(cat, [])
      grouped.get(cat)!.push(lineVal)
    }

    // Sort lines within each section by line code (numeric part, then suffix)
    for (const [_, lines] of grouped) {
      lines.sort((a, b) => {
        const numA = parseInt(a.line.lineCode.replace(/\D/g, "")) || 0
        const numB = parseInt(b.line.lineCode.replace(/\D/g, "")) || 0
        if (numA !== numB) return numA - numB
        return a.line.lineCode.localeCompare(b.line.lineCode)
      })
    }

    return grouped
  }, [data])

  // Key summary values
  const summaryValues = useMemo(() => {
    if (!data?.lines) return null
    const get = (ln: string) => {
      const v = data.lines[ln]?.value
      return typeof v === "number" ? v : null
    }
    return {
      totalIncome: get("9") || get("1z"),
      agi: get("11"),
      taxableIncome: get("15"),
      totalTax: get("24"),
      totalPayments: get("33"),
      refund: get("34") || get("35a"),
      amountOwed: get("37"),
    }
  }, [data])

  const handlePrint = () => {
    window.print()
  }

  if (error) {
    const isNotFound = error.message.includes("not found") || error.message.includes("404")
    return (
      <div className="min-h-screen bg-stone-50 p-6">
        <Card className={isNotFound ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}>
          <CardContent className="p-6 flex items-center gap-4">
            <AlertCircle className={cn("h-6 w-6", isNotFound ? "text-amber-700" : "text-rose-700")} />
            <div>
              <div className={cn("font-medium", isNotFound ? "text-amber-900" : "text-rose-900")}>
                {isNotFound ? "Return Data Not Available" : "Failed to Load Form 1040"}
              </div>
              <div className={cn("text-sm mt-1", isNotFound ? "text-amber-700" : "text-rose-700")}>
                {isNotFound
                  ? "This return hasn't been exported from ProConnect yet. Export it now to pull the latest return data into the Hub."
                  : error.message}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {isNotFound && clientId && (
                  <Button size="sm" onClick={handleExport} disabled={exporting}>
                    {exporting ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-1.5" />
                    )}
                    {exporting ? "Exporting from ProConnect…" : "Export from ProConnect"}
                  </Button>
                )}
                {clientId && (
                  <Link
                    href={`/tax/clients/${clientId}`}
                    className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
                  >
                    Return to client profile
                  </Link>
                )}
              </div>
              {exportError && (
                <div className="text-sm text-rose-700 mt-2" role="alert">
                  {exportError}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-stone-50 p-6 space-y-4">
        <Skeleton className="h-12 w-96" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-white border-b border-stone-200 print:static print:border-none">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-blue-100 text-blue-700 print:hidden">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Form 1040 — U.S. Individual Income Tax Return
                </h1>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    Tax Year {data.taxYear}
                  </span>
                  {data.clientName && (
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {data.clientName}
                    </span>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {data.mappedLineCount} of {data.lineCount} lines mapped
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1.5" />
                Print
              </Button>
              {clientId && (
                <Link href={`/tax/clients/${clientId}`}>
                  <Button variant="outline" size="sm">
                    <ExternalLink className="h-4 w-4 mr-1.5" />
                    Client Profile
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Summary card */}
        {summaryValues && (
          <Card className="print:shadow-none print:border-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Return Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <SummaryValue label="Total Income" value={summaryValues.totalIncome} line="9" />
                <SummaryValue label="AGI" value={summaryValues.agi} line="11" />
                <SummaryValue label="Taxable Income" value={summaryValues.taxableIncome} line="15" />
                <SummaryValue label="Total Tax" value={summaryValues.totalTax} line="24" />
                <SummaryValue label="Total Payments" value={summaryValues.totalPayments} line="33" />
                <SummaryValue
                  label="Refund"
                  value={summaryValues.refund}
                  line="34"
                  tone="emerald"
                />
                <SummaryValue
                  label="Amount Owed"
                  value={summaryValues.amountOwed}
                  line="37"
                  tone="rose"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* View controls */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpandedCategories(new Set(CATEGORY_ORDER.map((c) => c.key)))}
            >
              Expand All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpandedCategories(new Set())}
            >
              Collapse All
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAllLines}
              onChange={(e) => setShowAllLines(e.target.checked)}
              className="rounded border-stone-300"
            />
            Show lines with no value
          </label>
        </div>

        {/* Line categories */}
        <div className="space-y-3">
          {CATEGORY_ORDER.map(({ key, label }) => {
            const lines = linesByCategory.get(key) || []
            const visibleLines = showAllLines
              ? lines
              : lines.filter((l) => l.value !== null && l.value !== "")
            if (visibleLines.length === 0 && !showAllLines) return null

            const isExpanded = expandedCategories.has(key)
            const categoryTotal = lines.reduce((sum, l) => {
              if (l.line.dataType === "currency" && typeof l.value === "number") {
                return sum + l.value
              }
              return sum
            }, 0)

            return (
              <Card key={key} className="print:shadow-none print:border print:break-inside-avoid">
                <Collapsible open={isExpanded} onOpenChange={() => toggleCategory(key)}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-stone-50 transition-colors py-3 print:cursor-default print:hover:bg-transparent">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground print:hidden" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground print:hidden" />
                          )}
                          <CardTitle className="text-base">{label}</CardTitle>
                          <Badge variant="outline" className="text-xs">
                            {visibleLines.length} line{visibleLines.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        {categoryTotal !== 0 && (
                          <span className="text-sm font-medium tabular-nums">
                            {fmtMoney(categoryTotal)}
                          </span>
                        )}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="print:block">
                    <CardContent className="pt-0">
                      <div className="divide-y divide-stone-100">
                        {visibleLines.map((lineVal) => (
                          <LineRow key={lineVal.line.lineCode} lineVal={lineVal} />
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            )
          })}
        </div>

        {/* Footer / data provenance */}
        <footer className="text-xs text-muted-foreground pt-4 border-t border-stone-200 print:border-none">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Return ID: {data.returnId}</span>
            {data.version && <span>Version: {data.version}</span>}
            {data.exportedAt && (
              <span>Exported: {new Date(data.exportedAt).toLocaleString()}</span>
            )}
            <span>
              Source: ProConnect Phase 1 API ({data.mappedLineCount} mapped lines)
            </span>
          </div>
        </footer>
      </main>
    </div>
  )
}

// Summary value tile
function SummaryValue({
  label,
  value,
  line,
  tone = "stone",
}: {
  label: string
  value: number | null
  line: string
  tone?: "stone" | "emerald" | "rose"
}) {
  const hasValue = value !== null && value !== 0
  const toneClasses = {
    stone: "",
    emerald: hasValue ? "text-emerald-700" : "",
    rose: hasValue ? "text-rose-700" : "",
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
        <span className="ml-1 text-[10px] font-mono opacity-60">L{line}</span>
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", toneClasses[tone])}>
        {hasValue ? fmtMoney(value) : "—"}
      </div>
    </div>
  )
}

// Individual line row
function LineRow({ lineVal }: { lineVal: LineValue }) {
  const { line, value, source } = lineVal
  const hasValue = value !== null && value !== ""

  const formatValue = () => {
    if (value === null || value === "") return <span className="text-stone-400">—</span>

    switch (line.dataType) {
      case "currency":
        return (
          <span className="font-medium tabular-nums">
            {typeof value === "number" ? fmtMoney(value) : value}
          </span>
        )
      case "integer":
        return (
          <span className="font-medium tabular-nums">
            {typeof value === "number" ? fmtNumber(value) : value}
          </span>
        )
      case "boolean":
        return value ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <XCircle className="h-4 w-4 text-stone-400" />
        )
      case "ssn":
      case "ein":
        return <span className="font-mono text-sm">{String(value)}</span>
      default:
        return <span>{String(value)}</span>
    }
  }

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-2.5",
        !hasValue && "opacity-50"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground w-8 flex-shrink-0">
            {line.lineCode}
          </span>
          <span className="text-sm">{line.label}</span>
          {line.isComputed && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              computed
            </Badge>
          )}
          {line.scheduleRef && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {line.scheduleRef}
            </Badge>
          )}
        </div>
        {line.notes && (
          <div className="text-xs text-muted-foreground mt-0.5 ml-10 line-clamp-1">
            {line.notes}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-right min-w-[100px]">{formatValue()}</div>
    </div>
  )
}
