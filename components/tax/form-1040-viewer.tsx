"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import {
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  User,
  Calendar,
  Printer,
  Download,
  ExternalLink,
  CheckCircle2,
  Minus,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { fmtMoney, fmtNumber } from "@/components/tax/tax-shared"
import { cn } from "@/lib/utils"

type MaskedValue = {
  masked: true
  last4: string
  length: number
}

type LineValue = {
  value: string | number | boolean | MaskedValue | null
  line: {
    lineCode: string
    label: string
    shortLabel: string | null
    dataType: string
    section: string
    isComputed: boolean
    notApplicable?: boolean
    scheduleRef: string | null
    notes: string | null
  }
  source: "proconnect" | "computed" | "input" | "estimated"
  confidence?: "unknown" | "inferred" | "confirmed"
  decodeMissing?: boolean
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
  computedLineCount?: number
  estimatedLineCount?: number
  lines: Record<string, LineValue>
}

function isMasked(value: LineValue["value"]): value is MaskedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as MaskedValue).masked === true
  )
}

/** Masked display string per data type. Bullets sized from length, capped at 8. */
function maskedDisplay(dataType: string, mv: MaskedValue): string {
  if (dataType === "ssn") return `•••-••-${mv.last4}`
  if (dataType === "ein") return `••-•••${mv.last4}`
  const bulletCount = Math.min(Math.max((mv.length ?? 8) - mv.last4.length, 2), 8)
  return `${"•".repeat(bulletCount)}${mv.last4}`
}

const INFERRED_TOOLTIP =
  "Mapping inferred from Intuit field descriptions — not yet verified against a real return."

