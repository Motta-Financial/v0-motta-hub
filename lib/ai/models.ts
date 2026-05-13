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
 * Hard-coding raw model IDs at every call site has two problems:
 *
 *   1. Models drift fast. Anthropic shipped Sonnet 4 → 4.5 → 4.6 and
 *      Opus 4 → 4.1 → 4.5 → 4.6 → 4.7 within months. Pinning the wrong
 *      one means we either silently sit on stale capabilities or have
 *      to grep-and-replace across the codebase every quarter.
 *   2. There's no central audit of which features use which model — a
 *      partner-visible feature might quietly be on a cheap haiku.
 *
 * This file is the single source of truth. Import `CLAUDE_MODELS` for
 * the menu of options, and reference the named exports (`CLAUDE_SONNET`,
 * `CLAUDE_OPUS`, `CLAUDE_HAIKU`) at call sites so a future model bump
 * is one edit here.
 */

/** Latest Anthropic models exposed through the Vercel AI Gateway.
 *  Verified live against https://ai-gateway.vercel.sh/v1/models. */
export const CLAUDE_OPUS = "anthropic/claude-opus-4.7" as const
export const CLAUDE_SONNET = "anthropic/claude-sonnet-4.6" as const
export const CLAUDE_HAIKU = "anthropic/claude-haiku-4.5" as const

/** Default Claude model for general-purpose chat / reasoning tasks.
 *  Sonnet 4.6 is the current "smart enough for most things, fast
 *  enough to stream conversationally" sweet spot. Bump this when a
 *  newer Sonnet ships. */
export const CLAUDE_DEFAULT = CLAUDE_SONNET

export type ClaudeModelId =
  | typeof CLAUDE_OPUS
  | typeof CLAUDE_SONNET
  | typeof CLAUDE_HAIKU

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
