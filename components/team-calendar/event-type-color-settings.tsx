"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Loader2, RotateCcw } from "lucide-react"
import { useUser } from "@/contexts/user-context"
import type { EventTypeColorEntry } from "./types"

/**
 * Firm-wide color settings for Calendly meeting types.
 *
 * Renders one row per distinct `event_type_name`, sorted by usage count.
 * Each row has a swatch + native color picker + hex text input. Edits
 * are buffered locally; "Save changes" sends the diff to the PATCH
 * endpoint as a single batch upsert. A null color (via the "Reset"
 * action on a row) deletes the override and reverts to Calendly's own
 * default the next time the data is fetched.
 *
 * Why not save per-row? On a calendar where many types share the same
 * base color, the partner is often retuning a palette holistically —
 * batching keeps the round-trips down to one and gives a clear
 * commit/cancel boundary.
 */

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: EventTypeColorEntry[]
  /** Called after a successful save so the parent can re-fetch. */
  onSaved: () => void
}

interface Pending {
  /** undefined = unchanged; null = reset; string = new override hex */
  [event_type_name: string]: string | null | undefined
}

const HEX_RE = /^#[0-9a-f]{6}$/i

export function EventTypeColorSettings({ open, onOpenChange, entries, onSaved }: Props) {
  const { teamMember } = useUser()
  const [pending, setPending] = useState<Pending>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset buffer whenever the dialog reopens — stale draft state across
  // sessions would silently revert other teammates' changes on save.
  useEffect(() => {
    if (open) {
      setPending({})
      setError(null)
    }
  }, [open])

  const dirtyCount = useMemo(
    () => Object.values(pending).filter((v) => v !== undefined).length,
    [pending],
  )

  const renderedColor = (e: EventTypeColorEntry): string => {
    const p = pending[e.event_type_name]
    if (p === null) return e.default ?? "#64748b"
    if (typeof p === "string") return p
    return e.color
  }

  const renderedIsOverride = (e: EventTypeColorEntry): boolean => {
    const p = pending[e.event_type_name]
    if (p === null) return false
    if (typeof p === "string") return p.toLowerCase() !== (e.default ?? "").toLowerCase()
    return e.isOverride
  }

  const setColor = (name: string, hex: string) => {
    setPending((prev) => ({ ...prev, [name]: hex }))
  }

  const resetRow = (name: string) => {
    setPending((prev) => ({ ...prev, [name]: null }))
  }

  const handleSave = async () => {
    setError(null)
    // Validate every dirty hex value before opening the network round-trip
    // — surfaces typos in the text input ("#123" vs "#112233") immediately.
    const overrides: Array<{ event_type_name: string; color: string | null }> = []
    for (const [name, value] of Object.entries(pending)) {
      if (value === undefined) continue
      if (value === null) {
        overrides.push({ event_type_name: name, color: null })
        continue
      }
      if (!HEX_RE.test(value)) {
        setError(`"${value}" isn't a valid hex color for "${name}".`)
        return
      }
      overrides.push({ event_type_name: name, color: value.toLowerCase() })
    }
    if (overrides.length === 0) {
      onOpenChange(false)
      return
    }
    try {
      setSaving(true)
      const res = await fetch("/api/calendly/event-type-colors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overrides,
          team_member_id: teamMember?.id ?? null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "Save failed.")
        return
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      console.error("[event-type-colors] save error:", e)
      setError("Network error — try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Meeting type colors</DialogTitle>
          <DialogDescription>
            Color codes apply to every teammate&apos;s view of the team calendar. Changes are
            shared across the firm.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[420px] rounded-md border">
          <div className="divide-y">
            {entries.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No meeting types found yet — connect a Calendly account and run a sync.
              </div>
            ) : (
              entries.map((e) => {
                const color = renderedColor(e)
                const isOverride = renderedIsOverride(e)
                return (
                  <div
                    key={e.event_type_name}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    {/* Native color input doubles as the swatch — clicking
                        it opens the OS color picker. We layer a square div
                        on top to give it a consistent rounded look. */}
                    <label className="relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center">
                      <input
                        type="color"
                        value={
                          // browsers won't accept #rrggbbaa here — strip
                          // alpha if it slipped in from a future override
                          /^#[0-9a-f]{6}$/i.test(color) ? color : "#64748b"
                        }
                        onChange={(ev) => setColor(e.event_type_name, ev.target.value)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        aria-label={`Color for ${e.event_type_name}`}
                      />
                      <span
                        className="block h-7 w-7 rounded-md border border-stone-300 shadow-inner"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                    </label>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {e.event_type_name}
                        </span>
                        {isOverride ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Custom
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">{e.count} meetings</span>
                        {e.default ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>Calendly default {e.default}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <Input
                      value={color}
                      onChange={(ev) => setColor(e.event_type_name, ev.target.value)}
                      className="h-8 w-[110px] font-mono text-xs"
                      spellCheck={false}
                      aria-label={`Hex color for ${e.event_type_name}`}
                    />

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => resetRow(e.event_type_name)}
                      disabled={!isOverride}
                      title="Reset to Calendly default"
                      aria-label={`Reset ${e.event_type_name} to Calendly default`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>

        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : null}

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {dirtyCount > 0
              ? `${dirtyCount} pending change${dirtyCount === 1 ? "" : "s"}`
              : "No pending changes"}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || dirtyCount === 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
