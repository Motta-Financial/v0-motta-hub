"use client"

/**
 * Karbon-style per-task discussion thread.
 *
 * Comments here are scoped to a single work item and are separate from
 * the portal's main Messages thread, so task-specific questions stay
 * attached to the work they're about.
 *
 * Posts optimistically via SWR mutate so the client sees their comment
 * land immediately rather than waiting on the round-trip.
 */

import useSWR from "swr"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { MessageSquare, Send } from "lucide-react"
import { format, parseISO } from "date-fns"

const DEEP_GREEN = "#6B745D"

export interface TaskComment {
  id: string
  author_role: "client" | "team"
  author_name: string | null
  body: string
  created_at: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function initialsOf(name: string | null, role: string): string {
  if (!name) return role === "team" ? "MF" : "You"
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
}

export function TaskCommentThread({
  workItemId,
  previewComments,
}: {
  workItemId: string
  previewComments?: TaskComment[]
}) {
  const endpoint = `/api/client-portal/work-items/${workItemId}/comments`
  const { data, mutate, isLoading } = useSWR<{ comments: TaskComment[] }>(
    endpoint,
    fetcher,
  )

  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const comments = data?.comments ?? previewComments ?? []

  async function submit() {
    const body = draft.trim()
    if (!body || sending) return

    setSending(true)
    setError(null)

    // Optimistic entry — replaced by the server row on revalidate.
    const optimistic: TaskComment = {
      id: `optimistic-${Date.now()}`,
      author_role: "client",
      author_name: "You",
      body,
      created_at: new Date().toISOString(),
    }

    setDraft("")
    void mutate({ comments: [...comments, optimistic] }, { revalidate: false })

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? "Could not send your comment.")
      }
      await mutate()
    } catch (err: any) {
      setError(err?.message ?? "Could not send your comment.")
      setDraft(body) // hand the text back so nothing is lost
      void mutate()
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter sends. Guard against CJK IME composition so Enter
    // confirming a character never submits the form.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <Card className="shadow-sm border-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <MessageSquare className="h-4 w-4" style={{ color: DEEP_GREEN }} />
          Discussion
          {comments.length > 0 && (
            <span className="text-xs font-normal text-gray-400">
              ({comments.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && comments.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No comments yet. Ask your advisor a question about this task below.
          </p>
        ) : (
          <ul role="list" className="space-y-3">
            {comments.map((c) => {
              const isClient = c.author_role === "client"
              return (
                <li key={c.id} className="flex gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{
                      backgroundColor: isClient ? "#B45309" : DEEP_GREEN,
                    }}
                    aria-hidden="true"
                  >
                    {initialsOf(c.author_name, c.author_role)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-900">
                        {c.author_name ?? (isClient ? "You" : "Motta Financial")}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {format(parseISO(c.created_at), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <div
                      className="mt-1 rounded-xl px-3 py-2 text-sm leading-relaxed text-gray-700"
                      style={{
                        backgroundColor: isClient ? "#F5F3F0" : "#8E9B791A",
                      }}
                    >
                      <p className="whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Composer */}
        <div className="space-y-2 border-t border-gray-100 pt-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or add a note about this task..."
            rows={3}
            className="resize-none rounded-xl text-sm"
            aria-label="Add a comment to this task"
          />
          {error && (
            <p className="text-xs" style={{ color: "#B45309" }} role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-gray-400">
              Your advisor is notified when you post here.
            </p>
            <Button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || sending}
              className="gap-1.5 rounded-xl text-white"
              style={{ backgroundColor: DEEP_GREEN }}
            >
              <Send className="h-3.5 w-3.5" />
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
