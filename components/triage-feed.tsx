"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import useSWR, { mutate as swrMutate } from "swr"
import useSWRInfinite from "swr/infinite"
import { formatDistanceToNow } from "date-fns"
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  ImageIcon,
  Inbox,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Paperclip,
  Receipt,
  Reply,
  Search,
  Send,
  Smile,
  Sparkles,
  Trash2,
  User,
  Users,
  Video,
  X,
} from "lucide-react"
import Link from "next/link"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUser, useDisplayName, useUserInitials } from "@/contexts/user-context"
import type { OutlookThreadSummary, OutlookThreadMessage } from "@/lib/outlook-api"

const COMMON_EMOJIS = ["👍", "❤️", "😊", "🎉", "🔥", "👏", "💯", "✨"]

/* ─────────────────────────────────────────────────────────────────────────
 * Types — kept in sync with /api/triage/feed/route.ts
 * ─────────────────────────────────────────────────────────────────────── */

type TriageSourceType =
  | "team_message"
  | "broadcast"
  | "debrief"
  | "calendly_meeting"
  | "daily_briefing"
  | "accepted_proposal"
  | "client_email"

interface TriageItem {
  id: string
  source_type: TriageSourceType
  source_id: string
  timestamp: string
  actor_name: string
  actor_initials?: string
  actor_id?: string | null
  title: string
  summary: string
  metadata?: Record<string, any>
}

interface FeedResponse {
  items: TriageItem[]
  total: number
}

const swrFetcher = (url: string) => fetch(url).then((r) => r.json())

// Unlike swrFetcher above (used for the always-200 triage/threads-list
// endpoints), thread detail can legitimately 404/409/500 — those need to
// surface as a thrown error so SWR's `error` is populated instead of
// `data` silently holding an `{ error: "..." }` payload with no messages.
const strictJsonFetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

/* ─────────────────────────────────────────────────────────────────────────
 * Visual config per source type. Centralised so tabs, badges, and cards
 * all read from the same map.
 * ─────────────────────────────────────────────────────────────────────── */

const SOURCE_META: Record<
  TriageSourceType,
  { label: string; icon: React.ComponentType<{ className?: string }>; accent: string }
> = {
  team_message: { label: "Messages", icon: MessageSquare, accent: "text-blue-600" },
  broadcast: { label: "Announcements", icon: Megaphone, accent: "text-[#C97B3F]" },
  debrief: { label: "Debriefs", icon: FileText, accent: "text-emerald-600" },
  calendly_meeting: { label: "Meetings", icon: Calendar, accent: "text-purple-600" },
  daily_briefing: { label: "Briefings", icon: Sparkles, accent: "text-amber-600" },
  accepted_proposal: { label: "Proposals", icon: CheckCircle2, accent: "text-rose-600" },
  client_email: { label: "Emails", icon: Mail, accent: "text-[#C97B3F]" },
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "broadcast", label: "Announcements" },
  { value: "team_message", label: "Messages" },
  { value: "debrief", label: "Debriefs" },
  { value: "calendly_meeting", label: "Meetings" },
  { value: "daily_briefing", label: "Briefings" },
  { value: "accepted_proposal", label: "Proposals" },
  { value: "client_email", label: "Emails" },
] as const

/* ─────────────────────────────────────────────────────────────────────────
 * Client email helpers — the "Emails" tab is backed by real Outlook
 * threads (GET /api/outlook/threads), kept separate from the main feed
 * items so it never mixes into the "All" tab or its counts.
 * ─────────────────────────────────────────────────────────────────────── */

interface EmailReplyResult {
  ok: boolean
  error?: string
}

/**
 * What GET /api/outlook/threads adds on top of the raw Graph thread:
 * which Hub client the other party is (matched by email address), that
 * client's open work items, and any existing filing.
 *
 * `client` is null for most threads — vendors, colleagues, newsletters.
 * That is the normal case, not a failure, and those threads simply show
 * no project control.
 */
interface TriageEmailThread extends OutlookThreadSummary {
  client: { kind: "contact" | "organization"; id: string; name: string } | null
  availableProjects: Array<{ id: string; title: string }>
  assignment: {
    workItemId: string
    workItemTitle: string | null
    assignedById: string | null
    assignedAt: string
  } | null
}

