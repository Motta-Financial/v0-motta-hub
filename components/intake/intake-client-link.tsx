"use client"

/**
 * Reusable "linked client" widget for the Jotform intake detail sheet.
 *
 * Each intake submission has TWO independent client links:
 *
 *   1. Prospect side  — `contact_id` / `organization_id`
 *   2. Referral side  — `referral_contact_id` / `referral_organization_id`
 *
 * This component renders one of those slots. When a link exists it shows
 * the linked record's name with a deep-link to `/contacts/[id]` or
 * `/organizations/[id]`. When no link exists it exposes a search-and-pick
 * popover (against `/api/contacts-and-orgs/search`) plus a fallback
 * "Create new" form that POSTs `/api/clients/create-and-link` so the new
 * record is created AND wired up to this submission in one shot.
 *
 * The component is purely presentational — the parent owns the
 * submission state (via SWR) and is responsible for re-fetching after a
 * successful link/create. We expose `onLinked` for that hook.
 */

import { useEffect, useRef, useState } from "react"
import {
  Building2,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  User,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type LinkSlot = "submitter" | "referral"

export interface LinkedClient {
  type: "contact" | "organization"
  id: string
  name: string
  email: string | null
}

interface SearchHit {
  id: string
  name: string
  email: string | null
  kind: "contact" | "organization"
}

interface Props {
  submissionId: string
  slot: LinkSlot
  /** Existing link, hydrated by the API. `null` → render the picker. */
  linked: LinkedClient | null
  /**
   * Optional fallback display text shown when `linked` is null. For the
   * referral slot we pass the raw `referral_source` string so the UI
   * still tells the triager who the prospect named even before they
   * resolve it to a real client record.
   */
  fallbackLabel?: string | null
  /** Default values for the inline "create new" form. */
  defaults?: {
    firstName?: string | null
    lastName?: string | null
    fullName?: string | null
    organizationName?: string | null
    email?: string | null
    phone?: string | null
  }
  /**
   * Allow the triager to edit the underlying name (prospect name or
   * referral_source string) directly from the picker. When editing,
   * the new value is persisted via PATCH /api/jotform/intake/[id] so
   * the next sync, briefing, or Karbon note also reflects the
   * correction. When omitted (or false) the edit affordance is hidden.
   */
  editable?: boolean
  /** Re-fetch the parent after a successful mutation. */
  onLinked?: () => void
}

export function IntakeClientLink({
  submissionId,
  slot,
  linked,
  fallbackLabel,
  defaults,
  editable,
  onLinked,
}: Props) {
  if (linked) {
    return (
      <LinkedDisplay
        submissionId={submissionId}
        slot={slot}
        linked={linked}
        onUnlinked={onLinked}
      />
    )
  }
  return (
    <Unlinked
      submissionId={submissionId}
      slot={slot}
      fallbackLabel={fallbackLabel}
      defaults={defaults}
      editable={editable}
      onLinked={onLinked}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Linked state — show the record + offer "Change" / "Unlink"
// ─────────────────────────────────────────────────────────────────────────────

function LinkedDisplay({
  submissionId,
  slot,
  linked,
  onUnlinked,
}: {
  submissionId: string
  slot: LinkSlot
  linked: LinkedClient
  onUnlinked?: () => void
}) {
  const [working, setWorking] = useState(false)
  const href =
    linked.type === "contact" ? `/contacts/${linked.id}` : `/organizations/${linked.id}`
  const Icon = linked.type === "contact" ? User : Building2

  async function unlink() {
    setWorking(true)
    try {
      // Clearing both columns of the pair leaves the record
      // unlinked. The PATCH route accepts null to clear.
      const body =
        slot === "submitter"
          ? { contact_id: null, organization_id: null }
          : { referral_contact_id: null, referral_organization_id: null }
      const res = await fetch(`/api/jotform/intake/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      onUnlinked?.()
    } catch (err) {
      console.error("[v0] unlink intake client:", err)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2">
      <a
        href={href}
        className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
        <span className="truncate font-medium text-emerald-900">{linked.name}</span>
        {linked.email && (
          <span className="truncate text-xs text-emerald-900/70">· {linked.email}</span>
        )}
        <ExternalLink className="ml-1 h-3 w-3 shrink-0 text-emerald-700/70" />
      </a>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-emerald-900 hover:bg-emerald-100"
        disabled={working}
        onClick={unlink}
      >
        {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        <span className="ml-1">Unlink</span>
      </Button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Unlinked state — search + create
// ─────────────────────────────────────────────────────────────────────────────

function Unlinked({
  submissionId,
  slot,
  fallbackLabel,
  defaults,
  editable,
  onLinked,
}: {
  submissionId: string
  slot: LinkSlot
  fallbackLabel?: string | null
  defaults?: Props["defaults"]
  editable?: boolean
  onLinked?: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  // Inline name editor — the triager can correct a typo in the
  // submitted name (e.g. "Ryan Ciracello" → "Ryan Cirasiello") so the
  // search picker actually finds the underlying client record. The
  // edited value persists to the intake row, so downstream workflows
  // (Karbon note, briefing) also see the corrected spelling.
  const [editing, setEditing] = useState(false)
  // What we should *display* and *seed the search with* now.
  // Starts as fallbackLabel and gets replaced in-place when the user
  // saves an edit. We can't read it from the parent because parent
  // re-fetch lags behind the optimistic UI moment.
  const [displayLabel, setDisplayLabel] = useState<string | null>(fallbackLabel ?? null)
  // Keep the local state in sync if the parent SWR cache refreshes
  // with a new fallbackLabel (e.g. after another tab edited the row).
  useEffect(() => {
    setDisplayLabel(fallbackLabel ?? null)
  }, [fallbackLabel])

  return (
    <div className="space-y-2 rounded-md border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-amber-900">
        <Link2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">
          {displayLabel ? (
            <>
              <span className="font-medium">{displayLabel}</span>
              <span className="ml-1 text-amber-900/70">— not linked to a client yet</span>
            </>
          ) : (
            <span>No client linked</span>
          )}
        </span>
        {editable && !editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[11px] text-amber-900 hover:bg-amber-100"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" />
            Edit name
          </Button>
        )}
      </div>

      {editing && (
        <NameEditor
          submissionId={submissionId}
          slot={slot}
          initialValue={displayLabel ?? ""}
          onSaved={(newLabel) => {
            setDisplayLabel(newLabel)
            setEditing(false)
            onLinked?.()
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="flex flex-wrap gap-1.5">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs">
              <Search className="mr-1 h-3 w-3" /> Link to existing
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <SearchPicker
              submissionId={submissionId}
              slot={slot}
              initialQuery={
                displayLabel ?? defaults?.fullName ?? defaults?.organizationName ?? ""
              }
              onPicked={() => {
                setPickerOpen(false)
                onLinked?.()
              }}
            />
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? <X className="mr-1 h-3 w-3" /> : <Plus className="mr-1 h-3 w-3" />}
          {createOpen ? "Cancel" : "Create new client"}
        </Button>
      </div>

      {createOpen && (
        <CreateClientForm
          submissionId={submissionId}
          slot={slot}
          defaults={{ ...defaults, fullName: displayLabel ?? defaults?.fullName ?? null }}
          fallbackLabel={displayLabel}
          onCreated={() => {
            setCreateOpen(false)
            onLinked?.()
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline name editor — corrects typos in the submitted name / referral
// source. Sends a PATCH to /api/jotform/intake/[id] so the change
// sticks across reloads.
// ─────────────────────────────────────────────────────────────────────────────

function NameEditor({
  submissionId,
  slot,
  initialValue,
  onSaved,
  onCancel,
}: {
  submissionId: string
  slot: LinkSlot
  initialValue: string
  onSaved: (newLabel: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const trimmed = value.trim()
    if (!trimmed) {
      setError("Name can't be empty")
      return
    }
    setSaving(true)
    setError(null)
    try {
      // For the prospect slot we update the canonical first/last/full
      // triple together so downstream consumers (Karbon notes, briefing,
      // initials avatar) all see the corrected spelling. For the
      // referral slot we update `referral_source` only — there is no
      // first/last decomposition.
      const body: Record<string, string | null> =
        slot === "submitter"
          ? (() => {
              const parts = trimmed.split(/\s+/)
              const first = parts[0] ?? ""
              const last = parts.slice(1).join(" ")
              return {
                submitter_full_name: trimmed,
                submitter_first_name: first || null,
                submitter_last_name: last || null,
              }
            })()
          : { referral_source: trimmed }

      const res = await fetch(`/api/jotform/intake/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved(trimmed)
    } catch (err: any) {
      setError(err?.message ?? "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-amber-300 bg-background p-2">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save()
            if (e.key === "Escape") onCancel()
          }}
          placeholder={slot === "submitter" ? "Prospect's full name" : "Referral source name"}
          className="h-8 text-sm"
          disabled={saving}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={save}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs"
          onClick={onCancel}
          disabled={saving}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <p className="text-[11px] text-muted-foreground">
        Saving updates the intake record so the search and Karbon note use the corrected name.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Search picker — debounced fetch against /api/contacts-and-orgs/search
// ─────────────────────────────────────────────────────────────────────────────

function SearchPicker({
  submissionId,
  slot,
  initialQuery,
  onPicked,
}: {
  submissionId: string
  slot: LinkSlot
  initialQuery: string
  onPicked: () => void
}) {
  const [q, setQ] = useState(initialQuery)
  const [results, setResults] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)
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
      try {
        const res = await fetch(
          `/api/contacts-and-orgs/search?q=${encodeURIComponent(trimmed)}&limit=8`,
        )
        const json = await res.json()
        // Drop stale responses if the user has typed further in the
        // meantime — `lastQueryRef` always reflects the most recent
        // dispatched query.
        if (lastQueryRef.current !== trimmed) return
        setResults(json.results ?? [])
      } catch (err) {
        setError("Search failed")
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [q])

  async function pick(hit: SearchHit) {
    setLinking(hit.id)
    setError(null)
    try {
      const body =
        slot === "submitter"
          ? hit.kind === "contact"
            ? { contact_id: hit.id, organization_id: null }
            : { contact_id: null, organization_id: hit.id }
          : hit.kind === "contact"
            ? { referral_contact_id: hit.id, referral_organization_id: null }
            : { referral_contact_id: null, referral_organization_id: hit.id }

      const res = await fetch(`/api/jotform/intake/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      onPicked()
    } catch (err: any) {
      setError(err?.message ?? "Failed to link")
    } finally {
      setLinking(null)
    }
  }

  return (
    <div className="space-y-2 p-2">
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients by name or email…"
          className="h-8 pl-7 text-sm"
        />
      </div>
      {loading && (
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
        </div>
      )}
      {error && <p className="px-1 text-xs text-red-600">{error}</p>}
      <ul className="max-h-64 overflow-y-auto">
        {results.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            <button
              type="button"
              onClick={() => pick(r)}
              disabled={!!linking}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                linking === r.id && "opacity-60",
              )}
            >
              {r.kind === "contact" ? (
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{r.name}</span>
                {r.email && (
                  <span className="ml-1 text-xs text-muted-foreground">{r.email}</span>
                )}
              </span>
              {linking === r.id && (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
              )}
            </button>
          </li>
        ))}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <li className="px-2 py-3 text-center text-xs text-muted-foreground">
            No clients match "{q}"
          </li>
        )}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Create-new form — pre-filled from intake answers when applicable
// ─────────────────────────────────────────────────────────────────────────────

function CreateClientForm({
  submissionId,
  slot,
  defaults,
  fallbackLabel,
  onCreated,
}: {
  submissionId: string
  slot: LinkSlot
  defaults?: Props["defaults"]
  fallbackLabel?: string | null
  onCreated: () => void
}) {
  // Try to split a single string into first/last when the parent only
  // gave us a full name (always the case for the referral slot).
  function splitName(full: string | null | undefined): [string, string] {
    const s = (full || "").trim()
    if (!s) return ["", ""]
    const parts = s.split(/\s+/)
    if (parts.length === 1) return [parts[0], ""]
    return [parts[0], parts.slice(1).join(" ")]
  }

  const [seedFirst, seedLast] =
    defaults?.firstName || defaults?.lastName
      ? [defaults?.firstName ?? "", defaults?.lastName ?? ""]
      : splitName(defaults?.fullName ?? fallbackLabel)

  const [type, setType] = useState<"contact" | "organization">(
    defaults?.organizationName && !seedFirst ? "organization" : "contact",
  )
  const [firstName, setFirstName] = useState(seedFirst)
  const [lastName, setLastName] = useState(seedLast)
  const [orgName, setOrgName] = useState(defaults?.organizationName ?? "")
  const [email, setEmail] = useState(defaults?.email ?? "")
  const [phone, setPhone] = useState(defaults?.phone ?? "")
  const [createInKarbon, setCreateInKarbon] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/clients/create-and-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          firstName: type === "contact" ? firstName : undefined,
          lastName: type === "contact" ? lastName : undefined,
          name: type === "organization" ? orgName : undefined,
          email: email || undefined,
          phone: phone || undefined,
          createInKarbon,
          linkToRecord: {
            type:
              slot === "submitter"
                ? "jotform_intake_submitter"
                : "jotform_intake_referral",
            id: submissionId,
          },
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Create failed (${res.status})`)
      onCreated()
    } catch (err: any) {
      setError(err?.message ?? "Failed to create client")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={type === "contact" ? "default" : "outline"}
          className="h-7 flex-1 text-xs"
          onClick={() => setType("contact")}
        >
          <User className="mr-1 h-3 w-3" /> Person
        </Button>
        <Button
          type="button"
          size="sm"
          variant={type === "organization" ? "default" : "outline"}
          className="h-7 flex-1 text-xs"
          onClick={() => setType("organization")}
        >
          <Building2 className="mr-1 h-3 w-3" /> Business
        </Button>
      </div>

      {type === "contact" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">First name</Label>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Last name</Label>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="h-8 text-sm"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Business name</Label>
          <Input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            className="h-8 text-sm"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Phone</Label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={createInKarbon}
          onChange={(e) => setCreateInKarbon(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Also create in Karbon
      </label>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}

      <Button type="submit" size="sm" className="h-8 w-full text-xs" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Creating…
          </>
        ) : (
          <>
            <Check className="mr-1 h-3 w-3" /> Create &amp; link
          </>
        )}
      </Button>
    </form>
  )
}
