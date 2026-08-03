"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Check,
  CircleAlert,
  FileText,
  Loader2,
  Lock,
  RotateCcw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtMoney } from "@/components/tax/tax-shared"
import { cn } from "@/lib/utils"
import {
  FILING_STATUS_OPTIONS,
  SECTION_ORDER,
  SUMMARY_LINES,
  checkLines,
  evaluateLines,
  standardDeductionAssist,
  taxAssist,
  toNumber,
  type EntryConstants,
  type EvaluatedLines,
  type FilingStatus,
  type LineDef,
  type LineEntries,
  type LineValue,
  type LineWarning,
} from "@/lib/tax/intake/direct-lines"

/**
 * Direct 1040 line entry.
 *
 * The preparer types onto Form 1040 lines; computed lines recalculate as
 * they type. The recalculation runs `lib/tax/intake/direct-lines.ts` — the
 * same module the API route runs on save — so what is on screen and what is
 * stored cannot disagree.
 *
 * Values save on blur, not on keystroke: a debounce on every character
 * turns one figure into a dozen writes and makes the "saved" indicator
 * meaningless. Blur is also when a preparer has finished thinking about a
 * number.
 */

interface LinesResponse {
  set: {
    id: string
    taxYear: number
    returnType: string | null
    filingStatus: FilingStatus
    contactId: string | null
    proconnectClientId: string | null
    proconnectReturnId: string | null
    status: string | null
  }
  lines: LineDef[]
  entries: LineEntries
  evaluated: EvaluatedLines
  warnings: LineWarning[]
  constants: EntryConstants
  lastSaved: string | null
  proconnect: { writable: boolean; reason: string }
}

type SaveState = "idle" | "saving" | "saved" | "error"

