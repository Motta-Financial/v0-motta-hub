import { tool } from "ai"
import { z } from "zod"
import Browserbase from "@browserbasehq/sdk"
import { chromium, type Browser } from "playwright-core"

/**
 * Page navigation timeout. Most marketing pages settle in <5s; the IRS
 * site and other government surfaces sometimes hit 15s. Anything past 30s
 * is almost always a dead/slow URL — fail fast so ALFRED can move on.
 */
const NAV_TIMEOUT_MS = 30_000

/**
 * Hard cap on extracted text. The model gets confused by giant blobs and
 * we don't want to balloon the context window on a single tool call.
 * 8k chars is roughly 2k tokens — plenty for a typical article.
 */
const MAX_BODY_CHARS = 8_000

/**
 * Browse a specific URL via a Browserbase-managed Chromium session.
 *
 * Why Browserbase + Playwright vs a plain `fetch`:
 *   - Many target pages (IRS, state DORs, accounting trade pubs) ship
 *     server-rendered HTML behind aggressive bot detection. A residential-
 *     IP managed browser dodges blocks that `fetch` hits immediately.
 *   - Some pages (Notion exports, Karbon help center) hydrate via JS and
 *     return ~empty HTML to a non-JS fetcher.
 *
 * Cost note: each call spins up a session (~3-8s warm, ~10s cold). Use
 * `webSearch` first for general research; reserve this for "open this
 * specific URL and tell me what it says".
 */
export const browsePageTool = tool({
  description:
    "Open a specific URL in a managed cloud browser (Browserbase) and " +
    "return its visible text plus the page title. Use this when you " +
    "have a known URL the user wants summarized, OR after `webSearch` " +
    "when one ranked result needs deeper reading. Don't use this for " +
    "broad research — use `webSearch` for that. Each call takes ~5-10s.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe(
        "Fully-qualified HTTPS URL to open. Example: " +
          '"https://www.irs.gov/newsroom/irs-grants-relief-for-hurricane-helene".',
      ),
    extractSelector: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Optional CSS selector to scope extraction to a region of the " +
          'page (e.g. "main", "article", ".content"). When omitted we ' +
          "extract the full <body>.",
      ),
  }),
  execute: async ({ url, extractSelector }) => {
    const apiKey = process.env.BROWSEBASE_BROWSERBASE_API_KEY
    const projectId = process.env.BROWSEBASE_BROWSERBASE_PROJECT_ID
    if (!apiKey || !projectId) {
      return {
        ok: false as const,
        error: "Browserbase is not configured on this deployment.",
      }
    }

    const bb = new Browserbase({ apiKey })
    let session: { id: string; connectUrl: string } | null = null
    let browser: Browser | null = null

    try {
      // Create a fresh ephemeral session so concurrent ALFRED users don't
      // share cookies/cache. Browserbase auto-cleans these.
      session = await bb.sessions.create({ projectId })

      browser = await chromium.connectOverCDP(session.connectUrl)
      const context = browser.contexts()[0] ?? (await browser.newContext())
      const page = context.pages()[0] ?? (await context.newPage())

      const response = await page.goto(url, {
        timeout: NAV_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      })

      const status = response?.status() ?? 0
      const finalUrl = page.url()
      const title = await page.title().catch(() => "")

      // Extract visible text. We do this in-page so we get post-JS DOM,
      // which is the whole point of using a real browser. Strip script/
      // style nodes and collapse whitespace so the model sees clean text.
      const body = await page.evaluate((sel) => {
        const root: Element = sel
          ? (document.querySelector(sel) as Element) ?? document.body
          : document.body
        if (!root) return ""
        const clone = root.cloneNode(true) as Element
        for (const n of clone.querySelectorAll("script, style, noscript, svg")) {
          n.remove()
        }
        return (clone.textContent ?? "").replace(/\s+/g, " ").trim()
      }, extractSelector ?? null)

      const truncated = body.length > MAX_BODY_CHARS
      const text = truncated ? body.slice(0, MAX_BODY_CHARS) : body

      return {
        ok: true as const,
        url: finalUrl,
        status,
        title,
        text,
        textLength: body.length,
        truncated,
      }
    } catch (e) {
      const err = e as Error
      return {
        ok: false as const,
        url,
        error: `Browserbase fetch failed: ${err.message}`,
      }
    } finally {
      // Always close — leaving sessions open burns Browserbase quota even
      // though they auto-expire eventually.
      try {
        await browser?.close()
      } catch {
        // Best-effort; browser may already be gone if the upstream errored.
      }
    }
  },
})
