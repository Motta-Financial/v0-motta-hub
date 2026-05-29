/**
 * AI Configuration fetcher and usage logger.
 *
 * This module provides:
 * - `getAIConfig(useCase)` — fetches model + prompt overrides from the DB
 *   with a 1-minute memory cache so we don't hit Supabase on every AI call.
 * - `logAIUsage(...)` — fire-and-forget logger that writes to ai_usage_log
 *   for the admin stats dashboard.
 *
 * The default models from lib/ai/models.ts are used when no DB override
 * exists, so the system works even if the config tables are empty.
 */

import { createAdminClient } from "@/lib/supabase/server"
import {
  ALFRED_CHAT_MODEL,
  EMAIL_PROSE_MODEL,
  LEAD_ENRICHMENT_MODEL,
  QUESTION_RESEARCH_MODEL,
  CLAUDE_DEFAULT,
  OPENAI_GPT_4O,
  OPENAI_GPT_5,
  OPENAI_GPT_5_MINI,
  CLAUDE_OPUS,
  CLAUDE_SONNET,
  CLAUDE_HAIKU,
} from "@/lib/ai/models"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AIUseCase =
  | "alfred_chat"
  | "daily_briefing"
  | "tommy_recap"
  | "jotform_enrichment"
  | "question_research"
  | "intake_fee_estimate"
  | "meeting_research"
  | "claude_playground"

export interface AIConfig {
  useCase: AIUseCase
  displayName: string
  description: string | null
  sourceLocation: string | null
  /** Model to use — either from DB override or the hardcoded default. */
  model: string
  /** System prompt override from DB, or null to use hardcoded prompt. */
  systemPrompt: string | null
  /** Whether this use case is active. Inactive = skip AI call entirely. */
  isActive: boolean
  /** Whether the model came from DB override vs hardcoded default. */
  isModelOverridden: boolean
  /** Whether the prompt came from DB override vs hardcoded default. */
  isPromptOverridden: boolean
}

export interface AIUsageLogEntry {
  useCase: AIUseCase
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  latencyMs?: number
  success: boolean
  errorMessage?: string
  userId?: string
  userEmail?: string
  metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Default model mapping
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<AIUseCase, string> = {
  alfred_chat: ALFRED_CHAT_MODEL,           // Claude Sonnet — tool-use + reasoning
  daily_briefing: EMAIL_PROSE_MODEL,         // Claude Haiku — fast prose generation
  tommy_recap: EMAIL_PROSE_MODEL,            // Claude Haiku — fast prose generation
  jotform_enrichment: LEAD_ENRICHMENT_MODEL, // Claude Haiku — fast summarization
  question_research: QUESTION_RESEARCH_MODEL, // Claude Sonnet — accurate technical answers
  intake_fee_estimate: QUESTION_RESEARCH_MODEL, // Claude Sonnet — same reasoning tier as research
  meeting_research: QUESTION_RESEARCH_MODEL, // Claude Sonnet — partner-facing meeting brief
  claude_playground: CLAUDE_DEFAULT,         // Claude Sonnet — general playground
}

const DEFAULT_DISPLAY_NAMES: Record<AIUseCase, string> = {
  alfred_chat: "ALFRED Chat",
  daily_briefing: "Daily Briefing",
  tommy_recap: "Tommy Weekly Recap",
  jotform_enrichment: "Jotform Lead Enrichment",
  question_research: "Question Research",
  intake_fee_estimate: "Intake Fee Estimate",
  meeting_research: "Meeting Booking Research",
  claude_playground: "Claude Playground",
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache (1-minute TTL)
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  config: AIConfig
  expiresAt: number
}

const configCache = new Map<AIUseCase, CacheEntry>()
const CACHE_TTL_MS = 60_000 // 1 minute

function getCached(useCase: AIUseCase): AIConfig | null {
  const entry = configCache.get(useCase)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    configCache.delete(useCase)
    return null
  }
  return entry.config
}