export function Form1040EntryClient({ setId }: { setId: string }) {
  const [data, setData] = useState<LinesResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [entries, setEntries] = useState<LineEntries>({})
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single")
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [assistNote, setAssistNote] = useState<{ lineCode: string; text: string; ok: boolean } | null>(null)
  const [additional65Blind, setAdditional65Blind] = useState(0)

  // Entries as last confirmed by the server. Used to diff before saving so
  // a blur that changed nothing does not write.
  const persisted = useRef<LineEntries>({})

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/tax/intake/${setId}/lines`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`)
      const body = payload as LinesResponse
      setData(body)
      setEntries(body.entries)
      persisted.current = { ...body.entries }
      setFilingStatus(body.set.filingStatus)
      setSavedAt(body.lastSaved)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load")
    }
  }, [setId])

  useEffect(() => {
    void load()
  }, [load])

  // ── Live evaluation ──
  // Recomputed on every keystroke from the same evaluator the server uses.
  const evaluated = useMemo(() => {
    if (!data) return {} as EvaluatedLines
    return evaluateLines(data.lines, entries)
  }, [data, entries])

  const warnings = useMemo(() => {
    if (!data) return [] as LineWarning[]
    return checkLines(evaluated, filingStatus)
  }, [data, evaluated, filingStatus])

  const warningsByLine = useMemo(() => {
    const m = new Map<string, LineWarning[]>()
    for (const w of warnings) {
      if (!m.has(w.lineCode)) m.set(w.lineCode, [])
      m.get(w.lineCode)!.push(w)
    }
    return m
  }, [warnings])

  const save = useCallback(
    async (changed: LineEntries, nextFilingStatus?: FilingStatus) => {
      if (Object.keys(changed).length === 0 && nextFilingStatus === undefined) return
      setSaveState("saving")
      setSaveError(null)
      try {
        const res = await fetch(`/api/tax/intake/${setId}/lines`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entries: changed,
            ...(nextFilingStatus !== undefined ? { filingStatus: nextFilingStatus } : {}),
          }),
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`)

        const serverEntries = payload.entries as LineEntries
        persisted.current = { ...serverEntries }

        // Adopt the server's value for the lines we just sent — it is
        // authoritative, and its parse of "1,234.00" is what got stored.
        // Everything else keeps the local value: a save that landed while
        // the preparer was typing in another field must not overwrite what
        // they are part-way through entering.
        const savedKeys = Object.keys(changed)
        if (savedKeys.length > 0) {
          setEntries((prev) => {
            const next = { ...prev }
            for (const k of savedKeys) next[k] = serverEntries[k] ?? null
            return next
          })
        }
        setSavedAt(payload.savedAt as string)
        setSaveState("saved")

        const rejected = (payload.rejected ?? []) as Array<{ lineCode: string; reason: string }>
        if (rejected.length > 0) {
          setSaveError(rejected.map((r) => `Line ${r.lineCode}: ${r.reason}`).join(" "))
          setSaveState("error")
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Save failed")
        setSaveState("error")
      }
    },
    [setId],
  )

  /**
   * Commit one line if it actually changed since the last server round trip.
   *
   * Takes the value explicitly rather than reading it out of `entries`.
   * A checkbox or select commits in the same tick as its change, before
   * React has re-rendered, so a closure over `entries` would still hold the
   * pre-change value, compare equal, and silently skip the save.
   */
  const commitLine = useCallback(
    (lineCode: string, value: LineValue) => {
      const prev = persisted.current[lineCode] ?? null
      if (String(value ?? "") === String(prev ?? "")) return
      void save({ [lineCode]: value })
    },
    [save],
  )

  const setLine = useCallback((lineCode: string, value: LineValue) => {
    setEntries((prev) => ({ ...prev, [lineCode]: value }))
    setSaveState("idle")
  }, [])

  const changeFilingStatus = useCallback(
    (next: FilingStatus) => {
      setFilingStatus(next)
      void save({}, next)
    },
    [save],
  )

  // ── Assists ──
  const runTaxAssist = useCallback(() => {
    if (!data) return
    const result = taxAssist(evaluated, filingStatus, data.constants)
    if (result.ok) {
      setEntries((prev) => ({ ...prev, "16": result.value }))
      void save({ "16": result.value })
      setAssistNote({ lineCode: "16", text: result.explanation, ok: true })
    } else {
      setAssistNote({ lineCode: "16", text: result.reason, ok: false })
    }
  }, [data, evaluated, filingStatus, save])

  const runStdDeductionAssist = useCallback(() => {
    if (!data) return
    const result = standardDeductionAssist(filingStatus, data.constants, additional65Blind)
    if (result.ok) {
      setEntries((prev) => ({ ...prev, "12a": result.value }))
      void save({ "12a": result.value })
      setAssistNote({ lineCode: "12a", text: result.explanation, ok: true })
    } else {
      setAssistNote({ lineCode: "12a", text: result.reason, ok: false })
    }
  }, [data, filingStatus, additional65Blind, save])

  // ── Render ──

  if (loadError) {
    return (
      <div className="p-6">
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-6 flex items-start gap-4">
            <CircleAlert className="h-6 w-6 text-rose-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-rose-900">Could not load the 1040 entry form</div>
              <div className="text-sm text-rose-700 mt-1">{loadError}</div>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const linesBySection = new Map<string, LineDef[]>()
  for (const line of data.lines) {
    if (!linesBySection.has(line.section)) linesBySection.set(line.section, [])
    linesBySection.get(line.section)!.push(line)
  }

  const blockingCount = warnings.filter((w) => w.severity === "blocking").length

  return (
    <TooltipProvider delayDuration={200}>
      <div className="pb-16">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <Link
              href={`/tax/intake/${setId}`}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to source documents
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <FileText className="h-6 w-6 text-blue-700" />
              Form 1040 — direct entry
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tax year {data.set.taxYear} · {data.set.returnType ?? "IND"} · Values typed here are stored in
              the Hub and are not sent to ProConnect.
            </p>
          </div>
          <SaveIndicator state={saveState} savedAt={savedAt} error={saveError} />
        </div>

        {/* ── Summary bar ── */}
        <Card className="mb-4 sticky top-2 z-10 shadow-sm">
          <CardContent className="py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
              {SUMMARY_LINES.map(({ code, label, tone }) => {
                const raw = evaluated[code]?.value
                const n = raw === null || raw === undefined ? null : toNumber(raw)
                const highlight = n !== null && n !== 0
                return (
                  <div key={code}>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {label}
                      <span className="ml-1 font-mono opacity-60">L{code}</span>
                    </div>
                    <div
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        highlight && tone === "emerald" && "text-emerald-700",
                        highlight && tone === "rose" && "text-rose-700",
                      )}
                    >
                      {n === null ? "—" : fmtMoney(n)}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Gate notices ── */}
        {!data.constants.bracketsVerified && (
          <GateNotice>
            Tax brackets for TY{data.set.taxYear} are <strong>not verified</strong>. Line 16 will not be
            computed automatically — enter it from ProConnect or the worksheet. Set{" "}
            <code className="font-mono text-xs">form_1040_constants.tax_brackets_verified = true</code> once
            checked against Rev. Proc. 2024-40.
          </GateNotice>
        )}
        {!data.constants.itemizedVerified && (
          <GateNotice>
            Itemized-deduction constants are <strong>not verified</strong>, so no itemized figure is offered
            for line 12a. Gather a Schedule A on the{" "}
            <Link href={`/tax/intake/${setId}`} className="underline">
              source-documents tab
            </Link>{" "}
            instead, where the SALT cap and its phase-down are handled.
          </GateNotice>
        )}

        {blockingCount > 0 && (
          <Card className="mb-4 border-rose-200 bg-rose-50">
            <CardContent className="py-3 flex items-start gap-3">
              <CircleAlert className="h-5 w-5 text-rose-700 shrink-0 mt-0.5" />
              <div className="text-sm text-rose-900">
                <strong>
                  {blockingCount} {blockingCount === 1 ? "problem" : "problems"} to resolve
                </strong>
                <ul className="mt-1 space-y-0.5 list-disc list-inside text-rose-800">
                  {warnings
                    .filter((w) => w.severity === "blocking")
                    .map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Filing status ── */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filing Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {FILING_STATUS_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={filingStatus === opt.value ? "default" : "outline"}
                  onClick={() => changeFilingStatus(opt.value)}
                >
                  {filingStatus === opt.value && <Check className="h-3.5 w-3.5 mr-1.5" />}
                  {opt.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Stored once on the intake set. The Form 1040 checkboxes (
              <span className="font-mono">fs_*</span>) are derived from this, so they cannot contradict each
              other.
            </p>
          </CardContent>
        </Card>

        {/* ── Line sections ── */}
        <div className="space-y-4">
          {SECTION_ORDER.filter((s) => s.key !== "filing_status").map((section) => {
            const lines = linesBySection.get(section.key) ?? []
            if (lines.length === 0) return null

            return (
              <Card key={section.key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{section.label}</CardTitle>
                    {section.key === "dependents" && (
                      <Badge variant="outline" className="text-[10px]">
                        one dependent only
                      </Badge>
                    )}
                  </div>
                  {section.key === "dependents" && (
                    <p className="text-xs text-muted-foreground">
                      The seeded line schema models a single dependent row. Returns with more than one
                      dependent need the repeat model, which is not built — record the rest on the client
                      profile and complete them in ProConnect.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="divide-y divide-stone-100">
                    {lines.map((line) => (
                      <LineField
                        key={line.lineCode}
                        line={line}
                        value={entries[line.lineCode] ?? null}
                        evaluated={evaluated[line.lineCode]}
                        warnings={warningsByLine.get(line.lineCode) ?? []}
                        onChange={(v) => setLine(line.lineCode, v)}
                        onCommit={(v) => commitLine(line.lineCode, v)}
                        assist={
                          line.lineCode === "16"
                            ? { label: "Compute tax", onRun: runTaxAssist }
                            : line.lineCode === "12a"
                              ? { label: "Use standard deduction", onRun: runStdDeductionAssist }
                              : undefined
                        }
                        assistNote={assistNote?.lineCode === line.lineCode ? assistNote : null}
                        extraControl={
                          line.lineCode === "12a" ? (
                            <div className="flex items-center gap-2 mt-2">
                              <Label
                                htmlFor="add65"
                                className="text-xs text-muted-foreground whitespace-nowrap"
                              >
                                65+ / blind boxes
                              </Label>
                              <Input
                                id="add65"
                                type="number"
                                min={0}
                                max={4}
                                value={additional65Blind}
                                onChange={(e) =>
                                  setAdditional65Blind(
                                    Math.max(0, Math.min(4, Number(e.target.value) || 0)),
                                  )
                                }
                                className="h-7 w-16 text-sm"
                              />
                            </div>
                          ) : undefined
                        }
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-6">
          Computed lines are derived on every read from the operands above them and are never stored, so they
          cannot drift. {data.proconnect.reason}
        </p>
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GateNotice({ children }: { children: React.ReactNode }) {
  return (
    <Card className="mb-4 border-amber-200 bg-amber-50">
      <CardContent className="py-3 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">{children}</div>
      </CardContent>
    </Card>
  )
}

function SaveIndicator({
  state,
  savedAt,
  error,
}: {
  state: SaveState
  savedAt: string | null
  error: string | null
}) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    )
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-rose-700 max-w-md" role="alert">
        <CircleAlert className="h-3.5 w-3.5 shrink-0" />
        {error ?? "Save failed"}
      </span>
    )
  }
  if (savedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        Saved {new Date(savedAt).toLocaleTimeString()}
      </span>
    )
  }
  return null
}

function LineField({
  line,
  value,
  evaluated,
  warnings,
  onChange,
  onCommit,
  assist,
  assistNote,
  extraControl,
}: {
  line: LineDef
  value: LineValue
  evaluated: { value: LineValue; source: string } | undefined
  warnings: LineWarning[]
  onChange: (v: LineValue) => void
  onCommit: (v: LineValue) => void
  assist?: { label: string; onRun: () => void }
  assistNote?: { text: string; ok: boolean } | null
  extraControl?: React.ReactNode
}) {
  const blocking = warnings.some((w) => w.severity === "blocking")

  // Computed line — read-only, shows the derived figure.
  if (line.isComputed) {
    const n = evaluated?.value === null || evaluated?.value === undefined ? null : toNumber(evaluated.value)
    return (
      <div className="flex items-center justify-between gap-4 py-2.5 bg-stone-50/60 -mx-6 px-6">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-muted-foreground w-10 shrink-0">{line.lineCode}</span>
          <span className="text-sm">{line.label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                <Lock className="h-2.5 w-2.5" />
                computed
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {line.computation
                ? `${line.computation.kind} of ${line.computation.operands.join(", ")}`
                : "Derived"}
            </TooltipContent>
          </Tooltip>
        </div>
        <span className="text-sm font-semibold tabular-nums shrink-0">
          {n === null ? "—" : fmtMoney(n)}
        </span>
      </div>
    )
  }

  return (
    <div className="py-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span className="text-xs font-mono text-muted-foreground w-10 shrink-0 pt-2">
            {line.lineCode}
          </span>
          <div className="min-w-0 flex-1">
            <Label htmlFor={`line-${line.lineCode}`} className="text-sm font-normal">
              {line.label}
            </Label>
            {line.scheduleRef && (
              <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">
                {line.scheduleRef}
              </Badge>
            )}
            {line.notes && <p className="text-xs text-muted-foreground mt-0.5">{line.notes}</p>}
            {extraControl}
            {assistNote && (
              <p className={cn("text-xs mt-1", assistNote.ok ? "text-emerald-700" : "text-amber-700")}>
                {assistNote.text}
              </p>
            )}
            {warnings.map((w, i) => (
              <p
                key={i}
                className={cn("text-xs mt-1", w.severity === "blocking" ? "text-rose-700" : "text-amber-700")}
                role="alert"
              >
                {w.message}
              </p>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {assist && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={assist.onRun}>
              <Calculator className="h-3.5 w-3.5 mr-1" />
              {assist.label}
            </Button>
          )}
          <LineInput
            line={line}
            value={value}
            invalid={blocking}
            onChange={onChange}
            onCommit={onCommit}
          />
        </div>
      </div>
    </div>
  )
}

function LineInput({
  line,
  value,
  invalid,
  onChange,
  onCommit,
}: {
  line: LineDef
  value: LineValue
  invalid: boolean
  onChange: (v: LineValue) => void
  onCommit: (v: LineValue) => void
}) {
  const id = `line-${line.lineCode}`
  const base = cn("h-9", invalid && "border-rose-400 focus-visible:ring-rose-400")

  // Identifiers are read from the client profile, never re-keyed here — the
  // API rejects them for the same reason (see the route's comment on
  // migration 364). Render the field so the line is still visible on the
  // form, but do not offer it as an input.
  if (line.dataType === "ssn" || line.dataType === "ein") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Input
            id={id}
            disabled
            value=""
            placeholder="from client profile"
            className={cn(base, "w-56 cursor-not-allowed")}
          />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Taxpayer identifiers are held on the client profile and masked when read. They are not stored by
          direct entry.
        </TooltipContent>
      </Tooltip>
    )
  }

  if (line.dataType === "boolean") {
    return (
      <Checkbox
        id={id}
        checked={value === true}
        onCheckedChange={(checked) => {
          // Checkboxes have no meaningful blur, so commit in the same tick,
          // passing the new value explicitly — state has not re-rendered yet.
          const next = checked === true
          onChange(next)
          onCommit(next)
        }}
      />
    )
  }

  if (line.dataType === "enum" && line.enumOptions?.length) {
    return (
      <Select
        value={typeof value === "string" && value ? value : undefined}
        onValueChange={(v) => {
          onChange(v)
          onCommit(v)
        }}
      >
        <SelectTrigger id={id} className={cn(base, "w-40")}>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {line.enumOptions.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const isNumeric = line.dataType === "currency" || line.dataType === "integer"

  return (
    <Input
      id={id}
      // `inputMode` rather than `type="number"`: a preparer pastes
      // "1,234.00" and "(500)" straight off a document, and a number input
      // discards both silently. The API parses them.
      inputMode={isNumeric ? "decimal" : "text"}
      value={value === null || value === undefined ? "" : String(value)}
      placeholder={isNumeric ? "0.00" : line.dataType === "routing" ? "9 digits" : ""}
      maxLength={line.dataType === "routing" ? 9 : undefined}
      onChange={(e) => onChange(e.target.value)}
      // On blur the component has re-rendered, so `value` is current.
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
      }}
      className={cn(base, isNumeric ? "w-36 text-right tabular-nums" : "w-56")}
    />
  )
}
