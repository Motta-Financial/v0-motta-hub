"use client"

import { useMemo, useState } from "react"
import { ExternalLink, Loader2, Play, Video } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildLoomEmbedUrl, extractLoomVideoId } from "@/lib/loom"

/**
 * Reusable Loom player embed.
 *
 * Designed to drop inline anywhere in the app — SOP pages, onboarding
 * docs, debriefs, the Training Library detail view. Renders a 16:9
 * thumbnail first, then mounts the iframe only after the teammate
 * clicks Play. This matters for three reasons:
 *
 *   1. Pages that embed many Looms (a long SOP, the library grid)
 *      don't pay the cost of 20 hidden iframes loading Loom's player
 *      bundle on first paint.
 *   2. Loom's iframe loads third-party tracking scripts; deferring
 *      until interaction keeps the page faster and less chatty.
 *   3. The thumbnail-first UX matches how Loom itself renders shared
 *      links, so it feels native.
 *
 * Pass either `url` (any Loom share/embed URL) or a raw `videoId`.
 * `thumbnailUrl` and `title` are optional — when omitted we render a
 * generic poster with a Play button.
 */
interface LoomEmbedProps {
  /** Any Loom URL — share, embed, /v/, /e/. Optional if videoId set. */
  url?: string | null
  /** Raw Loom video id, if known. Overrides url-derived id. */
  videoId?: string | null
  /** Poster image — typically the oEmbed thumbnail_url. */
  thumbnailUrl?: string | null
  /** Title overlay on the poster. Hidden once playing. */
  title?: string | null
  /** Extra classes on the wrapper (e.g. rounded corners, max-width). */
  className?: string
  /** Skip the thumbnail-first behavior and mount the iframe immediately. */
  autoload?: boolean
  /** Aspect ratio override. Defaults to 16/9. */
  aspectRatio?: number
}

export function LoomEmbed({
  url,
  videoId,
  thumbnailUrl,
  title,
  className,
  autoload = false,
  aspectRatio = 16 / 9,
}: LoomEmbedProps) {
  // Resolve the video id once. Memoized so a parent re-render doesn't
  // re-parse the URL or thrash our internal state.
  const resolvedId = useMemo(() => {
    if (videoId) return videoId
    if (url) return extractLoomVideoId(url)
    return null
  }, [url, videoId])

  const [showPlayer, setShowPlayer] = useState(autoload)

  // Defensive: if we couldn't parse a video id, fall back to a clear
  // error state with a link out, rather than silently rendering nothing.
  if (!resolvedId) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed bg-muted/40 p-6 text-sm text-muted-foreground",
          className,
        )}
        style={{ aspectRatio: String(aspectRatio) }}
      >
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4" />
          <span>Loom video unavailable</span>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-1 text-foreground underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  const embedSrc = buildLoomEmbedUrl(resolvedId)

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg bg-black",
        className,
      )}
      style={{ aspectRatio: String(aspectRatio) }}
    >
      {showPlayer ? (
        <iframe
          src={embedSrc}
          title={title ?? "Loom video player"}
          // Loom recommends these on its embed snippet; allowfullscreen
          // enables the native fullscreen control inside the player.
          allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowPlayer(true)}
          className="group absolute inset-0 flex h-full w-full items-center justify-center bg-black/40 transition-colors hover:bg-black/30"
          aria-label={title ? `Play ${title}` : "Play video"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-stone-700 to-stone-900">
              <Video className="h-12 w-12 text-white/40" aria-hidden="true" />
            </div>
          )}
          {/* Subtle gradient so the title and play button stay legible
              over busy thumbnails. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/10" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-105">
            <Play className="h-7 w-7 translate-x-[2px] fill-stone-900 text-stone-900" />
          </div>
          {title ? (
            <span className="absolute bottom-3 left-3 right-3 line-clamp-2 text-balance text-left text-sm font-medium text-white drop-shadow-sm">
              {title}
            </span>
          ) : null}
        </button>
      )}
    </div>
  )
}

/**
 * Tiny convenience wrapper for the "loading" placeholder used by the
 * library grid before data arrives. Same 16:9 footprint as the real
 * embed so the page doesn't jump when content paints.
 */
export function LoomEmbedSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-stone-200/70",
        className,
      )}
    >
      <Loader2 className="h-6 w-6 animate-spin text-stone-500" />
    </div>
  )
}
