"use client"

/**
 * Portal Documents page.
 *
 * A single place for the client to find every file exchanged with the
 * firm, grouped by the task it belongs to. Uploading happens on the
 * individual task page (so files always land against the right work
 * item) — each group here links back to its task.
 */

import useSWR from "swr"
import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText, FolderOpen, Search, ArrowRight } from "lucide-react"
import { DocumentRow, type PortalDocument } from "@/components/portal/task-documents"
import { EmptyState, WarningBanner } from "@/components/shared/empty-state"

const DEEP_GREEN = "#6B745D"

interface PortalDocumentWithTask extends PortalDocument {
  work_item_id: string | null
  work_item_title: string | null
  work_item_type: string | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load documents (HTTP ${res.status})`)
  }
  return res.json()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const { data, isLoading, error, mutate } = useSWR<{
    documents: PortalDocumentWithTask[]
  }>("/api/client-portal/documents", fetcher)

  const [query, setQuery] = useState("")

  const documents = data?.documents ?? []

  // Filter first, then group, so a search that empties a task group
  // hides that group entirely rather than leaving a bare heading.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? documents.filter(
          (d) =>
            d.name.toLowerCase().includes(q) ||
            (d.work_item_title ?? "").toLowerCase().includes(q) ||
            (d.document_type ?? "").toLowerCase().includes(q),
        )
      : documents

    const byTask = new Map<
      string,
      { title: string; type: string | null; workItemId: string | null; docs: PortalDocumentWithTask[] }
    >()

    for (const doc of filtered) {
      const key = doc.work_item_id ?? "unassigned"
      if (!byTask.has(key)) {
        byTask.set(key, {
          title: doc.work_item_title ?? "Other documents",
          type: doc.work_item_type,
          workItemId: doc.work_item_id,
          docs: [],
        })
      }
      byTask.get(key)!.docs.push(doc)
    }

    return Array.from(byTask.values())
  }, [documents, query])

  const totalShown = groups.reduce((n, g) => n + g.docs.length, 0)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every file you&apos;ve shared with us and everything we&apos;ve
          prepared for you, organized by project.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents..."
          className="rounded-xl pl-9"
          aria-label="Search documents"
        />
      </div>

      {isLoading && documents.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <WarningBanner
          heading="We couldn't load your documents"
          description="Something went wrong fetching your files. Try refreshing — if this keeps happening, send us a message and we'll take a look."
          action={{ label: "Try again", onClick: () => mutate() }}
        />
      ) : totalShown === 0 && query ? (
        <EmptyState
          icon={Search}
          heading="No documents match your search"
          description="Try a different name or clear the search to see everything on file."
          action={{ label: "Clear search", onClick: () => setQuery("") }}
        />
      ) : totalShown === 0 ? (
        <EmptyState
          icon={FolderOpen}
          heading="No documents yet"
          description="Files you upload and everything we prepare for you will appear here once you upload something to a project."
          action={{ label: "Go to your projects", href: "/client-portal/tax" }}
        />
      ) : (
        groups.map((group) => (
          <Card key={group.workItemId ?? "unassigned"} className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <FileText className="h-4 w-4 shrink-0" style={{ color: DEEP_GREEN }} />
                    <span className="truncate">{group.title}</span>
                  </CardTitle>
                  {group.type && (
                    <p className="mt-0.5 pl-6 text-xs text-gray-400">{group.type}</p>
                  )}
                </div>
                {group.workItemId && (
                  <a
                    href={`/client-portal/tax/${group.workItemId}`}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
                    style={{ color: DEEP_GREEN }}
                  >
                    Open task
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {group.docs.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
