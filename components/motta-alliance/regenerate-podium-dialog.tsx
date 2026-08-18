"use client"

/**
 * Motta Alliance — "Regenerate Podium Image" admin dialog.
 *
 * Lets an admin hand-edit the podium image prompt (pre-filled with the
 * prompt that was actually used last time, so they're editing rather
 * than starting from scratch) and re-render the F1-podium image for a
 * given recap week — e.g. after the auto-drafted prompt produced a bad
 * render (extra teammates who weren't winners, a tie split across
 * separate tiers, etc.).
 *
 * On submit it calls POST /api/tommy-awards/recap/regenerate-image with
 * the caller's admin session (no bearer token needed client-side — the
 * route accepts a signed-in admin via `requireAdmin()`), which:
 *   1. Renders the supplied prompt verbatim with gpt-image-2 (skips the
 *      GPT-5.5-pro drafting step entirely).
 *   2. Rebuilds the dispatch PDF with the new image embedded.
 *   3. Persists both on the recap row.
 *
 * It intentionally never touches `email_sent_at` — this is an in-place
 * fix, not a re-send.
 */

import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Sparkles, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface RegenerateResult {
  success: boolean
  podium_image_url: string
  podium_image_prompt: string
  podium_pdf_url: string | null
  pdf_error: string | null
}

export function RegeneratePodiumDialog({
  open,
  onOpenChange,
  weekId,
  weekLabel,
  currentPrompt,
  onRegenerated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekId: string
  weekLabel: string
  currentPrompt: string | null
  onRegenerated?: () => void
}) {
  const [prompt, setPrompt] = useState(currentPrompt ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RegenerateResult | null>(null)

  // Reset to the latest known prompt every time the dialog opens fresh
  // for a (possibly different) week, and clear any stale result/error.
  useEffect(() => {
    if (open) {
      setPrompt(currentPrompt ?? "")
      setError(null)
      setResult(null)
    }
  }, [open, currentPrompt])

  async function handleSubmit() {
    if (!prompt.trim()) {
      setError("Prompt can't be empty — describe the podium scene you want rendered.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/tommy-awards/recap/regenerate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week_id: weekId,
          customPrompt: prompt.trim(),
          regeneratePdf: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || `Regeneration failed (${res.status})`)
      }
      setResult(json as RegenerateResult)
      onRegenerated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed")
    } finally {
      setSubmitting(false)
    }
  }

  const showResult = result !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" style={{ color: "#A8C566" }} />
            Regenerate Podium Image
          </DialogTitle>
          <DialogDescription>
            {weekLabel} — edit the prompt below and re-render. This renders your
            prompt exactly as written (no auto-drafting step) and rebuilds the
            dispatch PDF with the new image. The recap email is not re-sent.
          </DialogDescription>
        </DialogHeader>

        {showResult ? (
          <ResultPanel result={result} onClose={() => onOpenChange(false)} />
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="podium-prompt" className="mb-1.5 block">
                Image prompt
              </Label>
              <Textarea
                id="podium-prompt"
                rows={10}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={submitting}
                placeholder="Cinematic comic-book illustration of an F1-style podium…"
                className="font-mono text-xs leading-relaxed"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Pre-filled with the prompt used last time. Edit the winner count,
                names, tie grouping, or any other detail, then regenerate.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
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
              <Button onClick={handleSubmit} disabled={submitting || !prompt.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Rendering &amp; rebuilding PDF…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Regenerate
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

function ResultPanel({
  result,
  onClose,
}: {
  result: RegenerateResult
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3.5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-emerald-900">
            Podium image regenerated
          </div>
          <div className="mt-0.5 text-xs text-emerald-800">
            {result.podium_pdf_url
              ? "The dispatch PDF was rebuilt with the new image."
              : "The image updated, but the PDF rebuild had an issue — see below."}
          </div>
        </div>
      </div>

      {result.podium_image_url && (
        <div className="overflow-hidden rounded-md border">
          {/* Plain <img> is fine here — this is an ephemeral confirmation
              panel, not a perf-sensitive gallery view. */}
          <img
            src={result.podium_image_url || "/placeholder.svg"}
            alt="Newly regenerated podium image"
            className="w-full object-contain"
          />
        </div>
      )}

      {result.pdf_error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.pdf_error}</span>
        </div>
      )}

      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </div>
  )
}