function setCache(useCase: AIUseCase, config: AIConfig): void {
  configCache.set(useCase, {
    config,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

/** Clear the entire config cache. Called by the admin API after updates. */
export function clearConfigCache(): void {
  configCache.clear()
}

// ─────────────────────────────────────────────────────────────────────────────
// Config fetcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch AI configuration for a specific use case.
 *
 * Returns the model and prompt to use, either from the database override
 * or falling back to the hardcoded defaults in lib/ai/models.ts.
 *
 * Uses a 1-minute in-memory cache to avoid hitting Supabase on every call.
 */
export async function getAIConfig(useCase: AIUseCase): Promise<AIConfig> {
  // Check cache first
  const cached = getCached(useCase)
  if (cached) return cached

  // Build fallback config using hardcoded defaults
  const fallback: AIConfig = {
    useCase,
    displayName: DEFAULT_DISPLAY_NAMES[useCase] ?? useCase,
    description: null,
    sourceLocation: null,
    model: DEFAULT_MODELS[useCase] ?? OPENAI_GPT_4O,
    systemPrompt: null,
    isActive: true,
    isModelOverridden: false,
    isPromptOverridden: false,
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("ai_configurations")
      .select("*")
      .eq("use_case", useCase)
      .single()

    if (error || !data) {
      // No DB row — use hardcoded defaults
      setCache(useCase, fallback)
      return fallback
    }

    const config: AIConfig = {
      useCase,
      displayName: data.display_name ?? DEFAULT_DISPLAY_NAMES[useCase] ?? useCase,
      description: data.description,
      sourceLocation: data.source_location,
      // Use DB model if set, otherwise fall back to hardcoded default
      model: data.model ?? DEFAULT_MODELS[useCase] ?? OPENAI_GPT_4O,
      systemPrompt: data.system_prompt,
      isActive: data.is_active ?? true,
      isModelOverridden: !!data.model,
      isPromptOverridden: !!data.system_prompt,
    }

    setCache(useCase, config)
    return config
  } catch (err) {
    // DB error — use fallback so AI calls don't break
    console.warn(`[ai/config] Failed to fetch config for ${useCase}:`, err)
    setCache(useCase, fallback)
    return fallback
  }
}

/**
 * Fetch all AI configurations (for the admin UI matrix).
 */
export async function getAllAIConfigs(): Promise<AIConfig[]> {
  const allUseCases: AIUseCase[] = [
    "alfred_chat",
    "daily_briefing",
    "tommy_recap",
    "jotform_enrichment",
    "question_research",
    "intake_fee_estimate",
    "meeting_research",
    "claude_playground",
  ]

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("ai_configurations")
      .select("*")
      .order("display_name")

    if (error) {
      console.warn("[ai/config] Failed to fetch all configs:", error)
      // Return defaults for all use cases
      return allUseCases.map((uc) => ({
        useCase: uc,
        displayName: DEFAULT_DISPLAY_NAMES[uc] ?? uc,
        description: null,
        sourceLocation: null,
        model: DEFAULT_MODELS[uc] ?? OPENAI_GPT_4O,
        systemPrompt: null,
        isActive: true,
        isModelOverridden: false,
        isPromptOverridden: false,
      }))
    }

    return (data ?? []).map((row) => ({
      useCase: row.use_case as AIUseCase,
      displayName: row.display_name ?? row.use_case,
      description: row.description,
      sourceLocation: row.source_location,
      model: row.model ?? DEFAULT_MODELS[row.use_case as AIUseCase] ?? OPENAI_GPT_4O,
      systemPrompt: row.system_prompt,
      isActive: row.is_active ?? true,
      isModelOverridden: !!row.model,
      isPromptOverridden: !!row.system_prompt,
    }))
  } catch (err) {
    console.warn("[ai/config] Failed to fetch all configs:", err)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage logger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log an AI usage event to the ai_usage_log table.
 *
 * This is fire-and-forget — errors are logged but don't throw.
 * Call this after every AI request (success or failure) to populate
 * the usage stats dashboard.
 */
export async function logAIUsage(entry: AIUsageLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from("ai_usage_log").insert({
      use_case: entry.useCase,
      model: entry.model,
      prompt_tokens: entry.promptTokens ?? null,
      completion_tokens: entry.completionTokens ?? null,
      total_tokens: entry.totalTokens ?? null,
      latency_ms: entry.latencyMs ?? null,
      success: entry.success,
      error_message: entry.errorMessage ?? null,
      user_id: entry.userId ?? null,
      user_email: entry.userEmail ?? null,
      metadata: entry.metadata ?? {},
    })
  } catch (err) {
    // Fire-and-forget — log but don't throw
    console.warn("[ai/config] Failed to log usage:", err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model options for UI pickers
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelOption {
  id: string
  label: string
  provider: "OpenAI" | "Anthropic"
}

/** All available models for the admin UI model picker. */
export const ALL_MODELS: ModelOption[] = [
  // OpenAI
  { id: OPENAI_GPT_4O, label: "GPT-4o", provider: "OpenAI" },
  { id: OPENAI_GPT_5, label: "GPT-5", provider: "OpenAI" },
  { id: OPENAI_GPT_5_MINI, label: "GPT-5 Mini", provider: "OpenAI" },
  // Anthropic
  { id: CLAUDE_SONNET, label: "Claude Sonnet 4.6", provider: "Anthropic" },
  { id: CLAUDE_OPUS, label: "Claude Opus 4.7", provider: "Anthropic" },
  { id: CLAUDE_HAIKU, label: "Claude Haiku 4.5", provider: "Anthropic" },
]

/** Get the display label for a model ID. */
export function getModelLabel(modelId: string): string {
  const found = ALL_MODELS.find((m) => m.id === modelId)
  return found?.label ?? modelId
}
