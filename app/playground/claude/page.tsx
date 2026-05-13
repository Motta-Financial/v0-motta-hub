"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card } from "@/components/ui/card"
import { Loader2, Send, Sparkles } from "lucide-react"
import {
  CLAUDE_DEFAULT,
  CLAUDE_MODELS,
  type ClaudeModelId,
} from "@/lib/ai/models"

/**
 * Claude Playground — sanity check + live demo of AI Gateway → Claude.
 *
 * The transport posts to /api/playground/claude. The model id is sent
 * per-message (via the second arg of `sendMessage`) so switching the
 * picker takes effect on the very next turn without reloading the
 * conversation.
 */
export default function ClaudePlaygroundPage() {
  const [model, setModel] = useState<ClaudeModelId>(CLAUDE_DEFAULT)
  const [input, setInput] = useState("")

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/playground/claude",
    }),
  })

  const isStreaming = status === "submitted" || status === "streaming"

  const onSend = () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput("")
    // Per-call body so the picker change takes effect immediately.
    sendMessage({ text }, { body: { model } })
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI Gateway · Anthropic
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
              Claude Playground
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Streams responses from Claude through the Vercel AI Gateway —
              same plumbing ALFRED and the cron jobs use. Pick a model,
              send a prompt, and verify the response identifies the model
              you selected.
            </p>
          </div>
          <div className="w-56 shrink-0">
            <label
              htmlFor="claude-model"
              className="mb-1 block text-xs font-medium text-stone-600"
            >
              Model
            </label>
            <Select
              value={model}
              onValueChange={(v) => setModel(v as ClaudeModelId)}
              disabled={isStreaming}
            >
              <SelectTrigger id="claude-model" className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAUDE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{m.label}</span>
                      <span className="text-[11px] text-stone-500">
                        {m.bestFor}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 font-mono text-[10px] text-stone-400">
              {model}
            </p>
          </div>
        </header>

        <Card className="mb-4 overflow-hidden border-stone-200 bg-white">
          <div
            className="flex max-h-[60vh] min-h-[320px] flex-col gap-3 overflow-y-auto p-4"
            role="log"
            aria-live="polite"
            aria-label="Conversation"
          >
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            {isStreaming && (
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Claude is thinking…
              </div>
            )}
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <div className="font-medium">Request failed</div>
                <div className="mt-1 font-mono">{error.message}</div>
              </div>
            )}
          </div>
        </Card>

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Claude anything…"
            rows={3}
            className="resize-none bg-white"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSend()
              }
            }}
            disabled={isStreaming}
            aria-label="Prompt"
          />
          {isStreaming ? (
            <Button
              type="button"
              variant="outline"
              onClick={stop}
              className="h-[76px] shrink-0"
            >
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onSend}
              disabled={!input.trim()}
              className="h-[76px] shrink-0 bg-stone-900 text-stone-50 hover:bg-stone-800"
            >
              <Send className="mr-2 h-4 w-4" aria-hidden />
              Send
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-stone-400">
          Tip: Cmd/Ctrl + Enter to send.
        </p>
      </div>
    </main>
  )
}

function EmptyState() {
  const suggestions = [
    "Which model are you? Answer with the exact gateway id.",
    "Summarize the difference between Sonnet 4.6 and Opus 4.7 in one sentence.",
    "Write a tagline for Motta Financial in the voice of a friendly butler.",
  ]
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <Sparkles className="h-6 w-6 text-stone-400" aria-hidden />
      <p className="max-w-sm text-sm text-stone-500">
        Send a prompt to verify Claude is reachable through the AI Gateway.
        Suggestions:
      </p>
      <ul className="flex flex-col gap-1 text-xs text-stone-600">
        {suggestions.map((s) => (
          <li key={s} className="rounded bg-stone-100 px-2 py-1 font-mono">
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Render a single UIMessage. UIMessages don't have `.content` — text
 *  lives inside `parts[]`, so we filter for text parts and join them. */
function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user"
  const text =
    message.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? ""
  return (
    <div
      className={
        isUser
          ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-3 py-2 text-sm text-stone-50"
          : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900"
      }
    >
      <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">
        {isUser ? "You" : "Claude"}
      </div>
      <div className="whitespace-pre-wrap leading-relaxed">{text}</div>
    </div>
  )
}
