/**
 * ALFRED's fee-estimate pass for new intake submissions.
 *
 * Runs alongside enrichIntakeSubmission + researchProspectQuestions
 * inside `runIntakePostProcessing`. Output lives on
 * `jotform_intake_submissions.fee_estimate` (jsonb, see migration 164)
 * and is rendered into the firm-wide intake email under "Potential
 * client value".
 *
 * Strategy:
 *   1. Pull the firm's actual historical pricing as anchor data:
 *        - `services` (Ignition catalog with min/max/default prices)
 *        - `motta_recurring_revenue_by_client` (the firm's real ARR
 *          per client — best ground truth we have)
 *      We feed a compact summary of these into the prompt instead of
 *      letting the LLM hallucinate its own price book.
 *   2. Build a structured prospect profile from the intake row.
 *   3. Ask Claude Sonnet (via `getAIConfig("intake_fee_estimate")`) for
 *      a JSON object with low/high one-time fees, low/high annual
 *      recurring, line items, rationale, and a confidence band. The
 *      prompt explicitly tells it to express "I don't have enough info"
 *      via low confidence rather than guessing.
 *   4. Validate + persist. Any failure (model down, malformed JSON,
 *      etc.) returns null and the post-processing pipeline carries on
 *      without an estimate — the email just renders without that
 *      block. Same fail-soft pattern as enrich + research.
 *
 * IMPORTANT: this is a DRAFT for partner review, not a quoted fee.
 * The prompt explicitly instructs the model to avoid client-facing
 * language and the email surfaces a "draft — verify before quoting"
 * disclaimer.
 */
import { generateText } from "ai"
import type { SupabaseClient } from "@supabase/supabase-js"
import { CLAUDE_SONNET } from "@/lib/ai/models"
import { getAIConfig, logAIUsage } from "@/lib/ai/config"

const SUMMARY_TIMEOUT_MS = 14_000
const DEFAULT_MODEL = CLAUDE_SONNET

export interface FeeEstimate {
  /** One-time / setup fees in USD. */
  low: number
  high: number
  currency: "USD"
  /** Annual recurring (compliance + advisory + bookkeeping retainer). */
  annual_recurring?: { low: number; high: number } | null
  /** Partner-facing rationale, 2-4 sentences. */
  rationale: string
  /** Specific line items the model thinks apply. */
  line_items: Array<{
    label: string
    low: number
    high: number
    /** "one_time" | "annual" | "monthly" — controls UI grouping. */
    cadence: "one_time" | "annual" | "monthly"
  }>
  /** "low" when intake info is too thin to ground the estimate. */
  confidence: "low" | "medium" | "high"
  /** Things the model would want clarified to tighten the estimate. */
  open_questions: string[]
  generated_at: string
  model: string
}

export interface FeeEstimateInput {
  service_focus: string | null
  services_requested: string[] | null
  entity_types: string[] | null
  business_revenue_range: string | null
  business_tax_classification: string | null
  business_employee_count: string | null
  business_state: string | null
  business_summary: string | null
  questions_or_concerns: string | null
}

interface ServiceCatalogRow {
  name: string
  category: string | null
  price: number | null
  min_price: number | null
  max_price: number | null
  billing_mode: string | null
}

interface RevenueAnchor {
  service_types: string | null
  mrr: number | null
  arr: number | null
  one_time_total: number | null
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T | null> {
  return await Promise.race<T | null>([
    p,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.log(`[v0] fee-estimate: ${label} timed out after ${ms}ms`)
        resolve(null)
      }, ms),
    ),
  ])
}

/**
 * Pull the firm's price book from `services` + recurring-revenue from
 * `motta_recurring_revenue_by_client`. We summarize hard so the prompt
 * stays under a few KB.
 */
