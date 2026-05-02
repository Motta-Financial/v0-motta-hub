"use client"

/**
 * Match-picker dialog used by the Ignition admin page.
 *
 * Pattern: when the user clicks "Map" on an unmatched Ignition client row,
 * we open this dialog. It loads the full client record + the top-N candidate
 * matches (suggest_ignition_client_candidates) in a single GET, then lets the
 * user pick a candidate, search for a different contact/org, or mark the
 * client as no_match.
 */

import { useState } from "react"
import useSWR from "swr"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Building2, User2, AlertTriangle, CheckCircle2, Search, Ban } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type MatchKind = "contact" | "organization"

interface Candidate {
  match_kind: MatchKind
  matched_id: string
  matched_name: string
  matched_email: string | null
  confidence: number
  method: "email_exact" | "name_fuzzy" | "business_fuzzy"
}

interface ClientRow {
  ignition_client_id: string
  name: string | null
  business_name: string | null
  email: string | null
  phone: string | null
  client_type: string | null
  match_status: string
  match_method: string | null
  match_confidence: number | null
  contact_id: string | null
  organization_id: string | null
  match_notes: string | null
}

interface SearchHit {
  id: string
  name: string
  email: string | null
  kind: MatchKind
}

export function MatchPickerDialog({
  ignitionClientId,
  open,
  onOpenChange,
  onApplied,
}: {
  ignitionClientId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [search, setSearch] = useState("")

  const { data, isLoading, mutate } = useSWR<{
    client: ClientRow
    candidates: Candidate[]
  }>(open && ignitionClientId ? `/api/ignition/clients/${ignitionClientId}/match` : null, fetcher)

  // Free-text search across contacts + organizations to override the
  // suggester when its top picks aren't right.
  const { data: searchData, isLoading: searchLoading } = useSWR<{ results: SearchHit[] }>(
    open && search.trim().length >= 2
      ? `/api/contacts-and-orgs/search?q=${encodeURIComponent(search.trim())}&limit=8`
      : null,
    fetcher,
  )

  const apply = async (matchKind: MatchKind | "no_match", matchedId: string | null) => {
    if (!ignitionClientId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/ignition/clients/${ignitionClientId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_kind: matchKind,
          matched_id: matchedId,
          notes: notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "match failed")
      onApplied()
      onOpenChange(false)
      setNotes("")
      setSearch("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!ignitionClientId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/ignition/clients/${ignitionClientId}/match`, {
        method: "DELETE",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "reset failed")
      mutate()
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const client = data?.client
  const candidates = data?.candidates ?? []
  const hasMatch = client && (client.contact_id || client.organization_id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Map Ignition client</DialogTitle>
          <DialogDescription>
            Link this Ignition client to its matching contact or organization in
            Motta. The mapping cascades to all proposals, invoices, and payments
            for this client.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !client ? (
          <p className="py-4 text-sm text-muted-foreground">Client not found.</p>
        ) : (
          <>
            {/* Source: the Ignition client */}
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                Ignition client
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="text-base font-semibold">
                  {client.business_name || client.name || "(no name)"}
                </div>
                {client.business_name && client.name ? (
                  <div className="text-sm text-muted-foreground">
                    contact: {client.name}
                  </div>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {client.email || "(no email)"} {client.phone ? ` · ${client.phone}` : ""}
              </div>
              {hasMatch ? (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-muted-foreground">
                    Currently {client.match_status.replace("_", " ")} ·{" "}
                    {client.match_method || "—"}
                    {client.match_confidence
                      ? ` · ${Math.round(Number(client.match_confidence) * 100)}%`
                      : ""}
                  </span>
                  <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                    Reset
                  </Button>
                </div>
              ) : null}
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not apply match</AlertTitle>
                <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
              </Alert>
            ) : null}

            <Tabs defaultValue="suggested">
              <TabsList className="w-full">
                <TabsTrigger value="suggested" className="flex-1">
                  Suggested ({candidates.length})
                </TabsTrigger>
                <TabsTrigger value="search" className="flex-1">
                  Search all
                </TabsTrigger>
                <TabsTrigger value="no-match" className="flex-1">
                  No match
                </TabsTrigger>
              </TabsList>

              <TabsContent value="suggested" className="mt-3">
                {candidates.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No automatic candidates found. Try the Search tab to pick a
                    contact or organization manually.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {candidates.map((cand) => (
                      <li
                        key={`${cand.match_kind}-${cand.matched_id}`}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {cand.match_kind === "contact" ? (
                            <User2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium">{cand.matched_name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {cand.matched_email || "(no email)"} · {cand.method.replace("_", " ")}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              Number(cand.confidence) >= 1
                                ? "border-emerald-600/50 text-emerald-700"
                                : Number(cand.confidence) >= 0.7
                                  ? "border-amber-600/50 text-amber-700"
                                  : "border-stone-400/50 text-stone-700"
                            }
                          >
                            {Math.round(Number(cand.confidence) * 100)}%
                          </Badge>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => apply(cand.match_kind, cand.matched_id)}
                          >
                            Apply
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="search" className="mt-3 space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search contacts and organizations…"
                    className="pl-9"
                  />
                </div>

                {searchLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : searchData?.results && searchData.results.length > 0 ? (
                  <ul className="divide-y rounded-md border">
                    {searchData.results.map((hit) => (
                      <li
                        key={`${hit.kind}-${hit.id}`}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {hit.kind === "contact" ? (
                            <User2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium">{hit.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {hit.email || "(no email)"} · {hit.kind}
                            </div>
                          </div>
                        </div>
                        <Button size="sm" disabled={busy} onClick={() => apply(hit.kind, hit.id)}>
                          Apply
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : search.trim().length >= 2 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No matches.</p>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Type at least 2 characters to search.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="no-match" className="mt-3 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Mark this client as having no Motta counterpart. Useful when
                  the Ignition client is a one-off prospect, an internal account,
                  or a duplicate that should be ignored. They will stop showing
                  in the unmatched queue.
                </p>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Reason (optional, e.g. 'duplicate of XYZ', 'test account')"
                />
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => apply("no_match", null)}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Mark as no match
                </Button>
              </TabsContent>
            </Tabs>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
