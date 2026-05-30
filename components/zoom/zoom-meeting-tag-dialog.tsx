"use client"

/**
 * <ZoomMeetingTagDialog>
 * ────────────────────────────────────────────────────────────────────────
 * Modal that lets a team member tag a Zoom meeting against:
 *   - one or more clients (organization OR contact, multi-select) — REQUIRED
 *   - one or more Karbon work items (multi-select)                   — REQUIRED
 *
 * Mirrors the Calendly tag dialog conceptually, but renders the search
 * UI INLINE inside the Dialog instead of using nested Popover→Command
 * pickers (ClientPicker / WorkItemPicker). The nested-popover approach
 * was tripping Radix's Dialog focus scope on this page in particular —
 * the cmdk input was rendered but every keystroke got swallowed by the
 * Dialog's focus trap, so users saw a "dead" search field. Inline
 * inputs sit inside the same focus scope as the Dialog so typing works
 * exactly the way users expect.
 *
 * Tagging policy (per Master Client Profile): a Zoom meeting MUST be
 * linked to at least one client AND at least one Karbon work item
 * before it can be saved. We mirror the `needs_tagging` rule from the
 * `zoom_meetings_with_tag_counts` view (`client_count = 0 OR
 * work_item_count = 0`). The Save button is disabled until both
 * sections have at least one entry. A small "Skip for now" link lets
 * the user dismiss the dialog without saving, so they aren't trapped.
 *
 * The component takes a `meeting` prop (raw shape from the dashboard) and
 * does NOT prefetch on mount — only when the dialog opens — to keep the
 * meeting list snappy when a user has 50+ rows visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  Briefcase,
  Building2,
  Check,
  FolderKanban,
  Handshake,
  Loader2,
  Search,
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
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"

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
  confidence?: number | null
  alfred_reason?: string | null
  needs_review?: boolean | null
  contact?: { id: string; full_name: string; primary_email?: string | null } | null
  organization?: { id: string; name: string } | null
}

interface WorkItemTag {
  id: string
  link_source?: string | null
  match_method?: string | null
  confidence?: number | null
  alfred_reason?: string | null
  needs_review?: boolean | null
  work_item?: {
    id: string
    title: string
    client_name?: string | null
    status?: string | null
  } | null
}

interface DealTag {
  id: string
  link_source?: string | null
  match_method?: string | null
  confidence?: number | null
  alfred_reason?: string | null
  needs_review?: boolean | null
  deal?: { id: string; title: string | null; stage?: string | null; status?: string | null } | null
}

interface ProjectTag {
  id: string
  link_source?: string | null
  match_method?: string | null
  confidence?: number | null
  alfred_reason?: string | null
  needs_review?: boolean | null
  project?: { id: string; name: string | null; kind?: string | null; status?: string | null } | null
}

interface RawClientResult {
  id: string
  name: string
  email?: string | null
  type: "Organization" | "Contact"
  karbon_key?: string | null
}

interface RawDealResult {
  id: string
  title: string | null
  contact_name?: string | null
  organization_name?: string | null
  stage?: string | null
  status?: string | null
}

interface RawProjectResult {
  id: string
  name: string | null
  client_name?: string | null
  status?: string | null
  kind?: string | null
}

interface RawWorkItemResult {
  id: string
  title: string | null
  client_name?: string | null
  status?: string | null
}

interface Props {
  meeting: ZoomMeetingForTagging
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called after every successful tag/untag so the dashboard can update
   * its in-memory tag count badge without a full refetch.
   */
  onTagsChanged?: (next: {
    clients: ClientTag[]
    workItems: WorkItemTag[]
    deals: DealTag[]
    projects: ProjectTag[]
  }) => void
}

/**
 * Renders a small uppercase chip describing how a tag got onto this
 * meeting. Together with the optional yellow "review" chip these are
 * the only visual cue that distinguishes a Calendly-bridge tag from a
 * Zoom-participant auto-tag from an ALFRED guess from a manual pick.
 *
 * Source labels:
 *   - 'auto'             → "auto"     (Zoom participant sweep)
 *   - 'calendly_bridge'  → "Calendly" (carried over from a Calendly booking)
 *   - 'alfred'           → "ALFRED"   (model-inferred)
 *   - 'manual' / null    → no chip    (user-tagged is the default)
 */
