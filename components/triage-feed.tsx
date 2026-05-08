"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import useSWR from "swr"
import { formatDistanceToNow } from "date-fns"
import {
  Bell,
  Briefcase,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileText,
  ImageIcon,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Send,
  Smile,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUser, useDisplayName, useUserInitials } from "@/contexts/user-context"

const COMMON_EMOJIS = ["👍", "❤️", "😊", "🎉", "🔥", "👏", "💯", "✨"]

/* ─────────────────────────────────────────────────────────────────────────
 * Types — kept in sync with /api/triage/feed/route.ts
 * ─────────────────────────────────────────────────────────────────────── */

type TriageSourceType =
  | "team_message"
  | "debrief"
  | "calendly_meeting"
  | "daily_briefing"
  | "accepted_proposal"

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

/* ─────────────────────────────────────────────────────────────────────────
 * Visual config per source type. Centralised so tabs, badges, and cards
 * all read from the same map.
 * ─────────────────────────────────────────────────────────────────────── */

const SOURCE_META: Record<
  TriageSourceType,
  { label: string; icon: React.ComponentType<{ className?: string }>; accent: string }
> = {
  team_message: { label: "Messages", icon: MessageSquare, accent: "text-blue-600" },
  debrief: { label: "Debriefs", icon: FileText, accent: "text-emerald-600" },
  calendly_meeting: { label: "Meetings", icon: Calendar, accent: "text-purple-600" },
  daily_briefing: { label: "Briefings", icon: Sparkles, accent: "text-amber-600" },
  accepted_proposal: { label: "Proposals", icon: CheckCircle2, accent: "text-rose-600" },
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "team_message", label: "Messages" },
  { value: "debrief", label: "Debriefs" },
  { value: "calendly_meeting", label: "Meetings" },
  { value: "daily_briefing", label: "Briefings" },
  { value: "accepted_proposal", label: "Proposals" },
] as const

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
              const count = f.value === "all" ? items.length : countsBySource[f.value] || 0
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
        {isLoading ? (
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

  return (
    <li className="group relative rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-300 hover:shadow-sm transition-all">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-50 ${meta.accent}`}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
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
          onClick={() => onDismiss(item)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
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
    case "debrief":
      return <DebriefBody item={item} />
    case "calendly_meeting":
      return <CalendlyBody item={item} />
    case "daily_briefing":
      return <BriefingBody item={item} />
    case "accepted_proposal":
      return <ProposalBody item={item} />
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
