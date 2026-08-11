"use client"

/**
 * FieldEditSheet — inline field editor for /tax/returns/[returnId].
 *
 * Opened by clicking the Pencil button on a row in the "Field data by
 * series" card. Implements the two-step validate → commit flow with the
 * critical-rule verification display.
 *
 * THE CRITICAL RULE: success is ONLY verification.landed === verification.checked.
 * summary.totalImported is deliberately ignored — the upstream API has a
 * confirmed defect where it returns totalImported:1 for writes it did not apply.
 */

import { useState } from "react"
import { toast } from "sonner"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditTarget = {
  returnId: string
  clientId: string
  seriesId: string
  seriesVersion: string | null
  prefixId: string
  codeId: string
  suffixId: string
  /** Which FieldCell key carries the value on this cell */
  writeKey: "val" | "desc"
  currentValue: string | null
}

type UnlandedEntry = {
  prefixId: string
  codeId: string
  suffixId: string
  reason: "absent" | "value_mismatch" | "clear_ignored"
}

type Verification = {
  checked: number
  landed: number
  unlanded: UnlandedEntry[]
}

type ImportResult = {
  jobId: string
  summary: { totalImported: number; totalErrors: number; dryRun: boolean }
  results?: Array<{
    errors?: Array<{
      prefixId: string
      codeId: string
      suffixId: string
      errorCode?: string
      errorMessage?: string
    }>
  }>
  verification: Verification | null
  /**
   * Post-e-file edit lock, as the server decided it at the moment of this
   * request — lib/proconnect/efile-lock.LockDecision. Present on every
   * response including a 423 refusal, so the reason shown here is the
   * server's own words rather than a guess made in the browser.
   */
  lock?: { locked: boolean; code: string; reason: string } | null
  intuitTid?: string
}

type DryRunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "clean"; jobId: string }
  | { status: "rejected"; errors: Array<{ errorCode?: string; errorMessage?: string }> }
  | { status: "error"; message: string }

