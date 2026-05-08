import { tool } from "ai"
import { z } from "zod"

/**
 * Parallel Web Search API endpoint. v1beta is the documented public version
 * as of 2026-Q2. Hard-coded so a routing change doesn't silently break
 * ALFRED chats; if Parallel ever ships v1, we bump this in one place.
 */
const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1beta/search"

/**
 * Hard timeout for the upstream call. Parallel's median latency is ~3s but
 * the long tail can push 10s+. We cap at 25s so the chat stream doesn't
 * stall a user-visible reply.
 */
const TIMEOUT_MS = 25_000

interface ParallelSearchResult {
  url: string
  title: string
  /** 1+ ranked excerpt strings ("snippets") that match the query. */
  excerpts: string[]
}

interface ParallelSearchResponse {
  search_id: string
  results: ParallelSearchResult[]
}

/**
 * Web search tool — uses Parallel Web's Search API to answer broad
 * research questions ("latest IRS guidance on…", "ASC 842 lease changes
 * 2026", "what does <competitor> charge for bookkeeping").
 *
 * Returns ranked excerpts only — no full page bodies. If ALFRED needs a
 * full page, it should chain this with `browsePage` on a result URL.
 */
export const webSearchTool = tool({
  description:
    "Search the public web for current information using Parallel Web. " +
    "Use this when the user asks about recent news, regulations, " +
    "industry trends, competitors, or anything outside Motta's internal " +
    "data (clients, work items, debriefs, etc. are in other tools). " +
    "Returns ranked excerpts with source URLs. If you need the full text " +
    "of a specific page, follow up with `browsePage` on the result URL.",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .max(500)
      .describe(
        "Natural-language search query. More specific is better — " +
          "include year, jurisdiction, and entity types when relevant " +
          '(e.g. "2026 IRS deadline extension Hurricane Helene Florida").',
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("How many ranked results to return. Default 5."),
    objective: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Optional: a one-sentence statement of WHY you're searching. " +
          "Parallel uses this to better rank excerpts. Example: " +
          '"Find the official IRS announcement for FL hurricane relief."',
      ),
  }),
  execute: async ({ query, maxResults, objective }) => {
    const apiKey = process.env.PARALLELWEB_PARALLEL_API_KEY
    if (!apiKey) {
      return {
        ok: false as const,
        error: "Parallel Web API key is not configured on this deployment.",
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(PARALLEL_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          objective: objective || query,
          search_queries: [query],
          processor: "base",
          max_results: maxResults,
          // Caps each excerpt at ~1500 chars so we don't blow ALFRED's
          // context budget on a single tool result.
          max_chars_per_result: 1500,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        return {
          ok: false as const,
          error: `Parallel Web returned HTTP ${res.status}`,
          details: body.slice(0, 500),
        }
      }

      const data = (await res.json()) as ParallelSearchResponse

      return {
        ok: true as const,
        query,
        resultCount: data.results?.length ?? 0,
        results: (data.results ?? []).map((r) => ({
          url: r.url,
          title: r.title,
          // Join excerpts with a separator so the model sees them as
          // distinct snippets, not run-on prose.
          snippet: (r.excerpts ?? []).join(" … "),
        })),
      }
    } catch (e) {
      const err = e as Error
      if (err.name === "AbortError") {
        return {
          ok: false as const,
          error: `Parallel Web search timed out after ${TIMEOUT_MS / 1000}s.`,
        }
      }
      return {
        ok: false as const,
        error: `Parallel Web search failed: ${err.message}`,
      }
    } finally {
      clearTimeout(timeout)
    }
  },
})
