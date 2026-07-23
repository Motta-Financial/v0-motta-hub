"use client"

import { useEffect, useRef, useState } from "react"
import useSWR, { mutate } from "swr"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { Send, MessageSquare } from "lucide-react"
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

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatMessageDate(dateStr: string): string {
  const d = parseISO(dateStr)
  if (isToday(d)) return format(d, "h:mm a")
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`
  return format(d, "MMM d, h:mm a")
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { data, isLoading } = useSWR<{ messages: PortalMessage[] }>(
    "/api/client-portal/messages",
    fetcher,
    { refreshInterval: 15000 }, // poll every 15s for new messages
  )

  const messages = data?.messages ?? []

  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

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
          className="flex items-center gap-2.5 px-4 py-3 border-b shrink-0"
          style={{ borderColor: "#E5E7EB" }}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-white text-xs font-bold"
            style={{ backgroundColor: "#6B745D" }}
          >
            MF
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Motta Financial</p>
            <p className="text-xs text-gray-400">Your advisory team</p>
          </div>
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
            Cmd+Enter to send &nbsp;·&nbsp; Your team typically replies within 1 business day
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
}: {
  msg: PortalMessage
  isFirstInGroup: boolean
  isLastInGroup: boolean
}) {
  const isClient = msg.sender_role === "client"
  const isUnread = !isClient && !msg.read_at

  return (
    <div className={cn("flex flex-col", isClient ? "items-end" : "items-start")}>
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
          isUnread && "ring-1 ring-amber-300",
        )}
        style={isClient ? { backgroundColor: "#6B745D" } : {}}
      >
        <p className="whitespace-pre-wrap">{msg.body}</p>
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
