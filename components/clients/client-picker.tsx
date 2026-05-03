"use client"

/**
 * <ClientPicker>
 * ────────────────────────────────────────────────────────────────────────
 * Shared picker for assigning a record to either an Organization or a
 * Contact. Hits the existing `/api/clients?type=all&search=...` endpoint
 * and renders results in a Popover + Command list. Used by every "edit
 * record" sheet (debriefs, invoices, proposals) so a partner can fix the
 * client mapping without leaving the table.
 *
 * Emits a normalized `ClientPickerValue` so the parent always knows whether
 * it picked an org or a contact and can write back to the right FK column
 * (`organization_id` vs `contact_id`).
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Building2, Check, ChevronsUpDown, Search, User, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type ClientKind = "organization" | "contact"

export interface ClientPickerValue {
  id: string
  name: string
  kind: ClientKind
  email?: string | null
  karbon_key?: string | null
}

interface RawClient {
  id: string
  name: string
  email?: string | null
  type: "Organization" | "Contact"
  karbon_key?: string | null
}

interface Props {
  value: ClientPickerValue | null
  onChange: (next: ClientPickerValue | null) => void
  /** Restrict picker to only orgs or only contacts. Defaults to both. */
  kindFilter?: ClientKind | "all"
  placeholder?: string
  disabled?: boolean
  className?: string
  allowClear?: boolean
}

export function ClientPicker({
  value,
  onChange,
  kindFilter = "all",
  placeholder = "Select a client…",
  disabled,
  className,
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [results, setResults] = useState<RawClient[]>([])
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  // Debounce the search input so we don't hammer the API on every keystroke.
  // 200ms is short enough to feel snappy but long enough to skip every
  // intermediate state of "fast" typing.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  // Fetch results when popover is open and the debounced query changes.
  // We track an incrementing request id so out-of-order responses (slow
  // network, fast typing) don't overwrite a newer result set.
  useEffect(() => {
    if (!open) return
    const reqId = ++reqIdRef.current
    setLoading(true)
    const params = new URLSearchParams()
    if (debounced) params.set("search", debounced)
    params.set("type", kindFilter === "all" ? "all" : kindFilter === "organization" ? "organizations" : "contacts")
    params.set("limit", "20")
    fetch(`/api/clients?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (reqIdRef.current !== reqId) return
        setResults(Array.isArray(json?.clients) ? json.clients : [])
      })
      .catch(() => {
        if (reqIdRef.current !== reqId) return
        setResults([])
      })
      .finally(() => {
        if (reqIdRef.current === reqId) setLoading(false)
      })
  }, [open, debounced, kindFilter])

  const grouped = useMemo(() => {
    const orgs: RawClient[] = []
    const contacts: RawClient[] = []
    for (const r of results) {
      if (r.type === "Organization") orgs.push(r)
      else if (r.type === "Contact") contacts.push(r)
    }
    return { orgs, contacts }
  }, [results])

  const Icon = value?.kind === "organization" ? Building2 : value?.kind === "contact" ? User : Search

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <Icon className="h-4 w-4 shrink-0 opacity-60" />
              <span className="truncate">{value?.name || placeholder}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search organizations and contacts…"
            />
            <CommandList>
              {loading ? (
                <div className="p-2 space-y-2">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ) : results.length === 0 ? (
                <CommandEmpty>
                  {debounced ? "No matches found." : "Type to search…"}
                </CommandEmpty>
              ) : (
                <>
                  {grouped.orgs.length > 0 && (
                    <CommandGroup heading="Organizations">
                      {grouped.orgs.map((o) => (
                        <CommandItem
                          key={`o:${o.id}`}
                          value={`o:${o.id}`}
                          onSelect={() => {
                            onChange({
                              id: o.id,
                              name: o.name,
                              kind: "organization",
                              email: o.email,
                              karbon_key: o.karbon_key,
                            })
                            setOpen(false)
                          }}
                          className="flex items-center gap-2"
                        >
                          <Building2 className="h-4 w-4 opacity-60" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{o.name}</div>
                            {o.email && (
                              <div className="truncate text-xs text-muted-foreground">{o.email}</div>
                            )}
                          </div>
                          {value?.kind === "organization" && value.id === o.id && (
                            <Check className="h-4 w-4" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {grouped.contacts.length > 0 && (
                    <CommandGroup heading="Contacts">
                      {grouped.contacts.map((c) => (
                        <CommandItem
                          key={`c:${c.id}`}
                          value={`c:${c.id}`}
                          onSelect={() => {
                            onChange({
                              id: c.id,
                              name: c.name,
                              kind: "contact",
                              email: c.email,
                              karbon_key: c.karbon_key,
                            })
                            setOpen(false)
                          }}
                          className="flex items-center gap-2"
                        >
                          <User className="h-4 w-4 opacity-60" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{c.name}</div>
                            {c.email && (
                              <div className="truncate text-xs text-muted-foreground">{c.email}</div>
                            )}
                          </div>
                          {value?.kind === "contact" && value.id === c.id && (
                            <Check className="h-4 w-4" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowClear && value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onChange(null)}
          title="Clear client mapping"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