function SourcePill({
  source,
  matchMethod,
  reason,
  confidence,
  needsReview,
}: {
  source: string | null | undefined
  matchMethod?: string | null
  reason?: string | null
  confidence?: number | null
  needsReview?: boolean | null
}) {
  if (!source || source === "manual") {
    return needsReview ? <ReviewPill /> : null
  }

  const config: Record<
    string,
    { label: string; className: string; titlePrefix: string }
  > = {
    auto: {
      label: "auto",
      className: "text-muted-foreground",
      titlePrefix: "Auto-linked from Zoom participant list",
    },
    calendly_bridge: {
      label: "Calendly",
      className: "text-blue-700 dark:text-blue-300",
      titlePrefix: "Carried over from the Calendly booking",
    },
    alfred: {
      label: "ALFRED",
      className: "text-violet-700 dark:text-violet-300",
      titlePrefix: "Suggested by ALFRED",
    },
  }
  const c = config[source] ?? {
    label: source,
    className: "text-muted-foreground",
    titlePrefix: source,
  }
  const titleParts = [c.titlePrefix]
  if (matchMethod) titleParts.push(`via ${matchMethod}`)
  if (typeof confidence === "number") titleParts.push(`confidence ${(confidence * 100).toFixed(0)}%`)
  if (reason) titleParts.push(`— ${reason}`)
  return (
    <>
      <span
        className={cn("text-[10px] uppercase tracking-wide font-medium", c.className)}
        title={titleParts.join(" ")}
      >
        {c.label}
      </span>
      {needsReview ? <ReviewPill /> : null}
    </>
  )
}

