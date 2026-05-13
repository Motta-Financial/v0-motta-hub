/**
 * Canonical AI Gateway model registry for Motta Hub.
 *
 * The AI SDK uses the Vercel AI Gateway by default — we just pass a
 * model string like `"anthropic/claude-sonnet-4.6"` to `streamText` /
 * `generateText`. No provider SDK or API key is needed; on Vercel the
 * `VERCEL_OIDC_TOKEN` injected at runtime authenticates the request,
 * and locally `pnpm vercel env pull` populates the same token (or you
 * can fall back to a personal `AI_GATEWAY_API_KEY`).
 *
 * ── Why this file exists ─────────────────────────────────────────────
 *
 * Hard-coding raw model IDs at every call site has two problems:
 *
 *   1. Models drift fast. Anthropic shipped Sonnet 4 → 4.5 → 4.6 and
 *      Opus 4 → 4.1 → 4.5 → 4.6 → 4.7 within months; OpenAI is on
 *      gpt-5.5 already. Pinning the wrong one means we either silently
 *      sit on stale capabilities or have to grep-and-replace across
 *      the codebase every quarter.
 *   2. There's no central audit of which features use which model — a
 *      partner-visible feature might quietly be on a cheap haiku.
 *
 * ── How to use ───────────────────────────────────────────────────────
 *
 * - Reference a NAMED ROLE (`ALFRED_CHAT_MODEL`, `EMAIL_PROSE_MODEL`,
 *   `RESEARCH_SUMMARY_MODEL`) when you want the project's "current
 *   choice" for that workload. Bumping the role rebinds every call
 *   site at once.
 * - Reference a SPECIFIC MODEL (`CLAUDE_SONNET`, `OPENAI_GPT_5`) when
 *   you have a hard requirement on that exact model and don't want a
 *   role bump to silently move you.
 * - For the playground / model pickers, use `CLAUDE_MODELS`.
 *
 * If you find yourself adding a raw `"openai/..."` or `"anthropic/..."`
 * string anywhere else in the repo, add it here first and import the
 * symbol instead. That's the entire point of this file.
 */

// ─── Anthropic ───────────────────────────────────────────────────────
// Verified live against https://ai-gateway.vercel.sh/v1/models.

export const CLAUDE_OPUS = "anthropic/claude-opus-4.7" as const
export const CLAUDE_SONNET = "anthropic/claude-sonnet-4.6" as const
export const CLAUDE_HAIKU = "anthropic/claude-haiku-4.5" as const

/** Default Claude model for general-purpose chat / reasoning tasks.
 *  Sonnet 4.6 is the current "smart enough for most things, fast
 *  enough to stream conversationally" sweet spot. */
export const CLAUDE_DEFAULT = CLAUDE_SONNET

export type ClaudeModelId =
  | typeof CLAUDE_OPUS
  | typeof CLAUDE_SONNET
  | typeof CLAUDE_HAIKU

// ─── OpenAI ──────────────────────────────────────────────────────────
// Models actually referenced from this codebase. Add more here before
// using them at a call site rather than splicing strings inline.

export const OPENAI_GPT_4O = "openai/gpt-4o" as const
export const OPENAI_GPT_5 = "openai/gpt-5" as const
export const OPENAI_GPT_5_MINI = "openai/gpt-5-mini" as const

// ─── Role-based aliases ──────────────────────────────────────────────
// These bind a workload to a specific model. To migrate a workload to
// a different model (e.g. flip ALFRED to Claude Sonnet) change the
// constant on the right-hand side here — every call site picks it up.

/** ALFRED conversational chat with tool-use. Long context window + many
 *  parallel tool calls per turn, so we stay on a top-tier reasoning
 *  model. Keep on OpenAI for now — switching providers mid-stream is a
 *  separate decision from the registry refactor. */
export const ALFRED_CHAT_MODEL = OPENAI_GPT_4O

/** Short, formulaic British-butler prose for transactional emails
 *  (daily briefing intro, weekly Tommy recap). Capped at a few hundred
 *  tokens; doesn't need flagship reasoning. */
export const EMAIL_PROSE_MODEL = OPENAI_GPT_4O

/** Jotform intake research summaries — both the "what does this
 *  company do" enrichment and the "answer the prospect's question"
 *  research pass. We deliberately use a small/fast model with a short
 *  timeout so a slow LLM never blocks the intake email. */
export const RESEARCH_SUMMARY_MODEL = OPENAI_GPT_5_MINI

// ─── UI surfaces ─────────────────────────────────────────────────────

export interface ClaudeModelOption {
  id: ClaudeModelId
  /** Friendly name surfaced in pickers. */
  label: string
  /** Short tagline for UI tooltips / option descriptions. */
  description: string
  /** Recommended best-fit task. */
  bestFor: string
}

/** Ordered list for UI pickers. Order matters — first entry is the
 *  default selection in the playground. */
export const CLAUDE_MODELS: ClaudeModelOption[] = [
  {
    id: CLAUDE_SONNET,
    label: "Claude Sonnet 4.6",
    description: "Balanced reasoning + speed. The general default.",
    bestFor: "Chat, drafting, most agentic workflows",
  },
  {
    id: CLAUDE_OPUS,
    label: "Claude Opus 4.7",
    description: "Anthropic's flagship — deepest reasoning, slowest, priciest.",
    bestFor: "Complex analysis, long-context synthesis, hard tool-use",
  },
  {
    id: CLAUDE_HAIKU,
    label: "Claude Haiku 4.5",
    description: "Fastest + cheapest. Drops some reasoning depth.",
    bestFor: "High-volume classification, quick summarization, ALFRED tool-calls",
  },
]

/** Runtime guard for incoming request bodies. */
export function isClaudeModel(id: unknown): id is ClaudeModelId {
  return (
    typeof id === "string" &&
    CLAUDE_MODELS.some((m) => m.id === id)
  )
}
