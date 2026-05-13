"use client"

/**
 * Motta Alliance — "Issue New Edition" dialog.
 *
 * Two-step flow:
 *
 *   1. Upload the PDF to Vercel Blob via POST /api/motta-alliance/upload.
 *      The upload kicks off the moment the user picks a file so the
 *      Submit click later has nothing big left to push. The returned
 *      blob URL + pathname stay in dialog state until Submit.
 *
 *   2. Fill out cover-card metadata (issue label, title, arc, tagline,
 *      featured characters, variant), then POST the whole thing to
 *      /api/motta-alliance/issues. That route reads the PDF with Claude,
 *      persists the issue, and ALFRED Ai emails the team — all in one
 *      shot. The dialog only waits for the response and surfaces the
 *      send result inline.
 *
 * State lives entirely in this component; the parent only opens it via
 * `open` and gets a callback (`onIssued`) when a new edition was
 * successfully published so the gallery list can refresh.
 */

import { useRef, useState, useEffect } from "react"
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  Sparkles,
  Upload,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface UploadedPdf {
  url: string
  pathname: string
  name: string
  size_bytes: number
}

interface PublishResponse {
  issue: { id: string; title: string; issue_number: string; slug: string }
  ai: { used: boolean; error: string | null }
  email: {
    attempted: number
    sent: number
    skipped: number
    error: string | null
  }
}

// Visual variants exposed in the variant picker. Mirrors the keys in
// VARIANT_STYLES on the gallery component so the cover renders the
// matching treatment.
const VARIANT_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "olive", label: "Olive (default)", hint: "Olive on cream — the main series look" },
  { value: "sunset", label: "Sunset", hint: "Warm brown + amber spotlight" },
  { value: "taxverse", label: "Taxverse Night", hint: "Deep olive, gold accent" },
  { value: "cream-olive", label: "Cream on Olive", hint: "Light cover for hero volumes" },
  { value: "amber", label: "Amber on Olive", hint: "Olive base + amber accent" },
]

