"use client"

import * as React from "react"
import Link from "next/link"
import useSWR from "swr"
import { Search, ExternalLink, Loader2, FileText, Building2, User, Calendar } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type WorkItem = {
  id: string
  karbon_work_item_key: string
  title: string | null
  clientName?: string | null
  client_group_name?: string | null
  work_type?: string | null
  status?: string | null
  workflow_status?: string | null
  primary_status?: string | null
  due_date?: string | null
  completed_date?: string | null
  assignee_name?: string | null
  karbon_url?: string | null
}

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

/**
 * Debounce a value — used to avoid hammering the search API on every keystroke.
 * 200ms is responsive but lets the user finish a token before issuing a query.
 */
function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function statusTone(status?: string | null) {
  const s = (status || "").toLowerCase()
  if (s.includes("complete")) return "bg-emerald-100 text-emerald-700 border-emerald-200"
  if (s.includes("progress")) return "bg-blue-100 text-blue-700 border-blue-200"
  if (s.includes("ready")) return "bg-amber-100 text-amber-700 border-amber-200"
  if (s.includes("plan")) return "bg-slate-100 text-slate-700 border-slate-200"
  if (s.includes("wait") || s.includes("hold")) return "bg-orange-100 text-orange-700 border-orange-200"
  if (s.includes("cancel")) return "bg-rose-100 text-rose-700 border-rose-200"
  return "bg-stone-100 text-stone-700 border-stone-200"
}

function formatDate(d?: string | null) {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Trigger button — designed to live in the dashboard topbar / sidebar so the
 * palette is one click (or Cmd+K) away from any page in the app.
 */
export function WorkItemSearchTrigger({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false)

  // Cmd+K (Mac) / Ctrl+K (Windows) opens the palette globally.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          "h-9 w-full justify-start gap-2 bg-background/60 text-muted-foreground",
          "hover:bg-background hover:text-foreground",
          className,
        )}
        aria-label="Search work items"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left text-sm">Search work items…</span>
        <kbd className="pointer-events-none hidden items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <span className="text-xs">{typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? "⌘" : "Ctrl"}</span>
          K
        </kbd>
      </Button>
      <WorkItemSearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

