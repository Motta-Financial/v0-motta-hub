"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import Image from "next/image"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  Send,
  X,
  Minimize2,
  Maximize2,
  Shrink,
  ExternalLink,
  Loader2,
  User,
  Search,
  Calendar,
  Users,
  FileText,
  DollarSign,
  Database,
  History,
  Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useUser } from "@/contexts/user-context"

// Shape returned by GET /api/alfred/conversations. Kept narrow on purpose --
// the recent-conversations rail only needs id/title/time. Detail fetches
// happen on click.
interface ConversationSummary {
  id: string
  title: string | null
  updated_at: string
}

// Persisted row shape from GET /api/alfred/conversations/[id]. `content` is
// the raw jsonb we wrote in the chat route's onFinish, which contains the
// original UIMessage.parts array verbatim.
interface PersistedMessage {
  id: string
  role: "user" | "assistant" | "tool" | "system"
  content: { parts?: any[] } | null
  created_at: string
}

// Relative-time formatter for the recent list. Avoids pulling in date-fns
// just for this. Falls back to a locale date for anything older than a week.
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

interface AlfredChatProps {
  isOpen: boolean
  onClose: () => void
  onMinimize?: () => void
  isMinimized?: boolean
  className?: string
  // When true the chat fills its container (used by the standalone
  // /alfred window route) rather than floating as a fixed bottom-right
  // card. In this mode the minimize / expand / pop-out controls are
  // hidden since they make no sense in a dedicated window.
  fullPage?: boolean
  // Widget-only: toggles the floating card between its default compact
  // footprint and a larger expanded size.
  isExpanded?: boolean
  onToggleExpand?: () => void
  // Widget-only: pops the conversation out into a standalone browser
  // window (the /alfred route).
  onOpenInNewWindow?: () => void
}

const suggestedQueries = [
  { icon: Users, text: "Show team workload", query: "What's the current workload for each team member?" },
  { icon: Calendar, text: "Upcoming deadlines", query: "What work items are due in the next 7 days?" },
  { icon: Search, text: "Find a client", query: "Search for client " },
  { icon: FileText, text: "Recent debriefs", query: "Show me recent client debriefs from this week" },
  { icon: DollarSign, text: "Financial summary", query: "What's our current financial summary?" },
  { icon: Database, text: "Work items by status", query: "Summarize work items by status" },
]

// Brand palette — the olive from the ALFRED sphere, kept on a neutral
// Hub-consistent base (zinc/slate) so the chat no longer looks like a
// separate orange product wedged into the Hub. Defined once at the top
// of the file rather than inlined so a future palette tweak (e.g. dark
// mode) is a single-place change.
const OLIVE = {
  ring: "#C4CB8B",       // light olive — borders, idle ring
  mid: "#9CA757",        // mid olive   — small accents
  deep: "#7E8845",       // deep olive  — links, primary text accents
  wash: "#F5F6E8",       // pale wash   — hover/tint backgrounds
}