function ReviewPill() {
  return (
    <span
      className="rounded-sm bg-amber-100 px-1 text-[10px] uppercase tracking-wide font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
      title="ALFRED's confidence is below the auto-accept threshold — please confirm or remove."
    >
      review
    </span>
  )
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
  const [deals, setDeals] = useState<DealTag[]>([])
  const [projects, setProjects] = useState<ProjectTag[]>([])

  // Inline-search state for clients and work items. We keep two
  // independent debounced queries plus their result lists so the user
  // can search both at once without one search clobbering the other.
  const [clientQuery, setClientQuery] = useState("")
  const [clientQueryDebounced, setClientQueryDebounced] = useState("")
  const [clientResults, setClientResults] = useState<RawClientResult[]>([])
  const [clientSearching, setClientSearching] = useState(false)
  const clientReqRef = useRef(0)

  const [workItemQuery, setWorkItemQuery] = useState("")
  const [workItemQueryDebounced, setWorkItemQueryDebounced] = useState("")
  const [workItemResults, setWorkItemResults] = useState<RawWorkItemResult[]>([])
  const [workItemSearching, setWorkItemSearching] = useState(false)
  const workItemReqRef = useRef(0)

  const [dealQuery, setDealQuery] = useState("")
  const [dealQueryDebounced, setDealQueryDebounced] = useState("")
  const [dealResults, setDealResults] = useState<RawDealResult[]>([])
  const [dealSearching, setDealSearching] = useState(false)
  const dealReqRef = useRef(0)

  const [projectQuery, setProjectQuery] = useState("")
  const [projectQueryDebounced, setProjectQueryDebounced] = useState("")
  const [projectResults, setProjectResults] = useState<RawProjectResult[]>([])
  const [projectSearching, setProjectSearching] = useState(false)
  const projectReqRef = useRef(0)

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
      setDeals(json.deals || [])
      setProjects(json.projects || [])
      onTagsChanged?.({
        clients: json.clients || [],
        workItems: json.workItems || [],
        deals: json.deals || [],
        projects: json.projects || [],
      })
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
    if (open) {
      refresh()
    } else {
      // Reset search state on close so re-opening starts fresh.
      setClientQuery("")
      setClientQueryDebounced("")
      setClientResults([])
      setWorkItemQuery("")
      setWorkItemQueryDebounced("")
      setWorkItemResults([])
      setDealQuery("")
      setDealQueryDebounced("")
      setDealResults([])
      setProjectQuery("")
      setProjectQueryDebounced("")
      setProjectResults([])
    }
    // intentionally not adding refresh to deps -- it's already memoized on
    // meetingIdParam which is the only thing that should re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meetingIdParam])

  // ────────────────────────────────────────────────────────────
  // Debounce search inputs (200ms feels instant but coalesces the
  // "tax season".split('') burst of a fast typist into one call).
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setClientQueryDebounced(clientQuery.trim()), 200)
    return () => clearTimeout(t)
  }, [clientQuery])

  useEffect(() => {
    const t = setTimeout(() => setWorkItemQueryDebounced(workItemQuery.trim()), 200)
    return () => clearTimeout(t)
  }, [workItemQuery])

  useEffect(() => {
    const t = setTimeout(() => setDealQueryDebounced(dealQuery.trim()), 200)
    return () => clearTimeout(t)
  }, [dealQuery])

  useEffect(() => {
    const t = setTimeout(() => setProjectQueryDebounced(projectQuery.trim()), 200)
    return () => clearTimeout(t)
  }, [projectQuery])

  // ────────────────────────────────────────────────────────────
  // Client search — hits /api/clients?type=all so the picker covers
  // both organizations and contacts in one round-trip. Request id
  // protects against out-of-order responses on slow networks.
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (!clientQueryDebounced) {
      setClientResults([])
      setClientSearching(false)
      return
    }
    const reqId = ++clientReqRef.current
    setClientSearching(true)
    const params = new URLSearchParams()
    params.set("search", clientQueryDebounced)
    params.set("type", "all")
    params.set("limit", "20")
    fetch(`/api/clients?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (clientReqRef.current !== reqId) return
        setClientResults(Array.isArray(j?.clients) ? j.clients : [])
      })
      .catch(() => {
        if (clientReqRef.current !== reqId) return
        setClientResults([])
      })
      .finally(() => {
        if (clientReqRef.current === reqId) setClientSearching(false)
      })
  }, [open, clientQueryDebounced])

  // ────────────────────────────────────────────────────────────
  // Work item search — same pattern, hits /api/work-items.
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (!workItemQueryDebounced) {
      setWorkItemResults([])
      setWorkItemSearching(false)
      return
    }
    const reqId = ++workItemReqRef.current
    setWorkItemSearching(true)
    const params = new URLSearchParams()
    params.set("search", workItemQueryDebounced)
    params.set("limit", "20")
    fetch(`/api/work-items?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (workItemReqRef.current !== reqId) return
        // Tolerate every shape /api/work-items has historically returned.
        const list: RawWorkItemResult[] =
          (Array.isArray(j?.work_items) && j.work_items) ||
          (Array.isArray(j?.items) && j.items) ||
          (Array.isArray(j?.data) && j.data) ||
          (Array.isArray(j?.workItems) && j.workItems) ||
          []
        setWorkItemResults(list.filter((r) => r.title && r.title.trim().length > 0))
      })
      .catch(() => {
        if (workItemReqRef.current !== reqId) return
        setWorkItemResults([])
      })
      .finally(() => {
        if (workItemReqRef.current === reqId) setWorkItemSearching(false)
      })
  }, [open, workItemQueryDebounced])

  // ────────────────────────────────────────────────────────────
  // Deal search — hits /api/deals?q= (matches title, contact, org).
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (!dealQueryDebounced) {
      setDealResults([])
      setDealSearching(false)
      return
    }
    const reqId = ++dealReqRef.current
    setDealSearching(true)
    const params = new URLSearchParams()
    params.set("q", dealQueryDebounced)
    params.set("status", "all")
    params.set("limit", "20")
    fetch(`/api/deals?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (dealReqRef.current !== reqId) return
        setDealResults(Array.isArray(j?.deals) ? j.deals : [])
      })
      .catch(() => {
        if (dealReqRef.current !== reqId) return
        setDealResults([])
      })
      .finally(() => {
        if (dealReqRef.current === reqId) setDealSearching(false)
      })
  }, [open, dealQueryDebounced])

  // ────────────────────────────────────────────────────────────
  // Project search — hits /api/projects?search=.
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (!projectQueryDebounced) {
      setProjectResults([])
      setProjectSearching(false)
      return
    }
    const reqId = ++projectReqRef.current
    setProjectSearching(true)
    const params = new URLSearchParams()
    params.set("search", projectQueryDebounced)
    params.set("status", "all")
    params.set("limit", "20")
    fetch(`/api/projects?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (projectReqRef.current !== reqId) return
        setProjectResults(Array.isArray(j?.projects) ? j.projects : [])
      })
      .catch(() => {
        if (projectReqRef.current !== reqId) return
        setProjectResults([])
      })
      .finally(() => {
        if (projectReqRef.current === reqId) setProjectSearching(false)
      })
  }, [open, projectQueryDebounced])

  // Dedupe results against already-tagged rows so we don't show a
  // "Add" affordance for a client/work item the meeting already has.
  const taggedClientKeys = useMemo(() => {
    const set = new Set<string>()
    for (const c of clients) {
      if (c.organization?.id) set.add(`o:${c.organization.id}`)
      if (c.contact?.id) set.add(`c:${c.contact.id}`)
    }
    return set
  }, [clients])

  const taggedWorkItemIds = useMemo(
    () => new Set(workItems.map((w) => w.work_item?.id).filter(Boolean) as string[]),
    [workItems],
  )

  const taggedDealIds = useMemo(
    () => new Set(deals.map((d) => d.deal?.id).filter(Boolean) as string[]),
    [deals],
  )

  const taggedProjectIds = useMemo(
    () => new Set(projects.map((p) => p.project?.id).filter(Boolean) as string[]),
    [projects],
  )

  // ────────────────────────────────────────────────────────────
  // Add client tag
  // ────────────────────────────────────────────────────────────
  async function addClient(result: RawClientResult) {
    setSaving(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${meetingIdParam}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "client",
          contactId: result.type === "Contact" ? result.id : null,
          organizationId: result.type === "Organization" ? result.id : null,
          teamMemberId: teamMember?.id ?? null,
          meeting: meetingMeta,
        }),
      })
      if (res.status === 409) {
        toast({
          title: "Already tagged",
          description: `${result.name} is already linked to this meeting.`,
        })
      } else if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `${res.status}`)
      }
      // Clear the search after a successful add so the user can pick
      // the next one without manually clearing the field.
      setClientQuery("")
      setClientQueryDebounced("")
      setClientResults([])
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
  async function addWorkItem(result: RawWorkItemResult) {
    setSaving(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${meetingIdParam}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "work_item",
          workItemId: result.id,
          teamMemberId: teamMember?.id ?? null,
          meeting: meetingMeta,
        }),
      })
      if (res.status === 409) {
        toast({
          title: "Already tagged",
          description: `${result.title} is already linked to this meeting.`,
        })
      } else if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `${res.status}`)
      }
      setWorkItemQuery("")
      setWorkItemQueryDebounced("")
      setWorkItemResults([])
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
  // Add deal tag
  // ────────────────────────────────────────────────────────────
  async function addDeal(result: RawDealResult) {
    setSaving(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${meetingIdParam}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "deal",
          dealId: result.id,
          teamMemberId: teamMember?.id ?? null,
          meeting: meetingMeta,
        }),
      })
      if (res.status === 409) {
        toast({
          title: "Already tagged",
          description: `${result.title || "This deal"} is already linked to this meeting.`,
        })
      } else if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `${res.status}`)
      }
      setDealQuery("")
      setDealQueryDebounced("")
      setDealResults([])
      await refresh()
    } catch (err) {
      toast({
        title: "Could not add deal",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // ────────────────────────────────────────────────────────────
  // Add project tag
  // ────────────────────────────────────────────────────────────
  async function addProject(result: RawProjectResult) {
    setSaving(true)
    try {
      const res = await fetch(`/api/zoom/meetings/${meetingIdParam}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "project",
          projectId: result.id,
          teamMemberId: teamMember?.id ?? null,
          meeting: meetingMeta,
        }),
      })
      if (res.status === 409) {
        toast({
          title: "Already tagged",
          description: `${result.name || "This project"} is already linked to this meeting.`,
        })
      } else if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `${res.status}`)
      }
      setProjectQuery("")
      setProjectQueryDebounced("")
      setProjectResults([])
      await refresh()
    } catch (err) {
      toast({
        title: "Could not add project",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // ────────────────────────────────────────────────────────────
  // Remove tag (works for all kinds via ?kind= query param)
  // ────────────────────────────────────────────────────────────
  async function removeTag(
    kind: "client" | "work_item" | "deal" | "project",
    junctionId: string,
  ) {
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

  // ────────────────────────────────────────────────────────────
  // Required-state derived flags. The meeting is "complete" when it
  // has at least one client AND at least one work item, mirroring the
  // `needs_tagging` rule in the zoom_meetings_with_tag_counts view.
  // ────────────────────────────────────────────────────────────
  const hasClient = clients.length > 0
  const hasWorkItem = workItems.length > 0
  const isComplete = hasClient && hasWorkItem
  const tagCount = clients.length + workItems.length

  // Block escape / outside-click when the dialog isn't complete so the
  // policy ("every Zoom meeting must be tagged") is enforced visibly.
  // The "Skip for now" footer link is the explicit escape hatch — it
  // calls onOpenChange(false) directly.
  function handleOpenChange(next: boolean) {
    if (!next && !isComplete && !loading) {
      // No-op: the user must use the explicit Save or Skip buttons so
      // we don't silently let them drop out by clicking outside.
      return
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(e) => {
          if (!isComplete && !loading) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (!isComplete && !loading) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (!isComplete && !loading) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5 shrink-0" />
            Tag this meeting
          </DialogTitle>
          <DialogDescription className="text-pretty">
            Link <span className="font-medium">{meeting.topic || "this meeting"}</span> to
            every applicable client and the Karbon work item it relates to. Both
            are required so the meeting shows up under the right Master Client
            Profile and feeds work-item time tracking.
          </DialogDescription>
        </DialogHeader>

        {!isComplete && !loading && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Required</p>
              <p className="text-amber-800 dark:text-amber-200/90">
                Add at least one{" "}
                <span className={cn("font-medium", hasClient && "line-through opacity-60")}>
                  client
                </span>{" "}
                and one{" "}
                <span className={cn("font-medium", hasWorkItem && "line-through opacity-60")}>
                  Karbon work item
                </span>{" "}
                before saving.
              </p>
            </div>
          </div>
        )}

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
                <h3 className="text-sm font-semibold">
                  Clients
                  <span className="ml-1 text-destructive" aria-label="required">
                    *
                  </span>
                </h3>
                <Badge
                  variant={hasClient ? "secondary" : "outline"}
                  className={cn(
                    "ml-auto",
                    !hasClient && "border-amber-300 text-amber-700 dark:border-amber-700/50 dark:text-amber-300",
                  )}
                >
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
                        className={cn(
                          "flex items-center gap-1.5 pr-1 py-1 font-normal",
                          c.needs_review &&
                            "border-amber-300 dark:border-amber-700/60",
                        )}
                      >
                        <Icon className="h-3 w-3 shrink-0 opacity-60" />
                        <span className="truncate max-w-[200px]">{label}</span>
                        <SourcePill
                          source={c.link_source}
                          matchMethod={c.match_method}
                          reason={c.alfred_reason}
                          confidence={c.confidence}
                          needsReview={c.needs_review}
                        />
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

              {/* Inline search input */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                  <Input
                    type="text"
                    autoComplete="off"
                    placeholder="Search organizations and contacts to tag…"
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    className="pl-9"
                    aria-label="Search clients"
                  />
                </div>

                {/* Results — only render once the user starts typing so the
                    dialog stays compact when first opened. */}
                {clientQueryDebounced && (
                  <div className="rounded-md border bg-background">
                    {clientSearching ? (
                      <div className="space-y-2 p-2">
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-3/4" />
                      </div>
                    ) : clientResults.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                        No matches for &quot;{clientQueryDebounced}&quot;.
                      </p>
                    ) : (
                      <ul
                        role="listbox"
                        aria-label="Search results"
                        className="max-h-64 overflow-y-auto py-1"
                      >
                        {clientResults.map((r) => {
                          const key = r.type === "Organization" ? `o:${r.id}` : `c:${r.id}`
                          const alreadyTagged = taggedClientKeys.has(key)
                          const Icon = r.type === "Organization" ? Building2 : User
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                disabled={alreadyTagged || saving}
                                onClick={() => addClient(r)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                                  alreadyTagged && "cursor-not-allowed opacity-60 hover:bg-transparent",
                                )}
                              >
                                <Icon className="h-4 w-4 shrink-0 opacity-60" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">{r.name}</div>
                                  {r.email && (
                                    <div className="truncate text-xs text-muted-foreground">
                                      {r.email}
                                    </div>
                                  )}
                                </div>
                                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {r.type === "Organization" ? "org" : "contact"}
                                </span>
                                {alreadyTagged && <Check className="h-4 w-4 shrink-0 opacity-60" />}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </section>

            <div className="h-px w-full bg-border" role="separator" />

            {/* ──── Work Items ──────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">
                  Karbon work items
                  <span className="ml-1 text-destructive" aria-label="required">
                    *
                  </span>
                </h3>
                <Badge
                  variant={hasWorkItem ? "secondary" : "outline"}
                  className={cn(
                    "ml-auto",
                    !hasWorkItem && "border-amber-300 text-amber-700 dark:border-amber-700/50 dark:text-amber-300",
                  )}
                >
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
                      className={cn(
                        "flex items-center gap-1.5 pr-1 py-1 font-normal",
                        w.needs_review && "border-amber-300 dark:border-amber-700/60",
                      )}
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
                      <SourcePill
                        source={w.link_source}
                        matchMethod={w.match_method}
                        reason={w.alfred_reason}
                        confidence={w.confidence}
                        needsReview={w.needs_review}
                      />
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

              {/* Inline search input */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                  <Input
                    type="text"
                    autoComplete="off"
                    placeholder="Search Karbon work items to tag…"
                    value={workItemQuery}
                    onChange={(e) => setWorkItemQuery(e.target.value)}
                    className="pl-9"
                    aria-label="Search work items"
                  />
                </div>

                {workItemQueryDebounced && (
                  <div className="rounded-md border bg-background">
                    {workItemSearching ? (
                      <div className="space-y-2 p-2">
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-full" />
                      </div>
                    ) : workItemResults.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                        No matches for &quot;{workItemQueryDebounced}&quot;.
                      </p>
                    ) : (
                      <ul
                        role="listbox"
                        aria-label="Search results"
                        className="max-h-64 overflow-y-auto py-1"
                      >
                        {workItemResults.map((w) => {
                          const alreadyTagged = taggedWorkItemIds.has(w.id)
                          return (
                            <li key={w.id}>
                              <button
                                type="button"
                                disabled={alreadyTagged || saving}
                                onClick={() => addWorkItem(w)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                                  alreadyTagged && "cursor-not-allowed opacity-60 hover:bg-transparent",
                                )}
                              >
                                <Briefcase className="h-4 w-4 shrink-0 opacity-60" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">{w.title}</div>
                                  {(w.client_name || w.status) && (
                                    <div className="truncate text-xs text-muted-foreground">
                                      {[w.client_name, w.status].filter(Boolean).join(" • ")}
                                    </div>
                                  )}
                                </div>
                                {alreadyTagged && <Check className="h-4 w-4 shrink-0 opacity-60" />}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </section>

            <div className="h-px w-full bg-border" role="separator" />

            {/* ──── Deals (optional) ─────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Deals</h3>
                <span className="text-xs text-muted-foreground">(optional)</span>
                <Badge variant={deals.length > 0 ? "secondary" : "outline"} className="ml-auto">
                  {deals.length}
                </Badge>
              </div>

              {deals.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No deals tagged yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {deals.map((d) => (
                    <Badge
                      key={d.id}
                      variant="outline"
                      className={cn(
                        "flex items-center gap-1.5 pr-1 py-1 font-normal",
                        d.needs_review && "border-amber-300 dark:border-amber-700/60",
                      )}
                    >
                      <Handshake className="h-3 w-3 shrink-0 opacity-60" />
                      <span className="truncate max-w-[220px]">
                        {d.deal?.title || "Untitled deal"}
                        {d.deal?.stage && (
                          <span className="text-muted-foreground"> · {d.deal.stage}</span>
                        )}
                      </span>
                      <SourcePill
                        source={d.link_source}
                        matchMethod={d.match_method}
                        reason={d.alfred_reason}
                        confidence={d.confidence}
                        needsReview={d.needs_review}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${d.deal?.title || "deal"}`}
                        onClick={() => removeTag("deal", d.id)}
                        disabled={saving}
                        className="ml-0.5 rounded-sm p-0.5 hover:bg-muted disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                  <Input
                    type="text"
                    autoComplete="off"
                    placeholder="Search deals by title, client, or org…"
                    value={dealQuery}
                    onChange={(e) => setDealQuery(e.target.value)}
                    className="pl-9"
                    aria-label="Search deals"
                  />
                </div>

                {dealQueryDebounced && (
                  <div className="rounded-md border bg-background">
                    {dealSearching ? (
                      <div className="space-y-2 p-2">
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-3/4" />
                      </div>
                    ) : dealResults.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                        No matches for &quot;{dealQueryDebounced}&quot;.
                      </p>
                    ) : (
                      <ul role="listbox" aria-label="Deal results" className="max-h-64 overflow-y-auto py-1">
                        {dealResults.map((d) => {
                          const alreadyTagged = taggedDealIds.has(d.id)
                          const sub = [d.contact_name || d.organization_name, d.stage]
                            .filter(Boolean)
                            .join(" • ")
                          return (
                            <li key={d.id}>
                              <button
                                type="button"
                                disabled={alreadyTagged || saving}
                                onClick={() => addDeal(d)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                                  alreadyTagged && "cursor-not-allowed opacity-60 hover:bg-transparent",
                                )}
                              >
                                <Handshake className="h-4 w-4 shrink-0 opacity-60" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">{d.title || "Untitled deal"}</div>
                                  {sub && (
                                    <div className="truncate text-xs text-muted-foreground">{sub}</div>
                                  )}
                                </div>
                                {alreadyTagged && <Check className="h-4 w-4 shrink-0 opacity-60" />}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </section>

            <div className="h-px w-full bg-border" role="separator" />

            {/* ──── Projects (optional) ──────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Projects</h3>
                <span className="text-xs text-muted-foreground">(optional)</span>
                <Badge variant={projects.length > 0 ? "secondary" : "outline"} className="ml-auto">
                  {projects.length}
                </Badge>
              </div>

              {projects.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No projects tagged yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {projects.map((p) => (
                    <Badge
                      key={p.id}
                      variant="outline"
                      className={cn(
                        "flex items-center gap-1.5 pr-1 py-1 font-normal",
                        p.needs_review && "border-amber-300 dark:border-amber-700/60",
                      )}
                    >
                      <FolderKanban className="h-3 w-3 shrink-0 opacity-60" />
                      <span className="truncate max-w-[220px]">
                        {p.project?.name || "Untitled project"}
                        {p.project?.status && (
                          <span className="text-muted-foreground"> · {p.project.status}</span>
                        )}
                      </span>
                      <SourcePill
                        source={p.link_source}
                        matchMethod={p.match_method}
                        reason={p.alfred_reason}
                        confidence={p.confidence}
                        needsReview={p.needs_review}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${p.project?.name || "project"}`}
                        onClick={() => removeTag("project", p.id)}
                        disabled={saving}
                        className="ml-0.5 rounded-sm p-0.5 hover:bg-muted disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                  <Input
                    type="text"
                    autoComplete="off"
                    placeholder="Search projects by name…"
                    value={projectQuery}
                    onChange={(e) => setProjectQuery(e.target.value)}
                    className="pl-9"
                    aria-label="Search projects"
                  />
                </div>

                {projectQueryDebounced && (
                  <div className="rounded-md border bg-background">
                    {projectSearching ? (
                      <div className="space-y-2 p-2">
                        <Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-3/4" />
                      </div>
                    ) : projectResults.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                        No matches for &quot;{projectQueryDebounced}&quot;.
                      </p>
                    ) : (
                      <ul role="listbox" aria-label="Project results" className="max-h-64 overflow-y-auto py-1">
                        {projectResults.map((p) => {
                          const alreadyTagged = taggedProjectIds.has(p.id)
                          const sub = [p.client_name, p.status].filter(Boolean).join(" • ")
                          return (
                            <li key={p.id}>
                              <button
                                type="button"
                                disabled={alreadyTagged || saving}
                                onClick={() => addProject(p)}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                                  alreadyTagged && "cursor-not-allowed opacity-60 hover:bg-transparent",
                                )}
                              >
                                <FolderKanban className="h-4 w-4 shrink-0 opacity-60" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">{p.name || "Untitled project"}</div>
                                  {sub && (
                                    <div className="truncate text-xs text-muted-foreground">{sub}</div>
                                  )}
                                </div>
                                {alreadyTagged && <Check className="h-4 w-4 shrink-0 opacity-60" />}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="sm:flex-col sm:items-stretch sm:gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="h-3 w-3" />
              {tagCount === 0
                ? "This meeting has no tags yet."
                : `${tagCount} tag${tagCount === 1 ? "" : "s"} on this meeting.`}
            </p>

            <div className="flex items-center gap-2">
              {/* Explicit escape hatch so the user is nudged but not
                  trapped — closes the dialog without saving but logs
                  no special "skip" record (we just leave the meeting
                  in its current incomplete state). */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Skip for now
              </Button>
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={!isComplete || saving || loading}
                title={
                  !isComplete
                    ? "Add at least one client and one work item to save."
                    : undefined
                }
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {isComplete ? "Save & close" : "Tagging required"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
