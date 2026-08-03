"use client"

/**
 * Single row inside the Prospect Form's "Platform Sync" card.
 *
 * Pure presentational checkbox + label + description with an optional
 * "Recommended" badge and a "queued" footnote shown when the platform
 * push is intent-only (i.e. wired up server-side but not yet executed
 * by a worker — see `lib/hub/find-or-create-contact.ts` for the
 * Hub-first invariant).
 */

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface PlatformPushRowProps {
  id: string
  label: string
  description: string
  recommended?: boolean
  /** Optional copy shown beneath the description when checked + queued (no live worker yet). */
  queuedNote?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function PlatformPushRow({
  id,
  label,
  description,
  recommended,
  queuedNote,
  checked,
  onChange,
}: PlatformPushRowProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border bg-card p-3 transition-colors",
        checked ? "border-primary/50 bg-primary/5" : "border-border",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <div className="flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
            {label}
          </Label>
          {recommended && (
            <Badge variant="secondary" className="text-[10px] uppercase">
              Recommended
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {checked && queuedNote && (
          <p className="text-xs italic text-muted-foreground">{queuedNote}</p>
        )}
      </div>
    </div>
  )
}