export function WorkItemSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [q, setQ] = React.useState("")
  const [includeCompleted, setIncludeCompleted] = React.useState(true)
  const debouncedQ = useDebounced(q, 200)

  // Reset query when palette closes so re-opening starts fresh.
  React.useEffect(() => {
    if (!open) setQ("")
  }, [open])

  // Only fire when the user has typed something searchable; the FTS backend
  // uses websearch_to_tsquery and needs >= 3 chars to be useful, but we send
  // 2 chars too — the API falls back to ILIKE for very short tokens.
  const shouldFetch = open && debouncedQ.trim().length >= 2

  const params = new URLSearchParams()
  params.set("limit", "25")
  params.set("search", debouncedQ.trim())
  if (!includeCompleted) params.set("status", "active")

  const { data, error, isLoading } = useSWR<{ workItems: WorkItem[]; total: number }>(
    shouldFetch ? `/api/supabase/work-items?${params.toString()}` : null,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  )

  const items = data?.workItems || []

  // Group by primary_status so users get an "In Progress" cluster, "Completed"
  // cluster, etc. instead of a flat unsorted list.
  const grouped = React.useMemo(() => {
    const buckets = new Map<string, WorkItem[]>()
    for (const it of items) {
      const key = it.primary_status || it.workflow_status || it.status || "Other"
      const arr = buckets.get(key) || []
      arr.push(it)
      buckets.set(key, arr)
    }
    // Stable order: in-progress first, then ready, planned, waiting, completed, others.
    const order = ["In Progress", "Ready To Start", "Planned", "Waiting", "Completed"]
    const sorted = [...buckets.entries()].sort(([a], [b]) => {
      const ai = order.findIndex((o) => a.toLowerCase().includes(o.toLowerCase()))
      const bi = order.findIndex((o) => b.toLowerCase().includes(o.toLowerCase()))
      const an = ai === -1 ? order.length : ai
      const bn = bi === -1 ? order.length : bi
      return an - bn
    })
    return sorted
  }, [items])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Work Items"
      description="Search by title, client, work type, or Karbon key. Press Esc to close."
    >
      <CommandInput
        placeholder="Search by title, client, work type, or Karbon key…"
        value={q}
        onValueChange={setQ}
        autoFocus
      />
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span>
          {shouldFetch ? (
            isLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Searching…
              </span>
            ) : error ? (
              <span className="text-rose-600">Error: {String((error as Error).message)}</span>
            ) : (
              <span>
                {data?.total ?? 0} match{(data?.total ?? 0) === 1 ? "" : "es"}
                {data?.total === 25 ? " (showing first 25)" : ""}
              </span>
            )
          ) : (
            <span>Type at least 2 characters</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setIncludeCompleted((v) => !v)}
          className="rounded border px-2 py-0.5 transition-colors hover:bg-muted"
          aria-pressed={includeCompleted}
        >
          {includeCompleted ? "Including completed" : "Active only"}
        </button>
      </div>
      <CommandList className="max-h-[60vh]">
        {!shouldFetch && (
          <CommandEmpty>
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Search className="mx-auto mb-2 h-6 w-6 opacity-40" />
              Start typing to search across {/* number is approximate */}3,000+ Karbon work items.
            </div>
          </CommandEmpty>
        )}
        {shouldFetch && !isLoading && items.length === 0 && (
          <CommandEmpty>
            <div className="py-8 text-center text-sm text-muted-foreground">
              No work items match &ldquo;{debouncedQ}&rdquo;.
            </div>
          </CommandEmpty>
        )}
        {grouped.map(([groupName, groupItems], gi) => (
          <React.Fragment key={groupName}>
            {gi > 0 && <CommandSeparator />}
            <CommandGroup heading={`${groupName} (${groupItems.length})`}>
              {groupItems.map((item) => (
                <WorkItemRow key={item.id} item={item} onSelect={() => onOpenChange(false)} />
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

function WorkItemRow({ item, onSelect }: { item: WorkItem; onSelect: () => void }) {
  const due = formatDate(item.due_date)
  const completed = formatDate(item.completed_date)
  const statusLabel = item.primary_status || item.workflow_status || item.status || ""
  const client = item.clientName || item.client_group_name || "—"

  return (
    <CommandItem
      value={`${item.title || ""} ${item.karbon_work_item_key} ${client} ${item.work_type || ""}`}
      // Render as a Link so keyboard navigation + Enter follows naturally.
      asChild
    >
      <Link
        // Deep-link to the work-items list pre-filtered by Karbon key. The
        // list view's own search already exact-matches that 36-char GUID.
        // (We don't have a per-item detail page yet, so this is the most
        // useful "open" target — and keeps users one click from Karbon.)
        href={`/work-items?q=${encodeURIComponent(item.karbon_work_item_key)}`}
        onClick={onSelect}
        className="flex w-full items-start gap-3 px-2 py-2"
      >
        <div className="mt-0.5 rounded-md bg-stone-100 p-1.5">
          <FileText className="h-4 w-4 text-stone-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {item.title || "(untitled)"}
            </span>
            {statusLabel && (
              <Badge variant="outline" className={cn("h-5 shrink-0 text-[10px]", statusTone(statusLabel))}>
                {statusLabel}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {item.work_type && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" /> {item.work_type}
              </span>
            )}
            <span className="inline-flex items-center gap-1 truncate">
              <User className="h-3 w-3" /> {client}
            </span>
            {item.assignee_name && (
              <span className="inline-flex items-center gap-1 truncate">
                <User className="h-3 w-3" /> {item.assignee_name}
              </span>
            )}
            {(due || completed) && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {completed ? `Completed ${completed}` : `Due ${due}`}
              </span>
            )}
            <span className="font-mono text-[10px] text-stone-400">
              {item.karbon_work_item_key.slice(0, 8)}
            </span>
          </div>
        </div>
        {item.karbon_url && (
          <a
            href={item.karbon_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Open in Karbon"
            title="Open in Karbon"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </Link>
    </CommandItem>
  )
}
