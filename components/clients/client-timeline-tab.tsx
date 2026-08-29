"use client"

/**
 * ClientTimelineTab — one chronological feed of everything that has
 * happened with a client: emails, portal messages, document requests
 * and uploads, meetings, notes, project status changes, and filed
 * returns. Newest first, grouped under sticky date headers.
 *
 * No timeline/activity-log table exists yet, so the feed below is
 * generated from deterministic mock data (seeded by client id — the
 * same client always sees the same "history" across reloads) per the
 * design spec. Swap `generateMockTimelineEvents` for a real fetch once
 * an activity-log backend exists; the rendering below doesn't care
 * where the events came from.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  FileCheck2,
  FileQuestion,
  FileUp,
  GitCommitHorizontal,
  Inbox,
  Loader2,
  MessageCircle,
  MessageSquare,
  Search,
  Send,
  StickyNote,
  Video,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { ClientBundle } from "@/components/client-profile"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineEventType =
  | "email_sent"
  | "email_received"
  | "message_sent"
  | "message_received"
  | "document_requested"
  | "document_uploaded"
  | "meeting_held"
  | "note_added"
  | "project_status_changed"
  | "return_filed"

interface TimelineEventBase {
  id: string
  type: TimelineEventType
  summary: string
  detail: string
  occurredAt: string
  projectId: string | null
  projectTitle: string | null
  actorName: string
}

interface EmailEvent extends TimelineEventBase {
  type: "email_sent" | "email_received"
  body: string
  counterparty: string
}

interface MessageEvent extends TimelineEventBase {
  type: "message_sent" | "message_received"
  body: string
}

interface DocumentEvent extends TimelineEventBase {
  type: "document_requested" | "document_uploaded"
  fileName: string
  fileSizeBytes: number | null
}

interface MeetingEvent extends TimelineEventBase {
  type: "meeting_held"
  attendees: string[]
  actionItems: string[]
}

interface NoteEvent extends TimelineEventBase {
  type: "note_added"
  body: string
}

interface StatusChangeEvent extends TimelineEventBase {
  type: "project_status_changed"
  fromStatus: string
  toStatus: string
}

interface ReturnFiledEvent extends TimelineEventBase {
  type: "return_filed"
  returnType: string
  taxYear: number
}

export type TimelineEvent =
  | EmailEvent
  | MessageEvent
  | DocumentEvent
  | MeetingEvent
  | NoteEvent
  | StatusChangeEvent
  | ReturnFiledEvent

// ─────────────────────────────────────────────────────────────────────────────
// Entry type configuration — icon + accent per event type
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<
  TimelineEventType,
  { label: string; icon: LucideIcon; iconClass: string; dotClass: string }
> = {
  email_sent: {
    label: "Email sent",
    icon: Send,
    iconClass: "text-sky-700 dark:text-sky-300",
    dotClass: "bg-sky-100 dark:bg-sky-950",
  },
  email_received: {
    label: "Email received",
    icon: Inbox,
    iconClass: "text-sky-700 dark:text-sky-300",
    dotClass: "bg-sky-50 dark:bg-sky-900/40",
  },
  message_sent: {
    label: "Message sent",
    icon: MessageSquare,
    iconClass: "text-emerald-700 dark:text-emerald-300",
    dotClass: "bg-emerald-100 dark:bg-emerald-950",
  },
  message_received: {
    label: "Message received",
    icon: MessageCircle,
    iconClass: "text-emerald-700 dark:text-emerald-300",
    dotClass: "bg-emerald-50 dark:bg-emerald-900/40",
  },
  document_requested: {
    label: "Document requested",
    icon: FileQuestion,
    iconClass: "text-amber-700 dark:text-amber-300",
    dotClass: "bg-amber-50 dark:bg-amber-900/40",
  },
  document_uploaded: {
    label: "Document uploaded",
    icon: FileUp,
    iconClass: "text-amber-700 dark:text-amber-300",
    dotClass: "bg-amber-100 dark:bg-amber-950",
  },
  meeting_held: {
    label: "Meeting held",
    icon: Video,
    iconClass: "text-violet-700 dark:text-violet-300",
    dotClass: "bg-violet-100 dark:bg-violet-950",
  },
  note_added: {
    label: "Note added",
    icon: StickyNote,
    iconClass: "text-muted-foreground",
    dotClass: "bg-muted",
  },
  project_status_changed: {
    label: "Status changed",
    icon: GitCommitHorizontal,
    iconClass: "text-foreground",
    dotClass: "bg-secondary",
  },
  return_filed: {
    label: "Return filed",
    icon: FileCheck2,
    iconClass: "text-rose-700 dark:text-rose-300",
    dotClass: "bg-rose-100 dark:bg-rose-950",
  },
}

const ALL_EVENT_TYPES = Object.keys(EVENT_CONFIG) as TimelineEventType[]

// ─────────────────────────────────────────────────────────────────────────────
// Mock data generation (seeded by client id)
// ─────────────────────────────────────────────────────────────────────────────

function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isActiveProjectStatus(status: string | null): boolean {
  const s = (status || "").toLowerCase()
  return s !== "completed" && s !== "cancelled" && s !== "canceled"
}

const EMAIL_TEMPLATES: Array<{ summary: string; body: string }> = [
  { summary: "Sent 2024 engagement letter", body: "Here's the engagement letter for this year, just needs a signature whenever you get a chance." },
  { summary: "Requested missing W-2s", body: "We're still missing one W-2 from your second employer — could you forward it over when you have a moment?" },
  { summary: "Followed up on estimated payment", body: "Just confirming the Q4 estimated payment voucher went out — let us know if you have questions on the amount." },
  { summary: "Sent draft return for review", body: "Attached is the draft return for your review. Take a look and let us know if anything looks off before we finalize." },
  { summary: "Replied about brokerage statement", body: "Thanks for sending that over — this was the last piece we needed for the schedule D." },
  { summary: "Sent year-end tax planning notes", body: "Wanted to flag a couple of planning opportunities before year-end, mainly around retirement contributions." },
]

const MESSAGE_TEMPLATES: Array<{ summary: string; body: string }> = [
  { summary: "Replied in portal chat", body: "Got it, thank you! We'll get everything reconciled and reach out if anything's missing." },
  { summary: "Answered portal question", body: "Yes, that extension already went in last week — you're all set until October." },
  { summary: "Sent portal update", body: "We're finishing the final review now, expect a draft in your portal by Friday." },
  { summary: "Confirmed document receipt", body: "Received the 1099 you uploaded, thank you for getting that over so quickly." },
]

const DOC_NAMES_REQUESTED = [
  "2024 W-2 (second employer)",
  "1098 Mortgage Interest Statement",
  "Q3 Bank Statement",
  "K-1 from Meridian Partners",
  "1099-B Brokerage Statement",
]
const DOC_NAMES_UPLOADED = [
  "2024_W2_Acme_Corp.pdf",
  "1099-NEC_Consulting.pdf",
  "Q3_Bank_Statement.pdf",
  "K1_Meridian_Partners.pdf",
  "Signed_Engagement_Letter.pdf",
  "1098_Mortgage_Interest.pdf",
]

const MEETING_TEMPLATES: Array<{ summary: string; actionItems: string[] }> = [
  {
    summary: "Year-end planning call",
    actionItems: [
      "Client to send Q4 estimated brokerage gains by Friday",
      "Firm to draft retirement contribution scenarios",
    ],
  },
  {
    summary: "Onboarding kickoff meeting",
    actionItems: [
      "Client to grant QuickBooks access",
      "Firm to send engagement letter for signature",
    ],
  },
  {
    summary: "Quarterly bookkeeping review",
    actionItems: ["Client to categorize outstanding Amex transactions"],
  },
  {
    summary: "Return review call",
    actionItems: [
      "Client to confirm home office square footage",
      "Firm to finalize and e-file once confirmed",
    ],
  },
]

const NOTE_TEMPLATES = [
  "Client mentioned a possible home sale next year — flag for capital gains planning.",
  "Prefers all communication via portal messages over email when possible.",
  "New dependent added this year, need updated W-4 on file.",
  "Client runs a side consulting business — watch for estimated tax exposure.",
]

const STATUS_SEQUENCES = [
  ["Not Started", "In Progress"],
  ["In Progress", "Waiting on Client"],
  ["Waiting on Client", "In Progress"],
  ["In Progress", "Internal Review"],
  ["Internal Review", "Ready to File"],
  ["Ready to File", "Completed"],
]

const RETURN_TYPES = ["1040", "1120-S", "1065", "990"]

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function generateMockTimelineEvents(
  clientId: string,
  clientName: string,
  activeProjects: Array<{ id: string; title: string }>,
  teamMembers: Array<{ name: string; email: string | null }>,
): TimelineEvent[] {
  const rng = mulberry32(hashString(clientId || clientName || "client"))
  const staffName = teamMembers[0]?.name || "Motta Financial Team"
  const events: TimelineEvent[] = []
  const now = Date.now()
  const projectFor = () =>
    activeProjects.length > 0 && rng() > 0.25 ? pick(rng, activeProjects) : null

  let cursor = now

  const step = (minHours: number, maxHours: number) => {
    cursor -= (minHours + rng() * (maxHours - minHours)) * 60 * 60 * 1000
  }

  const targetCount = 30
  let idx = 0
  // Weighted type pool so common event types (emails, messages) appear more
  // often than rarer ones (returns filed, status changes) — mirrors a real
  // firm's activity mix.
  const typePool: TimelineEventType[] = [
    "email_sent", "email_received", "email_sent", "email_received",
    "message_sent", "message_received", "message_sent",
    "document_uploaded", "document_requested",
    "note_added",
    "project_status_changed",
    "meeting_held",
    "return_filed",
  ]

  while (idx < targetCount) {
    const type = pick(rng, typePool)
    step(4, 30)
    const occurredAt = new Date(cursor).toISOString()
    const project = projectFor()
    const base = {
      id: `${clientId}-tl-${idx}`,
      occurredAt,
      projectId: project?.id ?? null,
      projectTitle: project?.title ?? null,
    }

    switch (type) {
      case "email_sent": {
        const tpl = pick(rng, EMAIL_TEMPLATES)
        events.push({
          ...base,
          type,
          summary: tpl.summary,
          detail: `To ${clientName}`,
          body: tpl.body,
          counterparty: clientName,
          actorName: staffName,
        })
        break
      }
      case "email_received": {
        events.push({
          ...base,
          type,
          summary: `${clientName} replied by email`,
          detail: "Re: " + pick(rng, EMAIL_TEMPLATES).summary,
          body: pick(rng, EMAIL_TEMPLATES).body,
          counterparty: clientName,
          actorName: clientName,
        })
        break
      }
      case "message_sent": {
        const tpl = pick(rng, MESSAGE_TEMPLATES)
        events.push({
          ...base,
          type,
          summary: tpl.summary,
          detail: "Portal message",
          body: tpl.body,
          actorName: staffName,
        })
        break
      }
      case "message_received": {
        events.push({
          ...base,
          type,
          summary: `${clientName} sent a portal message`,
          detail: "Portal message",
          body: pick(rng, [
            "Just uploaded my W-2 and the 1099 — let me know if you need anything else.",
            "Do you need the mortgage interest statement too?",
            "Any update on when the return will be ready?",
            "Thanks so much for handling this so quickly!",
          ]),
          actorName: clientName,
        })
        break
      }
      case "document_requested": {
        const fileName = pick(rng, DOC_NAMES_REQUESTED)
        events.push({
          ...base,
          type,
          summary: `Requested ${fileName}`,
          detail: project ? `For ${project.title}` : "Document checklist",
          fileName,
          fileSizeBytes: null,
          actorName: staffName,
        })
        break
      }
      case "document_uploaded": {
        const fileName = pick(rng, DOC_NAMES_UPLOADED)
        const isClientUpload = rng() > 0.4
        events.push({
          ...base,
          type,
          summary: `${fileName} uploaded`,
          detail: isClientUpload ? `By ${clientName}` : `By ${staffName}`,
          fileName,
          fileSizeBytes: Math.floor(80_000 + rng() * 2_400_000),
          actorName: isClientUpload ? clientName : staffName,
        })
        break
      }
      case "meeting_held": {
        const tpl = pick(rng, MEETING_TEMPLATES)
        events.push({
          ...base,
          type,
          summary: tpl.summary,
          detail: `With ${clientName}`,
          attendees: [clientName, staffName],
          actionItems: tpl.actionItems,
          actorName: staffName,
        })
        break
      }
      case "note_added": {
        events.push({
          ...base,
          type,
          summary: "Internal note added",
          detail: project ? project.title : "General",
          body: pick(rng, NOTE_TEMPLATES),
          actorName: staffName,
        })
        break
      }
      case "project_status_changed": {
        const [from, to] = pick(rng, STATUS_SEQUENCES)
        const p = project ?? pick(rng, activeProjects.length ? activeProjects : [{ id: "none", title: "General" }])
        events.push({
          ...base,
          projectId: p?.id ?? null,
          projectTitle: p?.title ?? null,
          type,
          summary: `${p?.title ?? "Project"} moved to ${to}`,
          detail: `${from} → ${to}`,
          fromStatus: from,
          toStatus: to,
          actorName: staffName,
        })
        break
      }
      case "return_filed": {
        const returnType = pick(rng, RETURN_TYPES)
        const taxYear = 2023 - Math.floor(rng() * 2)
        events.push({
          ...base,
          type,
          summary: `${taxYear} ${returnType} return filed`,
          detail: "E-filed and accepted",
          returnType,
          taxYear,
          actorName: staffName,
        })
        break
      }
    }
    idx++
  }

  return events.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Date grouping helpers
// ─────────────────────────────────────────────────────────────────────────────

function dateHeaderLabel(iso: string): string {
  const d = parseISO(iso)
  if (isToday(d)) return "Today"
  if (isYesterday(d)) return "Yesterday"
  return format(d, "MMMM d")
}

function groupByDate(events: TimelineEvent[]): Array<{ label: string; events: TimelineEvent[] }> {
  const groups: Array<{ label: string; events: TimelineEvent[] }> = []
  for (const e of events) {
    const label = dateHeaderLabel(e.occurredAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.events.push(e)
    } else {
      groups.push({ label, events: [e] })
    }
  }
  return groups
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true })
  } catch {
    return ""
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 12

export function ClientTimelineTab({ data }: { data: ClientBundle }) {
  const activeProjects = useMemo(
    () =>
      data.workItems
        .filter((w) => isActiveProjectStatus(w.status))
        .map((w) => ({ id: w.id, title: w.title || "(untitled project)" })),
    [data.workItems],
  )

  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [enabledTypes, setEnabledTypes] = useState<Set<TimelineEventType>>(
    new Set(ALL_EVENT_TYPES),
  )
  const [projectFilter, setProjectFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      setEvents(
        generateMockTimelineEvents(
          data.client.id,
          data.client.clientName,
          activeProjects,
          data.teamMembers,
        ),
      )
      setLoading(false)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 550)
    return () => clearTimeout(timer)
  }, [data.client.id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (!enabledTypes.has(e.type)) return false
      if (projectFilter !== "all") {
        if (projectFilter === "unassigned" && e.projectId) return false
        if (projectFilter !== "unassigned" && e.projectId !== projectFilter) return false
      }
      if (q) {
        const haystack = `${e.summary} ${e.detail}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [events, enabledTypes, projectFilter, search])

  // Reset pagination whenever the filters materially change the result set.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [enabledTypes, projectFilter, search])

  const visibleEvents = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length
  const groups = useMemo(() => groupByDate(visibleEvents), [visibleEvents])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    setTimeout(() => {
      setVisibleCount((v) => Math.min(v + PAGE_SIZE, filtered.length))
      setLoadingMore(false)
    }, 500)
  }, [loadingMore, hasMore, filtered.length])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: "200px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore, loading])

  const toggleType = (type: TimelineEventType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const allOn = enabledTypes.size === ALL_EVENT_TYPES.length

  if (loading) return <TimelineSkeleton />

  return (
    <div className="flex flex-col gap-4">
      {/* Filter row */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setEnabledTypes(allOn ? new Set() : new Set(ALL_EVENT_TYPES))
            }
            className={cn(
              "h-7 rounded-full border px-3 text-xs font-medium transition-colors",
              allOn
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            All
          </button>
          {ALL_EVENT_TYPES.map((type) => {
            const cfg = EVENT_CONFIG[type]
            const active = enabledTypes.has(type)
            const Icon = cfg.icon
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  active
                    ? "border-border bg-secondary text-secondary-foreground"
                    : "border-border bg-background text-muted-foreground/50 hover:text-muted-foreground",
                )}
              >
                <Icon className="h-3 w-3" />
                {cfg.label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {activeProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {filtered.length} event{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timeline"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Feed */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium text-foreground">No matching events</p>
          <p className="text-xs text-muted-foreground">
            Try adjusting the filters or search above.
          </p>
        </div>
      ) : (
        <div className="max-h-[720px] overflow-y-auto rounded-lg border">
          {groups.map((group, groupIdx) => (
            <div key={`${group.label}-${groupIdx}`}>
              <div className="sticky top-0 z-10 border-b bg-muted/90 px-4 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-muted/70">
                <span className="text-xs font-semibold text-foreground">{group.label}</span>
              </div>
              <div className="relative px-4 pb-2 pt-3">
                {group.events.length > 1 && (
                  <div className="absolute left-[19px] top-4 bottom-4 w-px bg-border" />
                )}
                {group.events.map((event) => (
                  <TimelineRow
                    key={event.id}
                    event={event}
                    expanded={expandedId === event.id}
                    onToggle={() =>
                      setExpandedId((id) => (id === event.id ? null : event.id))
                    }
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Infinite scroll sentinel + loading skeleton */}
          {hasMore && (
            <div ref={sentinelRef} className="px-4 pb-4">
              {loadingMore ? (
                <TimelineRowSkeleton />
              ) : (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

function TimelineRow({
  event,
  expanded,
  onToggle,
}: {
  event: TimelineEvent
  expanded: boolean
  onToggle: () => void
}) {
  const cfg = EVENT_CONFIG[event.type]
  const Icon = cfg.icon

  return (
    <div className="relative pb-3 last:pb-0">
      <span
        className={cn(
          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background",
          cfg.dotClass,
        )}
        style={{ position: "absolute", left: 0, top: 0 }}
        aria-hidden="true"
      >
        <Icon className={cn("h-3.5 w-3.5", cfg.iconClass)} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="ml-11 flex w-full items-start justify-between gap-3 rounded-md py-1 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{event.summary}</span>
            {event.projectTitle && (
              <Badge variant="outline" className="text-[10px]">
                {event.projectTitle}
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{event.detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <span className="text-xs text-muted-foreground">{relativeTime(event.occurredAt)}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="ml-11 mt-2 rounded-md border bg-muted/30 p-3">
          <TimelineRowDetail event={event} />
        </div>
      )}
    </div>
  )
}

function TimelineRowDetail({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case "email_sent":
    case "email_received":
      return (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            {event.type === "email_sent" ? `To ${event.counterparty}` : `From ${event.counterparty}`}
            {" · "}
            {format(parseISO(event.occurredAt), "MMM d, yyyy · h:mm a")}
          </p>
          <p className="whitespace-pre-wrap text-sm text-foreground/90">{event.body}</p>
        </div>
      )
    case "message_sent":
    case "message_received":
      return (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            {event.actorName} · {format(parseISO(event.occurredAt), "MMM d, yyyy · h:mm a")}
          </p>
          <p className="whitespace-pre-wrap text-sm text-foreground/90">{event.body}</p>
        </div>
      )
    case "document_requested":
      return (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileQuestion className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-foreground/90">{event.fileName}</span>
          </div>
          <Badge variant="outline" className="text-xs">
            Awaiting upload
          </Badge>
        </div>
      )
    case "document_uploaded":
      return (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm text-foreground/90">{event.fileName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(event.fileSizeBytes)}
            </span>
          </div>
          <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1.5 text-xs">
            <Download className="h-3 w-3" />
            Download
          </Button>
        </div>
      )
    case "meeting_held":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Attendees: {event.attendees.join(", ")}
          </p>
          {event.actionItems.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-foreground">Action items</p>
              <ul className="flex flex-col gap-1">
                {event.actionItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-foreground/90">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )
    case "note_added":
      return <p className="whitespace-pre-wrap text-sm text-foreground/90">{event.body}</p>
    case "project_status_changed":
      return (
        <div className="flex items-center gap-2 text-sm text-foreground/90">
          <Badge variant="outline" className="text-xs">
            {event.fromStatus}
          </Badge>
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge variant="secondary" className="text-xs">
            {event.toStatus}
          </Badge>
        </div>
      )
    case "return_filed":
      return (
        <div className="flex items-center gap-2 text-sm text-foreground/90">
          <FileCheck2 className="h-4 w-4 text-muted-foreground" />
          <span>
            {event.taxYear} Form {event.returnType} — e-filed and accepted by the IRS
          </span>
        </div>
      )
    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeletons
// ─────────────────────────────────────────────────────────────────────────────

function TimelineRowSkeleton() {
  return (
    <div className="flex items-start gap-3 py-2">
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-3 w-12 shrink-0" />
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>
      <div className="rounded-lg border p-4">
        <Skeleton className="mb-3 h-4 w-16" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <TimelineRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Avoid ArrowDownLeft unused-import lint noise: reserved for a future
// "received" directional affordance without swapping the icon set.
void ArrowDownLeft
