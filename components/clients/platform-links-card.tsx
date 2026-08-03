"use client"

/**
 * PlatformLinksCard
 *
 * Surfaces every external-platform link state for a Master Hub
 * Contact in one card, and lets a teammate link or unlink each
 * platform inline (no need to bounce out to per-platform admin
 * pages).
 *
 * Data flow:
 *   GET /api/contacts/[id]/links              -> current state
 *   GET /api/contacts/[id]/links/candidates   -> picker results
 *   POST /api/contacts/[id]/links             -> link
 *   DELETE /api/contacts/[id]/links           -> unlink
 *
 * Each platform row shows one of three states:
 *   - linked    -> external id chip + "Open" link + Unlink button
 *   - unlinked  -> "Link to <Platform>" button -> opens picker dialog
 *   - n/a       -> only for kinds the platform doesn't support
 *
 * Ignition supports MULTIPLE links per Hub contact (Ignition allows
 * multiple billing records for one client), so its row renders as a
 * list of chips and a separate "Link another" button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  Plus,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

type Platform = "karbon" | "proconnect" | "ignition"

interface IgnitionLink {
  external_id: string
  display_name: string | null
  email: string | null
  business_name: string | null
  match_status: string | null
  match_method: string | null
  match_confidence: number | null
}

interface LinksResponse {
  contact: {
    id: string
    kind: "contact" | "organization"
    display_name: string | null
    primary_email: string | null
  }
  links: {
    karbon:
      | { external_id: string; karbon_url: string }
      | null
    proconnect:
      | {
          external_id: string
          display_name: string | null
          email: string | null
          client_state: string | null
          client_type: string | null
        }
      | null
    ignition: IgnitionLink[]
  }
  mapping: { id: string; updated_at: string } | null
}

interface Candidate {
  external_id: string
  display_name: string | null
  email: string | null
  hint: string | null
}

const PLATFORM_META: Record<
  Platform,
  { label: string; subtitle: string; accent: string }
> = {
  karbon: {
    label: "Karbon",
    subtitle: "CRM and work-item home",
    accent: "bg-emerald-500",
  },
  proconnect: {
    label: "ProConnect",
    subtitle: "Tax-prep platform",
    accent: "bg-sky-500",
  },
  ignition: {
    label: "Ignition",
    subtitle: "Proposals and billing",
    accent: "bg-amber-500",
  },
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

interface Props {
  contactId: string
}

export function PlatformLinksCard({ contactId }: Props) {
  const { toast } = useToast()
  const { data, isLoading, mutate } = useSWR<LinksResponse>(
    `/api/contacts/${contactId}/links`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [pickerPlatform, setPickerPlatform] = useState<Platform | null>(null)
  const [unlinkBusy, setUnlinkBusy] = useState<string | null>(null)

  const handleUnlink = useCallback(
    async (platform: Platform, externalId?: string) => {
      const key = `${platform}:${externalId ?? ""}`
      setUnlinkBusy(key)
      try {
        const url = new URL(
          `/api/contacts/${contactId}/links`,
          window.location.origin,
        )
        url.searchParams.set("platform", platform)
        if (externalId) url.searchParams.set("external_id", externalId)
        const res = await fetch(url.toString(), { method: "DELETE" })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        toast({
          title: `Unlinked from ${PLATFORM_META[platform].label}`,
        })
        await mutate()
      } catch (err) {
        toast({
          title: "Unlink failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        })
      } finally {
        setUnlinkBusy(null)
      }
    },
    [contactId, mutate, toast],
  )

  const handleLinked = useCallback(async () => {
    setPickerPlatform(null)
    await mutate()
  }, [mutate])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          Platform Links
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          This contact is the Master Hub record. Connect or disconnect
          its identity on each platform below — changes mirror into
          the master client mapping immediately.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading || !data ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading platform links…
          </div>
        ) : (
          <>
            {/* Karbon — single link */}
            <PlatformRow
              platform="karbon"
              linkedSummary={
                data.links.karbon ? (
                  <LinkedChip
                    label={data.links.karbon.external_id}
                    href={data.links.karbon.karbon_url}
                  />
                ) : null
              }
              onLink={() => setPickerPlatform("karbon")}
              onUnlink={() => handleUnlink("karbon")}
              unlinkBusy={unlinkBusy === "karbon:"}
            />

            {/* ProConnect — single link */}
            <PlatformRow
              platform="proconnect"
              linkedSummary={
                data.links.proconnect ? (
                  <LinkedChip
                    label={
                      data.links.proconnect.display_name ??
                      data.links.proconnect.external_id
                    }
                    sublabel={
                      [
                        data.links.proconnect.client_type,
                        data.links.proconnect.client_state,
                        data.links.proconnect.email,
                      ]
                        .filter(Boolean)
                        .join(" · ") || null
                    }
                  />
                ) : null
              }
              onLink={() => setPickerPlatform("proconnect")}
              onUnlink={() => handleUnlink("proconnect")}
              unlinkBusy={unlinkBusy === "proconnect:"}
            />

            {/* Ignition — multi-link */}
            <PlatformRow
              platform="ignition"
              linkedSummary={
                data.links.ignition.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.links.ignition.map((ig) => (
                      <LinkedChip
                        key={ig.external_id}
                        label={
                          ig.display_name ??
                          ig.business_name ??
                          ig.external_id
                        }
                        sublabel={ig.email}
                        onUnlink={() =>
                          handleUnlink("ignition", ig.external_id)
                        }
                        unlinkBusy={
                          unlinkBusy === `ignition:${ig.external_id}`
                        }
                      />
                    ))}
                  </div>
                ) : null
              }
              onLink={() => setPickerPlatform("ignition")}
              linkLabel={
                data.links.ignition.length > 0 ? "Link another" : undefined
              }
              hideUnlink
            />
          </>
        )}

        {/* Mapping audit footer */}
        {data?.mapping?.updated_at && (
          <p className="pt-1 text-[10px] text-muted-foreground">
            Master client mapping last updated{" "}
            {new Date(data.mapping.updated_at).toLocaleString()}
          </p>
        )}
      </CardContent>

      <LinkPickerDialog
        platform={pickerPlatform}
        contactId={contactId}
        onClose={() => setPickerPlatform(null)}
        onLinked={handleLinked}
      />
    </Card>
  )
}

