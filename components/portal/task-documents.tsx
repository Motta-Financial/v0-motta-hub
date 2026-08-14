"use client"

/**
 * Per-task document list + client upload.
 *
 * Files are stored on the shared `documents` table keyed by
 * `work_item_id`, so anything a client uploads here is immediately
 * visible against the same work item on the internal hub side.
 */

import useSWR from "swr"
import { useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText, Upload, Download } from "lucide-react"
import { format, parseISO } from "date-fns"

const DEEP_GREEN = "#6B745D"
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export interface PortalDocument {
  id: string
  name: string
  file_type: string | null
  file_size_bytes: number | null
  document_type: string | null
  status: string | null
  uploaded_at: string | null
  uploaded_by_role: "client" | "team" | null
  created_at?: string | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ""
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function DocumentRow({ doc }: { doc: PortalDocument }) {
  const meta = [
    doc.file_type?.toUpperCase(),
    formatBytes(doc.file_size_bytes),
    doc.uploaded_at ? format(parseISO(doc.uploaded_at), "MMM d, yyyy") : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: "#8E9B791A" }}
        >
          <FileText className="h-4 w-4" style={{ color: DEEP_GREEN }} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">{doc.name}</p>
          <p className="text-xs text-gray-400">
            {meta}
            {doc.uploaded_by_role === "client" && " · Uploaded by you"}
          </p>
        </div>
      </div>
      <a
        href={`/api/client-portal/documents/${doc.id}/download`}
        className="flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-gray-100"
        style={{ color: DEEP_GREEN }}
      >
        <Download className="h-3.5 w-3.5" />
        <span className="sr-only sm:not-sr-only">Download</span>
      </a>
    </div>
  )
}

export function TaskDocuments({
  workItemId,
  previewDocuments,
}: {
  workItemId: string
  previewDocuments?: PortalDocument[]
}) {
  const endpoint = `/api/client-portal/work-items/${workItemId}/documents`
  const { data, mutate, isLoading } = useSWR<{ documents: PortalDocument[] }>(
    endpoint,
    fetcher,
  )

  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const documents = data?.documents ?? previewDocuments ?? []

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is too large — the limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
      return
    }

    setUploading(true)
    setError(null)

    try {
      const body = new FormData()
      body.append("file", file)

      const res = await fetch(endpoint, { method: "POST", body })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? "Upload failed. Please try again.")
      }
      await mutate()
    } catch (err: any) {
      setError(err?.message ?? "Upload failed. Please try again.")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <Card className="shadow-sm border-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4" style={{ color: DEEP_GREEN }} />
          Documents
          {documents.length > 0 && (
            <span className="text-xs font-normal text-gray-400">
              ({documents.length})
            </span>
          )}
        </CardTitle>

        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="gap-1.5 rounded-xl text-white"
          style={{ backgroundColor: DEEP_GREEN }}
        >
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "Uploading..." : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
          aria-label="Upload a document to this task"
        />
      </CardHeader>

      <CardContent className="space-y-2">
        {error && (
          <p className="text-xs" style={{ color: "#B45309" }} role="alert">
            {error}
          </p>
        )}

        {isLoading && documents.length === 0 ? (
          Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <FileText className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">
              No documents on this task yet.
            </p>
            <p className="text-xs text-gray-400">
              Upload anything your advisor has asked for.
            </p>
          </div>
        ) : (
          documents.map((doc) => <DocumentRow key={doc.id} doc={doc} />)
        )}
      </CardContent>
    </Card>
  )
}
