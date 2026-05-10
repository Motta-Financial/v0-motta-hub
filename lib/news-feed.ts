/**
 * Lightweight Google News RSS fetcher for the daily briefing.
 *
 * We deliberately avoid pulling in an RSS-parsing dependency for what is
 * effectively two regex passes — Google News's feed XML is well-formed and
 * stable enough that a hand-rolled parser is the right tradeoff for cold
 * start time on a Vercel cron.
 *
 * If the briefing ever needs richer feeds (full body summaries, images,
 * deduplication across topics) swap to `rss-parser`. For "5 headlines and
 * links in the morning email" this is plenty.
 */

export interface NewsItem {
  title: string
  url: string
  source: string
  pubDate: string | null
  category: NewsCategory
}

export type NewsCategory = "market" | "tax" | "tech"

const FEEDS: Record<NewsCategory, string> = {
  // `when:1d` constrains Google News to the past day so we don't recycle
  // stale headlines morning after morning.
  market:
    "https://news.google.com/rss/search?q=%22stock+market%22+OR+%22S%26P+500%22+OR+%22Federal+Reserve%22+when:1d&hl=en-US&gl=US&ceid=US:en",
  tax:
    "https://news.google.com/rss/search?q=%22IRS%22+OR+%22tax+law%22+OR+%22tax+deadline%22+when:1d&hl=en-US&gl=US&ceid=US:en",
  // Tech/AI news covering our stack (OpenAI, Anthropic/Claude, AI SDK) and
  // broader AI industry updates relevant to a tech-forward accounting firm.
  tech:
    "https://news.google.com/rss/search?q=%22OpenAI%22+OR+%22Claude%22+OR+%22Anthropic%22+OR+%22GPT%22+OR+%22AI+integration%22+OR+%22AI+partnership%22+OR+%22generative+AI%22+when:1d&hl=en-US&gl=US&ceid=US:en",
}

/**
 * Fetches a news category from Google News RSS. Returns up to `limit`
 * items. On any failure (network, malformed XML) returns an empty array
 * — the caller should treat news as best-effort and skip the section
 * rather than failing the whole briefing.
 */
export async function fetchNewsCategory(
  category: NewsCategory,
  limit = 4,
): Promise<NewsItem[]> {
  const feedUrl = FEEDS[category]
  try {
    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ALFRED-Ai-DailyBriefing/1.0; +https://motta.cpa)",
      },
      // Cache between cron invocations within a 30-minute window so a
      // re-run of the briefing doesn't double-hit Google.
      next: { revalidate: 60 * 30 },
    })
    if (!response.ok) {
      console.warn(`[news-feed] ${category} feed returned ${response.status}`)
      return []
    }
    const xml = await response.text()
    return parseRssItems(xml, category).slice(0, limit)
  } catch (err) {
    console.warn(`[news-feed] ${category} fetch failed:`, err)
    return []
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Minimal RSS <item> parser
 * ─────────────────────────────────────────────────────────────────────── */

function parseRssItems(xml: string, category: NewsCategory): NewsItem[] {
  const items: NewsItem[] = []
  // Match each <item>…</item> block. The `s` flag makes `.` match newlines
  // (RSS items are multi-line in Google's output).
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, "title")
    const link = extractTag(block, "link")
    const pubDate = extractTag(block, "pubDate")
    const source = extractTag(block, "source")
    if (!title || !link) continue
    items.push({
      title: decodeEntities(title.trim()),
      url: link.trim(),
      source: source ? decodeEntities(source.trim()) : "Google News",
      pubDate: pubDate || null,
      category,
    })
  }
  return items
}

function extractTag(block: string, tag: string): string | null {
  // Handles both <tag>x</tag> and <tag><![CDATA[x]]></tag>, and tags with
  // attributes (e.g. <source url="...">Reuters</source>).
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`)
  const m = block.match(re)
  if (!m) return null
  let value = m[1]
  const cdata = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  if (cdata) value = cdata[1]
  return value
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}
