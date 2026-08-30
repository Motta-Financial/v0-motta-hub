"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR, { mutate } from "swr"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { Send, MessageSquare, Search, X, ChevronUp, ChevronDown } from "lucide-react"
import { format, isToday, isYesterday, parseISO } from "date-fns"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalMessage {
  id: string
  sender_role: "client" | "team"
  sender_name: string | null
  body: string
  created_at: string
  read_at: string | null
}

interface SearchMatch {
  messageId: string
  start: number
  end: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── Page ──────────────────────────────────────────────────────────────────────

function formatMessageDate(dateStr: string): string {
  const d = parseISO(dateStr)
  if (isToday(d)) return format(d, "h:mm a")
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`
  return format(d, "MMM d, h:mm a")
}

// Finds every case-insensitive, non-overlapping occurrence of `query` across
// the thread, in top-to-bottom reading order.
function findMatches(messages: PortalMessage[], query: string): SearchMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const matches: SearchMatch[] = []
  for (const msg of messages) {
    const haystack = msg.body.toLowerCase()
    let from = 0
    while (from <= haystack.length) {
      const idx = haystack.indexOf(q, from)
      if (idx === -1) break
      matches.push({ messageId: msg.id, start: idx, end: idx + q.length })
      from = idx + q.length
    }
  }
  return matches
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { data, isLoading } = useSWR<{ messages: PortalMessage[] }>(
    "/api/client-portal/messages",
    fetcher,
    { refreshInterval: 15000 },
  )

  const messages = data?.messages ?? []

  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  // ── Search ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("")
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)

  const matches = useMemo(
    () => findMatches(messages, searchQuery),
    [messages, searchQuery],
  )
  const matchedMessageIds = useMemo(
    () => new Set(matches.map((m) => m.messageId)),
    [matches],
  )
  const isSearching = searchQuery.trim().length > 0

  function registerMessageRef(id: string, el: HTMLDivElement | null) {
    if (el) messageRefs.current.set(id, el)
    else messageRefs.current.delete(id)
  }

  function scrollToMatch(index: number) {
    const match = matches[index]
    if (!match) return
    messageRefs.current
      .get(match.messageId)
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  // Jump to the first match whenever the query changes
  useEffect(() => {
    setCurrentMatchIndex(0)
    if (matches.length > 0) scrollToMatch(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  function goToNextMatch() {
    if (matches.length === 0) return
    const next = (currentMatchIndex + 1) % matches.length
    setCurrentMatchIndex(next)
    scrollToMatch(next)
  }

  function goToPrevMatch() {
    if (matches.length === 0) return
    const prev = (currentMatchIndex - 1 + matches.length) % matches.length
    setCurrentMatchIndex(prev)
    scrollToMatch(prev)
  }

  function clearSearch() {
    setSearchQuery("")
    setCurrentMatchIndex(0)
  }

  async function handleSend() {
    const text = body.trim()
    if (!text) return

    setSending(true)
    try {
      const res = await fetch("/api/client-portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      })

      if (!res.ok) {
        toast.error("Could not send your message. Please try again.")
        return
      }

      setBody("")
      await mutate("/api/client-portal/messages")
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter submits; plain Enter inserts newline
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 9rem)" }}>
      {/* Page header */}
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Communicate directly with your Motta Financial team.
        </p>
      </div>

      {/* Message thread */}
      <div className="flex flex-col flex-1 min-h-0 rounded-xl border-0 shadow-sm overflow-hidden bg-white">
        {/* Thread header */}
        <div
          className="flex items-center justify-between gap-2.5 px-4 py-3 border-b shrink-0"
          style={{ borderColor: "#E5E7EB" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-xs font-bold"
              style={{ backgroundColor: "#6B745D" }}
            >
              MF
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">Motta Financial</p>
              <p className="text-xs text-gray-400 truncate">Your advisory team</p>
            </div>
          </div>

          <MessageSearchBox
            query={searchQuery}
            onQueryChange={setSearchQuery}
            matchCount={matches.length}
            currentIndex={currentMatchIndex}
            onNext={goToNextMatch}
            onPrev={goToPrevMatch}
            onClear={clearSearch}
          />
        </div>

        {/* Messages scroll area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}
                >
                  <Skeleton className={cn("h-14 rounded-xl", i % 2 === 0 ? "w-52" : "w-44")} />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full"
                style={{ backgroundColor: "#EFF6E8" }}
              >
                <MessageSquare className="h-6 w-6" style={{ color: "#6B745D" }} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Start the conversation
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Send a message and your advisor will respond shortly.
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isFirstInGroup={
                    idx === 0 || messages[idx - 1].sender_role !== msg.sender_role
                  }
                  isLastInGroup={
                    idx === messages.length - 1 ||
                    messages[idx + 1].sender_role !== msg.sender_role
                  }
                  registerRef={registerMessageRef}
                  matches={matches}
                  currentMatchIndex={currentMatchIndex}
                  isSearching={isSearching}
                  isMatch={matchedMessageIds.has(msg.id)}
                />
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Compose box */}
        <div
          className="shrink-0 border-t px-4 py-3"
          style={{ borderColor: "#E5E7EB" }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              className="min-h-[44px] max-h-[140px] resize-none rounded-lg text-sm"
              placeholder="Type a message… (Cmd+Enter to send)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={1}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={sending || !body.trim()}
              className="shrink-0 h-10 w-10 text-white"
              style={{ backgroundColor: "#6B745D" }}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            {"Cmd+Enter to send \u00b7 Your team typically replies within 1 business day"}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isFirstInGroup,
  isLastInGroup,
  registerRef,
  matches,
  currentMatchIndex,
  isSearching,
  isMatch,
}: {
  msg: PortalMessage
  isFirstInGroup: boolean
  isLastInGroup: boolean
  registerRef: (id: string, el: HTMLDivElement | null) => void
  matches: SearchMatch[]
  currentMatchIndex: number
  isSearching: boolean
  isMatch: boolean
}) {
  const isClient = msg.sender_role === "client"
  const isUnread = !isClient && !msg.read_at

  return (
    <div
      ref={(el) => registerRef(msg.id, el)}
      className={cn(
        "flex flex-col transition-opacity duration-200",
        isClient ? "items-end" : "items-start",
        isSearching && !isMatch && "opacity-30",
      )}
    >
      {/* Sender name — only shown on first bubble in a group */}
      {isFirstInGroup && (
        <p className="text-[11px] font-medium text-gray-400 mb-1 px-1">
          {isClient ? "You" : msg.sender_name ?? "Motta Financial"}
        </p>
      )}

      <div
        className={cn(
          "relative max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isClient
            ? "text-white rounded-br-sm"
            : "bg-gray-100 text-gray-800 rounded-bl-sm",
          isUnread && "ring-1 ring-[#8E9B79]/50",
          isMatch && isSearching && "ring-2 ring-[#8E9B79]/70",
        )}
        style={isClient ? { backgroundColor: "#6B745D" } : {}}
      >
        <p className="whitespace-pre-wrap">
          {highlightText(msg.body, msg.id, matches, currentMatchIndex)}
        </p>
      </div>

      {/* Timestamp — only shown on last bubble in a group */}
      {isLastInGroup && (
        <p className="text-[10px] text-gray-400 mt-1 px-1">
          {formatMessageDate(msg.created_at)}
          {isClient && msg.read_at && (
            <span className="ml-2 text-[10px]" style={{ color: "#6B745D" }}>
              Seen
            </span>
          )}
        </p>
      )}
    </div>
  )
}

// ── Match highlighting ────────────────────────────────────────────────────────

function highlightText(
  text: string,
  messageId: string,
  matches: SearchMatch[],
  currentMatchIndex: number,
) {
  const ownMatches = matches
    .map((m, globalIndex) => ({ ...m, globalIndex }))
    .filter((m) => m.messageId === messageId)

  if (ownMatches.length === 0) return text

  const parts: React.ReactNode[] = []
  let cursor = 0

  ownMatches.forEach((m, i) => {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start))
    const isCurrent = m.globalIndex === currentMatchIndex
    parts.push(
      <mark
        key={`${messageId}-${i}`}
        className="rounded-sm px-0.5"
        style={{
          backgroundColor: isCurrent ? "#8E9B79" : "#FEF3C7",
          color: isCurrent ? "#ffffff" : "#4A5240",
        }}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    )
    cursor = m.end
  })

  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

// ── Search box ────────────────────────────────────────────────────────────────

function MessageSearchBox({
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onNext,
  onPrev,
  onClear,
}: {
  query: string
  onQueryChange: (value: string) => void
  matchCount: number
  currentIndex: number
  onNext: () => void
  onPrev: () => void
  onClear: () => void
}) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const expanded = focused || query.length > 0

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault()
      onClear()
      inputRef.current?.blur()
    } else if (e.key === "Enter") {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      if (e.shiftKey) onPrev()
      else onNext()
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full transition-all duration-200",
        expanded
          ? "w-full max-w-[220px] cursor-text bg-[#EAE6E1] pl-2.5 pr-1.5 py-1"
          : "h-8 w-8 cursor-pointer justify-center hover:bg-[#EAE6E1]",
      )}
    >
      <Search
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: expanded ? "#6B745D" : "#9CA3AF" }}
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="Search messages"
        aria-label="Search messages"
        className={cn(
          "bg-transparent text-xs text-gray-700 placeholder:text-gray-400 outline-none transition-all duration-200",
          expanded ? "ml-1 w-full min-w-0" : "w-0",
        )}
      />

      {expanded && query.length > 0 && (
        <>
          <span className="shrink-0 whitespace-nowrap px-1 text-[11px] text-gray-500">
            {matchCount > 0 ? `${currentIndex + 1} of ${matchCount} messages` : "No matches"}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPrev()
            }}
            disabled={matchCount === 0}
            aria-label="Previous match"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onNext()
            }}
            disabled={matchCount === 0}
            aria-label="Next match"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            aria-label="Clear search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
