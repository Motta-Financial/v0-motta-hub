"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Filter, Search, Video as VideoIcon, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { AddLoomDialog } from "./add-loom-dialog"
import { VideoCard } from "./video-card"
import type { CategoriesResponse, VideosResponse } from "./types"

/**
 * Training Library — the main /training page.
 *
 * Layout (desktop):
 *   ┌────────────┬──────────────────────────────────────────────┐
 *   │  Sidebar   │  Header (title + search + Add Loom button)   │
 *   │  Filters   │  ────────────────────────────────────────────│
 *   │            │  Video grid (responsive 2 / 3 / 4 columns)   │
 *   └────────────┴──────────────────────────────────────────────┘
 *
 * On mobile the sidebar collapses into a horizontal scroll of chips
 * at the top of the page.
 *
 * Data fetching uses SWR keyed on the active filters so changing a
 * filter triggers a refetch without manual state plumbing. The keys
 * deliberately point at our own /api/training endpoints rather than
 * hitting Supabase from the client — we want the server to enforce
 * filtering rules and stay the single source of truth for query
 * shape.
 */
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("Failed to load")
  return res.json()
}

export function TrainingLibrary() {
  // Filters
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [query, setQuery] = useState("")
  // Debounced query — searching on every keystroke would thrash the API
  // and the DB. 250ms is the sweet spot for "feels instant".
  const [debouncedQuery, setDebouncedQuery] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  // Build the videos endpoint URL. Memoize so SWR caches by exact key.
  const videosKey = useMemo(() => {
    const params = new URLSearchParams()
    if (activeCategory !== "all") params.set("category", activeCategory)
    if (debouncedQuery) params.set("q", debouncedQuery)
    const qs = params.toString()
    return qs ? `/api/training/videos?${qs}` : "/api/training/videos"
  }, [activeCategory, debouncedQuery])

  const {
    data: videosData,
    isLoading: videosLoading,
    mutate: mutateVideos,
  } = useSWR<VideosResponse>(videosKey, fetcher, {
    // Keep showing the previous result while a new filter loads so the
    // grid doesn't blank out for a fraction of a second.
    keepPreviousData: true,
  })

  const { data: catsData, mutate: mutateCats } = useSWR<CategoriesResponse>(
    "/api/training/categories",
    fetcher,
  )

  // After a successful add/edit/delete, revalidate BOTH videos and
  // categories — categories carry the per-chip count which needs to
  // reflect the new state.
  const refresh = () => {
    mutateVideos()
    mutateCats()
  }

  const videos = videosData?.videos ?? []
  const categories = catsData?.categories ?? []
  const totalCount = catsData?.total_count ?? 0

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Training Library
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Loom videos recorded by the team — SOPs, onboarding, deep dives.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AddLoomDialog categories={categories} onAdded={refresh} />
        </div>
      </header>

      {/* Mobile category chips */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:hidden">
        <CategoryChip
          label="All"
          count={totalCount}
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
        />
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            label={c.name}
            color={c.color}
            count={c.video_count ?? 0}
            active={activeCategory === c.id}
            onClick={() => setActiveCategory(c.id)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20 space-y-1">
            <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">
              Categories
            </h2>
            <SidebarItem
              label="All videos"
              count={totalCount}
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            />
            {categories.map((c) => (
              <SidebarItem
                key={c.id}
                label={c.name}
                color={c.color}
                count={c.video_count ?? 0}
                active={activeCategory === c.id}
                onClick={() => setActiveCategory(c.id)}
              />
            ))}
          </div>
        </aside>

        {/* Main content */}
        <section className="flex-1 space-y-4">
          {/* Search bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
                aria-hidden="true"
              />
              <Input
                placeholder="Search title, description, author…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="border-stone-200 bg-white pl-9"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-600"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {activeCategory !== "all" || debouncedQuery ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActiveCategory("all")
                  setQuery("")
                }}
              >
                <Filter className="mr-1.5 h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
          </div>

          {/* Result summary */}
          <p className="text-xs text-stone-500">
            {videosLoading
              ? "Loading…"
              : `${videos.length} ${videos.length === 1 ? "video" : "videos"}${
                  debouncedQuery ? ` matching "${debouncedQuery}"` : ""
                }`}
          </p>

          {/* Grid / empty / loading states */}
          {videosLoading && videos.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="aspect-[16/13] w-full rounded-xl bg-stone-200/70"
                />
              ))}
            </div>
          ) : videos.length === 0 ? (
            <EmptyState
              hasFilters={activeCategory !== "all" || !!debouncedQuery}
              onClearFilters={() => {
                setActiveCategory("all")
                setQuery("")
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {videos.map((v) => (
                <VideoCard key={v.id} video={v} onChanged={refresh} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/* ── Sidebar primitives ────────────────────────────────────────────── */

function SidebarItem({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string
  count: number
  color?: string | null
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-stone-900 text-white"
          : "text-stone-700 hover:bg-stone-200/70",
      )}
    >
      <span className="flex items-center gap-2 truncate">
        {color ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
          active ? "bg-white/15 text-white" : "bg-stone-200 text-stone-600",
        )}
      >
        {count}
      </span>
    </button>
  )
}

function CategoryChip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string
  count: number
  color?: string | null
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-stone-900 bg-stone-900 text-white"
          : "border-stone-200 bg-white text-stone-700 hover:border-stone-300",
      )}
    >
      {color ? (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ) : null}
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
          active ? "bg-white/15 text-white" : "bg-stone-100 text-stone-500",
        )}
      >
        {count}
      </span>
    </button>
  )
}

/* ── Empty state ───────────────────────────────────────────────────── */

function EmptyState({
  hasFilters,
  onClearFilters,
}: {
  hasFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white/60 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
        <VideoIcon className="h-6 w-6 text-stone-500" aria-hidden="true" />
      </div>
      <h3 className="mt-3 text-base font-semibold text-stone-900">
        {hasFilters ? "No videos match those filters" : "No training videos yet"}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-stone-600">
        {hasFilters
          ? "Try a different category or clear your search."
          : "Paste a Loom share URL to add the first training video. The team can then browse, search, and watch from this page."}
      </p>
      {hasFilters ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClearFilters}>
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
