/**
 * Loom utilities — URL parsing + public oEmbed enrichment.
 *
 * Loom does not expose a self-serve "list videos in a workspace" API, so
 * Motta Hub's Training Library is built on:
 *   1. Manual URL entry (a teammate pastes a Loom share URL)
 *   2. Loom's public oEmbed endpoint, which takes any share URL and
 *      returns title, thumbnail, duration, author, and the iframe HTML
 *      needed to embed the player.
 *
 * The oEmbed endpoint is unauthenticated and free; the only thing that
 * matters is that the source video is publicly viewable inside the
 * firm's Loom workspace (workspace-only links also enrich, but obviously
 * only workspace members will be able to play them).
 *
 * Doc: https://dev.loom.com/docs/embed-sdk/embedding-loom-videos#oembed
 */

/**
 * Pull the 32-char hex video id out of any of the Loom URL shapes we
 * see in the wild. Returns null when the URL clearly isn't a Loom link
 * so callers can bail early with a friendly error before hitting the
 * network.
 *
 * Examples that all return "abc123…":
 *   - https://www.loom.com/share/abc123…
 *   - https://www.loom.com/share/abc123…?sid=xyz
 *   - https://www.loom.com/embed/abc123…
 *   - https://loom.com/share/abc123…
 *   - loom.com/share/abc123…   (no scheme — we tolerate this)
 *   - abc123…                  (raw id — we tolerate this too)
 */
export function extractLoomVideoId(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null

  // Raw id fast-path. Loom ids are lowercase hex, 32 chars. We accept
  // 16+ to be lenient against future format tweaks.
  if (/^[a-f0-9]{16,}$/i.test(trimmed)) return trimmed.toLowerCase()

  // Tolerate URLs missing a scheme — common when someone copies from
  // the browser bar with autocomplete still active.
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const u = new URL(normalized)
    if (!/(^|\.)loom\.com$/i.test(u.hostname)) return null
    // Path shapes: /share/<id>, /embed/<id>, /v/<id>, /e/<id>
    const match = u.pathname.match(/\/(share|embed|v|e)\/([a-f0-9]{16,})/i)
    if (match) return match[2].toLowerCase()
    return null
  } catch {
    return null
  }
}

/** Build the canonical share URL we store in the DB. */
export function buildLoomShareUrl(videoId: string): string {
  return `https://www.loom.com/share/${videoId}`
}

/** Build the iframe src for embedding (the embed URL plays inline). */
export function buildLoomEmbedUrl(videoId: string): string {
  return `https://www.loom.com/embed/${videoId}`
}

/**
 * Normalized shape of what we care about from Loom's oEmbed response.
 * Loom returns more fields (html, provider_url, version, type, etc.)
 * but the player only needs the embed URL — which we can derive from
 * the video id — so we keep our internal type small and stable.
 */
export interface LoomOEmbedData {
  videoId: string
  title: string | null
  /** Thumbnail URL — used in the library grid. */
  thumbnailUrl: string | null
  /** Length in whole seconds. Loom returns a float; we round. */
  durationSeconds: number | null
  authorName: string | null
}

/**
 * Fetch oEmbed metadata for a Loom URL. Returns null on any failure
 * (network error, non-200, malformed JSON, video not public) so the
 * caller can decide whether to surface an error or save the video with
 * just the URL and let the teammate type a title manually.
 *
 * The fetch is cached for an hour — oEmbed payloads are effectively
 * immutable per video id (title edits are rare in Loom) and this saves
 * us a round-trip on the bulk-paste path where the same URL might get
 * resubmitted within minutes of an initial add.
 */
export async function fetchLoomOEmbed(
  shareUrl: string,
): Promise<LoomOEmbedData | null> {
  const videoId = extractLoomVideoId(shareUrl)
  if (!videoId) return null

  // Always send Loom the canonical share URL form. Loom's oEmbed is
  // picky about /embed/ vs /share/ — share form is the documented path.
  const canonical = buildLoomShareUrl(videoId)
  const endpoint = `https://www.loom.com/v1/oembed?url=${encodeURIComponent(canonical)}&format=json`

  try {
    const res = await fetch(endpoint, {
      // 1 hour cache — see comment above.
      next: { revalidate: 3600 },
      headers: { accept: "application/json" },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      title?: string
      thumbnail_url?: string
      duration?: number | string
      author_name?: string
    }
    const duration =
      typeof data.duration === "number"
        ? Math.round(data.duration)
        : typeof data.duration === "string" && data.duration
          ? Math.round(Number(data.duration))
          : null
    return {
      videoId,
      title: data.title?.trim() || null,
      thumbnailUrl: data.thumbnail_url || null,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      authorName: data.author_name?.trim() || null,
    }
  } catch {
    return null
  }
}

/**
 * Format a duration in seconds as "M:SS" or "H:MM:SS". Returns "—" for
 * unknown durations so the UI can render a stable-width column.
 */
export function formatLoomDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