export function IssueNewEditionDialog({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onIssued?: () => void
}) {
  // ── File upload state ─────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pdf, setPdf] = useState<UploadedPdf | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ── Form fields ───────────────────────────────────────────────────
  const [series, setSeries] = useState("Motta Alliance")
  const [issueNumber, setIssueNumber] = useState("")
  const [title, setTitle] = useState("")
  const [arc, setArc] = useState("")
  const [tagline, setTagline] = useState("")
  const [characters, setCharacters] = useState("")
  const [variant, setVariant] = useState<string>("olive")

  // ── Submit state ──────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<PublishResponse | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset everything when the dialog closes so the next open is fresh.
  // We deliberately do NOT wipe on every transition — only when the
  // dialog leaves the screen — so a misclick on the overlay doesn't
  // discard a half-filled form. (Radix Dialog handles overlay clicks
  // as `open=false` so we still reset here.)
  useEffect(() => {
    if (!open) {
      setPdf(null)
      setUploadError(null)
      setSubmitError(null)
      setResult(null)
      setSeries("Motta Alliance")
      setIssueNumber("")
      setTitle("")
      setArc("")
      setTagline("")
      setCharacters("")
      setVariant("olive")
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [open])

  async function handleFile(file: File) {
    setUploadError(null)
    setPdf(null)

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are supported.")
      return
    }

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/motta-alliance/upload", {
        method: "POST",
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || `Upload failed (${res.status})`)
      }
      setPdf(json.attachment)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    setSubmitError(null)
    setResult(null)

    if (!pdf) {
      setSubmitError("Please upload a PDF first.")
      return
    }
    if (!issueNumber.trim()) {
      setSubmitError('Issue number is required (e.g. "Issue 3").')
      return
    }
    if (!title.trim()) {
      setSubmitError("Title is required.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/motta-alliance/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series: series.trim() || "Motta Alliance",
          issueNumber: issueNumber.trim(),
          title: title.trim(),
          arc: arc.trim() || null,
          tagline: tagline.trim() || null,
          characters: characters
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          variant,
          pdfUrl: pdf.url,
          pdfPathname: pdf.pathname,
          pdfFilename: pdf.name,
          pdfSizeBytes: pdf.size_bytes,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || `Publish failed (${res.status})`)
      }
      setResult(json as PublishResponse)
      onIssued?.()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Publish failed")
    } finally {
      setSubmitting(false)
    }
  }

  // Once the result is in, the dialog body switches into a confirmation
  // panel — we let the issuer see exactly how many teammates received
  // the email + whether Claude was able to read the PDF.
  const showResult = result !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600" />
            Issue New Edition
          </DialogTitle>
          <DialogDescription>
            Upload the next edition of the Motta Alliance. ALFRED Ai will
            read the PDF, write a preview, and email every active
            teammate with the PDF attached.
          </DialogDescription>
        </DialogHeader>

        {showResult ? (
          <ResultPanel result={result} onClose={() => onOpenChange(false)} />
        ) : (
          <div className="space-y-5">
            {/* ── Upload zone ──────────────────────────────────────── */}
            <div>
              <Label className="mb-1.5 block">PDF</Label>
              <PdfUploadZone
                pdf={pdf}
                uploading={uploading}
                error={uploadError}
                onPick={() => fileInputRef.current?.click()}
                onClear={() => {
                  setPdf(null)
                  if (fileInputRef.current) fileInputRef.current.value = ""
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
            </div>

            {/* ── Cover metadata ──────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="issue-number" className="mb-1.5 block">
                  Issue number
                </Label>
                <Input
                  id="issue-number"
                  placeholder="Issue 3"
                  value={issueNumber}
                  onChange={(e) => setIssueNumber(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <Label htmlFor="series" className="mb-1.5 block">
                  Series
                </Label>
                <Input
                  id="series"
                  placeholder="Motta Alliance"
                  value={series}
                  onChange={(e) => setSeries(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="title" className="mb-1.5 block">
                  Title
                </Label>
                <Input
                  id="title"
                  placeholder="The Audit Awakens"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="arc" className="mb-1.5 block">
                  Story arc{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    optional
                  </span>
                </Label>
                <Input
                  id="arc"
                  placeholder="Taxverse 2026"
                  value={arc}
                  onChange={(e) => setArc(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="tagline" className="mb-1.5 block">
                  Cover tagline{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    optional
                  </span>
                </Label>
                <Input
                  id="tagline"
                  placeholder="When the deadline hits, the Alliance answers."
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="characters" className="mb-1.5 block">
                  Featured characters
                </Label>
                <Textarea
                  id="characters"
                  placeholder="Caleb Long, Amy Sparaco, Andrew Gianares"
                  rows={2}
                  value={characters}
                  onChange={(e) => setCharacters(e.target.value)}
                  disabled={submitting}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Comma-separated. Rendered as chips on the cover card.
                </p>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="variant" className="mb-1.5 block">
                  Cover variant
                </Label>
                <Select value={variant} onValueChange={setVariant} disabled={submitting}>
                  <SelectTrigger id="variant">
                    <SelectValue placeholder="Pick a variant" />
                  </SelectTrigger>
                  <SelectContent>
                    {VARIANT_OPTIONS.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        <div className="flex flex-col">
                          <span>{v.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {v.hint}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {submitError && (
              <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !pdf || uploading}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Publishing & emailing team…
                  </>
                ) : (
                  <>
                    <Mail className="mr-1.5 h-4 w-4" />
                    Publish & Email Team
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ─────────────────────────────────────────────────────────────────────
 * Upload widget — its own component so the main dialog body stays flat.
 * ───────────────────────────────────────────────────────────────────── */
function PdfUploadZone({
  pdf,
  uploading,
  error,
  onPick,
  onClear,
}: {
  pdf: UploadedPdf | null
  uploading: boolean
  error: string | null
  onPick: () => void
  onClear: () => void
}) {
  if (pdf) {
    const sizeMb = (pdf.size_bytes / (1024 * 1024)).toFixed(1)
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {pdf.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {sizeMb} MB · uploaded
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label="Remove PDF"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onPick}
        disabled={uploading}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-muted/30 px-4 py-6 text-center transition-colors hover:bg-muted/50",
          uploading && "cursor-wait opacity-60",
        )}
      >
        {uploading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              Uploading to Vercel Blob…
            </span>
          </>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              Click to upload the PDF
            </span>
            <span className="text-xs text-muted-foreground">
              Max 25 MB · PDF only
            </span>
          </>
        )}
      </button>
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────
 * Confirmation panel — replaces the form once the issue ships.
 * ───────────────────────────────────────────────────────────────────── */
function ResultPanel({
  result,
  onClose,
}: {
  result: PublishResponse
  onClose: () => void
}) {
  const { issue, ai, email } = result
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3.5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-emerald-900">
            {issue.issue_number}: {issue.title} — Published
          </div>
          <div className="mt-0.5 text-xs text-emerald-800">
            The new edition is now on the Motta Alliance gallery.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            ALFRED Story Preview
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {ai.used ? "Generated by Claude" : "Used fallback preview"}
          </div>
          {ai.error && (
            <div className="mt-1 text-xs text-rose-700">{ai.error}</div>
          )}
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Mail className="h-3 w-3" />
            Team Email
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {email.sent} sent
            {email.skipped > 0 && (
              <span className="ml-1 text-muted-foreground">
                · {email.skipped} skipped
              </span>
            )}
          </div>
          {email.error && (
            <div className="mt-1 text-xs text-rose-700">{email.error}</div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </div>
  )
}