export function AlfredChat({
  isOpen,
  onClose,
  onMinimize,
  isMinimized,
  className,
  fullPage = false,
  isExpanded = false,
  onToggleExpand,
  onOpenInNewWindow,
}: AlfredChatProps) {
  const [inputValue, setInputValue] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Identify the requesting user so ALFRED can answer "my work items" /
  // "my deadlines" questions. The DefaultChatTransport `body` factory is
  // invoked on every turn, so if the team member loads after first paint
  // the next message will still include their identity.
  const { teamMember, user } = useUser()

  // ── Conversation state ─────────────────────────────────────────────
  // `conversationId` is null on a fresh thread; the server creates a row
  // and returns the id via a `data-conversation` stream part the very
  // first time the user sends a message. We keep a ref alongside the
  // state so the transport body factory always reads the latest value
  // (factories run synchronously on send and a stale closure would lose
  // the id on the second message of a brand-new thread).
  const [conversationId, setConversationId] = useState<string | null>(null)
  const conversationIdRef = useRef<string | null>(null)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const [recentConversations, setRecentConversations] = useState<ConversationSummary[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [hydrating, setHydrating] = useState(false)

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/alfred/chat",
      body: () => ({
        currentUser: teamMember
          ? {
              teamMemberId: teamMember.id,
              fullName: teamMember.full_name,
              email: teamMember.email,
              role: teamMember.title ?? teamMember.role ?? null,
              department: teamMember.department ?? null,
              karbonUserKey: teamMember.karbon_user_key ?? null,
            }
          : null,
        conversationId: conversationIdRef.current,
        audience: "staff" as const,
      }),
    }),
    // Custom data parts come back here. The server emits exactly one
    // `data-conversation` part per turn on a fresh thread, so we just
    // capture the id and store it. AI SDK 6 strips the `data-` prefix
    // for type matching against the union it builds, but the runtime
    // value is the literal "data-conversation" string.
    onData: (part) => {
      if (part?.type === "data-conversation") {
        const id = (part as any)?.data?.id
        if (typeof id === "string" && id !== conversationIdRef.current) {
          setConversationId(id)
        }
      }
    },
  })

  // Refresh the "Recent conversations" list. We refetch on mount, after
  // each successful send (so a brand-new thread shows up the instant the
  // server finishes persisting it), and when a user opens the widget.
  const refreshRecent = useCallback(async () => {
    setRecentLoading(true)
    try {
      const res = await fetch("/api/alfred/conversations")
      if (!res.ok) return
      const j = (await res.json()) as { conversations?: ConversationSummary[] }
      setRecentConversations(j.conversations ?? [])
    } catch {
      // Non-fatal: the rail just stays empty.
    } finally {
      setRecentLoading(false)
    }
  }, [])

  // Initial fetch when the widget opens. We gate on isOpen so we don't
  // hammer the API for closed widgets on every page.
  useEffect(() => {
    if (isOpen && !isMinimized) refreshRecent()
  }, [isOpen, isMinimized, refreshRecent])

  // Refresh after a turn completes so newly-created threads (and bumped
  // updated_at on existing ones) appear at the top.
  const prevStatusRef = useRef<typeof status | null>(null)
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      refreshRecent()
    }
    prevStatusRef.current = status
  }, [status, refreshRecent])

  // Hydrate the message list from a persisted conversation. Used by the
  // recent-conversations rail. We rebuild UIMessage[] from the stored
  // `content.parts` jsonb, which mirrors what was streamed originally.
  const loadConversation = useCallback(
    async (id: string) => {
      setHydrating(true)
      try {
        const res = await fetch(`/api/alfred/conversations/${id}`)
        if (!res.ok) return
        const j = (await res.json()) as { messages?: PersistedMessage[] }
        const hydrated: UIMessage[] = (j.messages ?? []).map((row) => ({
          id: row.id,
          role: row.role as UIMessage["role"],
          parts: (row.content?.parts ?? []) as any,
        }))
        setMessages(hydrated)
        setConversationId(id)
        conversationIdRef.current = id
      } finally {
        setHydrating(false)
      }
    },
    [setMessages],
  )

  // "New chat" — wipe local state. The server will create a fresh
  // conversation row on the next sendMessage and stream the new id back.
  const startNewChat = useCallback(() => {
    setMessages([])
    setConversationId(null)
    conversationIdRef.current = null
    setInputValue("")
    inputRef.current?.focus()
  }, [setMessages])

  const isLoading = status === "streaming" || status === "submitted"

  // The last assistant message may already have text streaming in — in
  // that case the text itself IS the loading indicator, so we suppress
  // the "Consulting the archives…" placeholder to avoid double UI. We
  // only show the placeholder when the model has not produced any text
  // yet (typically during the silent tool-loop phase).
  const lastAssistantHasText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== "assistant") continue
      return (m.parts ?? []).some(
        (p: any) => p?.type === "text" && typeof p.text === "string" && p.text.trim().length > 0,
      )
    }
    return false
  }, [messages])

  const showThinking = isLoading && !lastAssistantHasText

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen, isMinimized])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isLoading) return

    sendMessage({ text: inputValue })
    setInputValue("")
  }

  const handleSuggestionClick = (query: string) => {
    if (query.endsWith(" ")) {
      // This is a partial query, put it in the input
      setInputValue(query)
      inputRef.current?.focus()
    } else {
      // This is a complete query, send it
      sendMessage({ text: query })
    }
  }

  if (!isOpen) return null

  if (isMinimized) {
    return (
      <div className={cn("fixed bottom-4 right-4 z-50", className)}>
        <Button
          onClick={onMinimize}
          aria-label="Restore ALFRED"
          // Mirrors the launcher styling so the FAB looks consistent
          // whether the chat has never been opened or is just minimized.
          // Olive-green ring + halo pulse keep the brand identity going
          // while the chat is tucked away.
          className="h-14 w-14 rounded-full bg-white hover:bg-[#F5F6E8] ring-1 ring-[#C4CB8B] shadow-lg p-0 overflow-hidden relative"
        >
          <span
            aria-hidden
            className="absolute inset-0 rounded-full animate-alfred-halo"
            style={{
              background:
                "radial-gradient(circle at 50% 45%, rgba(156,167,87,0.45) 0%, rgba(196,203,139,0) 65%)",
            }}
          />
          <Image
            src="/images/alfred-logo.png"
            alt=""
            width={48}
            height={48}
            className="object-contain relative z-10"
          />
        </Button>
        {messages.length > 0 && (
          <Badge
            className="absolute -top-1 -right-1 text-white text-xs"
            style={{ backgroundColor: OLIVE.deep }}
          >
            {messages.filter((m) => m.role === "assistant").length}
          </Badge>
        )}
      </div>
    )
  }

  // Sizing is mode-driven:
  //  • fullPage  → fill the standalone /alfred window
  //  • expanded  → roomy floating card (capped to the viewport)
  //  • default   → compact bottom-right launcher card
  const sizingClasses = fullPage
    ? "relative w-full h-full rounded-none border-0 shadow-none"
    : isExpanded
      ? "fixed bottom-4 right-4 z-50 w-[min(880px,calc(100vw-2rem))] h-[min(820px,calc(100vh-2rem))] shadow-2xl border-border/60"
      : "fixed bottom-4 right-4 z-50 w-[420px] h-[600px] shadow-2xl border-border/60"

  return (
    <Card
      className={cn(
        "flex flex-col transition-[width,height] duration-200 ease-out",
        sizingClasses,
        className,
      )}
    >
      {/* Header — switched from the amber/orange gradient to the Hub's
          dark slate primary token. The futuristic orb supplies all the
          colour and motion the header needs. */}
      <CardHeader className="flex flex-row items-center justify-between py-3 px-4 bg-foreground text-background rounded-t-lg">
        <div className="flex items-center gap-2.5">
          <AlfredOrb size={36} active={isLoading} />
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">ALFRED Ai</CardTitle>
            <p className="text-[11px] text-background/70">Motta Hub Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-background/80 hover:bg-white/10 hover:text-background"
            onClick={startNewChat}
            title="Start a new chat"
            aria-label="Start a new chat"
            disabled={messages.length === 0 && conversationId === null}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {/* Pop-out + expand controls only make sense for the floating
              widget, not the dedicated /alfred window. */}
          {!fullPage && onOpenInNewWindow && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-background/80 hover:bg-white/10 hover:text-background"
              onClick={onOpenInNewWindow}
              title="Open in new window"
              aria-label="Open ALFRED in a new window"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
          {!fullPage && onToggleExpand && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-background/80 hover:bg-white/10 hover:text-background"
              onClick={onToggleExpand}
              title={isExpanded ? "Collapse" : "Expand"}
              aria-label={isExpanded ? "Collapse chat" : "Expand chat"}
            >
              {isExpanded ? <Shrink className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          {!fullPage && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-background/80 hover:bg-white/10 hover:text-background"
              onClick={onMinimize}
              title="Minimize"
              aria-label="Minimize chat"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-background/80 hover:bg-white/10 hover:text-background"
            onClick={onClose}
            title={fullPage ? "Close window" : "Close"}
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="space-y-4">
              <div className="text-center py-6">
                {/* Empty state — large breathing orb. Same animation
                    vocabulary as the header orb just up-scaled, so the
                    user immediately reads them as the same brand. */}
                <div className="mx-auto mb-4 w-fit">
                  <AlfredOrb size={88} active glow />
                </div>
                <h3 className="font-semibold text-foreground">At your service.</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Ask me anything about Motta Hub — I&apos;ll see to it.
                </p>
              </div>

              {/* Recent conversations rail. Hidden when the user has no
                  history yet, or while we're still fetching the first
                  page, to keep the empty state clean for new users. */}
              {recentConversations.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <History className="h-3 w-3" />
                      Recent conversations
                    </p>
                    {recentLoading && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-1">
                    {recentConversations.slice(0, 10).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => loadConversation(c.id)}
                        disabled={hydrating}
                        className="w-full flex items-center justify-between gap-2 p-2 text-left text-sm rounded-lg border border-border hover:bg-[var(--alfred-wash)] hover:border-[var(--alfred-ring)] transition-colors disabled:opacity-50"
                        style={
                          {
                            "--alfred-wash": OLIVE.wash,
                            "--alfred-ring": OLIVE.ring,
                          } as React.CSSProperties
                        }
                      >
                        <span className="truncate text-foreground">
                          {c.title?.trim() || "Untitled conversation"}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatRelative(c.updated_at)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  May I suggest:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestedQueries.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestionClick(suggestion.query)}
                      className="flex items-center gap-2 p-2 text-left text-sm rounded-lg border border-border hover:bg-[var(--alfred-wash)] hover:border-[var(--alfred-ring)] transition-colors"
                      style={
                        {
                          "--alfred-wash": OLIVE.wash,
                          "--alfred-ring": OLIVE.ring,
                        } as React.CSSProperties
                      }
                    >
                      <suggestion.icon
                        className="h-4 w-4 flex-shrink-0"
                        style={{ color: OLIVE.deep }}
                      />
                      <span className="text-foreground truncate">{suggestion.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}

              {showThinking && <ThinkingRow />}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                  Error: {error.message || "Something went wrong"}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>

      {/* Input */}
      <div className="p-3 border-t bg-background">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask ALFRED anything…"
            disabled={isLoading}
            className="flex-1 focus-visible:ring-[var(--alfred-ring)]"
            style={{ ["--alfred-ring" as any]: OLIVE.ring }}
          />
          <Button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>
    </Card>
  )
}

/* ─────────────────────────────────────────────────────────────────
 * AlfredOrb
 *
 * Futuristic, layered presentation of the ALFRED brand mark. Three
 * stacked layers:
 *   1. A soft olive radial halo that breathes (alfred-halo keyframe)
 *   2. A conic-gradient ring that slowly rotates (alfred-orbit) —
 *      masked into a thin annulus so it reads as an orbital trace
 *      rather than a filled disc
 *   3. The static logo image on a white core
 *
 * `active` ramps up the halo opacity when the model is working.
 * `glow` adds an extra outer aureole for the hero/empty-state use.
 * ───────────────────────────────────────────────────────────── */
function AlfredOrb({
  size,
  active = false,
  glow = false,
}: {
  size: number
  active?: boolean
  glow?: boolean
}) {
  // The conic ring needs an annular mask. We build the mask inline so
  // the thickness scales sensibly with `size` (a 36px header orb wants
  // a thinner ring than the 88px hero orb).
  const annulusInner = Math.max(0.62, 0.78 - size / 600) // 0.62 at small, 0.78 at large
  const ringMask = `radial-gradient(circle, transparent ${annulusInner * 100}%, black ${(annulusInner + 0.04) * 100}%, black ${(annulusInner + 0.18) * 100}%, transparent ${(annulusInner + 0.22) * 100}%)`

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* Outer aureole — only on the big hero version, sits beyond the
          card bounds slightly and gives the orb extra presence. */}
      {glow && (
        <div
          className="absolute -inset-3 rounded-full animate-alfred-halo"
          style={{
            background:
              "radial-gradient(circle, rgba(156,167,87,0.30) 0%, rgba(196,203,139,0) 70%)",
          }}
        />
      )}
      {/* Breathing halo */}
      <div
        className="absolute inset-0 rounded-full animate-alfred-halo"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(156,167,87,0.55) 0%, rgba(196,203,139,0) 70%)",
          opacity: active ? 1 : 0.7,
        }}
      />
      {/* Rotating conic ring */}
      <div
        className="absolute inset-0 rounded-full animate-alfred-orbit"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, #C4CB8B 90deg, #7E8845 180deg, #C4CB8B 270deg, transparent 360deg)",
          maskImage: ringMask,
          WebkitMaskImage: ringMask,
          opacity: active ? 0.9 : 0.55,
        }}
      />
      {/* White core that hosts the logo */}
      <div
        className="absolute rounded-full bg-white flex items-center justify-center overflow-hidden"
        style={{
          inset: Math.max(2, Math.round(size * 0.1)),
          boxShadow: "inset 0 0 0 1px rgba(126,136,69,0.25)",
        }}
      >
        <Image
          src="/images/alfred-logo.png"
          alt=""
          width={size}
          height={size}
          className="object-contain"
          style={{
            width: `${Math.round(size * 0.72)}px`,
            height: `${Math.round(size * 0.72)}px`,
          }}
        />
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
 * MessageRow
 *
 * Renders a single chat turn. The two important behaviour changes
 * from the previous implementation:
 *   1. Tool-call parts (`tool-*`) are silently dropped. The model's
 *      privately gathered intelligence is none of the user's
 *      business; we only show the final composed reply.
 *   2. Assistant text is rendered through `react-markdown` with GFM
 *      so headings, lists, tables, and links all come through tidy
 *      instead of leaking raw `### Contact` literals into the bubble.
 * ───────────────────────────────────────────────────────────── */
