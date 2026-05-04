"use client"

/**
 * <ServicePicker>
 * ────────────────────────────────────────────────────────────────────────
 * Searchable picker over the firm's service catalog (the `services`
 * table that powers Sales/Ignition). Hits /api/services?search=… so the
 * picker stays in sync with the rest of the app.
 */

import { useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Tag, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export interface ServicePickerValue {
  id: string
  name: string
  category?: string | null
}

interface RawService {
  id: string
  name: string
  category?: string | null
  description?: string | null
}

interface Props {
  value: ServicePickerValue | null
  onChange: (next: ServicePickerValue | null) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ServicePicker({
  value,
  onChange,
  placeholder = "Select a service…",
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [results, setResults] = useState<RawService[]>([])
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  // Fetch on open / query change. We always fetch with `state=active`
  // (the API default) so retired services don't pollute the dropdown.
  useEffect(() => {
    if (!open) return
    const id = ++reqIdRef.current
    setLoading(true)
    const params = new URLSearchParams()
    if (debounced) params.set("search", debounced)
    params.set("limit", "30")
    fetch(`/api/services?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (reqIdRef.current !== id) return
        setResults(Array.isArray(j?.services) ? j.services : [])
      })
      .catch(() => {
        if (reqIdRef.current !== id) return
        setResults([])
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoading(false)
      })
  }, [open, debounced])

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/*
        `modal` keeps the search input alive when the picker is mounted
        inside a Dialog/Sheet — without it the parent focus trap swallows
        keystrokes and the field looks dead. Safe to leave on outside a
        Dialog too.
      */}
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
          >
            <span className="flex items-center gap-2 truncate">
              <Tag className="h-4 w-4 shrink-0 opacity-60" />
              <span className="truncate">{value?.name || placeholder}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search services…" />
            <CommandList>
              {loading ? (
                <div className="p-2 space-y-2">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ) : results.length === 0 ? (
                <CommandEmpty>{debounced ? "No matches." : "Type to search…"}</CommandEmpty>
              ) : (
                <CommandGroup heading="Services">
                  {results.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.id}
                      onSelect={() => {
                        onChange({ id: s.id, name: s.name, category: s.category })
                        setOpen(false)
                      }}
                      className="flex items-center gap-2"
                    >
                      <Tag className="h-4 w-4 opacity-60" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{s.name}</div>
                        {s.category && (
                          <div className="truncate text-xs text-muted-foreground">{s.category}</div>
                        )}
                      </div>
                      {value?.id === s.id && <Check className="h-4 w-4" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onChange(null)}
          title="Clear selection"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
