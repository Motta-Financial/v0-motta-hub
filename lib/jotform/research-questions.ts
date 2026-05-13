/**
 * AI research pass for the prospect's "questions or concerns" answer
 * on the Jotform intake form.
 *
 * Why a separate module from `enrich.ts`:
 *   - The enrichment pass is about WHO the prospect is. This pass is
 *     about WHAT THEY ASKED. They're triggered independently — a
 *     prospect can ask great questions without giving a business name,
 *     and vice versa.
 *   - Output shape is meaningfully different: we want a partner-facing
 *     draft reply with optional references, not a one-paragraph brief.
 *   - Failure isolation: a flaky question-research call must not poison
 *     the company enrichment summary, and vice versa.
 *
 * The result is persisted to `jotform_intake_submissions.question_research`
 * and surfaced both in the firm-wide email and the triage sheet.
 *
 * IMPORTANT: this is a DRAFT for internal review, not a customer reply.
 * The system prompt explicitly tells the model to flag uncertainty and
 * cite sources so the partner can verify before forwarding.
 */
import { generateText } from "ai"
import { RESEARCH_SUMMARY_MODEL } from "@/lib/ai/models"

const RESEARCH_TIMEOUT_MS = 12_000
const SUMMARY_TIMEOUT_MS = 12_000
const SUMMARY_MODEL = RESEARCH_SUMMARY_MODEL
const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1beta/search"

interface ParallelResult {
  url: string
  title: string
  excerpts: string[]
}

export interface QuestionResearchBlob {
  /** The question text we researched, kept verbatim for the audit trail. */
  questions: string
  /** 2-4 sentence partner-facing draft answer. */
  summary: string
  /** Bullet points the partner can drop into a reply. May be empty. */
  key_points: string[]
  /** Citations the model leaned on, surfaced under the draft. */
  references: Array<{ url: string; title: string }>
  /** Static disclaimer always included so the partner remembers to verify. */
  disclaimer: string
  generated_at: string
  model: string
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return await Promise.race<T | null>([
    p,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.log(`[v0] research-questions: ${label} timed out after ${ms}ms`)
        resolve(null)
      }, ms),
    ),
  ])
}

async function searchForQuestion(question: string): Promise<ParallelResult[] | null> {
  const apiKey = process.env.PARALLELWEB_PARALLEL_API_KEY
  if (!apiKey) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(PARALLEL_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        // Frame the query so Parallel ranks IRS / state DOR / well-
        // sourced accounting trade publications above generic forums.
        objective:
          "Find authoritative tax, accounting, and small-business operations sources " +
          "(IRS, state DORs, AICPA, Journal of Accountancy, Bench, Bloomberg Tax) " +
          "that directly answer the prospect's question.",
        search_queries: [question.slice(0, 400)],
        processor: "base",
        max_results: 5,
        max_chars_per_result: 1500,
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: ParallelResult[] }
    return data.results ?? []
  } catch (err) {
    console.log("[v0] research-questions: Parallel error:", (err as Error).message)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export interface ResearchInput {
  questions_or_concerns: string | null
  /** Optional context to anchor the answer in the prospect's situation. */
  business_name?: string | null
  business_state?: string | null
  service_focus?: string | null
}

export async function researchProspectQuestions(
  input: ResearchInput,
): Promise<QuestionResearchBlob | null> {
  const question = input.questions_or_concerns?.trim()
  if (!question) return null

  const sources = (await withTimeout(searchForQuestion(question), RESEARCH_TIMEOUT_MS + 500, "search")) ?? []

  const promptLines = [
    "You are ALFRED Ai, helping a Motta Financial partner respond to a prospect's question from an intake form.",
    "",
    "Output rules:",
    "- Start with a single paragraph (2-4 sentences) drafting a clear, partner-voice reply.",
    "- Then add a short list (2-5 bullets) of the key technical points behind the answer.",
    "- If the sources don't actually answer the question, say so in the paragraph and offer what additional info you'd need.",
    "- Never invent a citation. Only reference sources you can see below.",
    "- Stay neutral and professional. No marketing language. No emojis.",
    "",
    "Prospect context:",
    `- Business: ${input.business_name ?? "(not provided)"}`,
    `- State: ${input.business_state ?? "(not provided)"}`,
    `- Service focus: ${input.service_focus ?? "(not provided)"}`,
    "",
    `Prospect's question (verbatim):\n"""${question}"""`,
    "",
    "Available web research:",
    sources.length === 0
      ? "(No relevant public results were found — answer cautiously based on common-sense tax / accounting knowledge and flag what you'd want to verify.)"
      : sources
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n${r.url}\n${(r.excerpts ?? []).join(" … ").slice(0, 1200)}`,
          )
          .join("\n\n"),
    "",
    "Format your response EXACTLY as:",
    "DRAFT REPLY:",
    "<paragraph>",
    "",
    "KEY POINTS:",
    "- <bullet>",
    "- <bullet>",
  ].join("\n")

  let raw = ""
  try {
    const ai = await withTimeout(
      generateText({ model: SUMMARY_MODEL, prompt: promptLines }),
      SUMMARY_TIMEOUT_MS,
      "generateText",
    )
    raw = ai?.text?.trim() ?? ""
  } catch (err) {
    console.log("[v0] research-questions: generateText error:", (err as Error).message)
  }

  if (!raw) {
    return {
      questions: question,
      summary:
        "ALFRED couldn't draft a research-backed answer before the deadline — please respond manually.",
      key_points: [],
      references: [],
      disclaimer:
        "Draft research generated by ALFRED Ai. Verify against authoritative sources before sending.",
      generated_at: new Date().toISOString(),
      model: "fallback",
    }
  }

  // Split the model output into "summary" paragraph + bullet list.
  // The prompt asks for a strict shape, but real LLM output is forgiving
  // — so we parse defensively and fall back to the whole text as the
  // summary if the structure differs.
  let summary = raw
  let keyPoints: string[] = []
  const draftMatch = raw.match(/DRAFT REPLY:\s*([\s\S]*?)(?:\n\s*KEY POINTS:|$)/i)
  if (draftMatch?.[1]) {
    summary = draftMatch[1].trim()
  }
  const pointsMatch = raw.match(/KEY POINTS:\s*([\s\S]*)$/i)
  if (pointsMatch?.[1]) {
    keyPoints = pointsMatch[1]
      .split(/\n+/)
      .map((line) => line.replace(/^[\s\-*•]+/, "").trim())
      .filter(Boolean)
      .slice(0, 6)
  }

  return {
    questions: question,
    summary,
    key_points: keyPoints,
    references: sources.slice(0, 5).map((r) => ({ url: r.url, title: r.title })),
    disclaimer:
      "Draft research generated by ALFRED Ai. Verify against authoritative sources before sending.",
    generated_at: new Date().toISOString(),
    model: SUMMARY_MODEL,
  }
}
