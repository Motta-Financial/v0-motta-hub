import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai"
import {
  CLAUDE_DEFAULT,
  isClaudeModel,
  type ClaudeModelId,
} from "@/lib/ai/models"

/**
 * Streaming chat endpoint for the Claude playground (/playground/claude).
 *
 * Goes through the Vercel AI Gateway — no Anthropic SDK, no
 * `ANTHROPIC_API_KEY` lookup, no provider import. The model string
 * (`anthropic/claude-sonnet-4.6`, etc.) is enough; the gateway
 * authenticates via Vercel OIDC at runtime.
 *
 * Body shape (sent by `useChat({ transport: DefaultChatTransport })`):
 *   {
 *     messages: UIMessage[],
 *     // attached by `sendMessage(_, { body: { model } })`:
 *     model?: ClaudeModelId
 *   }
 *
 * Anything we don't recognize falls back to `CLAUDE_DEFAULT` so an
 * outdated client can't 500 us with a stale model id.
 */
export const maxDuration = 60
export const dynamic = "force-dynamic"

interface ChatBody {
  messages: UIMessage[]
  model?: string
}

export async function POST(req: Request) {
  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    return new Response("messages[] is required", { status: 400 })
  }

  const model: ClaudeModelId = isClaudeModel(body.model)
    ? body.model
    : CLAUDE_DEFAULT

  // useChat sends UIMessage[] with `parts` -- must be converted (and
  // awaited, per AI SDK 6) before being passed to streamText.
  const result = streamText({
    model,
    system:
      "You are Claude, accessed through the Vercel AI Gateway from the Motta Hub Claude playground. " +
      "Answer concisely and accurately. When asked which model you are, name yourself by the exact " +
      "model id passed in (e.g. anthropic/claude-sonnet-4.6) so the user can verify the gateway " +
      "routed to the right place.",
    messages: await convertToModelMessages(messages),
    abortSignal: req.signal,
  })

  // SSE-encoded UIMessage stream — what `useChat` + DefaultChatTransport
  // expects to consume on the client.
  return result.toUIMessageStreamResponse()
}