// ────────────────────── Row ──────────────────────
function PlatformRow({
  platform,
  linkedSummary,
  onLink,
  onUnlink,
  unlinkBusy,
  hideUnlink,
  linkLabel,
}: {
  platform: Platform
  linkedSummary: React.ReactNode | null
  onLink: () => void
  onUnlink?: () => void
  unlinkBusy?: boolean
  hideUnlink?: boolean
  linkLabel?: string
}) {
  const meta = PLATFORM_META[platform]
  const linked = linkedSummary !== null
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between",
        linked ? "border-border bg-muted/30" : "border-dashed",
      )}
    >
      <div className="flex flex-1 items-start gap-3">
        <span
          className={cn("mt-1.5 h-2 w-2 rounded-full", meta.accent)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-none">{meta.label}</p>
            {!linked && (
              <Badge
                variant="outline"
                className="h-5 border-dashed text-[10px]"
              >
                Not linked
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {meta.subtitle}
          </p>
          {linked && <div className="mt-2">{linkedSummary}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:pt-0.5">
        {linked && !hideUnlink && onUnlink && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onUnlink}
            disabled={unlinkBusy}
            className="h-8 text-xs text-muted-foreground hover:text-destructive"
          >
            {unlinkBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Link2Off className="mr-1 h-3.5 w-3.5" />
                Unlink
              </>
            )}
          </Button>
        )}
        <Button
          variant={linked ? "outline" : "default"}
          size="sm"
          onClick={onLink}
          className="h-8 text-xs"
        >
          {linked ? <Plus className="mr-1 h-3.5 w-3.5" /> : null}
          {linkLabel ?? (linked ? "Replace" : `Link to ${meta.label}`)}
        </Button>
      </div>
    </div>
  )
}