function threadToTriageItem(
  thread: TriageEmailThread,
  callbacks: {
    onReply: (messageId: string, text: string) => Promise<EmailReplyResult>
    onOpen: (conversationId: string) => void
    onAssign: (conversationId: string, workItemId: string) => Promise<EmailReplyResult>
    onUnassign: (conversationId: string) => Promise<EmailReplyResult>
  },
): TriageItem {
  return {
    id: thread.id,
    source_type: "client_email",
    source_id: thread.id,
    timestamp: thread.latestSentAt,
    actor_name: thread.participantName,
    title: thread.participantName,
    summary: thread.latestBodyPreview,
    metadata: {
      thread,
      direction: thread.latestDirection,
      unread: thread.unread,
      messageCount: thread.messageCount,
      onReply: (text: string) => callbacks.onReply(thread.latestMessageId, text),
      onOpen: () => callbacks.onOpen(thread.id),
      onAssign: (workItemId: string) => callbacks.onAssign(thread.id, workItemId),
      onUnassign: () => callbacks.onUnassign(thread.id),
    },
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Main component
 * ─────────────────────────────────────────────────────────────────────── */

export function TriageFeed() {
  const { teamMember } = useUser()
  const teamMemberId = teamMember?.id ?? null
  const [filter, setFilter] = useState<string>("all")

  // The feed endpoint always wants the team_member_id so it can anti-join
  // dismissals. We refetch on every focus so a dismiss in one tab is
  // reflected in another within seconds without a websocket layer.
  const feedUrl = teamMemberId
    ? `/api/triage/feed?team_member_id=${encodeURIComponent(teamMemberId)}&limit=80`
    : null

  const { data, isLoading, mutate } = useSWR<FeedResponse>(feedUrl, swrFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000, // gentle polling — feed is read-mostly
  })

  const items = data?.items ?? []
  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((it) => it.source_type === filter)),
    [items, filter],
  )

  /* ── Client emails (real Outlook data, Emails tab only) ───────────────
   * Backed by GET /api/outlook/threads, which returns the signed-in
   * user's own mailbox grouped into conversations. `status` tells us
   * whether to show a connect/reconnect prompt instead of the list.
   * Cleared threads are hidden locally only (mirrors "Clear" elsewhere,
   * a per-user view state) — clearing never touches the real mailbox.
   */
  interface EmailPage {
    status: "not_connected" | "needs_reconnect" | "connected"
    threads: TriageEmailThread[]
    nextSkip: number | null
  }

  const {
    data: emailPages,
    isLoading: emailsLoading,
    isValidating: emailsValidating,
    size: emailPageCount,
    setSize: setEmailPageCount,
    mutate: mutateEmails,
  } = useSWRInfinite<EmailPage>(
    (index, previous) => {
      if (filter !== "client_email") return null
      if (index === 0) return "/api/outlook/threads"
      // Null nextSkip means the mailbox is exhausted — stop asking.
      if (previous?.nextSkip == null) return null
      return `/api/outlook/threads?skip=${previous.nextSkip}`
    },
    swrFetcher,
    {
      revalidateOnFocus: true,
      // Only the first page revalidates on focus. Re-fetching every loaded
      // page would re-hit Graph once per page each time the tab regains
      // focus, which is how you meet a throttling limit.
      revalidateAll: false,
    },
  )

  const emailConnectionStatus = emailPages?.[0]?.status ?? "connected"

  /**
   * Flatten the pages, de-duplicating by thread id. Graph pages by message,
   * so one conversation can appear in two pages — the later page's copy is
   * built from older messages and has a lower count, so the FIRST
   * occurrence (newest) wins.
   */
  const emailThreads = useMemo(() => {
    const byId = new Map<string, TriageEmailThread>()
    for (const page of emailPages ?? []) {
      for (const thread of page.threads ?? []) {
        if (!byId.has(thread.id)) byId.set(thread.id, thread)
      }
    }
    return Array.from(byId.values())
  }, [emailPages])

  const lastEmailPage = emailPages?.[emailPages.length - 1]
  const hasMoreEmails = Boolean(lastEmailPage && lastEmailPage.nextSkip != null)
  const loadingMoreEmails = emailsValidating && (emailPages?.length ?? 0) < emailPageCount
  const [dismissedEmailIds, setDismissedEmailIds] = useState<Set<string>>(() => new Set())
  const [emailSubFilter, setEmailSubFilter] = useState<string>("all")
  const [emailSearch, setEmailSearch] = useState("")

  async function replyToEmailMessage(messageId: string, text: string): Promise<EmailReplyResult> {
    const res = await fetch("/api/outlook/threads/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, text }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: json.error || "Couldn't send that reply. Please try again." }
    }
    await mutateEmails()
    return { ok: true }
  }

  async function assignEmailThread(
    conversationId: string,
    workItemId: string,
  ): Promise<EmailReplyResult> {
    const res = await fetch("/api/outlook/threads/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, workItemId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: json.error || "Couldn't file that email. Please try again." }
    }
    await mutateEmails()
    return { ok: true }
  }

  async function unassignEmailThread(conversationId: string): Promise<EmailReplyResult> {
    const res = await fetch(
      `/api/outlook/threads/assign?conversationId=${encodeURIComponent(conversationId)}`,
      { method: "DELETE" },
    )
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: json.error || "Couldn't unfile that email." }
    }
    await mutateEmails()
    return { ok: true }
  }

  function loadMoreEmails() {
    if (!hasMoreEmails || loadingMoreEmails) return
    setEmailPageCount((n) => n + 1)
  }

  /**
   * Auto-load as the box nears its end, the way a mail client does, with
   * the button below as the deliberate fallback. The 200px margin fires
   * the fetch before the user hits the floor so the list rarely stalls.
   */
  function onEmailListScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 200) return
    loadMoreEmails()
  }

  function openEmailThread(conversationId: string) {
    swrMutate(`/api/outlook/threads/detail?conversationId=${encodeURIComponent(conversationId)}`)
  }

  function dismissEmailThread(item: TriageItem) {
    setDismissedEmailIds((prev) => new Set(prev).add(item.source_id))
  }

  const emailItems = useMemo(
    () =>
      emailThreads
        .filter((t) => !dismissedEmailIds.has(t.id))
        .map((t) =>
          threadToTriageItem(t, {
            onReply: replyToEmailMessage,
            onOpen: openEmailThread,
            onAssign: assignEmailThread,
            onUnassign: unassignEmailThread,
          }),
        )
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emailThreads, dismissedEmailIds],
  )

  const unreadEmailCount = useMemo(
    () => emailThreads.filter((t) => !dismissedEmailIds.has(t.id) && t.unread).length,
    [emailThreads, dismissedEmailIds],
  )

  const unassignedEmailCount = useMemo(
    () =>
      emailItems.filter((it) => {
        const thread = it.metadata!.thread as TriageEmailThread
        return thread.client && !thread.assignment
      }).length,
    [emailItems],
  )

  const visibleEmailItems = useMemo(() => {
    const query = emailSearch.trim().toLowerCase()
    return emailItems.filter((it) => {
      const thread = it.metadata!.thread as TriageEmailThread
      if (emailSubFilter === "unread" && !it.metadata!.unread) return false
      // "Unassigned" means a client thread nobody has filed yet. Threads
      // that match no client are excluded: they are not work waiting to be
      // filed, they are a newsletter.
      if (emailSubFilter === "unassigned" && (!thread.client || thread.assignment)) return false
      if (query) {
        const haystack = [thread.subject, thread.participantName, thread.participantEmail, thread.latestBodyPreview]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [emailItems, emailSubFilter, emailSearch])

  // Counts per source feed the filter chips with a "5" pill so partners
  // can scan to see where new activity is concentrated without clicking.
  const countsBySource = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const it of items) counts[it.source_type] = (counts[it.source_type] || 0) + 1
    return counts
  }, [items])

  // Optimistic dismissal — we drop the item from the local SWR cache
  // immediately so the UI feels instant, then post the dismissal.
  // Failures restore the item with a toast-less console error so the user
  // doesn't see a flash; they'll see the item return on next fetch anyway.
  async function dismissItem(item: TriageItem) {
    if (!teamMemberId) return
    mutate(
      (prev) => {
        if (!prev) return prev
        return { ...prev, items: prev.items.filter((i) => i.source_id !== item.source_id || i.source_type !== item.source_type) }
      },
      false,
    )
    try {
      await fetch("/api/triage/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_member_id: teamMemberId,
          source_type: item.source_type,
          source_id: item.source_id,
        }),
      })
    } catch (err) {
      console.error("[v0] dismiss failed:", err)
      mutate()
    }
  }

  async function clearAllVisible() {
    if (!teamMemberId || filtered.length === 0) return
    const dismissedKeys = new Set(filtered.map((it) => `${it.source_type}:${it.source_id}`))
    mutate(
      (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.filter(
            (it) => !dismissedKeys.has(`${it.source_type}:${it.source_id}`),
          ),
        }
      },
      false,
    )
    try {
      await fetch("/api/triage/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_member_id: teamMemberId,
          items: filtered.map((it) => ({
            source_type: it.source_type,
            source_id: it.source_id,
          })),
        }),
      })
    } catch (err) {
      console.error("[v0] clear-all failed:", err)
      mutate()
    }
  }

  return (
    <Card className="bg-white shadow-sm border-gray-200">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-blue-600" />
              Triage
            </CardTitle>
            <CardDescription>
              Recent activity across the firm — debriefs, team messages, new meetings, daily
              briefings, and accepted proposals. Clear items as you handle them.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="flex items-center gap-1">
              <Bell className="h-3 w-3" />
              {filtered.length} {filtered.length === 1 ? "item" : "items"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={filtered.length === 0 || !teamMemberId}
              onClick={clearAllVisible}
              className="gap-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear {filter === "all" ? "All" : "Filtered"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Composer — posting messages stays a first-class action even
            though messages now live in the same feed as everything else. */}
        <MessageComposer onPosted={() => mutate()} />

        {/* Filter chips (also tabs for keyboard nav). */}
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="flex flex-wrap gap-1 h-auto bg-gray-100 p-1">
            {FILTERS.map((f) => {
              // The Emails tab shows unread inbound threads, not a total —
              // that's the number that actually needs a reply.
              const count =
                f.value === "client_email"
                  ? unreadEmailCount
                  : f.value === "all"
                    ? items.length
                    : countsBySource[f.value] || 0
              return (
                <TabsTrigger key={f.value} value={f.value} className="gap-1.5">
                  {f.label}
                  {count > 0 ? (
                    <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-medium text-gray-700 min-w-[18px] h-[18px]">
                      {count}
                    </span>
                  ) : null}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>

        {/* Feed list. */}
        {filter === "client_email" ? (
          emailConnectionStatus === "not_connected" ? (
            <EmailConnectionPrompt
              icon={Link2}
              title="Connect your Outlook mailbox"
              description="Connect Outlook to read, open, and reply to client emails right here in Triage."
              ctaLabel="Connect Outlook"
            />
          ) : emailConnectionStatus === "needs_reconnect" ? (
            <EmailConnectionPrompt
              icon={AlertTriangle}
              title="Outlook needs to be reconnected"
              description="Your Outlook access expired or was revoked — reconnect to keep reading and replying to emails from here."
              ctaLabel="Reconnect Outlook"
            />
          ) : emailsLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading your inbox…
            </div>
          ) : (
            <div className="space-y-3">
              <EmailFilterBar
                subFilter={emailSubFilter}
                unassignedCount={unassignedEmailCount}
                onSubFilterChange={setEmailSubFilter}
                search={emailSearch}
                onSearchChange={setEmailSearch}
                unreadCount={unreadEmailCount}
              />
              {visibleEmailItems.length === 0 ? (
                <EmptyState filter="client_email" />
              ) : (
                /* The list scrolls inside its own box rather than growing the
                   page, so the filter bar and tabs stay put the way a mail
                   client's do. Capped against the viewport rather than a fixed
                   pixel height so it still fills a large screen. */
                <div
                  onScroll={onEmailListScroll}
                  className="max-h-[calc(100vh-24rem)] min-h-[20rem] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2"
                >
                  <ul className="space-y-2">
                    {visibleEmailItems.map((item) => (
                      <FeedCard key={item.source_id} item={item} onDismiss={dismissEmailThread} />
                    ))}
                  </ul>

                  {hasMoreEmails ? (
                    <div className="flex justify-center py-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadMoreEmails}
                        disabled={loadingMoreEmails}
                        className="gap-1.5 text-xs"
                      >
                        {loadingMoreEmails ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading older email…
                          </>
                        ) : (
                          "Load older email"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p className="py-3 text-center text-xs text-gray-400">
                      That&apos;s the whole mailbox.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        ) : isLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading activity…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <ul className="space-y-2">
            {filtered.map((item) => (
              <FeedCard key={`${item.source_type}-${item.source_id}`} item={item} onDismiss={dismissItem} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * EmailFilterBar — secondary toolbar shown only above the Emails tab's
 * list: All / Unread / Unassigned chips, plus a search box over sender,
 * subject, and body.
 * ─────────────────────────────────────────────────────────────────────── */

function EmailFilterBar({
  subFilter,
  onSubFilterChange,
  search,
  onSearchChange,
  unreadCount,
  unassignedCount,
}: {
  subFilter: string
  onSubFilterChange: (v: string) => void
  search: string
  onSearchChange: (v: string) => void
  unreadCount: number
  unassignedCount: number
}) {
  const chips: Array<{ value: string; label: string; count?: number }> = [
    { value: "all", label: "All" },
    { value: "unread", label: "Unread", count: unreadCount },
    // Client mail nobody has filed yet — the actual work queue. Counts
    // only threads that matched a client, so vendors never inflate it.
    { value: "unassigned", label: "Unassigned", count: unassignedCount },
  ]

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
      <div className="flex flex-wrap gap-1">
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => onSubFilterChange(chip.value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              subFilter === chip.value
                ? "bg-[#4A5240] text-white"
                : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
            }`}
          >
            {chip.label}
            {chip.count ? (
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-medium min-w-[16px] h-[16px] ${
                  subFilter === chip.value ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {chip.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search sender, subject, or body…"
          className="h-8 pl-8 text-sm bg-white"
        />
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * EmailConnectionPrompt — shown in place of the Emails list when the
 * signed-in user hasn't connected Outlook yet, or their connection
 * needs re-authorizing. Sends straight to the OAuth flow used by
 * /meetings/outlook, which redirects back there on completion.
 * ─────────────────────────────────────────────────────────────────────── */

function EmailConnectionPrompt({
  icon: Icon,
  title,
  description,
  ctaLabel,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  ctaLabel: string
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#4A5240]">
        <Icon className="h-5 w-5" />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
      <Button
        size="sm"
        className="mt-1 gap-1.5 text-white hover:opacity-90"
        style={{ backgroundColor: "#4A5240" }}
        onClick={() => {
          window.location.href = "/api/outlook/oauth/authorize"
        }}
      >
        <Mail className="h-3.5 w-3.5" />
        {ctaLabel}
      </Button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * MessageComposer — lifted from the old MessageBoard. Posts to the same
 * /api/messages endpoint, then asks the parent to refetch the feed so
 * the new message appears at the top alongside everything else.
 * ─────────────────────────────────────────────────────────────────────── */

function MessageComposer({ onPosted }: { onPosted: () => void }) {
  const { teamMember } = useUser()
  const displayName = useDisplayName()
  const userInitials = useUserInitials()
  const [draft, setDraft] = useState("")
  const [isPosting, setIsPosting] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showGifs, setShowGifs] = useState(false)
  const [gifQuery, setGifQuery] = useState("")
  const [gifs, setGifs] = useState<any[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function searchGifs(query: string) {
    if (!query.trim()) {
      setGifs([])
      return
    }
    try {
      const r = await fetch(
        `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&limit=12`,
      )
      const data = await r.json()
      setGifs(data.results || [])
    } catch (err) {
      console.error("[v0] gif search failed:", err)
    }
  }

  async function postMessage(gifUrl?: string) {
    if (!draft.trim() && !gifUrl) return
    setIsPosting(true)
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: displayName,
          authorInitials: userInitials,
          teamMemberId: teamMember?.id,
          content: draft.trim(),
          gifUrl,
        }),
      })
      setDraft("")
      setShowGifs(false)
      setGifQuery("")
      setGifs([])
      onPosted()
    } catch (err) {
      console.error("[v0] post message failed:", err)
    } finally {
      setIsPosting(false)
    }
  }

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current
    if (!textarea) {
      setDraft((d) => d + emoji)
    } else {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = draft
      setDraft(text.substring(0, start) + emoji + text.substring(end))
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + emoji.length, start + emoji.length)
      }, 0)
    }
    setShowEmoji(false)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      postMessage()
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex items-start gap-3">
        <Avatar className="h-9 w-9 bg-blue-100">
          <AvatarFallback className="text-blue-700 font-medium text-xs">
            {userInitials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-2">
          <Textarea
            ref={textareaRef}
            placeholder="Share an update with your team…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            className="min-h-[60px] resize-none bg-white"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <Popover open={showEmoji} onOpenChange={setShowEmoji}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Smile className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2">
                  <div className="grid grid-cols-4 gap-1">
                    {COMMON_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => insertEmoji(emoji)}
                        className="text-xl hover:bg-gray-100 rounded p-1.5 transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Popover open={showGifs} onOpenChange={setShowGifs}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2">
                  <input
                    type="text"
                    placeholder="Search GIFs…"
                    value={gifQuery}
                    onChange={(e) => {
                      setGifQuery(e.target.value)
                      searchGifs(e.target.value)
                    }}
                    className="w-full px-2.5 py-1.5 border rounded-md text-sm mb-2"
                  />
                  <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
                    {gifs.map((gif) => (
                      <button
                        key={gif.id}
                        onClick={() => postMessage(gif.media_formats.tinygif.url)}
                        className="aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                      >
                        <img
                          src={gif.media_formats.tinygif.url || "/placeholder.svg"}
                          alt={gif.content_description}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Button
              size="sm"
              onClick={() => postMessage()}
              disabled={!draft.trim() || isPosting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isPosting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              Post
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * FeedCard — one item, dispatched to a source-specific summary block.
 *
 * The card is a disclosure: the always-visible top half is the same compact
 * summary as before, and a chevron-driven panel below expands into the
 * full record (untruncated notes, action items, comments, services,
 * invitees, etc.) plus a footer of "Open in …" links to the related Hub
 * pages — Client profile, Karbon work item, Ignition proposal, etc.
 * ─────────────────────────────────────────────────────────────────────── */

function FeedCard({
  item,
  onDismiss,
}: {
  item: TriageItem
  onDismiss: (item: TriageItem) => void
}) {
  const meta = SOURCE_META[item.source_type]
  const Icon = meta.icon
  const [expanded, setExpanded] = useState(false)

  // Inbound-unread client emails get a visually louder card (amber left
  // border + tint) — everything else keeps the standard neutral treatment.
  const isUnreadEmail = item.source_type === "client_email" && Boolean(item.metadata?.unread)

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    // Side effect belongs in the event handler, not the setState updater —
    // updater functions can run during React's render phase, and calling
    // another component's setState from there trips "Cannot update a
    // component while rendering a different component."
    if (next && item.source_type === "client_email") {
      ;(item.metadata?.onOpen as (() => void) | undefined)?.()
    }
  }
  const panelId = `triage-card-${item.source_type}-${item.source_id}-detail`

  return (
    <li
      className={`group relative rounded-lg border bg-white hover:shadow-sm transition-all ${
        isUnreadEmail
          ? "border-l-4 hover:border-gray-300"
          : "border-gray-200 hover:border-gray-300"
      }`}
      style={
        isUnreadEmail
          ? { borderLeftColor: "#C97B3F", backgroundColor: "#FEF3C7" }
          : undefined
      }
    >
      <div className="flex items-start gap-2 p-3">
        {/* Expand toggle — full-height hit target on the left edge so
            keyboard users get an obvious affordance and the entire row
            isn't a single sprawling button. */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={expanded ? "Collapse details" : "Expand details"}
          className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-50 ${meta.accent}`}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </div>

        {/* Body: NOT wrapped in a <button> because SourceBody can contain
            anchor/link descendants for some sources, which would be
            invalid nesting. Clicking the meta row still toggles. */}
        <div className="min-w-0 flex-1">
          <div
            role="button"
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                toggle()
              }
            }}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex items-center gap-2 flex-wrap cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 rounded -mx-1 px-1"
          >
            <Badge variant="outline" className={`text-[10px] ${meta.accent}`}>
              {meta.label}
            </Badge>
            <span className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
            </span>
            {item.metadata?.is_pinned ? (
              <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200">
                Pinned
              </Badge>
            ) : null}
          </div>

          <SourceBody item={item} />
        </div>

        {/* Dismiss button — tucked into the card corner, always reachable
            via keyboard but visually subtle until hover. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 opacity-50 group-hover:opacity-100 transition-opacity"
          aria-label="Clear this item"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(item)
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded ? (
        <div
          id={panelId}
          className="border-t border-gray-100 bg-gray-50/60 px-3 py-3 rounded-b-lg"
        >
          <ExpandedDetail item={item} />
          <ItemLinkFooter item={item} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * Per-source rendering. Each branch picks the most useful piece of
 * information from the metadata bag for that source — partners reading
 * the feed should be able to triage without expanding anything.
 */
function SourceBody({ item }: { item: TriageItem }) {
  switch (item.source_type) {
    case "team_message":
      return <TeamMessageBody item={item} />
    case "broadcast":
      return <BroadcastBody item={item} />
    case "debrief":
      return <DebriefBody item={item} />
    case "calendly_meeting":
      return <CalendlyBody item={item} />
    case "daily_briefing":
      return <BriefingBody item={item} />
    case "accepted_proposal":
      return <ProposalBody item={item} />
    case "client_email":
      return <EmailThreadBody item={item} />
  }
}

function TeamMessageBody({ item }: { item: TriageItem }) {
  const reactionCount = (item.metadata?.reaction_count as number) || 0
  const commentCount = (item.metadata?.comment_count as number) || 0
  const gifUrl = item.metadata?.gif_url as string | undefined
  return (
    <>
      <div className="mt-0.5 flex items-center gap-2">
        <Avatar className="h-5 w-5 bg-blue-100">
          <AvatarFallback className="text-[10px] text-blue-700 font-medium">
            {item.actor_initials || item.actor_name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <p className="text-sm font-medium text-gray-900">{item.title}</p>
      </div>
      {item.summary ? (
        <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap line-clamp-3">{item.summary}</p>
      ) : null}
      {gifUrl ? (
        <img
          src={gifUrl || "/placeholder.svg"}
          alt="GIF"
          className="mt-2 rounded max-w-[160px] max-h-[120px] object-cover"
        />
      ) : null}
      {(reactionCount > 0 || commentCount > 0) && (
        <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
          {reactionCount > 0 ? <span>{reactionCount} reactions</span> : null}
          {commentCount > 0 ? <span>{commentCount} comments</span> : null}
        </div>
      )}
    </>
  )
}

function BroadcastBody({ item }: { item: TriageItem }) {
  const postedBy = item.metadata?.posted_by as string | undefined
  const actionItems = item.metadata?.action_items as string | undefined
  const attachments = (item.metadata?.attachments as Array<{ url: string; name: string }>) || []
  return (
    <>
      <p className="mt-0.5 text-sm font-semibold text-gray-900 flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5 text-[#C97B3F]" />
        {item.title}
      </p>
      <p className="text-xs text-gray-500">
        Firm announcement{postedBy ? ` • posted by ${postedBy}` : ""}
      </p>
      <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap line-clamp-3">{item.summary}</p>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {actionItems ? (
          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200">
            Action items included
          </Badge>
        ) : null}
        {attachments.length > 0 ? (
          <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-200">
            {attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
          </Badge>
        ) : null}
      </div>
    </>
  )
}

function DebriefBody({ item }: { item: TriageItem }) {
  const workItem = item.metadata?.work_item_title as string | undefined
  const debriefType = item.metadata?.debrief_type as string | undefined
  const actionCount = (item.metadata?.action_item_count as number) || 0
  const status = item.metadata?.status as string | undefined
  return (
    <>
      <p className="mt-0.5 text-sm font-medium text-gray-900">{item.title}</p>
      <p className="text-xs text-gray-500">
        Logged by {item.actor_name}
        {debriefType ? ` • ${debriefType}` : ""}
      </p>
      <p className="mt-1 text-sm text-gray-700 line-clamp-2">{item.summary}</p>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
        {workItem ? (
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Briefcase className="h-3 w-3" />
            {workItem}
          </span>
        ) : null}
        {status ? (
          <Badge
            variant={status === "completed" ? "default" : "secondary"}
            className={status === "completed" ? "bg-green-100 text-green-700 text-[10px]" : "text-[10px]"}
          >
            {status}
          </Badge>
        ) : null}
        {actionCount > 0 ? (
          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200">
            {actionCount} action item{actionCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
    </>
  )
}

function CalendlyBody({ item }: { item: TriageItem }) {
  const startTime = item.metadata?.start_time as string | undefined
  const host = item.metadata?.host_name as string | undefined
  return (
    <>
      <p className="mt-0.5 text-sm font-medium text-gray-900">{item.title}</p>
      <p className="text-xs text-gray-500">
        {host ? `Hosted by ${host}` : "New meeting"}
        {startTime ? ` • ${formatTime(startTime)}` : ""}
      </p>
      {item.metadata?.event_type_name ? (
        <Badge variant="outline" className="mt-1 text-[10px]">
          {item.metadata.event_type_name as string}
        </Badge>
      ) : null}
    </>
  )
}

function BriefingBody({ item }: { item: TriageItem }) {
  return (
    <>
      <p className="mt-0.5 text-sm font-medium text-gray-900 flex items-center gap-1.5">
        <Mail className="h-3.5 w-3.5 text-amber-500" />
        {item.title}
      </p>
      <p className="mt-0.5 text-sm text-gray-700">{item.summary}</p>
      <p className="mt-1 text-xs text-gray-500">
        Sent by {item.actor_name} — check your inbox for the full digest.
      </p>
    </>
  )
}

function ProposalBody({ item }: { item: TriageItem }) {
  const url = item.metadata?.proposal_url as string | undefined
  return (
    <>
      <p className="mt-0.5 text-sm font-medium text-gray-900">{item.title}</p>
      <p className="mt-0.5 text-sm text-gray-700">{item.summary}</p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          View proposal <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </>
  )
}

/**
 * EmailThreadBody — always-visible summary for a client email thread.
 * Shows the client link, subject, latest sender, a two-line snippet, a
 * direction indicator, and the three primary actions (Assign to project,
 * Reply, Clear — Clear is the existing dismiss button in FeedCard's
 * corner). Reply opens its own inline compose box here, independent of
 * the chevron-driven full-thread expand/collapse.
 */
function EmailThreadBody({ item }: { item: TriageItem }) {
  const thread = item.metadata!.thread as TriageEmailThread
  const direction = item.metadata!.direction as "inbound" | "outbound"
  const unread = Boolean(item.metadata!.unread)
  const messageCount = item.metadata!.messageCount as number
  const onReply = item.metadata!.onReply as (text: string) => Promise<EmailReplyResult>
  const onAssign = item.metadata!.onAssign as (workItemId: string) => Promise<EmailReplyResult>
  const onUnassign = item.metadata!.onUnassign as () => Promise<EmailReplyResult>

  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [replyOpen, setReplyOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  async function fileUnder(workItemId: string) {
    setAssigning(true)
    setAssignError(null)
    const result = await onAssign(workItemId)
    if (!result.ok) setAssignError(result.error ?? "Couldn't file that email.")
    setAssigning(false)
  }

  async function unfile() {
    setAssigning(true)
    setAssignError(null)
    const result = await onUnassign()
    if (!result.ok) setAssignError(result.error ?? "Couldn't unfile that email.")
    setAssigning(false)
  }

  async function sendReply() {
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setSendError(null)
    const result = await onReply(text)
    setSending(false)
    if (!result.ok) {
      setSendError(result.error || "Couldn't send that reply. Please try again.")
      return
    }
    setDraft("")
    setReplyOpen(false)
  }

  return (
    <>
      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
        {unread ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: "#C97B3F" }}
            aria-hidden="true"
          />
        ) : null}
        <span className={`text-sm font-semibold ${unread ? "text-gray-900" : "text-gray-700"}`}>
          {thread.participantName}
        </span>
        {messageCount > 1 ? (
          <span className="text-xs text-gray-500">{messageCount} messages</span>
        ) : null}
      </div>
      <p className={`text-sm ${unread ? "font-medium text-gray-900" : "text-gray-700"}`}>
        {thread.subject}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
        {direction === "inbound" ? (
          <ArrowDownLeft className="h-3 w-3 text-[#C97B3F]" />
        ) : (
          <ArrowUpRight className="h-3 w-3 text-gray-400" />
        )}
        {thread.participantName} &lt;{thread.participantEmail}&gt;
      </p>
      <p className="mt-1 text-sm text-gray-600 line-clamp-2">{thread.latestBodyPreview}</p>

      <div
        className="mt-2 flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            setSendError(null)
            setReplyOpen((v) => !v)
          }}
        >
          <Reply className="h-3 w-3" />
          Reply
        </Button>

        {/* Filing a thread under a job is the part that replaces Karbon.
            It only appears when the other party matched a Hub client --
            there is no project to file a newsletter under. */}
        {thread.client ? (
          thread.assignment ? (
            <Badge
              variant="outline"
              className="h-7 gap-1 pr-1 text-xs font-normal"
              title={`Filed under ${thread.assignment.workItemTitle ?? "a project"}`}
            >
              <Briefcase className="h-3 w-3" />
              {thread.assignment.workItemTitle ?? "Assigned"}
              <button
                type="button"
                onClick={unfile}
                disabled={assigning}
                className="rounded-full p-0.5 hover:bg-black/10 disabled:opacity-50"
                aria-label="Remove this project assignment"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : thread.availableProjects.length > 0 ? (
            <Select onValueChange={fileUnder} disabled={assigning}>
              <SelectTrigger className="h-7 w-52 text-xs">
                <SelectValue placeholder="Assign to project" />
              </SelectTrigger>
              <SelectContent>
                {thread.availableProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            // Matched a client, but they have nothing open. Saying so beats
            // an empty dropdown that looks broken.
            <span className="text-xs text-gray-500">
              No open projects for {thread.client.name}
            </span>
          )
        ) : null}
      </div>

      {assignError ? <p className="mt-1 text-xs text-red-600">{assignError}</p> : null}

      {replyOpen ? (
        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Reply to ${thread.participantName}…`}
            className="min-h-[70px] resize-none bg-white text-sm"
          />
          {sendError ? <p className="text-xs text-red-600">{sendError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReplyOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button size="sm" onClick={sendReply} disabled={!draft.trim() || sending} className="gap-1.5">
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * ExpandedDetail — full-record view rendered when the card is opened.
 * Each branch surfaces the untruncated fields the corresponding
 * compact summary intentionally hides.
 * ─────────────────────────────────────────────────────────────────────── */

function ExpandedDetail({ item }: { item: TriageItem }) {
  switch (item.source_type) {
    case "team_message":
      return <TeamMessageExpanded item={item} />
    case "broadcast":
      return <BroadcastExpanded item={item} />
    case "debrief":
      return <DebriefExpanded item={item} />
    case "calendly_meeting":
      return <CalendlyExpanded item={item} />
    case "daily_briefing":
      return <BriefingExpanded item={item} />
    case "accepted_proposal":
      return <ProposalExpanded item={item} />
    case "client_email":
      return <EmailThreadExpanded item={item} />
  }
}

function TeamMessageExpanded({ item }: { item: TriageItem }) {
  const gifUrl = item.metadata?.gif_url as string | undefined
  const reactions = (item.metadata?.reactions as Array<{ emoji: string; count: number }>) || []
  const comments =
    (item.metadata?.comments as Array<{
      id: string
      author_name: string
      author_initials: string | null
      content: string
      created_at: string
    }>) || []

  return (
    <div className="space-y-3 text-sm">
      {item.summary ? (
        <p className="whitespace-pre-wrap text-gray-800">{item.summary}</p>
      ) : (
        <p className="italic text-gray-500">No message text — media-only post.</p>
      )}

      {gifUrl ? (
        <img
          src={gifUrl || "/placeholder.svg"}
          alt="Attached GIF"
          className="rounded max-w-[280px] max-h-[200px] object-cover border border-gray-200"
        />
      ) : null}

      {reactions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {reactions.map((r) => (
            <span
              key={r.emoji}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs"
            >
              <span>{r.emoji}</span>
              <span className="text-gray-600">{r.count}</span>
            </span>
          ))}
        </div>
      ) : null}

      {comments.length > 0 ? (
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
            {comments.length} {comments.length === 1 ? "comment" : "comments"}
          </div>
          <ul className="divide-y divide-gray-100">
            {comments.map((c) => (
              <li key={c.id} className="px-3 py-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <Avatar className="h-5 w-5 bg-gray-100">
                    <AvatarFallback className="text-[10px] text-gray-700">
                      {c.author_initials ||
                        c.author_name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium text-gray-800">{c.author_name}</span>
                  <span className="text-[11px] text-gray-500">
                    {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap pl-7">{c.content}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function BroadcastExpanded({ item }: { item: TriageItem }) {
  const announcement = (item.metadata?.announcement as string) || item.summary || ""
  const actionItems = item.metadata?.action_items as string | undefined
  const attachments = (item.metadata?.attachments as Array<{ url: string; name: string; size_bytes?: number }>) || []
  const postedBy = item.metadata?.posted_by as string | undefined

  const formatBytes = (b?: number) => {
    if (!b) return ""
    if (b < 1024) return ` (${b} B)`
    if (b < 1024 * 1024) return ` (${(b / 1024).toFixed(1)} KB)`
    return ` (${(b / (1024 * 1024)).toFixed(1)} MB)`
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Topic</div>
        <p className="font-semibold text-gray-900">{item.title}</p>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Announcement</div>
        <p className="whitespace-pre-wrap text-gray-800 rounded-md border border-gray-200 bg-white p-3">
          {announcement}
        </p>
      </div>
      {actionItems ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Action Items</div>
          <p className="whitespace-pre-wrap text-amber-900 rounded-md border border-amber-200 bg-amber-50 p-3">
            {actionItems}
          </p>
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Attachments</div>
          <ul className="space-y-1 rounded-md border border-blue-200 bg-blue-50 p-3">
            {attachments.map((a, i) => (
              <li key={i}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 hover:underline inline-flex items-center gap-1"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {a.name}{formatBytes(a.size_bytes)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {postedBy ? (
        <p className="text-xs text-gray-500">Posted by {postedBy}</p>
      ) : null}
    </div>
  )
}

function DebriefExpanded({ item }: { item: TriageItem }) {
  const fullNotes = (item.metadata?.full_notes as string) || item.summary || ""
  const debriefType = item.metadata?.debrief_type as string | undefined
  const status = item.metadata?.status as string | undefined
  const followUpDate = item.metadata?.follow_up_date as string | undefined
  const actionItems =
    (item.metadata?.action_items as Array<Record<string, unknown>>) || []

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {debriefType ? (
          <DetailField label="Type" value={debriefType} />
        ) : null}
        {status ? <DetailField label="Status" value={status} /> : null}
        {followUpDate ? (
          <DetailField
            label="Follow-up"
            value={new Date(followUpDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          />
        ) : null}
        <DetailField label="Logged by" value={item.actor_name} />
      </div>

      {fullNotes ? (
        <div>
          <div className="text-xs font-medium text-gray-600 mb-1">Notes</div>
          <p className="whitespace-pre-wrap text-gray-800 rounded-md border border-gray-200 bg-white p-3">
            {fullNotes}
          </p>
        </div>
      ) : null}

      {actionItems.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-gray-600 mb-1">
            {actionItems.length} action item{actionItems.length === 1 ? "" : "s"}
          </div>
          <ul className="space-y-1 rounded-md border border-gray-200 bg-white p-2">
            {actionItems.map((ai, idx) => {
              const text =
                (ai.text as string) ||
                (ai.title as string) ||
                (ai.description as string) ||
                JSON.stringify(ai)
              const done = Boolean(ai.completed || ai.done)
              const owner = (ai.owner as string) || (ai.assignee as string) || undefined
              const dueDate = (ai.due_date as string) || (ai.due as string) || undefined
              return (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      done ? "bg-emerald-500 border-emerald-500 text-white" : "border-gray-300"
                    }`}
                  >
                    {done ? <CheckCircle2 className="h-3 w-3" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`whitespace-pre-wrap ${
                        done ? "text-gray-400 line-through" : "text-gray-800"
                      }`}
                    >
                      {text}
                    </p>
                    {(owner || dueDate) && (
                      <p className="text-[11px] text-gray-500">
                        {owner ? owner : null}
                        {owner && dueDate ? " • " : null}
                        {dueDate
                          ? `Due ${new Date(dueDate).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}`
                          : null}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function CalendlyExpanded({ item }: { item: TriageItem }) {
  const startTime = item.metadata?.start_time as string | undefined
  const endTime = item.metadata?.end_time as string | undefined
  const host = item.metadata?.host_name as string | undefined
  const locationType = item.metadata?.location_type as string | undefined
  const location = item.metadata?.location as string | undefined
  const eventTypeName = item.metadata?.event_type_name as string | undefined
  const invitees =
    (item.metadata?.invitees as Array<{
      name: string | null
      email: string | null
      contact_id: string | null
    }>) || []

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {eventTypeName ? <DetailField label="Event type" value={eventTypeName} /> : null}
        {host ? <DetailField label="Host" value={host} /> : null}
        {startTime ? (
          <DetailField label="Starts" value={formatTime(startTime)} />
        ) : null}
        {endTime ? <DetailField label="Ends" value={formatTime(endTime)} /> : null}
        {locationType ? (
          <DetailField label="Location" value={location || locationType} />
        ) : null}
      </div>

      {invitees.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-gray-600 mb-1">
            Invitee{invitees.length === 1 ? "" : "s"}
          </div>
          <ul className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
            {invitees.map((iv, idx) => (
              <li key={idx} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-800">{iv.name || "Unknown invitee"}</p>
                  {iv.email ? (
                    <p className="truncate text-xs text-gray-500">{iv.email}</p>
                  ) : null}
                </div>
                {iv.contact_id ? (
                  <Link
                    href={`/clients/${iv.contact_id}`}
                    className="shrink-0 text-xs text-blue-600 hover:underline"
                  >
                    View client
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function BriefingExpanded({ item }: { item: TriageItem }) {
  const dateKey = item.metadata?.date_key as string | undefined
  return (
    <div className="space-y-2 text-sm text-gray-700">
      <p>{item.summary}</p>
      {dateKey ? (
        <p className="text-xs text-gray-500">
          Briefing date: <span className="font-medium text-gray-700">{dateKey}</span>
        </p>
      ) : null}
      <p className="text-xs text-gray-500">
        The full digest is delivered to your inbox each weekday morning. Check your email
        for the complete client priority list, upcoming meetings, and pending follow-ups.
      </p>
    </div>
  )
}

function ProposalExpanded({ item }: { item: TriageItem }) {
  const currency = (item.metadata?.currency as string) || "USD"
  const totalValue = item.metadata?.total_value as number | null | undefined
  const recurringTotal = item.metadata?.recurring_total as number | null | undefined
  const oneTimeTotal = item.metadata?.one_time_total as number | null | undefined
  const recurringFrequency = item.metadata?.recurring_frequency as string | undefined
  const clientPartner = item.metadata?.client_partner as string | undefined
  const clientManager = item.metadata?.client_manager as string | undefined
  const proposalSentBy = item.metadata?.proposal_sent_by as string | undefined
  const services =
    (item.metadata?.services as Array<{
      service_name: string
      description: string | null
      total_amount: number | null
      billing_frequency: string | null
      quantity: number | null
    }>) || []

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {totalValue != null ? (
          <DetailField label="Total" value={formatCurrencyClient(totalValue, currency)} />
        ) : null}
        {recurringTotal != null && recurringTotal !== 0 ? (
          <DetailField
            label="Recurring"
            value={`${formatCurrencyClient(recurringTotal, currency)}${
              recurringFrequency ? ` / ${recurringFrequency}` : ""
            }`}
          />
        ) : null}
        {oneTimeTotal != null && oneTimeTotal !== 0 ? (
          <DetailField label="One-time" value={formatCurrencyClient(oneTimeTotal, currency)} />
        ) : null}
        {proposalSentBy ? <DetailField label="Sent by" value={proposalSentBy} /> : null}
        {clientPartner ? <DetailField label="Partner" value={clientPartner} /> : null}
        {clientManager ? <DetailField label="Manager" value={clientManager} /> : null}
      </div>

      {services.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-gray-600 mb-1">
            {services.length} service{services.length === 1 ? "" : "s"}
          </div>
          <ul className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
            {services.map((s, idx) => (
              <li key={idx} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800">{s.service_name}</p>
                  {s.description ? (
                    <p className="text-xs text-gray-500 line-clamp-2">{s.description}</p>
                  ) : null}
                  {s.billing_frequency ? (
                    <p className="text-[11px] text-gray-500">
                      {s.billing_frequency}
                      {s.quantity ? ` • Qty ${s.quantity}` : ""}
                    </p>
                  ) : null}
                </div>
                {s.total_amount != null ? (
                  <span className="shrink-0 text-sm font-medium text-gray-800">
                    {formatCurrencyClient(s.total_amount, currency)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/**
 * EmailThreadExpanded — full thread, oldest first / newest last. This is
 * what the chevron reveals: the collapsed card only shows the message
 * count and latest snippet, this shows every message in order.
 */
/**
 * Fetches the full conversation (every message, full plain-text body)
 * on demand — only mounted once a card is expanded, so opening a card
 * is exactly what triggers /api/outlook/threads/detail, including its
 * side effect of marking unread messages read on Outlook. Once that
 * lands, we revalidate the list so the unread dot/count clears too.
 */
function EmailThreadExpanded({ item }: { item: TriageItem }) {
  const thread = item.metadata!.thread as OutlookThreadSummary
  const { data, error, isLoading } = useSWR<{ id: string; subject: string; messages: OutlookThreadMessage[] }>(
    `/api/outlook/threads/detail?conversationId=${encodeURIComponent(thread.id)}`,
    strictJsonFetcher,
  )

  useEffect(() => {
    if (data) swrMutate("/api/outlook/threads")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading full thread…
      </div>
    )
  }

  if (error || !data) {
    return <p className="text-sm text-red-600">Couldn&apos;t load this thread. Please try again.</p>
  }

  return (
    <div className="space-y-2">
      {data.messages.map((m) => (
        <div
          key={m.id}
          className={`rounded-md border p-2.5 text-sm ${
            m.direction === "inbound" ? "border-[#E9D28F] bg-white" : "border-gray-200 bg-gray-50"
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
              {m.direction === "inbound" ? (
                <ArrowDownLeft className="h-3 w-3 text-[#C97B3F]" />
              ) : (
                <ArrowUpRight className="h-3 w-3 text-gray-400" />
              )}
              {m.senderName}
              <span className="font-normal text-gray-400">&lt;{m.senderEmail}&gt;</span>
            </span>
            <span className="text-[11px] text-gray-500">
              {formatDistanceToNow(new Date(m.sentAt), { addSuffix: true })}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-gray-800">{m.bodyText}</p>
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * Footer of contextual "Open in …" links. Each builds on metadata IDs
 * shipped by /api/triage/feed so we never need a per-card follow-up
 * fetch just to know whether a link can be rendered.
 * ─────────────────────────────────────────────────────────────────────── */

function ItemLinkFooter({ item }: { item: TriageItem }) {
  const links: Array<{
    label: string
    href: string
    icon: React.ComponentType<{ className?: string }>
    external?: boolean
  }> = []

  const md = item.metadata || {}
  const clientId = md.client_id as string | undefined
  const workItemId = md.work_item_id as string | undefined
  const karbonUrl = (md.karbon_work_url as string) || (md.karbon_url as string) || undefined

  switch (item.source_type) {
    case "debrief": {
      if (clientId) {
        links.push({
          label: "View client",
          href: `/clients/${clientId}`,
          icon: User,
        })
      }
      if (karbonUrl) {
        links.push({
          label: "Open work item in Karbon",
          href: karbonUrl,
          icon: Briefcase,
          external: true,
        })
      }
      if (workItemId) {
        links.push({
          label: "All work items",
          href: `/work-items`,
          icon: Briefcase,
        })
      }
      links.push({ label: "All debriefs", href: "/meetings/debriefs", icon: FileText })
      break
    }
    case "calendly_meeting": {
      const joinUrl = md.join_url as string | undefined
      if (joinUrl) {
        links.push({
          label: "Join meeting",
          href: joinUrl,
          icon: Video,
          external: true,
        })
      }
      if (clientId) {
        links.push({
          label: "View client",
          href: `/clients/${clientId}`,
          icon: User,
        })
      }
      if (workItemId) {
        links.push({
          label: "All work items",
          href: `/work-items`,
          icon: Briefcase,
        })
      }
      links.push({ label: "Open calendar", href: "/meetings/calendar", icon: Calendar })
      break
    }
    case "accepted_proposal": {
      const proposalUrl = md.proposal_url as string | undefined
      if (clientId) {
        links.push({
          label: "View client",
          href: `/clients/${clientId}`,
          icon: User,
        })
      }
      if (proposalUrl) {
        links.push({
          label: "View signed proposal",
          href: proposalUrl,
          icon: Receipt,
          external: true,
        })
      }
      links.push({ label: "All proposals", href: "/sales/proposals", icon: FileText })
      break
    }
    case "team_message": {
      // Nothing canonical to link to — comments live inline in the
      // expanded view. We still surface a way to open the broader team
      // message archive if/when that surface exists.
      break
    }
    case "daily_briefing": {
      links.push({ label: "Open intake queue", href: "/sales/intake", icon: Users })
      links.push({ label: "View today on calendar", href: "/meetings/calendar", icon: Calendar })
      break
    }
  }

  if (links.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
      {links.map((link) => {
        const LinkIcon = link.icon
        const inner = (
          <>
            <LinkIcon className="h-3 w-3" />
            <span>{link.label}</span>
            {link.external ? <ExternalLink className="h-3 w-3 text-gray-400" /> : null}
          </>
        )
        if (link.external) {
          return (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            >
              {inner}
            </a>
          )
        }
        return (
          <Link
            key={link.label}
            href={link.href}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 hover:text-gray-900"
          >
            {inner}
          </Link>
        )
      })}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-800 truncate">{value}</div>
    </div>
  )
}

function formatCurrencyClient(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${value}`
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Empty state — varies copy slightly with the active filter so partners
 * don't feel like the feature is broken when their filter is empty.
 * ─────────────────────────────────────────────────────────────────────── */

function EmptyState({ filter }: { filter: string }) {
  const meta =
    filter !== "all" && filter in SOURCE_META
      ? SOURCE_META[filter as TriageSourceType]
      : { label: "activity", icon: Inbox }
  const Icon = meta.icon
  return (
    <div className="text-center py-10 text-gray-500">
      <Icon className="h-10 w-10 mx-auto mb-3 text-gray-300" />
      <p className="text-sm">
        {filter === "all"
          ? "You're all caught up — no new activity to triage."
          : filter === "client_email"
            ? "No emails match here — try a different search or filter."
            : `No ${meta.label.toLowerCase()} in your feed right now.`}
      </p>
    </div>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
