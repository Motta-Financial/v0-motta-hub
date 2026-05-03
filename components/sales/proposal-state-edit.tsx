"use client"

/**
 * Inline state-edit popover used on the Sales Dashboard's proposal table.
 *
 * Clicking a state cell opens a Command palette with all 50 states + DC.
 * Confirming writes to the underlying CRM row (org > contact > ignition
 * client fallback) via PATCH /api/sales/proposals/[id]/state.
 *
 * The cell shows an optimistic value while the request is in flight so
 * a slow Supabase round-trip doesn't block the user from moving on.
 */

import { useState } from "react"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { US_STATE_NAMES, US_STATES } from "@/lib/sales/us-geo"

interface Props {
  proposalId: string
  /** Current state (2-letter abbreviation) or null. */
  value: string | null
  /** "organization" | "contact" | "ignition_client" | null — purely informational. */
  source?: "organization" | "contact" | "ignition_client" | null
  /** Called after a successful save with the new state value. Parent
   * should optimistically update its local copy of the proposal. */
  onSaved: (next: string | null) => void
  /** Disable the trigger entirely, e.g. for read-only roles. */
  disabled?: boolean
}

export function ProposalStateEdit({
  proposalId,
  value,
  source,
  onSaved,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function setState(next: string | null) {
    if (next === value) {
      setOpen(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/sales/proposals/${proposalId}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Failed to update state")
      onSaved(next)
      const targetLabel =
        json.updated === "ignition_client"
          ? "Ignition client"
          : json.updated === "contact"
          ? "contact"
          : "organization"
      toast.success(
        next
          ? `State set to ${US_STATE_NAMES[next] ?? next} on ${targetLabel}`
          : `State cleared on ${targetLabel}`,
      )
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update state")
    } finally {
      setSaving(false)
    }
  }

  const sourceHint =
    source === "organization"
      ? "From organization"
      : source === "contact"
      ? "From contact"
      : source === "ignition_client"
      ? "From Ignition import"
      : "Click to set"

  return (
    <Popover open={open} onOpenChange={(o) => !saving && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 -mx-1.5 rounded text-xs",
            "text-stone-700 hover:bg-stone-100 transition-colors disabled:opacity-50",
            "focus:outline-none focus:ring-1 focus:ring-stone-300",
            !value && "text-stone-400 hover:text-stone-700",
          )}
          title={sourceHint}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin text-stone-400" />
          ) : (
            <span className="tabular-nums">{value || "—"}</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search state…" className="h-8 text-xs" />
          <CommandList className="max-h-64">
            <CommandEmpty className="py-3 text-center text-xs text-stone-500">
              No matches
            </CommandEmpty>
            <CommandGroup heading={sourceHint}>
              <CommandItem
                value="__clear"
                onSelect={() => setState(null)}
                className="text-xs text-stone-500"
              >
                <span className="w-4" />
                Clear state
              </CommandItem>
              {US_STATES.map((abbr) => (
                <CommandItem
                  key={abbr}
                  value={`${abbr} ${US_STATE_NAMES[abbr]}`}
                  onSelect={() => setState(abbr)}
                  className="text-xs"
                >
                  {value === abbr ? (
                    <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                  ) : (
                    <span className="w-4 mr-1.5" />
                  )}
                  <span className="font-mono w-7 text-stone-500">{abbr}</span>
                  <span className="text-stone-700">{US_STATE_NAMES[abbr]}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
