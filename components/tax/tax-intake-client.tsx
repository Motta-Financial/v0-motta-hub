"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { FileText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * Tax intake — key source documents, see the 1040 and the ProConnect
 * Import payload they produce.
 *
 * Deliberately shows each field's ProConnect target (e.g. s11/c3/x1000)
 * next to the input. Preparers are the people who will catch a wrong
 * mapping, and there is no sandbox to catch it for us.
 */

interface FieldDef {
  fieldKey: string
  label: string
  dataType: "currency" | "text" | "ssn" | "ein" | "state" | "checkbox" | "integer"
  required: boolean
  target: string
  confidence: "high" | "medium" | "low"
}

interface DocumentDto {
  id: string
  docType: string
  instanceIndex: number
  prefixId: string
  label: string | null
  taxpayerSpouse: "T" | "S"
  values: Record<string, { text: string | null; num: number | null }>
  fields: FieldDef[]
}

interface ImportEntry {
  prefixId: string
  codeId: string
  suffixId: string
  val?: string
  desc?: string
  tsj?: string
}

interface ProfileFieldState {
  key: string
  label: string
  contactColumn: string | null
  necessity: "required" | "expected" | "optional"
  sensitive: boolean
  note?: string
  display: string | null
  present: boolean
  unmodelled: boolean
}

interface IntakeResponse {
  availableDocTypes: Array<{ docType: string; fieldCount: number }>
  set: {
    id: string
    taxYear: number
    returnType: string
    filingStatus: string | null
    contactId: string | null
    proconnectClientId: string | null
    proconnectReturnId: string | null
  }
  profile: {
    contactId: string
    displayName: string
    fields: ProfileFieldState[]
    blocking: ProfileFieldState[]
    warnings: ProfileFieldState[]
    coverage: { present: number; applicable: number; unmodelled: number }
  } | null
  documents: DocumentDto[]
  preview: {
    lines: Array<{ lineCode: string; label: string; value: number | null; unavailable?: string }>
    scheduleA?: {
      lines: Array<{ lineCode: string; label: string; value: number }>
      total: number
      itemizingWins: boolean
    }
    outOfScope: string[]
    notes: string[]
  }
  importPlan: {
    batches: Array<{ seriesId: string; agency: string; entries: ImportEntry[] }>
    entryCount: number
    problems: Array<{ severity: string; docType: string; instanceIndex: number; fieldKey: string | null; message: string }>
    validation: {
      catalogAvailable: boolean
      ok: boolean
      problems: Array<{ severity: string; apiErrorCode?: string; message: string }>
      unknownCodes: Array<{ seriesId: string; codeId: string }>
      sensitiveCodes: Array<{ seriesId: string; codeId: string }>
    }
    blocked: boolean
    prefixAssumed: boolean
    readyToImport: boolean
  }
}

// ─── Import-plan types ───────────────────────────────────────────────────────

type UnlandedEntry = {
  prefixId: string
  codeId: string
  suffixId: string
  reason: "absent" | "value_mismatch" | "clear_ignored"
}

type BatchImportResult = {
  seriesId: string
  entryCount: number
  /** null while pending, populated after the call */
  outcome:
    | null
    | { kind: "clean"; jobId: string }
    | { kind: "rejected"; errors: Array<{ prefixId: string; codeId: string; suffixId: string; errorCode?: string; errorMessage?: string }> }
    | { kind: "not-allowlisted" }
    | { kind: "error"; message: string; statusCode?: number }
    | { kind: "success"; jobId: string; landed: number }
    | { kind: "partial"; jobId: string; unlanded: UnlandedEntry[] }
    | { kind: "unverified"; jobId: string }
}

type ImportPhase =
  | { stage: "idle" }
  | { stage: "dry-running"; currentBatch: number; totalBatches: number; results: BatchImportResult[] }
  | { stage: "dry-done"; results: BatchImportResult[]; allClean: boolean; notAllowlisted: boolean }
  | { stage: "committing"; currentBatch: number; totalBatches: number; results: BatchImportResult[] }
  | { stage: "commit-done"; results: BatchImportResult[] }

