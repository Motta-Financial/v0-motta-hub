/**
 * Prospect enrichment — pulls public information about a new Jotform
 * intake submission so the firm can walk into the first conversation
 * already briefed.
 *
 * Strategy:
 *   1. Extract any URLs the prospect typed into free-text fields.
 *   2. If a linked organization already exists (via the auto-link
 *      pass in `upsertIntakeSubmission`) and has a `website` column,
 *      include that too.
 *   3. Run a single Parallel Web search keyed off the business name
 *      and state to surface anything the prospect didn't include — a
 *      LinkedIn page, press, etc.
 *   4. Hand the gathered URLs + snippets to `generateText` and ask
 *      for a tight, partner-ready 3-5 sentence brief.
 *
 * Failure mode: any individual step (no URLs, Parallel down, AI rate-
 * limited) returns `null` for that piece. The function never throws
 * upward — the email + ingest path must always succeed even when
 * research doesn't. The shape of the returned object is the same
 * one persisted into `jotform_intake_submissions.enrichment`.
 */
import { generateText } from "ai"
import type { SupabaseClient } from "@supabase/supabase-js"
import { RESEARCH_SUMMARY_MODEL } from "@/lib/ai/models"

/** Hard cap on the upstream research call so the webhook stays snappy. */
const RESEARCH_TIMEOUT_MS = 12_000
/** Hard cap on the summarization call. */
const SUMMARY_TIMEOUT_MS = 12_000
/** Default model for summarization. Cheap + fast; we don't need a top-tier
 *  reasoning model to summarize 5 web snippets. Routed through the
 *  central registry so it stays in sync with the question-research pass. */
const SUMMARY_MODEL = RESEARCH_SUMMARY_MODEL

const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1beta/search"

interface ParallelResult {
  url: string
  title: string
  excerpts: string[]
}

export interface EnrichmentBlob {
  /** Partner-facing 3-5 sentence brief about the prospect. */
  summary: string
  /** URLs we actually researched (prospect-supplied + linked-org sites). */
  websites: Array<{ url: string; title?: string; note?: string }>
  /** Raw search hits, kept for the UI's "show your work" affordance. */
  sources: Array<{ url: string; title: string; snippet: string }>
  generated_at: string
  model: string
}

export interface EnrichInput {
  id: string
  submitter_full_name: string | null
  business_name: string | null
  business_state: string | null
  business_summary: string | null
  questions_or_concerns: string | null
  additional_notes: string | null
  service_focus: string | null
  organization_id: string | null
  contact_id: string | null
}

/**
 * Regex that catches the common web-URL shapes typed into free-text
 * fields ("https://acme.com", "www.acme.com", "acme.com/about"). We
 * intentionally do NOT match plain "company.com" without a path or
 * www so we don't fire research on every TLD-shaped acronym.
 */
const URL_REGEX =
  /(https?:\/\/[^\s)<>"']+|www\.[^\s)<>"']+\.[a-z]{2,}[^\s)<>"']*)/gi

