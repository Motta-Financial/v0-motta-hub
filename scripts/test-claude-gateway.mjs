/**
 * Smoke test for the AI Gateway → Claude wiring.
 *
 * Runs the exact snippet from the docs against the live gateway so we
 * can confirm the project's `ai` package, model id, and credentials all
 * line up before exposing it from a route handler.
 *
 * Usage:
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *        scripts/test-claude-gateway.mjs
 */
import { streamText } from "ai"

// Standalone node smoke test — can't import from `lib/ai/models.ts` at
// runtime without a build step, so the model id is duplicated here.
// Keep it in lockstep with `CLAUDE_OPUS` in `lib/ai/models.ts`.
const result = streamText({
  model: "anthropic/claude-opus-4.7",
  prompt: "Why is the sky blue?",
})

for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}

// Surface finish reason + token usage so we know the stream completed
// cleanly rather than just hung up mid-response.
const finishReason = await result.finishReason
const usage = await result.usage
process.stdout.write(
  `\n\n[done] finishReason=${finishReason} ` +
    `input=${usage.inputTokens} output=${usage.outputTokens} total=${usage.totalTokens}\n`,
)
