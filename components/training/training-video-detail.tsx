"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Loader2,
  Pin,
  PinOff,
  Trash2,
  User as UserIcon,
} from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoomEmbed } from "@/components/loom-embed"
import { formatLoomDuration } from "@/lib/loom"
import type { TrainingVideo } from "./types"

/**
 * Single-video detail / watch page.
 *
 * Renders the LoomEmbed player at full width, with a side panel listing
 * metadata (category, department, duration, author, added-by, tags) and
 * primary actions (pin/unpin, remove, open in Loom).
 *
 * Uses SWR with the server-rendered video as fallback data so the page
 * is instantly interactive on first paint but auto-updates if the row
 * changes (e.g. from the kebab actions on this page).
 */
interface DetailProps {
  initialVideo: TrainingVideo
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("Failed to load")
  return res.json()
}

export function TrainingVideoDetail({ initialVideo }: DetailProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const { data, mutate } = useSWR<{ video: TrainingVideo }>(
    `/api/training/videos/${initialVideo.id}`,
    fetcher,
    {
      fallbackData: { video: initialVideo },
      revalidateOnFocus: false,
    },
  )
  const video = data?.video ?? initialVideo

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
      mutate()
    } finally {
      setBusy(false)
    }
  }

  const removeVideo = async () => {
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
      router.push("/training")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Back link */}
      <div>
        <Link
          href="/training"
          className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Training Library
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Player + title */}
        <div className="space-y-4">
          <LoomEmbed
            videoId={video.loom_video_id}
            url={video.loom_url}
            thumbnailUrl={video.thumbnail_url}
            title={video.title}
            className="shadow-lg"
          />
          <div className="space-y-2">
            <h1 className="text-balance text-2xl font-semibold tracking-tight text-stone-900">
              {video.title || "Untitled Loom"}
            </h1>
            {video.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                {video.description}
              </p>
            ) : null}
          </div>
        </div>

        {/* Side panel */}
        <aside className="space-y-4">
          {/* Actions */}
          <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={togglePin}
                disabled={busy}
                className="justify-start"
              >
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
              </Button>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="justify-start"
              >
                <a href={video.loom_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open in Loom
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={removeVideo}
                disabled={busy}
                className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Remove from library
              </Button>
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-sm">
            <MetadataRow label="Category">
              {video.training_categories ? (
                <Badge
                  className="border-0 text-[10px] font-medium uppercase tracking-wide text-white"
                  style={{
                    backgroundColor:
                      video.training_categories.color || "#8E9B79",
                  }}
                >
                  {video.training_categories.name}
                </Badge>
              ) : (
                <span className="text-stone-500">Uncategorized</span>
              )}
            </MetadataRow>
            {video.department ? (
              <MetadataRow label="Department">
                <Badge
                  variant="outline"
                  className="border-stone-300 text-[10px] font-medium uppercase tracking-wide text-stone-600"
                >
                  {video.department}
                </Badge>
              </MetadataRow>
            ) : null}
            <MetadataRow label="Duration">
              <span className="inline-flex items-center gap-1 text-stone-700">
                <Clock className="h-3.5 w-3.5 text-stone-400" />
                {formatLoomDuration(video.duration_seconds)}
              </span>
            </MetadataRow>
            {video.author_name ? (
              <MetadataRow label="Recorded by">
                <span className="inline-flex items-center gap-1 text-stone-700">
                  <UserIcon className="h-3.5 w-3.5 text-stone-400" />
                  {video.author_name}
                </span>
              </MetadataRow>
            ) : null}
            {video.added_by_name ? (
              <MetadataRow label="Added by">
                <span className="text-stone-700">{video.added_by_name}</span>
              </MetadataRow>
            ) : null}
            {video.created_at ? (
              <MetadataRow label="Added on">
                <span className="text-stone-700">
                  {format(new Date(video.created_at), "MMM d, yyyy")}
                </span>
              </MetadataRow>
            ) : null}
            {video.tags && video.tags.length > 0 ? (
              <MetadataRow label="Tags">
                <div className="flex flex-wrap gap-1">
                  {video.tags.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="border-stone-200 bg-stone-50 text-[10px] font-normal text-stone-600"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </MetadataRow>
            ) : null}
          </div>

          {/* Embed snippet — partners sometimes want to drop this into
              SOPs or onboarding docs. Easier to have it here than ask
              "how do I get the URL" every time. */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">
              Share
            </h3>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(video.loom_url).then(
                  () => toast.success("Loom URL copied"),
                  () => toast.error("Couldn't copy"),
                )
              }}
              className="w-full break-all rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-left text-xs text-stone-700 hover:bg-stone-100"
            >
              {video.loom_url}
            </button>
            <p className="mt-2 text-[11px] text-stone-500">
              Click to copy the URL. Paste it into any Motta Hub note, SOP,
              or debrief — it will embed inline as a player.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function MetadataRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
      </span>
      <div className="text-right">{children}</div>
    </div>
  )
}