async function loadAnchors(supabase: SupabaseClient): Promise<{
  catalog: ServiceCatalogRow[]
  revenue_summary: string
}> {
  const [catalogRes, revenueRes] = await Promise.allSettled([
    supabase
      .from("services")
      .select("name, category, price, min_price, max_price, billing_mode")
      .limit(60),
    supabase
      .from("motta_recurring_revenue_by_client")
      .select("service_types, mrr, arr, one_time_total")
      .order("arr", { ascending: false })
      .limit(40),
  ])

  const catalog =
    catalogRes.status === "fulfilled"
      ? ((catalogRes.value.data as ServiceCatalogRow[] | null) ?? [])
      : []

  // Bucket the firm's real revenue rows by service-type label so we
  // can quote bands like "Tax Preparation: median ~$2,400, p25-p75
  // $1,500-$3,800". This is the single most valuable signal we can
  // give the model.
  const buckets = new Map<string, number[]>()
  if (revenueRes.status === "fulfilled") {
    for (const row of (revenueRes.value.data as RevenueAnchor[] | null) ?? []) {
      const key = (row.service_types ?? "").trim()
      if (!key) continue
      const arr = row.arr ?? 0
      if (arr > 0) {
        const list = buckets.get(key) ?? []
        list.push(arr)
        buckets.set(key, list)
      }
    }
  }

  const summarize = (nums: number[]): string => {
    if (nums.length === 0) return "n/a"
    const sorted = [...nums].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const p25 = sorted[Math.floor(sorted.length * 0.25)]
    const p75 = sorted[Math.floor(sorted.length * 0.75)]
    return `n=${sorted.length}, median ~$${Math.round(median).toLocaleString()}, p25-p75 $${Math.round(p25).toLocaleString()}–$${Math.round(p75).toLocaleString()}`
  }

  const lines: string[] = []
  for (const [k, v] of buckets.entries()) {
    lines.push(`  ${k}: ${summarize(v)}`)
  }

  return {
    catalog,
    revenue_summary: lines.length > 0 ? lines.join("\n") : "(no historical anchors available)",
  }
}

function shapeCatalogForPrompt(rows: ServiceCatalogRow[]): string {
  if (rows.length === 0) return "(catalog unavailable)"
  return rows
    .map((r) => {
      const range =
        r.min_price != null && r.max_price != null
          ? `$${r.min_price}–$${r.max_price}`
          : r.price != null
            ? `~$${r.price}`
            : "tbd"
      return `  ${r.name} (${r.category ?? "?"}, ${r.billing_mode ?? "?"}): ${range}`
    })
    .join("\n")
}

/** Drop-in JSON parser that tolerates Claude's occasional preamble
 *  or trailing prose. We extract the first balanced `{ … }` block. */