function extractUrls(...sources: Array<string | null | undefined>): string[] {
  const urls = new Set<string>()
  for (const s of sources) {
    if (!s) continue
    const matches = s.match(URL_REGEX) ?? []
    for (const raw of matches) {
      const cleaned = raw.replace(/[.,;:!?]+$/, "")
      // Auto-add scheme so the URL is openable.
      const url = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`
      try {
        const parsed = new URL(url)
        // Strip tracking + fragments so we don't double-count slightly
        // different links pointing at the same page.
        parsed.hash = ""
        urls.add(parsed.toString())
      } catch {
        /* malformed — skip */
      }
    }
  }
  return Array.from(urls)
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return await Promise.race<T | null>([
    p,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        console.log(`[v0] enrich: ${label} timed out after ${ms}ms`)
        resolve(null)
      }, ms),
    ),
  ])
}

/**
 * One Parallel Web search call. Returns null on any failure so the
 * caller can carry on with whatever else it has.
 */
async function parallelSearch(query: string, objective: string): Promise<ParallelResult[] | null> {
  const apiKey = process.env.PARALLELWEB_PARALLEL_API_KEY
  if (!apiKey) {
    console.log("[v0] enrich: PARALLELWEB_PARALLEL_API_KEY not configured")
    return null
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(PARALLEL_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        objective,
        search_queries: [query],
        processor: "base",
        max_results: 5,
        max_chars_per_result: 1500,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.log(`[v0] enrich: Parallel search HTTP ${res.status}`)
      return null
    }
    const data = (await res.json()) as { results?: ParallelResult[] }
    return data.results ?? []
  } catch (err) {
    console.log("[v0] enrich: Parallel search failed:", (err as Error).message)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Pull `organizations.website` (and `contacts.website`) for the
 * already-linked rows on the intake submission, if any. This lets us
 * enrich even when the prospect didn't paste their URL into the form.
 */
async function gatherLinkedWebsites(
  supabase: SupabaseClient,
  input: EnrichInput,
): Promise<string[]> {
  const urls: string[] = []
  if (input.organization_id) {
    const { data } = await supabase
      .from("organizations")
      .select("website")
      .eq("id", input.organization_id)
      .maybeSingle()
    if (data?.website) urls.push(data.website)
  }
  if (input.contact_id) {
    const { data } = await supabase
      .from("contacts")
      .select("website")
      .eq("id", input.contact_id)
      .maybeSingle()
    if (data?.website) urls.push(data.website)
  }
  // Normalize / dedupe.
  return extractUrls(...urls)
}

/**
 * Run the enrichment pass. Returns null when there's literally nothing
 * to research (no business name AND no URLs AND no linked entities).
 */
export async function enrichIntakeSubmission(
  supabase: SupabaseClient,
  input: EnrichInput,
): Promise<EnrichmentBlob | null> {
  // 1. Collect candidate URLs.
  const userUrls = extractUrls(
    input.business_summary,
    input.additional_notes,
    input.questions_or_concerns,
  )
  const linkedUrls = await gatherLinkedWebsites(supabase, input)
  const allUrls = Array.from(new Set([...userUrls, ...linkedUrls]))

  // 2. Decide if there's enough signal to bother. We need EITHER a
  //    URL or a business name to run a useful search.
  if (allUrls.length === 0 && !input.business_name) {
    return null
  }

  // 3. Web search. Combine the business name + state and any URLs we
  //    have into the query so Parallel ranks results relevant to this
  //    specific company rather than a generic same-name match.
  const queryParts: string[] = []
  if (input.business_name) queryParts.push(input.business_name)
  if (input.business_state) queryParts.push(input.business_state)
  if (allUrls.length > 0) queryParts.push(allUrls[0]!)
  const query = queryParts.join(" ").trim()

  const objective =
    "Find concise public information about the prospect's business: what they do, " +
    "industry, size, leadership, and anything notable a tax / accounting partner " +
    "should know before a first meeting. Skip generic SEO listings."

  const sources = (await withTimeout(parallelSearch(query, objective), RESEARCH_TIMEOUT_MS + 500, "parallel search")) ?? []

  // 4. AI summarization. If the AI gateway isn't configured we still
  //    return a useful row (URLs + raw snippets) so partners can read
  //    them in the email.
  let summary = ""
  // Widened to `string` rather than the literal model id so the
  // "fallback" sentinel branch below stays well-typed after the
  // registry refactor (registry exports use `as const`, so `let` no
  // longer widens automatically).
  let usedModel: string = SUMMARY_MODEL

  const promptLines = [
    "You are ALFRED Ai, briefing a partner at Motta Financial about a new prospect.",
    "Write 3-5 plain sentences (no bullet lists, no headings). Focus on what the firm needs to know going into the first call: what the business actually does, scale signals, leadership, geography, and any recent news. Be neutral — do not editorialize.",
    "If the available information is too thin to brief, say so in one sentence instead of inventing facts.",
    "",
    "Prospect data from the intake form:",
    `- Submitter: ${input.submitter_full_name ?? "(unknown)"}`,
    `- Business: ${input.business_name ?? "(not provided)"}`,
    `- State: ${input.business_state ?? "(not provided)"}`,
    `- Service focus: ${input.service_focus ?? "(not provided)"}`,
    input.business_summary ? `- Prospect's own description: ${input.business_summary}` : "",
    "",
    "Web research:",
    sources.length === 0
      ? "(No relevant public results were found.)"
      : sources
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n${r.url}\n${(r.excerpts ?? []).join(" … ").slice(0, 1200)}`,
          )
          .join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const ai = await withTimeout(
      generateText({
        model: SUMMARY_MODEL,
        prompt: promptLines,
      }),
      SUMMARY_TIMEOUT_MS,
      "summary generateText",
    )
    if (ai?.text) {
      summary = ai.text.trim()
    }
  } catch (err) {
    console.log("[v0] enrich: generateText error:", (err as Error).message)
  }

  if (!summary) {
    // Last-resort fallback so the email still has *something* useful.
    summary =
      sources.length > 0
        ? `Found ${sources.length} public reference${sources.length === 1 ? "" : "s"} about ${input.business_name ?? "the prospect"} — see links below.`
        : "No public information was found about this prospect."
    usedModel = "fallback"
  }

  const websites: Array<{ url: string; title?: string; note?: string }> = []
  for (const url of allUrls) {
    websites.push({ url, note: linkedUrls.includes(url) ? "linked-org website" : "prospect-supplied" })
  }
  // Top search-hit URLs not already represented also surface in the
  // websites list, so the email's "Researched:" footer is meaningful
  // even when the prospect didn't paste a link.
  for (const s of sources.slice(0, 3)) {
    if (!websites.some((w) => w.url === s.url)) {
      websites.push({ url: s.url, title: s.title })
    }
  }

  return {
    summary,
    websites,
    sources: sources.map((s) => ({
      url: s.url,
      title: s.title,
      snippet: (s.excerpts ?? []).join(" … ").slice(0, 600),
    })),
    generated_at: new Date().toISOString(),
    model: usedModel,
  }
}
