"use client"

/**
 * Confirmation dialog for deleting a submitted debrief.
 *
 * Deletes are *soft* (migration 351): the row is retained with
 * deleted_at / deleted_by_id / deleted_reason stamped, and every read path
 * filters it out. That's why the copy says "removed from the Hub" rather than
 * "permanently deleted", and why we surface an Undo action on success.
 *
 * The optional reason is free text captured into `deleted_reason` so the next
 * person to wonder why a debrief vanished can find out.
 */

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export interface DebriefDeleteTarget {
  id: string
  /** Client / organization display name, for the confirmation copy. */
  clientName?: string | null
  /** Formatted debrief date, for the confirmation copy. */
  dateLabel?: string | null
  /** Team member the debrief is attributed to. */
  memberName?: string | null
}

interface DebriefDeleteDialogProps {
  /** The debrief to delete, or null when the dialog is closed. */
  target: DebriefDeleteTarget | null
  onOpenChange: (open: boolean) => void
  /** Called after a successful delete so the parent can drop the row. */
  onDeleted: (id: string) => void
  /** Called after a successful undo so the parent can restore the row. */
  onRestored?: (id: string) => void
}

export function DebriefDeleteDialog({
  target,
  onOpenChange,
  onDeleted,
  onRestored,
}: DebriefDeleteDialogProps) {
  const [reason, setReason] = useState("")
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!target) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/debriefs/${target.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to delete debrief")
      }

      const deletedId = target.id
      onDeleted(deletedId)
      onOpenChange(false)
      setReason("")

      toast.success("Debrief deleted", {
        description: "It's hidden from the Hub but can be restored.",
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              const undo = await fetch(`/api/debriefs/${deletedId}?restore=1`, {
                method: "PATCH",
              })
              if (!undo.ok) {
                const data = await undo.json().catch(() => ({}))
                throw new Error(data.error || "Failed to restore debrief")
              }
              onRestored?.(deletedId)
              toast.success("Debrief restored")
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to restore debrief")
            }
          },
        },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete debrief")
    } finally {
      setDeleting(false)
    }
  }

  // Build a human description of exactly which record is going away, so
  // nobody deletes the wrong one of several similar debriefs.
  const descriptor = [target?.clientName, target?.dateLabel, target?.memberName]
    .filter(Boolean)
    .join(" · ")

  return (
    <AlertDialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) setReason("")
        onOpenChange(open)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this debrief?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {"This removes the debrief from the Hub \u2014 it will disappear from the debriefs list, client profiles, search, and reports."}
              </p>
              {descriptor && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground">
                  {descriptor}
                </p>
              )}
              <p>{"The record is kept internally, so this can be undone if it was a mistake."}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="debrief-delete-reason">Reason (optional)</Label>
          <Textarea
            id="debrief-delete-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Duplicate entry, or logged under the wrong team member"
            rows={2}
            maxLength={500}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          {/*
            Not an AlertDialogAction: that primitive auto-closes the dialog on
            click, which would tear down the spinner before the request lands.
          */}
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete debrief
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
