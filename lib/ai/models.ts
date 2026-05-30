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
/** OpenAI's current flagship reasoning model (May 2026). Deeper
 *  reasoning + better instruction-following than gpt-5 / gpt-5.1, at
 *  the cost of slower inference. Use for high-stakes one-shot
 *  authoring tasks (image-prompt drafting, complex code synthesis). */
export const OPENAI_GPT_5_5_PRO = "openai/gpt-5.5-pro" as const
/** Faster gpt-5.5 tier — drops some reasoning depth but ~3x faster.
 *  Good default when latency matters more than ceiling quality. */
export const OPENAI_GPT_5_5 = "openai/gpt-5.5" as const

// ─── OpenAI image models ─────────────────────────────────────────────
// Listed flagship → tier-down. Always reference the named role
// (`IMAGE_GENERATION_MODEL`) at call sites so a future bump rebinds
// every caller at once.

/** OpenAI's latest image model (May 2026). Higher photographic
 *  fidelity, better text-in-image rendering, and stronger style
 *  adherence than gpt-image-1.5 / gpt-image-1. Supports the same
 *  `quality: "low" | "medium" | "high"` provider option. */
export const OPENAI_GPT_IMAGE_2 = "openai/gpt-image-2" as const
export const OPENAI_GPT_IMAGE_1_5 = "openai/gpt-image-1.5" as const
export const OPENAI_GPT_IMAGE_1 = "openai/gpt-image-1" as const

// ─── Role-based aliases ──────────────────────────────────────────────
// These bind a workload to a specific model. To migrate a workload to
// a different model (e.g. flip ALFRED to Claude Sonnet) change the
// constant on the right-hand side here — every call site picks it up.
//
// The firm prefers Claude models across the board.

/** ALFRED conversational chat with tool-use. Long context window + many
 *  parallel tool calls per turn, so we use Sonnet — strong reasoning +
 *  excellent tool-use without the latency hit of Opus. */
export const ALFRED_CHAT_MODEL = CLAUDE_SONNET

/** Short, formulaic British-butler prose for transactional emails
 *  (daily briefing intro, weekly Tommy recap). Capped at a few hundred
 *  tokens; doesn't need flagship reasoning. Haiku is 10x cheaper and
 *  faster with no quality loss for this task. */
export const EMAIL_PROSE_MODEL = CLAUDE_HAIKU

/** Jotform intake lead enrichment — "what does this company do".
 *  Straightforward summarization with a tight timeout so the intake
 *  email isn't blocked. Haiku's fast inference fits the constraint. */
export const LEAD_ENRICHMENT_MODEL = CLAUDE_HAIKU

/** Jotform question research — drafts partner-ready responses to
 *  prospect tax/accounting questions. Client-facing copy that needs
 *  accurate technical reasoning, so we use Sonnet over Haiku. */
export const QUESTION_RESEARCH_MODEL = CLAUDE_SONNET

/** Meeting-transcript summarization — turns a raw Zoom transcript into
 *  a structured client-note summary (overview, key points, action
 *  items, follow-ups). Goes onto the client profile and is read by the
 *  team, so accuracy matters more than cost; transcripts are long so we
 *  want strong long-context comprehension. Sonnet is the fit. */
export const MEETING_SUMMARY_MODEL = CLAUDE_SONNET

// Legacy alias — kept for backward compatibility during migration.
// New code should use LEAD_ENRICHMENT_MODEL or QUESTION_RESEARCH_MODEL.
export const RESEARCH_SUMMARY_MODEL = LEAD_ENRICHMENT_MODEL

/** Drafter for image-generation prompts — used by the Tommy Awards
 *  podium image pipeline. We use OpenAI's flagship reasoning model
 *  (gpt-5.5-pro) because the prompt determines 80% of final image
 *  quality and it's a once-a-week one-shot, so the latency cost is
 *  irrelevant. */
export const IMAGE_PROMPT_MODEL = OPENAI_GPT_5_5_PRO

/** Image renderer — OpenAI's latest gpt-image generation. Pairs with
 *  `quality: "high"` for the best output the model exposes. */
export const IMAGE_GENERATION_MODEL = OPENAI_GPT_IMAGE_2

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