const REVEAL_TIMEOUT_MS = 30_000

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

  // -------------------------------------------------------------------
  // Sensitive-field reveal state. Revealed raw values live ONLY in this
  // component's state — never in the SWR cache, never in localStorage.
  // Each reveal is a POST to the audited /reveal endpoint and auto
  // re-masks after 30 seconds.
  // -------------------------------------------------------------------
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})
  const [revealingLines, setRevealingLines] = useState<Set<string>>(new Set())
  const [showSensitive, setShowSensitive] = useState(false)
  const revealTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const maskLine = useCallback((lineCode: string) => {
    setRevealedValues((prev) => {
      if (!(lineCode in prev)) return prev
      const next = { ...prev }
      delete next[lineCode]
      return next
    })
    const timer = revealTimers.current.get(lineCode)
    if (timer) {
      clearTimeout(timer)
      revealTimers.current.delete(lineCode)
    }
  }, [])

  const revealLine = useCallback(
    async (lineCode: string) => {
      setRevealingLines((prev) => new Set(prev).add(lineCode))
      try {
        const res = await fetch(`/api/forms/1040/${returnId}/reveal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineCode, taxYear }),
        })
        if (!res.ok) return
        const payload = (await res.json()) as { value: string | number | null }
        setRevealedValues((prev) => ({
          ...prev,
          [lineCode]: payload.value === null ? "" : String(payload.value),
        }))
        // Auto re-mask after 30s. Reset any existing timer.
        const existing = revealTimers.current.get(lineCode)
        if (existing) clearTimeout(existing)
        revealTimers.current.set(
          lineCode,
          setTimeout(() => maskLine(lineCode), REVEAL_TIMEOUT_MS)
        )
      } catch {
        // Leave the field masked on failure.
      } finally {
        setRevealingLines((prev) => {
          const next = new Set(prev)
          next.delete(lineCode)
          return next
        })
      }
    },
    [returnId, taxYear, maskLine]
  )

  // Clear all pending re-mask timers on unmount.
  useEffect(() => {
    const timers = revealTimers.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

  // All populated sensitive line codes (masked by the server).
  const sensitiveLineCodes = useMemo(() => {
    if (!data?.lines) return []
    return Object.values(data.lines)
      .filter((lv) => isMasked(lv.value))
      .map((lv) => lv.line.lineCode)
  }, [data])

  const handleGlobalSensitiveToggle = () => {
    if (!showSensitive) {
      for (const code of sensitiveLineCodes) {
        if (revealedValues[code] === undefined) void revealLine(code)
      }
    } else {
      for (const code of sensitiveLineCodes) maskLine(code)
    }
    setShowSensitive(!showSensitive)
  }

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
          // The stored token already carries the taxreturns scope — a 403
          // here means Intuit hasn't allow-listed the app for the Phase 1
          // data endpoints. Re-consenting does NOT fix this; don't send
          // admins on that loop.
          setExportError(
            "Intuit is rejecting return-data exports for this firm. The app isn't allow-listed for the ProConnect data endpoints yet — this needs a request to the Intuit ProConnect API team (then re-consent from Tax Settings). See the Phase 1 status on /tax/settings.",
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
      <div className="min-h-screen bg-background p-6">
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
      <div className="min-h-screen bg-background p-6 space-y-4">
        <Skeleton className="h-12 w-96" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-card border-b border-border print:static print:border-none">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg print:hidden" style={{ backgroundColor: "#1e2010", color: "#9CA757" }}>
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
                  <Badge
                    variant="outline"
                    className="text-xs"
                    title="Remaining lines are amounts Intuit calculates (tax, credits) that the ProConnect API does not export yet — they come from the filed return."
                  >
                    {data.mappedLineCount + (data.computedLineCount ?? 0) + (data.estimatedLineCount ?? 0)} of {data.lineCount} lines populate
                    ({data.mappedLineCount} from ProConnect + {data.computedLineCount ?? 0} computed
                    {(data.estimatedLineCount ?? 0) > 0 ? ` + ${data.estimatedLineCount} estimated` : ""})
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
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Return Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              {/* Horizontal scroll so each tile always has room — no truncation */}
              <div className="flex overflow-x-auto divide-x divide-border">
                <SummaryValue label="Total Income" value={summaryValues.totalIncome} line="9" />
                <SummaryValue label="AGI" value={summaryValues.agi} line="11" />
                <SummaryValue label="Taxable Income" value={summaryValues.taxableIncome} line="15" />
                <SummaryValue label="Total Tax" value={summaryValues.totalTax} line="24" />
                <SummaryValue label="Total Payments" value={summaryValues.totalPayments} line="33" />
                <SummaryValue
                  label="Refund"
                  value={summaryValues.refund}
                  line="34"
                  tone="sage"
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
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
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
          <div className="flex items-center gap-4">
            {sensitiveLineCodes.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGlobalSensitiveToggle}
                aria-pressed={showSensitive}
                aria-label={
                  showSensitive ? "Hide sensitive data" : "Show sensitive data"
                }
              >
                {showSensitive ? (
                  <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                )}
                {showSensitive ? "Hide sensitive data" : "Show sensitive data"}
              </Button>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAllLines}
                onChange={(e) => setShowAllLines(e.target.checked)}
                className="rounded border-border"
              />
              Show lines with no value
            </label>
          </div>
        </div>

        {/* Line categories */}
        <div className="space-y-3">
          {CATEGORY_ORDER.map(({ key, label }) => {
            const lines = linesByCategory.get(key) || []
            const populatedLines = lines.filter((l) => l.value !== null && l.value !== "")
            const visibleLines = showAllLines ? lines : populatedLines
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
                    <CardHeader className="cursor-pointer hover:bg-muted/40 transition-colors py-3 print:cursor-default print:hover:bg-transparent">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground print:hidden" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground print:hidden" />
                          )}
                          <CardTitle className="text-base">{label}</CardTitle>
                          <span className="text-xs text-muted-foreground">
                            {populatedLines.length} of {lines.length} lines
                          </span>
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
                      <div className="divide-y divide-border/60">
                        {visibleLines.map((lineVal) => (
                          <LineRow
                            key={lineVal.line.lineCode}
                            lineVal={lineVal}
                            revealedValue={revealedValues[lineVal.line.lineCode]}
                            isRevealing={revealingLines.has(lineVal.line.lineCode)}
                            onReveal={revealLine}
                            onMask={maskLine}
                          />
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
        <footer className="text-xs text-muted-foreground pt-4 border-t border-border print:border-none">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Return ID: {data.returnId}</span>
            {data.version && <span>Version: {data.version}</span>}
            {data.exportedAt && (
              <span>Exported: {new Date(data.exportedAt).toLocaleString()}</span>
            )}
            <span>
              Source: ProConnect Phase 1 API — {data.mappedLineCount} mapped input lines. Amber “estimated” values are Hub-calculated from IRS worksheets, not from Intuit — verify against the filed return.
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
  tone = "neutral",
}: {
  label: string
  value: number | null
  line: string
  tone?: "neutral" | "sage" | "rose"
}) {
  const hasValue = value !== null && value !== 0
  // Motta olive/sage palette: #9CA757 (mid), #7E8845 (dark), #C4CB8B (light)
  const valueClass =
    tone === "sage"
      ? hasValue
        ? "text-[#9CA757]"
        : "text-muted-foreground"
      : tone === "rose"
      ? hasValue
        ? "text-rose-500"
        : "text-muted-foreground"
      : "text-foreground"

  return (
    <div className="flex-shrink-0 min-w-[168px] px-5 py-5 flex flex-col gap-2.5">
      {/* Label + line number on one row, never wraps */}
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/45">
          L{line}
        </span>
      </div>
      {/* Value always on its own line */}
      <div className={cn("text-xl font-semibold tabular-nums leading-none", valueClass)}>
        {hasValue ? fmtMoney(value) : (
          <span className="text-muted-foreground/35">—</span>
        )}
      </div>
    </div>
  )
}

// Individual line row
function LineRow({
  lineVal,
  revealedValue,
  isRevealing,
  onReveal,
  onMask,
}: {
  lineVal: LineValue
  revealedValue: string | undefined
  isRevealing: boolean
  onReveal: (lineCode: string) => void
  onMask: (lineCode: string) => void
}) {
  const { line, value, source } = lineVal
  const hasValue = value !== null && value !== ""
  const masked = isMasked(value)
  const isRevealed = masked && revealedValue !== undefined

  const formatValue = () => {
    if (value === null || value === "") return <span className="text-muted-foreground/40">—</span>

    if (masked) {
      const maskedStr = maskedDisplay(line.dataType, value)
      return (
        <span className="inline-flex items-center gap-1.5 justify-end">
          {/* Print always shows the masked form regardless of reveal state */}
          <span className="font-mono text-sm hidden print:inline">{maskedStr}</span>
          <span className="font-mono text-sm print:hidden">
            {isRevealed ? revealedValue || "—" : maskedStr}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground focus-visible:ring-2 print:hidden"
            aria-label={
              isRevealed
                ? `Hide ${line.label}`
                : `Reveal ${line.label} (access is logged)`
            }
            title={
              isRevealed
                ? `Hide ${line.label}`
                : `Reveal ${line.label} — access is logged`
            }
            disabled={isRevealing}
            onClick={(e) => {
              e.stopPropagation()
              if (isRevealed) onMask(line.lineCode)
              else onReveal(line.lineCode)
            }}
          >
            {isRevealing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isRevealed ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </Button>
        </span>
      )
    }

    switch (line.dataType) {
      case "currency":
        return (
          <span className="font-medium tabular-nums">
            {typeof value === "number" ? fmtMoney(value) : String(value)}
          </span>
        )
      case "integer":
        return (
          <span className="font-medium tabular-nums">
            {typeof value === "number" ? fmtNumber(value) : String(value)}
          </span>
        )
      case "boolean":
        return value ? (
          <CheckCircle2 className="h-4 w-4 inline-block" style={{ color: "#9CA757" }} aria-label="Yes" />
        ) : (
          <Minus className="h-4 w-4 text-muted-foreground/40 inline-block" aria-label="No" />
        )
      case "ssn":
      case "ein":
        return <span className="font-mono text-sm">{String(value)}</span>
      default:
        return <span>{String(value)}</span>
    }
  }

  const showInferredDot = hasValue && lineVal.confidence === "inferred"

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-2.5 hover:bg-muted/40 transition-colors rounded-sm",
        !hasValue && "opacity-50"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          {/^\d{1,2}[a-z]?$/.test(line.lineCode) ? (
            <span className="text-xs font-mono text-muted-foreground/60 w-16 flex-shrink-0 truncate">
              {line.lineCode}
            </span>
          ) : (
            <span className="w-16 flex-shrink-0" aria-hidden="true" />
          )}
          <span className="text-sm">{line.label}</span>
          {line.isComputed && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground border-border"
            >
              computed
            </Badge>
          )}
          {line.notApplicable && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-border">
              N/A this year
            </Badge>
          )}
          {source === "estimated" && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-amber-500/40 bg-amber-500/10 text-amber-500"
              title="Hub-calculated estimate (standard deduction / taxable SS / tax / CTC) — Intuit does not export calculated amounts. Verify against the filed return."
            >
              estimated
            </Badge>
          )}
          {line.scheduleRef && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground border-border"
            >
              {line.scheduleRef}
            </Badge>
          )}
          {lineVal.decodeMissing && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-muted-foreground border-border"
              title="This coded value has no decode entry yet — showing the raw code."
            >
              undecoded
            </Badge>
          )}
        </div>
        {line.notes && (
          <div className="text-xs text-muted-foreground mt-0.5 ml-[76px] line-clamp-1">
            {line.notes}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-right min-w-[120px]">
        {formatValue()}
        {showInferredDot && (
          <span
            className="ml-1 text-muted-foreground/40 select-none cursor-help align-super text-[10px]"
            title={INFERRED_TOOLTIP}
            aria-label={INFERRED_TOOLTIP}
            role="img"
          >
            *
          </span>
        )}
      </div>
    </div>
  )
}