// ────────────────────── Linked Chip ──────────────────────
function LinkedChip({
  label,
  sublabel,
  href,
  onUnlink,
  unlinkBusy,
}: {
  label: string
  sublabel?: string | null
  href?: string
  onUnlink?: () => void
  unlinkBusy?: boolean
}) {
  const inner = (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border bg-card px-2 py-1 text-xs">
      <span className="truncate font-mono text-[11px] text-foreground">
        {label}
      </span>
      {sublabel && (
        <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">
          {sublabel}
        </span>
      )}
      {href && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
      {onUnlink && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onUnlink}
                disabled={unlinkBusy}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                aria-label="Unlink"
              >
                {unlinkBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Link2Off className="h-3 w-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>Unlink this billing record</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  )
}

// ────────────────────── Picker Dialog ──────────────────────
function LinkPickerDialog({
  platform,
  contactId,
  onClose,
  onLinked,
}: {
  platform: Platform | null
  contactId: string
  onClose: () => void
  onLinked: () => void
}) {
  const { toast } = useToast()
  const [q, setQ] = useState("")
  const [debounced, setDebounced] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce the query so we don't hammer the candidates endpoint on
  // every keystroke. 200ms feels responsive without spamming.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200)
    return () => clearTimeout(t)
  }, [q])

  // Reset state when the dialog reopens for a different platform.
  useEffect(() => {
    if (platform) {
      setQ("")
      setDebounced("")
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [platform])

  const swrKey = platform
    ? `/api/contacts/${contactId}/links/candidates?platform=${platform}&q=${encodeURIComponent(debounced)}`
    : null
  const { data, isLoading } = useSWR<{ candidates: Candidate[] }>(
    swrKey,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  const meta = useMemo(
    () => (platform ? PLATFORM_META[platform] : null),
    [platform],
  )

  const handleLink = useCallback(
    async (candidate: Candidate) => {
      if (!platform) return
      setBusyId(candidate.external_id)
      try {
        const res = await fetch(`/api/contacts/${contactId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform,
            external_id: candidate.external_id,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        toast({
          title: `Linked to ${PLATFORM_META[platform].label}`,
          description:
            candidate.display_name ?? candidate.external_id ?? undefined,
        })
        onLinked()
      } catch (err) {
        toast({
          title: "Link failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        })
      } finally {
        setBusyId(null)
      }
    },
    [contactId, onLinked, platform, toast],
  )

  return (
    <Dialog open={!!platform} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Link to {meta?.label ?? "platform"}
          </DialogTitle>
          <DialogDescription>
            Search unlinked records on {meta?.label ?? "the platform"} by
            name, email, or business name. Selecting one creates the
            link immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, or ID…"
            className="pl-9"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto rounded-md border">
          {isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          )}
          {!isLoading && (data?.candidates?.length ?? 0) === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {debounced
                ? "No matching unlinked records."
                : "Type to search, or pick from the list."}
            </div>
          )}
          {!isLoading &&
            data?.candidates?.map((c) => (
              <button
                key={c.external_id}
                type="button"
                onClick={() => handleLink(c)}
                disabled={busyId === c.external_id}
                className="flex w-full items-start justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm hover:bg-muted/50 disabled:opacity-50 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {c.display_name ?? c.external_id}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {c.email && <span className="truncate">{c.email}</span>}
                    {c.hint && (
                      <span className="truncate text-[11px]">{c.hint}</span>
                    )}
                    <span className="font-mono text-[10px]">
                      {c.external_id.slice(0, 16)}
                      {c.external_id.length > 16 ? "…" : ""}
                    </span>
                  </div>
                </div>
                {busyId === c.external_id ? (
                  <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Link2 className="mt-1 h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
