"use client"

/**
 * Client-side "requested documents" checklist — friendly upload cards,
 * one per document the firm has asked for on this project.
 *
 * Prototype only, same shared mock set as the staff panel (lib/mock/
 * document-requests.ts), managed as local state here. Critically: a
 * request with status "not_requested" is a staff draft the firm hasn't
 * sent yet, so it's filtered out before it ever reaches this component
 * — the client must never see a request that hasn't been made.
 */

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, FileUp, Paperclip, RotateCcw, UploadCloud } from "lucide-react"
import { format, parseISO } from "date-fns"
import { cn } from "@/lib/utils"
import {
  INITIAL_DOCUMENT_REQUESTS,
  formatFileSize,
  type DocRequest,
  type DocRequestStatus,
} from "@/lib/mock/document-requests"

const DEEP_GREEN = "#6B745D"
const MID_GREEN = "#8E9B79"

function isFulfilled(status: DocRequestStatus) {
  return status === "received" || status === "accepted"
}

// ─────────────────────────────────────────────────────────────────────────────
// One upload card
// ─────────────────────────────────────────────────────────────────────────────

function UploadCard({
  request,
  onUpload,
  onReplace,
}: {
  request: DocRequest
  onUpload: (id: string, file: File, note: string) => void
  onReplace: (id: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [note, setNote] = useState("")

  const done = isFulfilled(request.status) && request.upload

  function handleFile(file: File | null | undefined) {
    if (!file) return
    onUpload(request.id, file, note)
    setNote("")
  }

  if (done && request.upload) {
    const upload = request.upload
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-start gap-3 p-4">
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: "#8E9B791A" }}
          >
            <CheckCircle2 className="h-5 w-5" style={{ color: DEEP_GREEN }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">{request.name}</p>
              {request.required && (
                <Badge
                  variant="outline"
                  className="h-5 border-gray-200 px-1.5 text-[11px] font-normal text-gray-500"
                >
                  Required
                </Badge>
              )}
              {request.status === "accepted" && (
                <Badge
                  className="h-5 border-0 px-1.5 text-[11px] font-normal text-white"
                  style={{ backgroundColor: DEEP_GREEN }}
                >
                  Accepted by your team
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-500">
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="truncate">{upload.fileName}</span>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatFileSize(upload.fileSizeBytes)}</span>
              <span className="shrink-0">·</span>
              <span className="shrink-0">
                {format(parseISO(upload.uploadedAt), "MMM d, yyyy")}
              </span>
            </div>
            {upload.note && (
              <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs italic leading-relaxed text-gray-600">
                &ldquo;{upload.note}&rdquo;
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-xs text-gray-500 hover:text-gray-900"
            onClick={() => onReplace(request.id)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Replace
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">{request.name}</p>
            {request.required && (
              <Badge
                variant="outline"
                className="h-5 border-gray-200 px-1.5 text-[11px] font-normal text-gray-500"
              >
                Required
              </Badge>
            )}
          </div>
          {request.instruction && (
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              {request.instruction}
            </p>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            handleFile(e.dataTransfer.files?.[0])
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            dragActive ? "border-current bg-[#8E9B791A]" : "border-gray-200 bg-gray-50/60",
          )}
          style={dragActive ? { color: DEEP_GREEN } : undefined}
        >
          <UploadCloud
            className="h-6 w-6"
            style={{ color: dragActive ? DEEP_GREEN : "#9CA3AF" }}
          />
          <p className="text-xs text-gray-500">
            Drag and drop a file here, or
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-xl bg-transparent"
            style={{ borderColor: MID_GREEN, color: DEEP_GREEN }}
            onClick={() => inputRef.current?.click()}
          >
            <FileUp className="h-3.5 w-3.5" />
            Choose file
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
            aria-label={`Upload ${request.name}`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`note-${request.id}`}
            className="text-xs font-medium text-gray-600"
          >
            Add a note about this document
          </label>
          <Textarea
            id={`note-${request.id}`}
            placeholder="Optional — anything your preparer should know about this file."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="resize-none text-sm"
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main checklist
// ─────────────────────────────────────────────────────────────────────────────

export function DocumentRequestChecklistClient() {
  // Only ever seed with requests the firm has actually sent — a client
  // should never render (or even briefly flash) a "not_requested" draft.
  const [requests, setRequests] = useState<DocRequest[]>(
    INITIAL_DOCUMENT_REQUESTS.filter((r) => r.status !== "not_requested"),
  )

  const total = requests.length
  const sentCount = requests.filter((r) => isFulfilled(r.status)).length
  const progressPct = total > 0 ? Math.round((sentCount / total) * 100) : 0

  const stillNeeded = [...requests]
    .filter((r) => !isFulfilled(r.status))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const received = [...requests]
    .filter((r) => isFulfilled(r.status))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  function handleUpload(id: string, file: File, note: string) {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "received",
              upload: {
                fileName: file.name,
                fileSizeBytes: file.size,
                uploadedAt: new Date().toISOString(),
                note: note.trim() || null,
              },
            }
          : r,
      ),
    )
  }

  function handleReplace(id: string) {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "waiting", upload: null } : r)),
    )
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col gap-5 p-4 sm:p-5">
        {/* Progress bar */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Requested documents</p>
            <span className="text-xs font-medium text-gray-500">
              You&apos;ve sent {sentCount} of {total} documents
            </span>
          </div>
          <Progress
            value={progressPct}
            className="h-2 bg-gray-100 [&>div]:bg-[var(--doc-progress)]"
            style={{ "--doc-progress": DEEP_GREEN } as React.CSSProperties}
          />
        </div>

        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <FileUp className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">
              Nothing has been requested for this project yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {stillNeeded.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Still needed ({stillNeeded.length})
                </p>
                <div className="flex flex-col gap-2.5">
                  {stillNeeded.map((r) => (
                    <UploadCard
                      key={r.id}
                      request={r}
                      onUpload={handleUpload}
                      onReplace={handleReplace}
                    />
                  ))}
                </div>
              </div>
            )}

            {received.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Received ({received.length})
                </p>
                <div className="flex flex-col gap-2.5">
                  {received.map((r) => (
                    <UploadCard
                      key={r.id}
                      request={r}
                      onUpload={handleUpload}
                      onReplace={handleReplace}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
