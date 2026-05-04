"use client"

/**
 * <WorkItemPicker>
 * ────────────────────────────────────────────────────────────────────────
 * Searchable picker over the firm's work items. Hits the existing
 * /api/work-items endpoint with the `search` param (which the route
 * routes through Postgres FTS via the GIN index on `search_vector`).
 *
 * Mirrors the API shape of ClientPicker — controlled value/onChange
 * with a normalized object — so callers can drop it into any "tag this
 * record" workflow without learning a new pattern.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Briefcase, Check, ChevronsUpDown, X } from "lucide-react"

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

export interface WorkItemPickerValue {
  id: string
  title: string
  clientName?: string | null
  status?: string | null
}

interface RawWorkItem {
  id: string
  title: string | null
  client_name?: string | null
  status?: string | null
}

interface Props {
  value: WorkItemPickerValue | null
  onChange: (next: WorkItemPickerValue | null) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function WorkItemPicker({
  value,
  onChange,
  placeholder = "Select a work item…",
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [results, setResults] = useState<RawWorkItem[]>([])
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  // Debounce so a fast typist doesn't hammer the API. 200ms feels
  // instant but coalesces "tax season".split('') into one call.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!open) return
    const id = ++reqIdRef.current
    setLoading(true)
    const params = new URLSearchParams()
    if (debounced) params.set("search", debounced)
    params.set("limit", "20")
    fetch(`/api/work-items?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (reqIdRef.current !== id) return
        // /api/work-items canonically returns `{ work_items: [...] }`
        // but historical callers used `items` / `data`. Tolerate every
        // shape so we don't depend on the exact route version.
        const list: RawWorkItem[] =
          (Array.isArray(j?.work_items) && j.work_items) ||
          (Array.isArray(j?.items) && j.items) ||
          (Array.isArray(j?.data) && j.data) ||
          (Array.isArray(j?.workItems) && j.workItems) ||
          []
        setResults(list)
      })
      .catch(() => {
        if (reqIdRef.current !== id) return
        setResults([])
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoading(false)
      })
  }, [open, debounced])

  const filtered = useMemo(
    () => results.filter((r) => r.title && r.title.trim().length > 0),
    [results],
  )

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
              <Briefcase className="h-4 w-4 shrink-0 opacity-60" />
              <span className="truncate">{value?.title || placeholder}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search work items…"
            />
            <CommandList>
              {loading ? (
                <div className="p-2 space-y-2">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ) : filtered.length === 0 ? (
                <CommandEmpty>{debounced ? "No matches found." : "Type to search…"}</CommandEmpty>
              ) : (
                <CommandGroup heading="Work items">
                  {filtered.map((w) => (
                    <CommandItem
                      key={w.id}
                      value={w.id}
                      onSelect={() => {
                        onChange({
                          id: w.id,
                          title: w.title || "Untitled",
                          clientName: w.client_name,
                          status: w.status,
                        })
                        setOpen(false)
                      }}
                      className="flex items-center gap-2"
                    >
                      <Briefcase className="h-4 w-4 opacity-60" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{w.title}</div>
                        {(w.client_name || w.status) && (
                          <div className="truncate text-xs text-muted-foreground">
                            {[w.client_name, w.status].filter(Boolean).join(" • ")}
                          </div>
                        )}
                      </div>
                      {value?.id === w.id && <Check className="h-4 w-4" />}
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
