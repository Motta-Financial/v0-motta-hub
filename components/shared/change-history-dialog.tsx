"use client"

/**
 * Reusable change-history (audit trail) viewer.
 *
 * Renders a timeline of edits for any audited entity. Fetches from
 * `GET /api/audit/[entityType]/[entityId]` when opened and shows, per
 * entry: actor, timestamp, a human description, and an expandable
 * field-level diff (from → to).
 */

import { useState } from "react"
import useSWR from "swr"
import { ChevronDown, History, Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type AuditEntityType = "contact" | "organization" | "deal" | "project"

interface AuditEntry {
  id: string
  action: string
  description: string | null
  changes: Record<string, { from: unknown; to: unknown }>
  metadata: Record<string, unknown> | null
  created_at: string
  actor_name: string | null
  actor_avatar_url: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityType: AuditEntityType
  entityId: string
  entityLabel?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "")
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—"
  if (typeof v === "object") {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  if (typeof v === "boolean") return v ? "Yes" : "No"
  return String(v)
}

function fieldLabel(field: string): string {
  return field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ChangeHistoryDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityLabel,
}: Props) {
  const { data, error, isLoading } = useSWR<{ changes: AuditEntry[] }>(
    open && entityId ? `/api/audit/${entityType}/${entityId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const entries = data?.changes ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Change history
          </DialogTitle>
          <DialogDescription>
            {entityLabel ? `Recent edits to ${entityLabel}.` : "Recent edits to this record."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading history…
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-destructive">Couldn&apos;t load change history.</p>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No changes recorded yet. Edits will appear here.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  const fields = Object.keys(entry.changes || {})
  const hasDiff = fields.length > 0

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex items-start gap-3">
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarImage src={entry.actor_avatar_url || undefined} alt={entry.actor_name || "Unknown"} />
          <AvatarFallback className="text-[10px] font-medium">{initials(entry.actor_name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{entry.description || "Updated record"}</p>
          <p className="text-xs text-muted-foreground">
            {entry.actor_name || "System"} · {relativeTime(entry.created_at)}
          </p>

          {hasDiff && (
            <Collapsible open={expanded} onOpenChange={setExpanded} className="mt-2">
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
                {expanded ? "Hide" : `Show`} {fields.length} field{fields.length === 1 ? "" : "s"}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 flex flex-col gap-2">
                {fields.map((f) => (
                  <div key={f} className="rounded bg-muted/50 p-2 text-xs">
                    <p className="font-medium text-foreground">{fieldLabel(f)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <span className="rounded bg-background px-1.5 py-0.5 line-through">
                        {fmtValue(entry.changes[f].from)}
                      </span>
                      <span aria-hidden>→</span>
                      <span className="rounded bg-background px-1.5 py-0.5 font-medium text-foreground">
                        {fmtValue(entry.changes[f].to)}
                      </span>
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>
    </li>
  )
}
