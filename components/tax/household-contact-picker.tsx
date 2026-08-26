"use client"

/**
 * HouseholdContactPicker — search-and-pick an EXISTING contact.
 *
 * Shared by the spouse and dependent add flows on the household tab.
 * Both flows link an existing Hub contact; neither creates one, so this
 * is deliberately just a search picker (no "create new" fallback, unlike
 * components/intake/intake-client-link.tsx which this borrows its
 * debounced-search shape from).
 */

import { useEffect, useRef, useState } from "react"
import { Loader2, Search, User } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type ContactHit = {
  id: string
  name: string
  email: string | null
  kind: "contact" | "organization"
}

export function HouseholdContactPicker({
  excludeContactId,
  onPick,
  autoFocus,
}: {
  /** Never offer the profile's own contact as a match. */
  excludeContactId: string
  onPick: (contact: { id: string; name: string }) => void
  autoFocus?: boolean
}) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<ContactHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastQueryRef = useRef("")

  useEffect(() => {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      setResults([])
      return
    }
    const handle = setTimeout(async () => {
      lastQueryRef.current = trimmed
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/contacts-and-orgs/search?q=${encodeURIComponent(trimmed)}&limit=10`,
        )
        const json = await res.json()
        if (lastQueryRef.current !== trimmed) return
        const contacts = ((json.results ?? []) as ContactHit[]).filter(
          (r) => r.kind === "contact" && r.id !== excludeContactId,
        )
        setResults(contacts)
      } catch {
        setError("Search failed")
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [q, excludeContactId])

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search contacts by name or email…"
          className="h-9 pl-7 text-sm"
        />
      </div>
      {loading && (
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
        </div>
      )}
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
      <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
        {results.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onPick({ id: r.id, name: r.name })}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted",
              )}
            >
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{r.name}</span>
                {r.email && (
                  <span className="ml-1 text-xs text-muted-foreground">{r.email}</span>
                )}
              </span>
            </button>
          </li>
        ))}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <li className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            {"No contacts match "}&quot;{q}&quot;
          </li>
        )}
        {q.trim().length < 2 && (
          <li className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            Type at least 2 characters to search.
          </li>
        )}
      </ul>
    </div>
  )
}