function unlanded_label(reason: UnlandedEntry["reason"]): string {
  switch (reason) {
    case "clear_ignored":
      return "API cannot clear — old value remains"
    case "absent":
      return "Value never appeared on return"
    case "value_mismatch":
      return "Different value came back than was sent"
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const money = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

/**
 * Display names and ordering for gathered document types.
 *
 * The set of types the Hub can actually accept comes from the API
 * (`availableDocTypes`, derived from tax_input_field_defs) — this only
 * supplies the labels. A type seeded in the database but missing here still
 * renders, under its raw key, rather than disappearing from the UI.
 */
const DOC_TYPE_META: Record<string, { label: string; singular: string; order: number }> = {
  w2: { label: "W-2", singular: "W-2", order: 10 },
  "1099int": { label: "1099-INT", singular: "1099-INT", order: 20 },
  "1099div": { label: "1099-DIV", singular: "1099-DIV", order: 30 },
  "1099r": { label: "1099-R", singular: "1099-R", order: 40 },
  scha: { label: "Schedule A", singular: "Schedule A", order: 50 },
}

const metaFor = (docType: string) =>
  DOC_TYPE_META[docType] ?? { label: docType, singular: docType, order: 999 }

/** Fields the preparer never types — they are derived from the document. */
const DERIVED_FIELDS = new Set(["spouse_w2"])

export function TaxIntakeClient({ setId }: { setId: string }) {
  const [data, setData] = useState<IntakeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  // Local edits per document, flushed on Save.
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  // Import plan two-step state
  const [importPhase, setImportPhase] = useState<ImportPhase>({ stage: "idle" })
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tax/intake/${setId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Failed to load intake set")
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [setId])

  useEffect(() => {
    void load()
  }, [load])

  const addDocument = async (docType: string) => {
    setSaving("add")
    try {
      const res = await fetch(`/api/tax/intake/${setId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Could not add document")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add document")
    } finally {
      setSaving(null)
    }
  }

  const saveDocument = async (doc: DocumentDto) => {
    setSaving(doc.id)
    try {
      const res = await fetch(`/api/tax/intake/${setId}/documents`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, values: drafts[doc.id] ?? {} }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Save failed")
      setDrafts((d) => ({ ...d, [doc.id]: {} }))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(null)
    }
  }

  const removeDocument = async (docId: string) => {
    setSaving(docId)
    try {
      await fetch(`/api/tax/intake/${setId}/documents?documentId=${docId}`, { method: "DELETE" })
      await load()
    } finally {
      setSaving(null)
    }
  }

  const setFilingStatus = async (fs: string) => {
    await fetch(`/api/tax/intake/${setId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filingStatus: fs }),
    })
    await load()
  }

  /**
   * Runs all batches sequentially with dryRun:true (or false for commits).
   * Stops at the first 403 or partial/failed commit. Never parallel.
   */
  async function runBatchedImport(isDryRun: boolean) {
    if (!data) return
    const { importPlan, set } = data
    const clientId = set.proconnectClientId!
    const returnId = set.proconnectReturnId!
    const batches = importPlan.batches
    const totalBatches = batches.length

    // Need the fresh return data for series versions
    let seriesVersionMap: Record<string, string | null> = {}
    try {
      const vRes = await fetch(
        `/api/proconnect/returns/${returnId}/data?clientId=${clientId}&fresh=true`,
      )
      if (vRes.ok) {
        const vBody = await vRes.json()
        const sv: Array<{ series: string; version: string }> = vBody.data?.seriesVersion ?? []
        sv.forEach((s) => { seriesVersionMap[s.series] = s.version })
      }
    } catch {
      // proceed with null versions — the import route accepts null
    }

    const results: BatchImportResult[] = batches.map((b) => ({
      seriesId: b.seriesId,
      entryCount: b.entries.length,
      outcome: null,
    }))

    if (isDryRun) {
      setImportPhase({ stage: "dry-running", currentBatch: 0, totalBatches, results: [...results] })
    } else {
      setImportPhase({ stage: "committing", currentBatch: 0, totalBatches, results: [...results] })
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const version = seriesVersionMap[batch.seriesId] ?? null

      if (isDryRun) {
        setImportPhase({ stage: "dry-running", currentBatch: i + 1, totalBatches, results: [...results] })
      } else {
        setImportPhase({ stage: "committing", currentBatch: i + 1, totalBatches, results: [...results] })
      }

      try {
        const res = await fetch(
          `/api/proconnect/returns/${returnId}/import/${batch.seriesId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId,
              version,
              dryRun: isDryRun,
              entries: batch.entries,
            }),
          },
        )

        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as Record<string, unknown>

        if (!res.ok) {
          if (res.status === 403) {
            results[i] = { ...results[i], outcome: { kind: "not-allowlisted" } }
            // Surface-B spec: 403 is the expected case for real returns.
            // Keep going with dry-runs; stop commits.
            if (!isDryRun) break
          } else if (res.status === 409) {
            results[i] = {
              ...results[i],
              outcome: { kind: "error", message: "stale-dry-run", statusCode: 409 },
            }
            break
          } else {
            results[i] = {
              ...results[i],
              outcome: {
                kind: "error",
                message: (body.error as string) ?? `HTTP ${res.status}`,
                statusCode: res.status,
              },
            }
            break
          }
        } else if (isDryRun) {
          const errors = (body as { results?: Array<{ errors?: Array<{ prefixId: string; codeId: string; suffixId: string; errorCode?: string; errorMessage?: string }> }> }).results?.[0]?.errors ?? []
          if (errors.length > 0) {
            results[i] = { ...results[i], outcome: { kind: "rejected", errors } }
          } else {
            results[i] = {
              ...results[i],
              outcome: { kind: "clean", jobId: body.jobId as string },
            }
          }
        } else {
          // Commit path — THE CRITICAL RULE
          const v = body.verification as { checked: number; landed: number; unlanded: UnlandedEntry[] } | null
          if (!v) {
            results[i] = {
              ...results[i],
              outcome: { kind: "unverified", jobId: body.jobId as string },
            }
            break
          }
          if (v.unlanded.length > 0) {
            results[i] = {
              ...results[i],
              outcome: { kind: "partial", jobId: body.jobId as string, unlanded: v.unlanded },
            }
            break
          }
          results[i] = {
            ...results[i],
            outcome: { kind: "success", jobId: body.jobId as string, landed: v.landed },
          }
        }
      } catch (err) {
        results[i] = {
          ...results[i],
          outcome: {
            kind: "error",
            message: err instanceof Error ? err.message : "Network error",
          },
        }
        break
      }
    }

    if (isDryRun) {
      const allClean = results.every((r) => r.outcome?.kind === "clean")
      const notAllowlisted = results.some((r) => r.outcome?.kind === "not-allowlisted")
      setImportPhase({ stage: "dry-done", results, allClean, notAllowlisted })
    } else {
      setImportPhase({ stage: "commit-done", results })
    }
  }

  const currentValue = (doc: DocumentDto, f: FieldDef): string => {
    const draft = drafts[doc.id]?.[f.fieldKey]
    if (draft !== undefined) return draft
    const v = doc.values[f.fieldKey]
    if (!v) return ""
    if (f.dataType === "checkbox") return v.num === 1 ? "1" : ""
    return v.num !== null ? String(v.num) : (v.text ?? "")
  }

  const setDraft = (docId: string, key: string, value: string) =>
    setDrafts((d) => ({ ...d, [docId]: { ...(d[docId] ?? {}), [key]: value } }))

  if (loading && !data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{error}</p>
            <Button className="mt-4" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) return null

  // Group by type so repeated documents sit together and the ProConnect
  // prefix sequence (p0, p1, p2…) reads in order.
  const grouped = [...data.availableDocTypes]
    .sort((a, b) => metaFor(a.docType).order - metaFor(b.docType).order)
    .map((t) => ({
      ...t,
      meta: metaFor(t.docType),
      docs: data.documents
        .filter((d) => d.docType === t.docType)
        .sort((a, b) => a.instanceIndex - b.instanceIndex),
    }))
  const hasAnyDocument = data.documents.length > 0

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tax Intake — {data.set.taxYear} {data.set.returnType}
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter source documents here. The Hub computes the return and builds the ProConnect
            import.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="fs" className="text-sm">
            Filing status
          </Label>
          <Select value={data.set.filingStatus ?? "single"} onValueChange={(v) => void setFilingStatus(v)}>
            <SelectTrigger id="fs" className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Single</SelectItem>
              <SelectItem value="mfj">Married filing jointly</SelectItem>
              <SelectItem value="mfs">Married filing separately</SelectItem>
              <SelectItem value="hoh">Head of household</SelectItem>
              <SelectItem value="qss">Qualifying surviving spouse</SelectItem>
            </SelectContent>
          </Select>
          {/* Direct entry covers the lines no source document produces —
              Schedule 1 totals, estimated payments, a prior-year
              overpayment applied forward. Same intake set, same store. */}
          <Link href={`/tax/intake/${setId}/1040`}>
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4 mr-1.5" />
              Enter 1040 lines
            </Button>
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── Documents ── */}
        <div className="space-y-4">
          {/* Taxpayer identity comes from the client profile — it is shown,
              not re-keyed. A preparer who spots an error fixes the client
              record, so next year's return inherits the correction. */}
          {data.profile && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  Taxpayer — from client profile
                  <Badge
                    variant={data.profile.blocking.length > 0 ? "destructive" : "outline"}
                    className="ml-2 text-xs"
                  >
                    {data.profile.coverage.present}/{data.profile.coverage.applicable} on file
                  </Badge>
                </CardTitle>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/clients/${data.profile.contactId}`}>Edit profile</a>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-medium">{data.profile.displayName}</p>

                <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {data.profile.fields
                    .filter((f) => !f.unmodelled)
                    .map((f) => (
                      <div key={f.key} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">{f.label}</span>
                        {f.present ? (
                          <span className="font-mono text-xs">{f.display}</span>
                        ) : (
                          <span
                            className={`text-xs ${
                              f.necessity === "required"
                                ? "font-medium text-destructive"
                                : f.necessity === "expected"
                                  ? "text-amber-600"
                                  : "text-muted-foreground"
                            }`}
                            title={f.note}
                          >
                            {f.necessity === "required" ? "missing — required" : "missing"}
                          </span>
                        )}
                      </div>
                    ))}
                </div>

                {(data.profile.blocking.length > 0 || data.profile.warnings.length > 0) && (
                  <>
                    <Separator />
                    <ul className="space-y-1 text-xs">
                      {data.profile.blocking.map((f) => (
                        <li key={f.key} className="text-destructive">
                          • <strong>{f.label}</strong> is required to file
                          {f.note ? ` — ${f.note}` : "."}
                        </li>
                      ))}
                      {data.profile.warnings.map((f) => (
                        <li key={f.key} className="text-amber-600">
                          • {f.label} is not on file{f.note ? ` — ${f.note}` : "."}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* Not this client's missing data — fields the Hub has no
                    column for. Chasing the client cannot fix these. */}
                {data.profile.fields.some((f) => f.unmodelled) && (
                  <>
                    <Separator />
                    <p className="text-xs font-medium text-muted-foreground">
                      Not modelled in the client profile
                    </p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {data.profile.fields
                        .filter((f) => f.unmodelled)
                        .map((f) => (
                          <li key={f.key}>
                            • <strong>{f.label}</strong>
                            {f.necessity === "required" && (
                              <span className="text-destructive"> (required to file)</span>
                            )}
                            {f.note ? ` — ${f.note}` : ""}
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {!data.profile && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                This intake set is not linked to a client profile, so the taxpayer&apos;s name, SSN,
                date of birth and address cannot be filled from the Hub. Link a client to the set.
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">Source documents</h2>
            <div className="flex flex-wrap gap-2">
              {grouped.map((g) => (
                <Button
                  key={g.docType}
                  size="sm"
                  variant={g.docs.length > 0 ? "outline" : "default"}
                  onClick={() => void addDocument(g.docType)}
                  disabled={saving === "add"}
                >
                  Add {g.meta.singular}
                </Button>
              ))}
            </div>
          </div>

          {!hasAnyDocument && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                No documents yet. Add a W-2, 1099, or Schedule A to begin.
              </CardContent>
            </Card>
          )}

          {grouped.flatMap((g) =>
            g.docs.map((doc) => (
              <Card key={doc.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">
                    {g.meta.singular}
                    {/* Schedule A is a single form per return, so numbering
                        it would imply a second one is expected. */}
                    {g.docType !== "scha" && ` #${doc.instanceIndex + 1}`}
                    <Badge variant="outline" className="ml-2 font-mono text-xs">
                      prefix {doc.prefixId}
                    </Badge>
                    {g.docType !== "scha" && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {doc.taxpayerSpouse === "S" ? "Spouse" : "Taxpayer"}
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void saveDocument(doc)}
                      disabled={saving === doc.id}
                    >
                      {saving === doc.id ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void removeDocument(doc.id)}
                      disabled={saving === doc.id}
                    >
                      Remove
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  {doc.fields
                    .filter((f) => !DERIVED_FIELDS.has(f.fieldKey))
                    .map((f) => (
                      <div key={f.fieldKey} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <Label htmlFor={`${doc.id}-${f.fieldKey}`} className="text-sm">
                            {f.label}
                            {f.required && <span className="ml-0.5 text-destructive">*</span>}
                          </Label>
                          <span
                            className="font-mono text-[10px] text-muted-foreground"
                            title={
                              f.confidence === "high"
                                ? "Mapping confirmed from Intuit's field description"
                                : "Mapping not fully confirmed — verify before importing"
                            }
                          >
                            {f.target}
                            {f.confidence !== "high" && (
                              <span className="ml-1 text-amber-600">({f.confidence})</span>
                            )}
                          </span>
                        </div>
                        {f.dataType === "checkbox" ? (
                          <div className="flex h-9 items-center">
                            <Checkbox
                              id={`${doc.id}-${f.fieldKey}`}
                              checked={currentValue(doc, f) === "1"}
                              onCheckedChange={(c) => setDraft(doc.id, f.fieldKey, c ? "1" : "0")}
                            />
                          </div>
                        ) : (
                          <Input
                            id={`${doc.id}-${f.fieldKey}`}
                            value={currentValue(doc, f)}
                            inputMode={
                              f.dataType === "currency" || f.dataType === "integer"
                                ? "decimal"
                                : "text"
                            }
                            placeholder={f.dataType === "currency" ? "0.00" : ""}
                            onChange={(e) => setDraft(doc.id, f.fieldKey, e.target.value)}
                          />
                        )}
                      </div>
                    ))}
                </CardContent>
              </Card>
            )),
          )}
        </div>

        {/* ── Preview + import plan ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Form 1040 preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.preview.lines.map((l) => (
                <div key={l.lineCode} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    <span className="font-mono text-xs">{l.lineCode}</span> {l.label}
                  </span>
                  <span
                    className="font-mono tabular-nums"
                    title={l.unavailable ?? undefined}
                  >
                    {l.unavailable ? "unavailable" : money(l.value)}
                  </span>
                </div>
              ))}
              {data.preview.notes.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {data.preview.notes.map((n, i) => (
                      <li key={i}>• {n}</li>
                    ))}
                  </ul>
                </>
              )}
              {data.preview.outOfScope.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs font-medium text-amber-600">Not modelled here</p>
                  <ul className="space-y-1.5 text-xs text-amber-600">
                    {data.preview.outOfScope.map((n, i) => (
                      <li key={i}>• {n}</li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          {data.preview.scheduleA && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Schedule A
                  <Badge
                    variant={data.preview.scheduleA.itemizingWins ? "default" : "secondary"}
                    className="ml-2 text-xs"
                  >
                    {data.preview.scheduleA.itemizingWins
                      ? "itemizing wins"
                      : "standard deduction wins"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.preview.scheduleA.lines.map((l) => (
                  <div
                    key={l.lineCode}
                    className={`flex items-baseline justify-between gap-3 text-sm ${
                      l.lineCode === "A17" ? "border-t pt-1 font-medium" : ""
                    }`}
                  >
                    <span className={l.lineCode === "A17" ? "" : "text-muted-foreground"}>
                      <span className="font-mono text-xs">{l.lineCode}</span> {l.label}
                    </span>
                    <span className="font-mono tabular-nums">{money(l.value)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                ProConnect import plan
                <Badge variant="outline" className="ml-2 text-xs">
                  {data.importPlan.entryCount} entries
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.importPlan.batches.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing to import yet.</p>
              )}
              {data.importPlan.batches.map((b) => (
                <div key={b.seriesId} className="space-y-1">
                  <p className="font-mono text-xs font-medium">
                    POST …/import/series/{b.seriesId}
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded border">
                    <table className="w-full text-[11px]">
                      <tbody>
                        {b.entries.map((e, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1 font-mono text-muted-foreground">
                              {e.prefixId}/{e.codeId}/{e.suffixId}
                            </td>
                            <td className="px-2 py-1 text-right font-mono tabular-nums">
                              {e.val ?? e.desc ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {data.importPlan.problems.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {data.importPlan.problems.map((p, i) => (
                    <li
                      key={i}
                      className={p.severity === "blocking" ? "text-destructive" : "text-amber-600"}
                    >
                      • {p.message}
                    </li>
                  ))}
                </ul>
              )}

              <Separator />
              <div className="space-y-1.5">
                <p className="text-xs font-medium">
                  Catalog pre-validation
                  <Badge
                    variant={
                      !data.importPlan.validation.catalogAvailable
                        ? "secondary"
                        : data.importPlan.validation.ok
                          ? "outline"
                          : "destructive"
                    }
                    className="ml-2 text-xs"
                  >
                    {!data.importPlan.validation.catalogAvailable
                      ? "catalog not loaded"
                      : data.importPlan.validation.ok
                        ? "passes Intuit field rules"
                        : "rule violations"}
                  </Badge>
                </p>
                {data.importPlan.validation.problems.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {data.importPlan.validation.problems.map((p, i) => (
                      <li
                        key={i}
                        className={p.severity === "blocking" ? "text-destructive" : "text-amber-600"}
                      >
                        • {p.apiErrorCode && <span className="font-mono">{p.apiErrorCode}: </span>}
                        {p.message}
                      </li>
                    ))}
                  </ul>
                )}
                {data.importPlan.validation.sensitiveCodes.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {data.importPlan.validation.sensitiveCodes.length} of these codes hold PII per
                    Intuit&apos;s catalog. Their values are never logged.
                  </p>
                )}
              </div>

              <Separator />
              <p className="text-xs text-muted-foreground">
                <strong>Prefix is assumed.</strong> p0/p1/p2 for repeated documents is inferred from
                the Phase 1 field model — Intuit&apos;s catalog carries no prefix data. Verify against
                a real Export before committing an import.
              </p>

              {/* ── Two-step import control ── */}
              {(() => {
                const plan = data.importPlan
                const clientId = data.set.proconnectClientId
                const returnId = data.set.proconnectReturnId
                const canValidate = plan.readyToImport && !!clientId && !!returnId
                const phase = importPhase

                // Dry-run progress
                if (phase.stage === "dry-running") {
                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Validating batch {phase.currentBatch} of {phase.totalBatches}…
                      </p>
                      <Button className="w-full" disabled>
                        Validating…
                      </Button>
                    </div>
                  )
                }

                // Commit progress
                if (phase.stage === "committing") {
                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Applying batch {phase.currentBatch} of {phase.totalBatches}…
                      </p>
                      <Button className="w-full" variant="destructive" disabled>
                        Applying…
                      </Button>
                    </div>
                  )
                }

                // Dry-run results
                if (phase.stage === "dry-done" || phase.stage === "commit-done") {
                  const results = phase.results
                  const isDryDone = phase.stage === "dry-done"
                  const allClean = isDryDone && (phase as { allClean: boolean }).allClean
                  const notAllowlisted = isDryDone && (phase as { notAllowlisted: boolean }).notAllowlisted

                  return (
                    <div className="space-y-3">
                      {/* Per-batch result rows */}
                      <div className="space-y-2">
                        {results.map((r) => {
                          const o = r.outcome
                          if (!o) return null
                          return (
                            <div key={r.seriesId} className="rounded-md border p-2.5 text-xs">
                              <p className="font-mono font-medium">
                                {r.seriesId}{" "}
                                <span className="text-muted-foreground">({r.entryCount} entries)</span>
                              </p>
                              {o.kind === "clean" && (
                                <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                                  All {r.entryCount} entries validated — no errors.
                                </p>
                              )}
                              {o.kind === "success" && (
                                <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                                  {o.landed} of {r.entryCount} entr{o.landed === 1 ? "y" : "ies"} confirmed on return.
                                </p>
                              )}
                              {o.kind === "rejected" && (
                                <div className="mt-1">
                                  <p className="text-destructive">
                                    {o.errors.length} entr{o.errors.length === 1 ? "y" : "ies"} rejected
                                  </p>
                                  <ul className="mt-1 space-y-0.5">
                                    {o.errors.map((e, i) => (
                                      <li key={i} className="text-destructive">
                                        <code className="rounded bg-muted px-1">
                                          {e.prefixId}/{e.codeId}/{e.suffixId}
                                        </code>
                                        {e.errorCode && (
                                          <span className="ml-1 font-mono">{e.errorCode}</span>
                                        )}
                                        {e.errorMessage && (
                                          <span className="ml-1 text-muted-foreground">{e.errorMessage}</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {o.kind === "partial" && (
                                <div className="mt-1">
                                  <p className="text-amber-700 dark:text-amber-400">
                                    Not fully applied — {o.unlanded.length} entr{o.unlanded.length === 1 ? "y" : "ies"} did not land
                                  </p>
                                  <ul className="mt-1 space-y-0.5">
                                    {o.unlanded.map((u, i) => (
                                      <li key={i}>
                                        <code className="rounded bg-muted px-1 font-mono">
                                          {u.prefixId}/{u.codeId}/{u.suffixId}
                                        </code>
                                        <span className="ml-1 text-muted-foreground">
                                          {unlanded_label(u.reason)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="mt-1 font-mono text-muted-foreground">job {o.jobId}</p>
                                </div>
                              )}
                              {o.kind === "unverified" && (
                                <p className="mt-1 text-amber-700 dark:text-amber-400">
                                  Write completed but could not be verified. Do not assume success.{" "}
                                  <span className="font-mono">job {o.jobId}</span>
                                </p>
                              )}
                              {o.kind === "not-allowlisted" && (
                                <p className="mt-1 text-muted-foreground">
                                  Write restricted — this return is not on the allowlist for commits.
                                  Validation passed.
                                </p>
                              )}
                              {o.kind === "error" && o.message === "stale-dry-run" && (
                                <p className="mt-1 text-amber-700 dark:text-amber-400">
                                  Dry-run window expired. Re-run validation before committing.
                                </p>
                              )}
                              {o.kind === "error" && o.message !== "stale-dry-run" && (
                                <p className="mt-1 text-destructive">{o.message}</p>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* 403 not-allowlisted explanation — calm, not an error */}
                      {notAllowlisted && (
                        <p className="text-xs text-muted-foreground">
                          Writes are restricted to designated test returns. Validation works on all
                          returns; commits require the return to be on the allowlist.
                        </p>
                      )}

                      {/* Re-validate button */}
                      {isDryDone && (
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={() => void runBatchedImport(true)}
                          disabled={!canValidate}
                        >
                          Re-validate all batches ({plan.entryCount} entries)
                        </Button>
                      )}

                      {/* Apply button — only after all batches are clean */}
                      {isDryDone && allClean && (
                        <Button
                          className="w-full"
                          variant="destructive"
                          onClick={() => setCommitDialogOpen(true)}
                        >
                          Apply {plan.entryCount} entries to the return
                        </Button>
                      )}

                      {/* After commit: option to re-validate from scratch */}
                      {!isDryDone && (
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={() => {
                            setImportPhase({ stage: "idle" })
                          }}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  )
                }

                // Idle — initial state
                return (
                  <div className="space-y-2">
                    {!canValidate && (
                      <p className="text-xs text-muted-foreground">
                        {plan.blocked
                          ? "Resolve the blocking problems above to enable import."
                          : "Link a ProConnect client and return to this set to enable import."}
                      </p>
                    )}
                    <Button
                      className="w-full"
                      disabled={!canValidate}
                      onClick={() => void runBatchedImport(true)}
                    >
                      Validate all batches ({plan.entryCount} entries)
                    </Button>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Commit confirmation dialog */}
      <AlertDialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply all batches to return?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  This will write{" "}
                  <strong>{data?.importPlan.entryCount} entries</strong> across{" "}
                  <strong>{data?.importPlan.batches.length} batches</strong> to the ProConnect return.
                </p>
                <p className="text-destructive">
                  This cannot be undone. The ProConnect API has no delete or clear — a wrong value can only be overwritten, never removed.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setCommitDialogOpen(false)
                void runBatchedImport(false)
              }}
            >
              Write to return
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
