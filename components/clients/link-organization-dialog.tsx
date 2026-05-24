"use client"

/**
 * LinkOrganizationDialog — used from a contact's People tab to attach
 * the contact to an organization with a role/title (Owner, CEO, CFO,
 * etc.) and optional ownership percentage.
 *
 * Search uses the existing `/api/clients/search` endpoint, which is
 * fed by the denormalized client_profile_summaries view; we only show
 * results whose clientKind === "organization". On submit we POST to
 * `/api/contacts/[id]/organizations`, which upserts the
 * contact_organizations row and marks both profile summaries stale so
 * the People card and the rest of the Client Profile reflect the new
 * affiliation immediately.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Building2, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const ROLE_PRESETS = [
  "Owner",
  "Co-Owner",
  "CEO",
  "President",
  "CFO",
  "COO",
  "Partner",
  "Managing Member",
  "Member",
  "Director",
  "Secretary",
  "Treasurer",
  "Shareholder",
  "Bookkeeper",
  "Controller",
  "Other",
] as const

const CUSTOM_ROLE_VALUE = "__custom__"

type SearchResult = {
  clientId: string
  clientKind: "contact" | "organization"
  displayName: string | null
}

export type LinkOrganizationInitial = {
  relationshipId?: string
  organizationId?: string
  organizationName?: string | null
  roleOrTitle?: string | null
  ownershipPercentage?: number | null
  isPrimaryContact?: boolean
}

export function LinkOrganizationDialog({
  open,
  onOpenChange,
  contactId,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  initial?: LinkOrganizationInitial
  onSaved?: () => void
}) {
  const isEdit = Boolean(initial?.relationshipId)

  const [orgQuery, setOrgQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<{
    id: string
    name: string
  } | null>(null)

  // Role state — mirrors the preset Select; we keep the raw string in
  // `roleCustom` so editing existing values that don't match a preset
  // still round-trips cleanly.
  const initialRole = initial?.roleOrTitle ?? ""
  const initialIsPreset = useMemo(
    () => (ROLE_PRESETS as readonly string[]).includes(initialRole),
    [initialRole],
  )
  const [rolePreset, setRolePreset] = useState<string>(
    initialRole ? (initialIsPreset ? initialRole : CUSTOM_ROLE_VALUE) : "",
  )
  const [roleCustom, setRoleCustom] = useState<string>(
    initialRole && !initialIsPreset ? initialRole : "",
  )
  const [ownership, setOwnership] = useState<string>(
    initial?.ownershipPercentage != null
      ? String(initial.ownershipPercentage)
      : "",
  )
  const [isPrimary, setIsPrimary] = useState<boolean>(
    initial?.isPrimaryContact ?? false,
  )
  const [submitting, setSubmitting] = useState(false)

  // Reset the form whenever the dialog opens with a new initial
  // payload (edit vs. fresh link). Doing this in an effect rather than
  // keying the dialog avoids losing the in-flight Select portal.
  useEffect(() => {
    if (!open) return
    setOrgQuery("")
    setResults([])
    setSelected(
      initial?.organizationId
        ? {
            id: initial.organizationId,
            name: initial.organizationName || "Selected organization",
          }
        : null,
    )
    const role = initial?.roleOrTitle ?? ""
    const preset = (ROLE_PRESETS as readonly string[]).includes(role)
    setRolePreset(role ? (preset ? role : CUSTOM_ROLE_VALUE) : "")
    setRoleCustom(role && !preset ? role : "")
    setOwnership(
      initial?.ownershipPercentage != null
        ? String(initial.ownershipPercentage)
        : "",
    )
    setIsPrimary(Boolean(initial?.isPrimaryContact))
  }, [open, initial])

  // Debounced org search. We filter to clientKind === "organization"
  // client-side because /api/clients/search returns both kinds.
  const queryRef = useRef("")
  useEffect(() => {
    if (isEdit) return // org is locked when editing an existing link
    queryRef.current = orgQuery
    const q = orgQuery.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/clients/search?q=${encodeURIComponent(q)}&limit=10`,
        )
        if (!res.ok) throw new Error(`search failed (${res.status})`)
        const json = await res.json()
        // Drop the request if the user has typed more characters since.
        if (queryRef.current !== orgQuery) return
        const orgs = (json.results ?? []).filter(
          (r: SearchResult) => r.clientKind === "organization",
        )
        setResults(orgs)
      } catch (err) {
        console.error("[v0] org search error:", err)
        setResults([])
      } finally {
        if (queryRef.current === orgQuery) setSearching(false)
      }
    }, 220)
    return () => window.clearTimeout(handle)
  }, [orgQuery, isEdit])

  const resolvedRole =
    rolePreset === CUSTOM_ROLE_VALUE
      ? roleCustom.trim()
      : rolePreset === ""
        ? ""
        : rolePreset

  const canSubmit = isEdit
    ? !submitting
    : Boolean(selected?.id) && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const ownershipNum =
        ownership.trim() === "" ? null : Number(ownership.trim())
      if (
        ownershipNum !== null &&
        (!Number.isFinite(ownershipNum) ||
          ownershipNum < 0 ||
          ownershipNum > 100)
      ) {
        toast.error("Ownership must be between 0 and 100.")
        setSubmitting(false)
        return
      }

      const payload: Record<string, unknown> = {
        role_or_title: resolvedRole || null,
        ownership_percentage: ownershipNum,
        is_primary_contact: isPrimary,
      }

      let res: Response
      if (isEdit && initial?.relationshipId) {
        res = await fetch(`/api/contacts/${contactId}/organizations`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            relationship_id: initial.relationshipId,
            ...payload,
          }),
        })
      } else {
        if (!selected?.id) {
          toast.error("Pick an organization to link.")
          setSubmitting(false)
          return
        }
        res = await fetch(`/api/contacts/${contactId}/organizations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization_id: selected.id,
            ...payload,
          }),
        })
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error || `Request failed (${res.status})`)
      }

      toast.success(isEdit ? "Role updated." : "Organization linked.")
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      console.error("[v0] LinkOrganizationDialog submit error:", err)
      toast.error(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit organization role" : "Link organization"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the role this contact holds at the organization."
              : "Find the organization and choose the role this contact holds there."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Organization picker (locked when editing) */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="org-search">Organization</Label>
            {isEdit ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">
                  {initial?.organizationName || "Selected organization"}
                </span>
              </div>
            ) : selected ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{selected.name}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="org-search"
                    autoFocus
                    placeholder="Search organizations…"
                    value={orgQuery}
                    onChange={(e) => setOrgQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
                {orgQuery.trim().length >= 2 && (
                  <div className="max-h-56 overflow-y-auto rounded-md border">
                    {searching ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Searching…
                      </div>
                    ) : results.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No organizations matched.
                      </div>
                    ) : (
                      <ul className="divide-y">
                        {results.map((r) => (
                          <li key={r.clientId}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                              onClick={() =>
                                setSelected({
                                  id: r.clientId,
                                  name: r.displayName || "(unnamed)",
                                })
                              }
                            >
                              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="truncate">
                                {r.displayName || "(unnamed)"}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Role / title */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="role">Role / title</Label>
            <Select
              value={rolePreset}
              onValueChange={(v) => {
                setRolePreset(v)
                if (v !== CUSTOM_ROLE_VALUE) setRoleCustom("")
              }}
            >
              <SelectTrigger id="role">
                <SelectValue placeholder="Pick a role…" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_PRESETS.filter((r) => r !== "Other").map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_ROLE_VALUE}>
                  Other (specify)
                </SelectItem>
              </SelectContent>
            </Select>
            {rolePreset === CUSTOM_ROLE_VALUE && (
              <Input
                placeholder="Enter custom role"
                value={roleCustom}
                onChange={(e) => setRoleCustom(e.target.value)}
              />
            )}
          </div>

          {/* Ownership */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="ownership">Ownership %</Label>
            <Input
              id="ownership"
              type="number"
              min={0}
              max={100}
              step="0.01"
              placeholder="Optional"
              value={ownership}
              onChange={(e) => setOwnership(e.target.value)}
            />
          </div>

          {/* Primary contact */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            Primary contact for this organization
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Link organization"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