type CommitState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; jobId: string; landed: number }
  | { status: "partial"; jobId: string; unlanded: UnlandedEntry[] }
  | { status: "unverified"; jobId: string }
  | { status: "error"; message: string; statusCode?: number; lockReason?: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unlanded_reason_label(reason: UnlandedEntry["reason"]): string {
  switch (reason) {
    case "clear_ignored":
      return "The API cannot clear a value — it reported success but the old value is still on the return."
    case "absent":
      return "The value never appeared on the return after the write."
    case "value_mismatch":
      return "A different value came back than the one sent."
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FieldEditSheet({
  target,
  open,
  onClose,
  onCommitSuccess,
}: {
  target: EditTarget | null
  open: boolean
  onClose: () => void
  onCommitSuccess: () => void
}) {
  const [newValue, setNewValue] = useState<string>("")
  const [dryRun, setDryRun] = useState<DryRunState>({ status: "idle" })
  const [commit, setCommit] = useState<CommitState>({ status: "idle" })
  const [confirmOpen, setConfirmOpen] = useState(false)
  // The dry-run response carries the server's live lock verdict. Dry runs
  // are allowed on a locked return — they write nothing — so this is the
  // earliest honest moment to say the commit will be refused, without
  // waiting for the user to click Apply and collect a 423.
  const [lockWarning, setLockWarning] = useState<string | null>(null)

  // Reset state when the sheet opens for a new target
  function handleOpenChange(o: boolean) {
    if (!o) {
      // Opening the confirm AlertDialog moves focus out of the Sheet, which
      // makes Radix fire onOpenChange(false) here. The parent owns `target`
      // and clears it on close, so honoring that would null the target out
      // from under a confirm dialog that is still on screen — the dialog
      // loses its field/old-value lines and `runCommit`'s `if (!target)`
      // guard turns "Write to return" into a silent no-op. Stay open while
      // confirming; the dialog's own actions close us.
      if (confirmOpen) return
      onClose()
    }
  }

  // Pre-fill the input when the target changes
  function handleSheetOpen() {
    if (target) {
      setNewValue(target.currentValue ?? "")
      setDryRun({ status: "idle" })
      setCommit({ status: "idle" })
      setLockWarning(null)
    }
  }

  async function runDryRun() {
    if (!target) return
    setDryRun({ status: "running" })
    setCommit({ status: "idle" })
    try {
      const entry =
        target.writeKey === "val"
          ? { prefixId: target.prefixId, codeId: target.codeId, suffixId: target.suffixId, val: newValue }
          : { prefixId: target.prefixId, codeId: target.codeId, suffixId: target.suffixId, desc: newValue }

      const res = await fetch(
        `/api/proconnect/returns/${target.returnId}/import/${target.seriesId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: target.clientId,
            version: target.seriesVersion,
            dryRun: true,
            entries: [entry],
          }),
        },
      )
      const body: ImportResult & { error?: string } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }) as never)

      if (!res.ok) {
        setDryRun({ status: "error", message: body.error ?? `HTTP ${res.status}` })
        return
      }

      setLockWarning(body.lock?.locked ? body.lock.reason : null)

      const errors = body.results?.[0]?.errors ?? []
      if (errors.length > 0) {
        setDryRun({ status: "rejected", errors })
      } else {
        setDryRun({ status: "clean", jobId: body.jobId })
      }
    } catch (err) {
      setDryRun({ status: "error", message: err instanceof Error ? err.message : "Network error" })
    }
  }

  async function runCommit() {
    if (!target) return
    setCommit({ status: "running" })
    setConfirmOpen(false)
    try {
      const entry =
        target.writeKey === "val"
          ? { prefixId: target.prefixId, codeId: target.codeId, suffixId: target.suffixId, val: newValue }
          : { prefixId: target.prefixId, codeId: target.codeId, suffixId: target.suffixId, desc: newValue }

      const res = await fetch(
        `/api/proconnect/returns/${target.returnId}/import/${target.seriesId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: target.clientId,
            version: target.seriesVersion,
            dryRun: false,
            entries: [entry],
          }),
        },
      )
      const body: ImportResult & { error?: string } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }) as never)

      if (!res.ok) {
        const statusCode = res.status
        if (statusCode === 403) {
          setCommit({ status: "error", message: "not-allowlisted", statusCode: 403 })
        } else if (statusCode === 409) {
          setCommit({ status: "error", message: "stale-dry-run", statusCode: 409 })
          setDryRun({ status: "idle" })
        } else if (statusCode === 423) {
          setCommit({
            status: "error",
            message: "locked",
            statusCode: 423,
            lockReason: body.lock?.reason ?? body.error,
          })
        } else if (statusCode === 429) {
          setCommit({ status: "error", message: "rate-limited", statusCode: 429 })
        } else {
          setCommit({ status: "error", message: body.error ?? `HTTP ${statusCode}`, statusCode })
        }
        return
      }

      // THE CRITICAL RULE — never read summary.totalImported as success
      const v = body.verification
      if (!v) {
        setCommit({ status: "unverified", jobId: body.jobId })
        return
      }
      if (v.unlanded.length > 0) {
        setCommit({ status: "partial", jobId: body.jobId, unlanded: v.unlanded })
        return
      }
      // Only here is it truly success
      setCommit({ status: "success", jobId: body.jobId, landed: v.landed })
      toast.success("Field written to return")
      onCommitSuccess()
    } catch (err) {
      setCommit({ status: "error", message: err instanceof Error ? err.message : "Network error" })
    }
  }

  const applyEnabled =
    dryRun.status === "clean" &&
    !lockWarning &&
    commit.status !== "running" &&
    commit.status !== "success"

  const is403 = commit.status === "error" && commit.statusCode === 403

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" onOpenAutoFocus={handleSheetOpen}>
          <SheetHeader>
            <SheetTitle>Edit field</SheetTitle>
            {target && (
              <p className="font-mono text-sm">
                {target.seriesId} / {target.prefixId} / {target.codeId} / {target.suffixId}
              </p>
            )}
            {target?.seriesVersion && (
              <p className="truncate font-mono text-xs text-muted-foreground" title={target.seriesVersion}>
                version {target.seriesVersion}
              </p>
            )}
          </SheetHeader>

          <div className="flex flex-col gap-4 overflow-y-auto px-4 py-2">
            {target && (
              <>
                {lockWarning && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                    <p className="font-medium">This return has been filed.</p>
                    <p className="mt-1">{lockWarning}</p>
                    <p className="mt-1">
                      Validation still runs, but the write will be refused. Make the change in
                      ProConnect.
                    </p>
                  </div>
                )}

                {/* Current value */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Current value</p>
                  <p className="font-mono text-sm">
                    {target.currentValue ?? <span className="text-muted-foreground">—</span>}
                  </p>
                </div>

                <Separator />

                {/* New value input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="field-edit-input">
                    New value
                  </label>
                  <Input
                    id="field-edit-input"
                    value={newValue}
                    onChange={(e) => {
                      setNewValue(e.target.value)
                      // Any value change invalidates a prior dry-run result
                      if (dryRun.status !== "idle" && dryRun.status !== "running") {
                        setDryRun({ status: "idle" })
                      }
                    }}
                    disabled={commit.status === "running" || commit.status === "success"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Writing to <code className="rounded bg-muted px-1">{target.writeKey}</code> key
                  </p>
                </div>

                {/* Dry-run result */}
                {dryRun.status === "rejected" && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                    <p className="font-medium text-destructive">Validation rejected</p>
                    <ul className="mt-1.5 space-y-1">
                      {dryRun.errors.map((e, i) => (
                        <li key={i} className="text-destructive">
                          {e.errorCode && (
                            <code className="mr-1 rounded bg-destructive/10 px-1">{e.errorCode}</code>
                          )}
                          {e.errorMessage ?? "Unknown error"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {dryRun.status === "error" && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                    {dryRun.message}
                  </div>
                )}

                {dryRun.status === "clean" && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                    Validation passed — no field-rule errors. You may now apply.
                  </div>
                )}

                {/* Commit result */}
                {commit.status === "running" && (
                  <p className="text-xs text-muted-foreground">Writing to return…</p>
                )}

                {commit.status === "success" && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                    <p className="font-medium">Written and verified</p>
                    <p className="mt-1 text-muted-foreground">
                      {commit.landed} of {commit.landed} entr{commit.landed === 1 ? "y" : "ies"} confirmed on the return.
                    </p>
                    <p className="mt-1 font-mono text-muted-foreground">job {commit.jobId}</p>
                  </div>
                )}

                {commit.status === "partial" && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <p className="font-medium text-amber-700 dark:text-amber-400">Not applied</p>
                    <ul className="mt-1.5 space-y-2">
                      {commit.unlanded.map((u, i) => (
                        <li key={i}>
                          <code className="rounded bg-muted px-1 font-mono">
                            {u.prefixId}/{u.codeId}/{u.suffixId}
                          </code>
                          <p className="mt-0.5 text-muted-foreground">
                            {unlanded_reason_label(u.reason)}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 font-mono text-muted-foreground">job {commit.jobId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Copy the job ID for support.
                    </p>
                  </div>
                )}

                {commit.status === "unverified" && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <p className="font-medium text-amber-700 dark:text-amber-400">Unverified write</p>
                    <p className="mt-1 text-muted-foreground">
                      The write completed but the return could not be re-read to confirm whether the value landed.
                      Do not assume success.
                    </p>
                    <p className="mt-1.5 font-mono text-muted-foreground">job {commit.jobId}</p>
                  </div>
                )}

                {commit.status === "error" && commit.statusCode === 409 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                    The dry-run window expired (30 minutes). Re-run Validate before applying.
                  </div>
                )}

                {commit.status === "error" && commit.statusCode === 423 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                    <p className="font-medium">Locked — no write was attempted.</p>
                    <p className="mt-1">
                      {commit.lockReason ??
                        "This return cannot be edited here. Make the change in ProConnect."}
                    </p>
                  </div>
                )}

                {commit.status === "error" && commit.statusCode === 429 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                    Rate limited. Wait a moment before trying again.
                  </div>
                )}

                {commit.status === "error" &&
                  commit.statusCode !== 403 &&
                  commit.statusCode !== 409 &&
                  commit.statusCode !== 423 &&
                  commit.statusCode !== 429 && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                      {commit.message}
                    </div>
                  )}

                {/* Version stamp note */}
                <p className="text-xs text-muted-foreground">
                  Note: a version stamp changes even when a write did not apply — the stamp alone does not confirm the write.
                </p>
              </>
            )}
          </div>

          <SheetFooter>
            {is403 ? (
              <p className="text-xs text-muted-foreground">
                Writes are restricted to designated test returns. Validate still works on this return, but no values will be committed.
              </p>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => void runDryRun()}
                  disabled={dryRun.status === "running" || commit.status === "running" || commit.status === "success"}
                >
                  {dryRun.status === "running" ? "Validating…" : "Validate"}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!applyEnabled}
                  onClick={() => setConfirmOpen(true)}
                >
                  Apply to return
                </Button>
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Write field to return?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {target && (
                  <>
                    <p>
                      Field{" "}
                      <code className="rounded bg-muted px-1 font-mono text-xs">
                        {target.seriesId}/{target.prefixId}/{target.codeId}/{target.suffixId}
                      </code>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Old value: </span>
                      <code className="rounded bg-muted px-1 font-mono text-xs">
                        {target.currentValue ?? "—"}
                      </code>
                      {" → "}
                      <code className="rounded bg-muted px-1 font-mono text-xs">{newValue}</code>
                    </p>
                  </>
                )}
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
              onClick={() => void runCommit()}
            >
              Write to return
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
