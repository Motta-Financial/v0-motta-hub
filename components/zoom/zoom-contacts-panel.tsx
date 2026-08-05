"use client"

/**
 * <ZoomContactsPanel>
 * ────────────────────────────────────────────────────────────────────────
 * The "Zoom Contacts" tab of /meetings/zoom. Lists the synced Zoom Team
 * Chat directory (`zoom_contacts` via /api/zoom/contacts) with each
 * contact's Hub link status:
 *
 *   • linked      → green badge, deep-links to the Hub contact/org
 *   • unlinked    → amber badge (external contact with no Hub match yet)
 *   • internal    → muted badge (the firm's own directory)
 *
 * The hourly Zoom link sweep keeps this fresh; "Sync now" gives admins an
 * on-demand pull. External contacts are auto-created as Hub contacts on
 * sync, so "unlinked" should trend toward zero.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  BadgeCheck,
  Building2,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"

interface ZoomContactRow {
  id: string
  contact_type: "external" | "company"
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string | null
  department: string | null
  job_title: string | null
  match_method: string | null
  hub_contact_id: string | null
  hub_organization_id: string | null
  synced_at: string | null
  contacts?: { id: string; full_name: string | null; is_prospect: boolean | null } | null
  organizations?: { id: string; name: string | null } | null
  team_members?: { id: string; full_name: string | null } | null
}

type TypeFilter = "all" | "external" | "company"

const PAGE_SIZE = 50

export function ZoomContactsPanel({ searchQuery = "" }: { searchQuery?: string }) {
  const [contacts, setContacts] = useState<ZoomContactRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("external")
  const [localQuery, setLocalQuery] = useState("")
  const [debouncedLocal, setDebouncedLocal] = useState("")
  const { toast } = useToast()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLocal(localQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [localQuery])

  const effectiveQuery = (searchQuery || debouncedLocal).trim()

  const load = useCallback(
    async (opts: { append: boolean; offset: number }) => {
      if (opts.append) setLoadingMore(true)
      else setLoading(true)
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(opts.offset),
        })
        if (effectiveQuery) params.set("q", effectiveQuery)
        if (typeFilter !== "all") params.set("type", typeFilter)
        const res = await fetch(`/api/zoom/contacts?${params.toString()}`)
        const json = res.ok ? await res.json() : { contacts: [], total: 0 }
        setTotal(json.total ?? 0)
        setContacts((prev) =>
          opts.append ? [...prev, ...(json.contacts ?? [])] : json.contacts ?? [],
        )
      } catch {
        if (!opts.append) setContacts([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [effectiveQuery, typeFilter],
  )

  useEffect(() => {
    load({ append: false, offset: 0 })
  }, [load])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/zoom/contacts", { method: "POST" })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.ok) {
        toast({
          title: "Zoom contacts synced",
          description: `${json.contactsUpserted ?? 0} contacts across ${json.connectionsScanned ?? 0} connections · ${json.hubMatched ?? 0} matched · ${json.hubCreated ?? 0} new Hub contacts.${
            json.errors?.length ? ` ${json.errors.length} connection(s) reported errors.` : ""
          }`,
        })
        await load({ append: false, offset: 0 })
      } else if (res.status === 403 || res.status === 401) {
        toast({
          title: "Admin access required",
          description: "Only firm admins can trigger the Zoom contacts sync.",
          variant: "destructive",
        })
      } else {
        toast({
          title: "Contacts sync failed",
          description: json.error || "Something went wrong syncing Zoom contacts.",
          variant: "destructive",
        })
      }
    } catch {
      toast({
        title: "Contacts sync failed",
        description: "Something went wrong syncing Zoom contacts.",
        variant: "destructive",
      })
    } finally {
      setSyncing(false)
    }
  }

  const displayName = (c: ZoomContactRow) =>
    c.display_name ||
    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
    c.email ||
    "Unknown contact"

  return (
    <div className="space-y-4">
      {/* Header row: explainer + sync */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-2 shrink-0">
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Zoom contact directory</p>
            <p className="text-xs text-muted-foreground">
              Team Chat contacts pulled from every connected Zoom account. External contacts are
              matched to Hub contacts automatically (and created when missing), so meetings with
              these people auto-link to the right client.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {syncing ? "Syncing..." : "Sync now"}
        </Button>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {!searchQuery && (
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Search Zoom contacts by name or email..."
              className="pl-9"
            />
          </div>
        )}
        <div className="flex items-center gap-1 rounded-lg border p-1">
          {(
            [
              { key: "external", label: "External" },
              { key: "company", label: "Company" },
              { key: "all", label: "All" },
            ] as Array<{ key: TypeFilter; label: string }>
          ).map((f) => (
            <Button
              key={f.key}
              variant={typeFilter === f.key ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTypeFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : contacts.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">
            {effectiveQuery
              ? "No Zoom contacts match your search."
              : "No Zoom contacts synced yet. Hit Sync now — if nothing arrives, the Zoom app may need the team_chat:read:list_contacts scope (reconnect after adding it)."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {contacts.map((c) => {
            const hubContact = c.contacts
            const hubOrg = c.organizations
            const linked = !!(hubContact || hubOrg)
            const internal = c.contact_type === "company" || c.match_method === "internal_directory"
            return (
              <Card key={c.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium truncate">{displayName(c)}</p>
                      {internal ? (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          Internal
                        </Badge>
                      ) : linked ? (
                        <Badge
                          variant="outline"
                          className="gap-1 font-normal border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        >
                          <BadgeCheck className="h-3 w-3" />
                          Linked to Hub
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="font-normal border-amber-500/40 text-amber-700 dark:text-amber-400"
                        >
                          Not linked
                        </Badge>
                      )}
                      {hubContact?.is_prospect ? (
                        <Badge variant="secondary" className="font-normal">
                          Prospect
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {c.email && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </span>
                      )}
                      {c.job_title && <span>{c.job_title}</span>}
                      {c.department && <span>{c.department}</span>}
                      {c.team_members?.full_name && (
                        <span>via {c.team_members.full_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {hubContact?.id && (
                      <Button size="sm" variant="outline" asChild title="Open Hub contact">
                        <Link href={`/clients/${hubContact.id}`}>
                          <UserRound className="h-4 w-4 mr-1" />
                          Hub contact
                        </Link>
                      </Button>
                    )}
                    {hubOrg?.id && (
                      <Button size="sm" variant="outline" asChild title="Open Hub organization">
                        <Link href={`/clients/${hubOrg.id}`}>
                          <Building2 className="h-4 w-4 mr-1" />
                          {hubOrg.name || "Organization"}
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {!loading && contacts.length < total && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => load({ append: true, offset: contacts.length })}
            disabled={loadingMore}
          >
            {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load more ({total - contacts.length} more)
          </Button>
        </div>
      )}
    </div>
  )
}