function safeParseJson<T = unknown>(raw: string): T | null {
  const trimmed = raw.trim()
  // Direct attempt
  try {
    return JSON.parse(trimmed) as T
  } catch {
    /* fall through to extraction */
  }
  // Find first '{' and last '}' — sufficient for object outputs.
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

export async function estimateIntakeFees(
  supabase: SupabaseClient,
  input: FeeEstimateInput,
): Promise<FeeEstimate | null> {
  // No signal at all → don't waste an API call.
  const hasAnyServiceSignal =
    !!input.service_focus ||
    (input.services_requested && input.services_requested.length > 0) ||
    !!input.business_summary ||
    !!input.questions_or_concerns
  if (!hasAnyServiceSignal) return null

  const { catalog, revenue_summary } = await loadAnchors(supabase)

  const promptLines = [
    "You are ALFRED Ai, drafting an INTERNAL fee estimate for a Motta Financial partner reviewing a new prospect intake. This is a draft for partner review, NOT a client quote.",
    "",
    "Output rules:",
    "- Respond with a SINGLE JSON object — no prose before or after, no markdown fences.",
    "- All amounts in whole USD. No cents. No currency symbols inside numbers.",
    "- If the intake doesn't give enough information to ground an estimate, set confidence='low' and widen the bands rather than guessing precisely.",
    "- Use the firm's historical price ranges below as anchors. Do NOT invent line items the firm doesn't actually offer.",
    "- Stay neutral and operational — partners see this. No marketing language, no emojis, no client-facing pitch copy.",
    "",
    "Required JSON shape:",
    `{
  "low": <integer USD, one-time/setup fees only>,
  "high": <integer USD>,
  "currency": "USD",
  "annual_recurring": { "low": <integer>, "high": <integer> } OR null,
  "rationale": "<2-4 sentence partner-facing rationale>",
  "line_items": [
    { "label": "<service line>", "low": <integer>, "high": <integer>, "cadence": "one_time" | "annual" | "monthly" }
  ],
  "confidence": "low" | "medium" | "high",
  "open_questions": ["<question to ask on the discovery call to tighten the estimate>"]
}`,
    "",
    "Firm price catalog (Ignition):",
    shapeCatalogForPrompt(catalog),
    "",
    "Historical actual recurring revenue per service line (real Motta clients):",
    revenue_summary,
    "",
    "Prospect intake:",
    `- Service focus: ${input.service_focus ?? "(not provided)"}`,
    `- Services requested: ${input.services_requested?.join(", ") ?? "(not provided)"}`,
    `- Entity types: ${input.entity_types?.join(", ") ?? "(not provided)"}`,
    `- Tax classification: ${input.business_tax_classification ?? "(not provided)"}`,
    `- Annual revenue: ${input.business_revenue_range ?? "(not provided)"}`,
    `- Employees: ${input.business_employee_count ?? "(not provided)"}`,
    `- State: ${input.business_state ?? "(not provided)"}`,
    `- Their words: ${input.questions_or_concerns ?? input.business_summary ?? "(not provided)"}`,
  ].join("\n")

  let modelUsed: string = DEFAULT_MODEL
  let raw = ""
  try {
    const aiConfig = await getAIConfig("intake_fee_estimate")
    modelUsed = aiConfig.model || DEFAULT_MODEL
    const startTime = Date.now()

    const ai = await withTimeout(
      generateText({
        model: modelUsed,
        prompt: aiConfig.systemPrompt
          ? `${aiConfig.systemPrompt}\n\n${promptLines}`
          : promptLines,
      }),
      SUMMARY_TIMEOUT_MS,
      "generateText",
    )
    raw = ai?.text?.trim() ?? ""
    if (raw) {
      logAIUsage({
        useCase: "intake_fee_estimate",
        model: modelUsed,
        promptTokens: ai?.usage?.inputTokens,
        completionTokens: ai?.usage?.outputTokens,
        totalTokens: ai?.usage?.totalTokens,
        latencyMs: Date.now() - startTime,
        success: true,
      })
    }
  } catch (err) {
    console.log("[v0] fee-estimate: generateText error:", (err as Error).message)
    logAIUsage({
      useCase: "intake_fee_estimate",
      model: modelUsed,
      success: false,
      errorMessage: (err as Error).message,
    })
  }

  if (!raw) return null

  const parsed = safeParseJson<{
    low: unknown
    high: unknown
    currency: unknown
    annual_recurring?: { low: unknown; high: unknown } | null
    rationale: unknown
    line_items?: Array<{
      label: unknown
      low: unknown
      high: unknown
      cadence: unknown
    }>
    confidence: unknown
    open_questions?: unknown[]
  }>(raw)
  if (!parsed) {
    console.log("[v0] fee-estimate: JSON parse failed — first 200 chars:", raw.slice(0, 200))
    return null
  }

  // ── Coerce + validate ─────────────────────────────────────────────
  // Models occasionally return strings ("$1,500") or floats. Squash to
  // integers; throw out anything that doesn't make sense.
  const toInt = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v)
    if (typeof v === "string") {
      const cleaned = v.replace(/[^\d.-]/g, "")
      const n = Number.parseFloat(cleaned)
      return Number.isFinite(n) ? Math.round(n) : 0
    }
    return 0
  }

  const low = toInt(parsed.low)
  const high = toInt(parsed.high)
  if (high < low || high <= 0) {
    console.log("[v0] fee-estimate: invalid range low/high:", low, high)
    return null
  }

  const annualRecurring =
    parsed.annual_recurring &&
    typeof parsed.annual_recurring === "object" &&
    parsed.annual_recurring !== null
      ? {
          low: toInt(parsed.annual_recurring.low),
          high: toInt(parsed.annual_recurring.high),
        }
      : null

  const cadenceOf = (v: unknown): "one_time" | "annual" | "monthly" => {
    const s = (typeof v === "string" ? v : "").toLowerCase().replace(/[\s-]/g, "_")
    if (s === "annual" || s === "yearly") return "annual"
    if (s === "monthly") return "monthly"
    return "one_time"
  }

  const lineItems: FeeEstimate["line_items"] = []
  for (const item of parsed.line_items ?? []) {
    const lo = toInt(item.low)
    const hi = toInt(item.high)
    const label = typeof item.label === "string" ? item.label.trim() : ""
    if (!label || hi < lo) continue
    lineItems.push({ label, low: lo, high: hi, cadence: cadenceOf(item.cadence) })
  }

  const confidence: FeeEstimate["confidence"] =
    parsed.confidence === "high" || parsed.confidence === "medium"
      ? parsed.confidence
      : "low"

  const openQuestions = (parsed.open_questions ?? [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, 6)

  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
      ? parsed.rationale.trim()
      : "Estimate generated from intake answers and historical Motta pricing anchors."

  return {
    low,
    high,
    currency: "USD",
    annual_recurring: annualRecurring,
    rationale,
    line_items: lineItems,
    confidence,
    open_questions: openQuestions,
    generated_at: new Date().toISOString(),
    model: modelUsed,
  }
}
