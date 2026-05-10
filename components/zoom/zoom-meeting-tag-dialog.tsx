"use client"

/**
 * <ZoomMeetingTagDialog>
 * ────────────────────────────────────────────────────────────────────────
 * Modal that lets a team member tag a Zoom meeting against:
 *   - one or more clients (organization OR contact, multi-select)
 *   - one or more Karbon work items (multi-select)
 *
 * Mirrors the Calendly tag dialog exactly: same picker components, same
 * "click to add, X to remove" pattern, same per-row delete. Wraps the
 * /api/zoom/meetings/[zoomMeetingId]/tags route which does lazy upsert of
 * the parent zoom_meetings row using the meeting metadata we pass in, so
 * the dialog works even before the master sync has run.
 *
 * The component takes a `meeting` prop (raw shape from the dashboard) and
 * does NOT prefetch on mount — only when the dialog opens — to keep the
 * meeting list snappy when a user has 50+ rows visible.
 */

import { useCallback, useEffect, useState } from "react"
import {
  Building2,
  Briefcase,
  Loader2,
  Plus,
  Tag,
  Tags,
  User,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/hooks/use-user"
import { ClientPicker, type ClientPickerValue } from "@/components/clients/client-picker"
import {
  WorkItemPicker,
  type WorkItemPickerValue,
} from "@/components/work-items/work-item-picker"

// Shape of the raw Zoom meeting object we receive from the dashboard.
// All fields optional because the master-meetings response is just a
// passthrough of Zoom's REST API which has changed shape over the years.
export interface ZoomMeetingForTagging {
  id: number | string
  topic?: string | null
  start_time?: string | null
  duration?: number | null
  timezone?: string | null
  agenda?: string | null
  join_url?: string | null
  host_email?: string | null
  host_id?: string | null
  status?: string | null
}

interface ClientTag {
  id: string
  link_source?: string | null
  match_method?: string | null
  contact?: { id: string; full_name: string; primary_email?: string | null } | null
  organization?: { id: string; name: string } | null
}

interface WorkItemTag {
  id: string
  work_item?: {
    id: string
    title: string
    client_name?: string | null
    status?: string | null
  } | null
}

interface Props {
  meeting: ZoomMeetingForTagging
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called after every successful tag/untag so the dashboard can update
   * its in-memory tag count badge without a full refetch.
   */
  onTagsChanged?: (next: { clients: ClientTag[]; workItems: WorkItemTag[] }) => void
}

export function ZoomMeetingTagDialog({
  meeting,
  open,
  onOpenChange,
  onTagsChanged,
}: Props) {
  const { teamMember } = useUser()
  const { toast } = useToast()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clients, setClients] = useState<ClientTag[]>([])
  const [workItems, setWorkItems] = useState<WorkItemTag[]>([])
  const [pendingClient, setPendingClient] = useState<ClientPickerValue | null>(null)
  const [pendingWorkItem, setPendingWorkItem] = useState<WorkItemPickerValue | null>(null)

  // The Zoom id is a bigint server-side; the URL just takes its string form.
  const meetingIdParam = String(meeting.id)

  // Body shape we forward to POST so the route can lazy-upsert the parent
  // zoom_meetings row when the master sync hasn't run yet for this meeting.
  const meetingMeta = {
    topic: meeting.topic ?? null,
    start_time: meeting.start_time ?? null,
    duration: meeting.duration ?? null,
    timezone: meeting.timezone ?? null,
    agenda: meeting.agenda ?? null,
    join_url: meeting.join_url ?? null,
    host_email: meeting.host_email ?? null,
    host_id: meeting.host_id ?? null,
    status: meeting.status ?? null,
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${meetingIdParam}/tags`)
      if (!res.ok) throw new Error("Failed to load tags")
      const json = await res.json()
      setClients(json.clients || [])
      setWorkItems(json.workItems || [])
      onTagsChanged?.({ clients: json.clients || [], workItems: json.workItems || [] })
    } catch (err) {
      toast({
        title: "Could not load tags",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [meetingIdParam, onTagsChanged, toast])

  // Only fetch when the dialog opens. Closing-then-reopening will re-fetch
  // so the user sees the canonical server state, not a stale cache.
  useEffect(() => {
    if (open) refresh()
    // intentionally not adding refresh to deps -- it's already memoized on
    // meetingIdParam which is the only thing that should re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meetingIdParam])

  // ────────────────────────────────────────────────────────────
  // Add client tag
  // ────────────────────────────────────────────────────────────
  async function addClient() {
    if (!pendingClient) return
    setSaving(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${meetingIdParam}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "client",
          contactId: pendingClient.kind === "contact" ? pendingClient.id : null,
          organizationId: pendingClient.kind === "organization" ? pendingClient.id : null,
          teamMemberId: teamMember?.id ?? null,
          meeting: meetingMeta,
        }),
      })
      if (res.status === 409) {
        toast({
          title: "Already tagged",
          description: `${pendingClient.name} is already linked to this meeting.`,
        })
      } else if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `${res.status}`)
      }
      setPendingClient(null)
      await refresh()
    } catch (err) {
      toast({
        title: "Could not add client",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // ────────────────────────────────────────────────────────────
  // Add work item tag
  // ────────────────────────────────────────────────────────────
  async function addWorkItem() {
    if (!pendingWorkItem) return
    setSaving(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${meetingIdParam}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "work_item",
          workItemId: pendingWorkItem.id,
          teamMemberId: teamMember?.id ?? null,
          meeting: meetingMeta,
        }),
      })
      if (res.status === 409) {
        toast({
          title: "Already tagged",
          description: `${pendingWorkItem.title} is already linked to this meeting.`,
        })
      } else if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `${res.status}`)
      }
      setPendingWorkItem(null)
      await refresh()
    } catch (err) {
      toast({
        title: "Could not add work item",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // ────────────────────────────────────────────────────────────
  // Remove tag (works for both kinds via ?kind= query param)
  // ────────────────────────────────────────────────────────────
  async function removeTag(kind: "client" | "work_item", junctionId: string) {
    setSaving(true)
    try {
      const res = await fetch(
        `/api/zoom/meetings/${meetingIdParam}/tags?kind=${kind}&id=${junctionId}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `${res.status}`)
      }
      await refresh()
    } catch (err) {
      toast({
        title: "Could not remove tag",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const tagCount = clients.length + workItems.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5 shrink-0" />
            Tag this meeting
          </DialogTitle>
          <DialogDescription className="text-pretty">
            Link <span className="font-medium">{meeting.topic || "this meeting"}</span> to the
            Karbon work item it relates to and every applicable client. Tagging
            is required so meetings show up in the right client view and feed
            into work-item time tracking.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {/* ──── Clients ──────────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Clients</h3>
                <Badge variant="secondary" className="ml-auto">
                  {clients.length}
                </Badge>
              </div>

              {/* Already-tagged client pills */}
              {clients.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No clients tagged yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {clients.map((c) => {
                    const isOrg = !!c.organization
                    const label = isOrg ? c.organization!.name : c.contact!.full_name
                    const Icon = isOrg ? Building2 : User
                    return (
                      <Badge
                        key={c.id}
                        variant="outline"
                        className="flex items-center gap-1.5 pr-1 py-1 font-normal"
                      >
                        <Icon className="h-3 w-3 shrink-0 opacity-60" />
                        <span className="truncate max-w-[200px]">{label}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${label}`}
                          onClick={() => removeTag("client", c.id)}
                          disabled={saving}
                          className="ml-0.5 rounded-sm p-0.5 hover:bg-muted disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              )}

              {/* Add new client picker */}
              <div className="flex items-center gap-2">
                <ClientPicker
                  value={pendingClient}
                  onChange={setPendingClient}
                  placeholder="Search clients to tag…"
                  className="flex-1"
                  allowClear={false}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={addClient}
                  disabled={!pendingClient || saving}
                  className="shrink-0"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add
                </Button>
              </div>
            </section>

            <div className="h-px w-full bg-border" role="separator" />

            {/* ──── Work Items ──────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Karbon work items</h3>
                <Badge variant="secondary" className="ml-auto">
                  {workItems.length}
                </Badge>
              </div>

              {workItems.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No work items tagged yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {workItems.map((w) => (
                    <Badge
                      key={w.id}
                      variant="outline"
                      className="flex items-center gap-1.5 pr-1 py-1 font-normal"
                    >
                      <Briefcase className="h-3 w-3 shrink-0 opacity-60" />
                      <span className="truncate max-w-[260px]">
                        {w.work_item?.title || "Untitled"}
                        {w.work_item?.client_name && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {w.work_item.client_name}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${w.work_item?.title || "work item"}`}
                        onClick={() => removeTag("work_item", w.id)}
                        disabled={saving}
                        className="ml-0.5 rounded-sm p-0.5 hover:bg-muted disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <WorkItemPicker
                  value={pendingWorkItem}
                  onChange={setPendingWorkItem}
                  placeholder="Search work items to tag…"
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={addWorkItem}
                  disabled={!pendingWorkItem || saving}
                  className="shrink-0"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add
                </Button>
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="sm:justify-between gap-2">
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Tag className="h-3 w-3" />
            {tagCount === 0
              ? "This meeting has no tags yet."
              : `${tagCount} tag${tagCount === 1 ? "" : "s"} on this meeting.`}
          </p>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