function MessageRow({ message }: { message: UIMessage }) {
  // Concatenate every text part into a single Markdown source. We
  // strip tool parts entirely. If an assistant message has no text
  // yet (i.e. the model is still in its silent tool-loop) we render
  // nothing — the global ThinkingRow handles that state.
  const text = useMemo(() => {
    const parts = (message.parts ?? []) as Array<{ type: string; text?: string }>
    return parts
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("")
      .trim()
  }, [message.parts])

  if (!text) return null

  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && <AlfredOrb size={28} />}
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-foreground text-background"
            : "bg-muted text-foreground",
        )}
      >
        {isUser ? (
          // User input is plain text — never run user content through
          // a markdown renderer (XSS risk + the user didn't ask for
          // their input to be reformatted anyway).
          <div className="whitespace-pre-wrap">{text}</div>
        ) : (
          <AlfredMarkdown>{text}</AlfredMarkdown>
        )}
      </div>
      {isUser && (
        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
 * AlfredMarkdown
 *
 * Tight, opinionated markdown styling for ALFRED's replies. Goals:
 *   - Compact line-height — the bubble is narrow, breathing room
 *     would only make answers feel sprawling.
 *   - Bold labels render inline ("**Full Name:** Dat Le" stays on
 *     one line), which is the formatting our system prompt asks
 *     for. The default browser `<p>` margin would otherwise split
 *     each bullet across two visual lines.
 *   - Links open in a new tab and use the brand olive so they're
 *     clearly interactive without screaming.
 * ───────────────────────────────────────────────────────────── */
const markdownComponents: Components = {
  // Paragraphs get tight vertical rhythm. `last:mb-0` keeps the bubble
  // from having a stray bottom margin after the final paragraph.
  p: ({ children }) => (
    <p className="leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  h1: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground mt-2 first:mt-0 mb-1">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground mt-2 first:mt-0 mb-1">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground mt-2 first:mt-0 mb-1">
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  // Bold labels stay foreground-coloured so they pop against the
  // bubble's muted text. Italic stays default.
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 break-all"
      style={{ color: OLIVE.deep }}
    >
      {children}
    </a>
  ),
  // Inline vs block code — react-markdown v10 removed the `inline`
  // prop, so we use the GFM convention: fenced code blocks always
  // carry a `language-*` className (or at least *some* className from
  // the parent <pre>), while inline `code` spans never do. This is
  // the same detection the v10 docs recommend.
  code: ({ children, className }: any) => {
    const isBlock = typeof className === "string" && className.startsWith("language-")
    if (!isBlock) {
      return (
        <code className="font-mono text-[0.8em] bg-black/10 px-1 py-0.5 rounded">
          {children}
        </code>
      )
    }
    return (
      <code className={cn("font-mono text-[0.8em]", className)}>{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="bg-black/10 p-2 rounded my-2 overflow-x-auto text-[0.8em] leading-snug">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold bg-black/5">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
  hr: () => <hr className="my-2 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 pl-2 my-2 italic text-muted-foreground"
      style={{ borderColor: OLIVE.ring }}
    >
      {children}
    </blockquote>
  ),
}

function AlfredMarkdown({ children }: { children: string }) {
  return (
    <div className="alfred-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
 * ThinkingRow
 *
 * Replaces the old "Querying getClientInfo…" / "Thinking…" UI with
 * a butler-toned placeholder. Three sequenced dots provide motion
 * without spinning, paired with the small ALFRED orb so the user
 * understands which entity is doing the thinking.
 * ───────────────────────────────────────────────────────────── */
function ThinkingRow() {
  return (
    <div className="flex gap-3 justify-start">
      <AlfredOrb size={28} active />
      <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2 min-h-[34px]">
        <span className="flex items-center gap-1" aria-hidden>
          <span
            className="inline-block h-1.5 w-1.5 rounded-full animate-alfred-dot"
            style={{ backgroundColor: OLIVE.deep, animationDelay: "0s" }}
          />
          <span
            className="inline-block h-1.5 w-1.5 rounded-full animate-alfred-dot"
            style={{ backgroundColor: OLIVE.deep, animationDelay: "0.2s" }}
          />
          <span
            className="inline-block h-1.5 w-1.5 rounded-full animate-alfred-dot"
            style={{ backgroundColor: OLIVE.deep, animationDelay: "0.4s" }}
          />
        </span>
        <span className="text-xs text-muted-foreground italic">
          Consulting the archives…
        </span>
      </div>
    </div>
  )
}
