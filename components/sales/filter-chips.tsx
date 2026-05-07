"use client"

/**
 * Sales filter chip components
 * ────────────────────────────────────────────────────────────────────────
 * These three chip components power the filter bars across every Sales
 * surface (Dashboard, Proposals, Invoices, Services, Recurring Revenue).
 * Centralising them here means the chips look and behave identically on
 * every page — same trigger button, same active-state, same popover
 * geometry — and there's exactly one place to tweak when we want to
 * adjust the filter UX.
 *
 * Why three components instead of one big polymorphic chip:
 *   - `MultiSelectChip`  → discrete enum-like values (status, state, partner)
 *   - `RangeChip`        → numeric min/max ranges (proposal value, invoice amount)
 *   - `DateRangeChip`    → date-from/date-to with an optional date-field selector
 *
 * Each one stays small enough to read in a single screen and the prop
 * surfaces stay specific to the kind of filter they represent.
 */

import { useEffect, useMemo, useState } from "react"
import { Filter as FilterIcon, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

/* ─────────────────────────────────────────────────────────────────────────
 * MultiSelectChip — pick zero or more from a list of options
 * ────────────────────────────────────────────────────────────────────────*/

export interface MultiSelectChipProps {
  /** Label shown on the trigger button (e.g. "Status", "State"). */
  label: string
  /**
   * Available options. Order is preserved as displayed; consumers should
   * pre-sort. Empty / null entries are filtered out automatically.
   */
  options: string[]
  /** Currently selected values. */
  value: string[]
  /** Called with the new array whenever the selection changes. */
  onChange: (next: string[]) => void
  /**
   * Custom display formatter — useful when raw values are codes
   * (e.g. "MA") but the dropdown should show full names ("Massachusetts").
   */
  formatLabel?: (v: string) => string
  /** Override the placeholder shown in the popover's filter input. */
  searchPlaceholder?: string
}

export function MultiSelectChip({
  label,
  options,
  value,
  onChange,
  formatLabel,
  searchPlaceholder,
}: MultiSelectChipProps) {
  const [open, setOpen] = useState(false)
  const cleanOptions = useMemo(
    () => options.filter((o): o is string => typeof o === "string" && o.length > 0),
    [options],
  )

  return (
    // `modal` is set so this chip behaves correctly when used inside a
    // Sheet/Dialog (e.g. the proposal edit sheet). It's a no-op on a
    // normal page, so it's safe to leave on everywhere.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            value.length > 0 ? "border-stone-900 bg-stone-50" : "",
          )}
        >
          <FilterIcon className="h-3.5 w-3.5" />
          {label}
          {value.length > 0 ? (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {value.length}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64" align="start">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder ?? `Filter ${label.toLowerCase()}…`}
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {cleanOptions.map((opt) => {
                const active = value.includes(opt)
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      onChange(active ? value.filter((v) => v !== opt) : [...value, opt])
                    }}
                  >
                    <span
                      className={cn(
                        "mr-2 inline-block h-3 w-3 rounded-sm border",
                        active ? "bg-stone-900 border-stone-900" : "border-stone-300",
                      )}
                    />
                    {formatLabel ? formatLabel(opt) : titleCase(opt)}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {value.length > 0 ? (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs h-7"
              onClick={() => onChange([])}
            >
              <X className="h-3 w-3 mr-1" /> Clear selection
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * RangeChip — numeric min/max range (proposal value, invoice amount, …)
 * ────────────────────────────────────────────────────────────────────────*/

export interface RangeChipProps {
  /** Trigger label (e.g. "Value", "Amount"). */
  label: string
  /** Current min/max as raw strings (so empty stays empty, not 0). */
  min: string
  max: string
  /**
   * Called whenever the user commits a change. Both fields come back as
   * strings; consumers convert to numbers when serialising to the URL.
   */
  onChange: (next: { min: string; max: string }) => void
  /**
   * Optional unit suffix shown next to the input (e.g. "$" prefix style is
   * already part of the layout — pass "USD" for currency-disambiguated
   * fields).
   */
  prefix?: string
  /** Step value for the number inputs. Defaults to 100. */
  step?: number
}

export function RangeChip({
  label,
  min,
  max,
  onChange,
  prefix = "$",
  step = 100,
}: RangeChipProps) {
  const [open, setOpen] = useState(false)
  // We hold local state inside the popover so users can type freely
  // without triggering a fetch on every keystroke. The committed values
  // only flow back when they hit Apply (or close-without-Cancel).
  const [draftMin, setDraftMin] = useState(min)
  const [draftMax, setDraftMax] = useState(max)

  // Re-sync draft when the popover opens (or external props change while open)
  // so the form always reflects the URL state on first render.
  useEffect(() => {
    if (open) {
      setDraftMin(min)
      setDraftMax(max)
    }
  }, [open, min, max])

  const active = (min !== "" && min !== null) || (max !== "" && max !== null)

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            active ? "border-stone-900 bg-stone-50" : "",
          )}
        >
          <FilterIcon className="h-3.5 w-3.5" />
          {label}
          {active ? (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {formatRangeBadge(min, max, prefix)}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-3 w-64" align="start">
        <div className="flex flex-col gap-3">
          <div className="text-xs font-medium text-stone-700 uppercase tracking-wide">
            {label} range
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Min</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  {prefix}
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  step={step}
                  value={draftMin}
                  onChange={(e) => setDraftMin(e.target.value)}
                  className="h-8 pl-5 text-sm"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Max</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  {prefix}
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  step={step}
                  value={draftMax}
                  onChange={(e) => setDraftMax(e.target.value)}
                  className="h-8 pl-5 text-sm"
                  placeholder="∞"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setDraftMin("")
                setDraftMax("")
                onChange({ min: "", max: "" })
                setOpen(false)
              }}
            >
              Clear
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                onChange({ min: draftMin.trim(), max: draftMax.trim() })
                setOpen(false)
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * DateRangeChip — from/to dates with an optional date-field selector
 * ────────────────────────────────────────────────────────────────────────*/

export interface DateFieldOption {
  /** API param value, e.g. "created_at", "accepted_at". */
  value: string
  /** Human label, e.g. "Created", "Accepted". */
  label: string
}

export interface DateRangeChipProps {
  /** Trigger label (e.g. "Date"). */
  label: string
  /** Current "yyyy-MM-dd" strings (empty when not set). */
  from: string
  to: string
  /** Currently selected date field (e.g. "created_at"). */
  field: string
  /**
   * Available date fields. When omitted we render a date range without a
   * field selector — useful when the consumer only has one meaningful
   * date column.
   */
  fieldOptions?: DateFieldOption[]
  onChange: (next: { from: string; to: string; field: string }) => void
}

export function DateRangeChip({
  label,
  from,
  to,
  field,
  fieldOptions,
  onChange,
}: DateRangeChipProps) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [draftField, setDraftField] = useState(field)

  useEffect(() => {
    if (open) {
      setDraftFrom(from)
      setDraftTo(to)
      setDraftField(field)
    }
  }, [open, from, to, field])

  const active = !!from || !!to
  const fieldLabel =
    fieldOptions?.find((o) => o.value === field)?.label ?? null

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1",
            active ? "border-stone-900 bg-stone-50" : "",
          )}
        >
          <FilterIcon className="h-3.5 w-3.5" />
          {label}
          {active ? (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {formatDateBadge(from, to, fieldLabel)}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-3 w-72" align="start">
        <div className="flex flex-col gap-3">
          {fieldOptions && fieldOptions.length > 1 ? (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Field</label>
              <select
                value={draftField}
                onChange={(e) => setDraftField(e.target.value)}
                className="h-8 rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                {fieldOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">From</label>
              <Input
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">To</label>
              <Input
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setDraftFrom("")
                setDraftTo("")
                onChange({ from: "", to: "", field: draftField })
                setOpen(false)
              }}
            >
              Clear
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                onChange({
                  from: draftFrom,
                  to: draftTo,
                  field: draftField,
                })
                setOpen(false)
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────*/

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Compact pill for a numeric range, e.g. "$1k–$10k", "≥ $5k", "≤ $1k". */
function formatRangeBadge(min: string, max: string, prefix: string): string {
  const fmt = (n: number) => {
    if (Math.abs(n) >= 1000) return `${prefix}${(n / 1000).toFixed(0)}k`
    return `${prefix}${n}`
  }
  const minN = min !== "" && min !== null ? Number(min) : null
  const maxN = max !== "" && max !== null ? Number(max) : null
  if (minN != null && maxN != null) return `${fmt(minN)}–${fmt(maxN)}`
  if (minN != null) return `≥ ${fmt(minN)}`
  if (maxN != null) return `≤ ${fmt(maxN)}`
  return ""
}

/** Compact pill for a date range, e.g. "Jan 1–Mar 31", "since Jan 1". */
function formatDateBadge(
  from: string,
  to: string,
  fieldLabel: string | null,
): string {
  const short = (iso: string) => {
    if (!iso) return ""
    try {
      const [y, m, d] = iso.split("-").map((n) => Number(n))
      const date = new Date(y, (m || 1) - 1, d || 1)
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    } catch {
      return iso
    }
  }
  let core: string
  if (from && to) core = `${short(from)}–${short(to)}`
  else if (from) core = `since ${short(from)}`
  else if (to) core = `until ${short(to)}`
  else core = ""
  return fieldLabel ? `${fieldLabel}: ${core}` : core
}
