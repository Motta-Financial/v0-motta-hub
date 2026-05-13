"use client"

import { useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import {
  Clock,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
  Video as VideoIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatLoomDuration } from "@/lib/loom"
import { cn } from "@/lib/utils"
import type { TrainingVideo } from "./types"

/**
 * One tile in the Training Library grid. Renders the thumbnail (with a
 * play overlay), title, description, metadata row (duration / category
 * chip / added-by), and a kebab menu for pin/unpin/delete.
 *
 * Wraps the entire thumbnail in a `<Link>` to /training/[id] so a click
 * navigates to the watch page; the action menu is rendered as a sibling
 * absolutely positioned over the corner so its clicks don't bubble.
 */
interface VideoCardProps {
  video: TrainingVideo
  onChanged: () => void
}

export function VideoCard({ video, onChanged }: VideoCardProps) {
  const [busy, setBusy] = useState(false)

  const togglePin = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/training/videos/${video.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_pinned: !video.is_pinned }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error || "Couldn't update")
        return
      }
      toast.success(video.is_pinned ? "Unpinned" : "Pinned to top")
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const removeVideo = async () => {
    // No native confirm() in modal UX style; a plain prompt is fine for
    // a destructive but recoverable action (admins can re-add the URL).
    if (!confirm(`Remove "${video.title}" from the library?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/training/videos/${video.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error || "Couldn't remove")
        return
      }
      toast.success("Removed from library")
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const categoryColor = video.training_categories?.color || "#8E9B79"
  const addedAt = video.created_at
    ? format(new Date(video.created_at), "MMM d, yyyy")
    : null

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-all hover:border-stone-300 hover:shadow-md">
      {/* Thumbnail — entire surface links to the watch page. */}
      <Link
        href={`/training/${video.id}`}
        className="relative block aspect-video w-full overflow-hidden bg-stone-200"
      >
        {video.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnail_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-300 to-stone-500">
            <VideoIcon className="h-10 w-10 text-white/60" aria-hidden="true" />
          </div>
        )}
        {/* Duration pill — bottom-right, like YouTube/Loom conventions. */}
        {video.duration_seconds ? (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
            <Clock className="h-3 w-3" />
            {formatLoomDuration(video.duration_seconds)}
          </span>
        ) : null}
        {/* Pinned badge — top-left so it doesn't fight the action menu. */}
        {video.is_pinned ? (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-xs font-medium text-white shadow-sm">
            <Pin className="h-3 w-3" />
            Pinned
          </span>
        ) : null}
      </Link>

      {/* Action menu — sibling to the link so clicking it doesn't
          navigate. Hidden on small screens until hover for a cleaner
          look; always-visible on touch devices since hover is unreliable. */}
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className={cn(
                "h-7 w-7 rounded-md bg-white/95 shadow-sm backdrop-blur-sm",
                "opacity-0 transition-opacity group-hover:opacity-100",
                "focus-visible:opacity-100 data-[state=open]:opacity-100",
              )}
              aria-label="Video actions"
              disabled={busy}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => togglePin()}>
              {video.is_pinned ? (
                <>
                  <PinOff className="mr-2 h-4 w-4" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-4 w-4" />
                  Pin to top
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => removeVideo()}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Title + metadata */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link
          href={`/training/${video.id}`}
          className="line-clamp-2 text-balance text-sm font-semibold text-stone-900 hover:text-stone-700"
        >
          {video.title || "Untitled Loom"}
        </Link>
        {video.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-stone-600">
            {video.description}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {video.training_categories ? (
            <Badge
              variant="secondary"
              className="border-0 text-[10px] font-medium uppercase tracking-wide text-white"
              style={{ backgroundColor: categoryColor }}
            >
              {video.training_categories.name}
            </Badge>
          ) : null}
          {video.department ? (
            <Badge
              variant="outline"
              className="border-stone-300 text-[10px] font-medium uppercase tracking-wide text-stone-600"
            >
              {video.department}
            </Badge>
          ) : null}
          {video.tags?.slice(0, 2).map((t) => (
            <Badge
              key={t}
              variant="outline"
              className="border-stone-200 bg-stone-50 text-[10px] font-normal text-stone-600"
            >
              {t}
            </Badge>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-stone-500">
          <span className="truncate">
            {video.added_by_name ? `Added by ${video.added_by_name}` : "—"}
          </span>
          {addedAt ? <span className="shrink-0">{addedAt}</span> : null}
        </div>
      </div>
    </div>
  )
}
