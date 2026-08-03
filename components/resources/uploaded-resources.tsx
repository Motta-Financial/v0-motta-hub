"use client"

import { useRef, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Upload,
  FileText,
  MoreVertical,
  RefreshCw,
  Trash2,
  Download,
  Sparkles,
  Loader2,
  AlertTriangle,
  Tag,
} from "lucide-react"

export type ResourceCategory =
  | "client-resources"
  | "templates"
  | "team-instructions"
  | "sop"
  | "other"

type Audience = "team" | "client"

export interface ResourceDocument {
  id: string
  title: string
  description: string | null
  category: ResourceCategory
  audience: Audience
  file_url: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  version: number
  status: "processing" | "ready" | "failed"
  ai_summary: string | null
  ai_keywords: string[] | null
  service_line_codes: string[] | null
  ingest_error: string | null
  uploaded_by_name: string | null
  created_at: string
  updated_at: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const AUDIENCE_LABEL: Record<Audience, string> = {
  team: "Internal",
  client: "Shareable",
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UploadedResources({
  category,
  defaultAudience = "team",
  title = "Uploaded files",
  subtitle = "Documents your team has uploaded. ALFRED reads each one and tags it automatically.",
}: {
  category: ResourceCategory
  defaultAudience?: Audience
  title?: string
  subtitle?: string
}) {
  const key = `/api/resources/documents?category=${category}`
  const { data, isLoading, mutate } = useSWR<{ documents: ResourceDocument[] }>(
    key,
    fetcher,
  )
  const documents = data?.documents ?? []

  const [uploadOpen, setUploadOpen] = useState(false)
  const [replaceTarget, setReplaceTarget] = useState<ResourceDocument | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ResourceDocument | null>(null)

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{subtitle}</p>
        </div>
        <Button
          size="sm"
          onClick={() => setUploadOpen(true)}
          className="shrink-0 gap-1.5 bg-stone-900 text-stone-50 hover:bg-stone-800"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <Card className="border-dashed border-stone-300 bg-stone-50 p-6 text-center">
          <FileText className="mx-auto h-6 w-6 text-stone-300" />
          <p className="mt-2 text-sm text-stone-500">
            No files uploaded yet. Click <span className="font-medium">Upload</span> to add one.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map((doc) => (
            <ResourceCard
              key={doc.id}
              doc={doc}
              onReplace={() => setReplaceTarget(doc)}
              onDelete={() => setDeleteTarget(doc)}
            />
          ))}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        category={category}
        defaultAudience={defaultAudience}
        onDone={() => mutate()}
      />

      <ReplaceDialog
        doc={replaceTarget}
        onOpenChange={(open) => !open && setReplaceTarget(null)}
        onDone={() => mutate()}
      />

      <DeleteDialog
        doc={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDone={() => mutate()}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: ResourceDocument["status"] }) {
  if (status === "processing") {
    return (
      <Badge variant="secondary" className="gap-1 bg-amber-50 text-[11px] text-amber-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        ALFRED reading…
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge variant="secondary" className="gap-1 bg-red-50 text-[11px] text-red-700">
        <AlertTriangle className="h-3 w-3" />
        Read failed
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1 bg-emerald-50 text-[11px] text-emerald-700">
      <Sparkles className="h-3 w-3" />
      Tagged
    </Badge>
  )
}

function ResourceCard({
  doc,
  onReplace,
  onDelete,
}: {
  doc: ResourceDocument
  onReplace: () => void
  onDelete: () => void
}) {
  return (
    <Card className="flex flex-col border-stone-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-stone-900">{doc.title}</h4>
            <p className="truncate text-[11px] text-stone-400">
              {doc.file_name}
              {doc.file_size_bytes ? ` · ${formatBytes(doc.file_size_bytes)}` : ""}
              {doc.version > 1 ? ` · v${doc.version}` : ""}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-stone-400">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Resource actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={doc.file_url} target="_blank" rel="noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReplace}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Replace file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-600">
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {doc.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-stone-600">
          {doc.description}
        </p>
      )}

      {doc.status === "ready" && doc.ai_summary && (
        <div className="mt-2 rounded-md bg-stone-50 px-3 py-2">
          <p className="line-clamp-3 text-xs leading-relaxed text-stone-600">{doc.ai_summary}</p>
        </div>
      )}

      {doc.status === "failed" && doc.ingest_error && (
        <p className="mt-2 text-xs leading-relaxed text-red-600">{doc.ingest_error}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        <StatusBadge status={doc.status} />
        <Badge variant="secondary" className="bg-stone-100 text-[11px] text-stone-600">
          {AUDIENCE_LABEL[doc.audience]}
        </Badge>
        {(doc.service_line_codes ?? []).map((code) => (
          <Badge
            key={code}
            variant="secondary"
            className="gap-1 bg-amber-50 text-[11px] font-medium text-amber-700"
          >
            <Tag className="h-2.5 w-2.5" />
            {code}
          </Badge>
        ))}
      </div>
    </Card>
  )
}

function UploadDialog({
  open,
  onOpenChange,
  category,
  defaultAudience,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: ResourceCategory
  defaultAudience: Audience
  onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [audience, setAudience] = useState<Audience>(defaultAudience)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setFile(null)
    setTitle("")
    setDescription("")
    setAudience(defaultAudience)
    if (fileRef.current) fileRef.current.value = ""
  }

  async function submit() {
    if (!file) {
      toast.error("Choose a file to upload.")
      return
    }
    if (!title.trim()) {
      toast.error("Give the resource a title.")
      return
    }
    setSubmitting(true)
    try {
      // Resolve the current teammate for provenance (best-effort).
      let uploadedById: string | null = null
      try {
        const who = await fetch("/api/alfred/whoami").then((r) => (r.ok ? r.json() : null))
        uploadedById = who?.teamMemberId ?? null
      } catch {
        // non-fatal
      }

      const fd = new FormData()
      fd.append("file", file)
      fd.append("title", title.trim())
      fd.append("description", description.trim())
      fd.append("category", category)
      fd.append("audience", audience)
      if (uploadedById) fd.append("uploaded_by_id", uploadedById)

      const res = await fetch("/api/resources/documents", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Upload failed")

      toast.success("Uploaded. ALFRED has read and tagged it.")
      reset()
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!submitting) {
          if (!o) reset()
          onOpenChange(o)
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a resource</DialogTitle>
          <DialogDescription>
            ALFRED will read the file, write a short summary, and auto-tag it to the relevant
            service lines. PDFs, docs, and images up to 25 MB.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resource-file">File</Label>
            <Input
              id="resource-file"
              ref={fileRef}
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                if (f && !title.trim()) {
                  setTitle(f.name.replace(/\.[^.]+$/, ""))
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resource-title">Title</Label>
            <Input
              id="resource-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2025 Tax Organizer Checklist"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resource-description">Description (optional)</Label>
            <Textarea
              id="resource-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this, and when should the team use it?"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Audience</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Internal — team only</SelectItem>
                <SelectItem value="client">Shareable — okay to send to clients</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-1.5">
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReplaceDialog({
  doc,
  onOpenChange,
  onDone,
}: {
  doc: ResourceDocument | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit() {
    if (!doc) return
    if (!file) {
      toast.error("Choose the replacement file.")
      return
    }
    setSubmitting(true)
    try {
      let uploadedById: string | null = null
      try {
        const who = await fetch("/api/alfred/whoami").then((r) => (r.ok ? r.json() : null))
        uploadedById = who?.teamMemberId ?? null
      } catch {
        // non-fatal
      }

      const fd = new FormData()
      fd.append("file", file)
      if (uploadedById) fd.append("uploaded_by_id", uploadedById)

      const res = await fetch(`/api/resources/documents/${doc.id}`, {
        method: "PATCH",
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Replace failed")

      toast.success("Replaced. ALFRED re-read the new version.")
      setFile(null)
      if (fileRef.current) fileRef.current.value = ""
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error(err?.message ?? "Replace failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={!!doc}
      onOpenChange={(o) => {
        if (!submitting) {
          if (!o) {
            setFile(null)
            if (fileRef.current) fileRef.current.value = ""
          }
          onOpenChange(o)
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Replace file</DialogTitle>
          <DialogDescription>
            {doc
              ? `Upload a new version of "${doc.title}". The old version is kept in history (this becomes v${doc.version + 1}), and ALFRED re-reads it.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="replace-file">New file</Label>
          <Input
            id="replace-file"
            ref={fileRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-1.5">
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Replacing…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Replace
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({
  doc,
  onOpenChange,
  onDone,
}: {
  doc: ResourceDocument | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  async function confirm() {
    if (!doc) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/resources/documents/${doc.id}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Remove failed")
      toast.success("Resource removed.")
      onOpenChange(false)
      onDone()
    } catch (err: any) {
      toast.error(err?.message ?? "Remove failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={!!doc} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this resource?</AlertDialogTitle>
          <AlertDialogDescription>
            {doc
              ? `"${doc.title}" will be archived and hidden from the team and ALFRED. This can be restored by an admin.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              confirm()
            }}
            disabled={submitting}
            className="bg-red-600 hover:bg-red-700"
          >
            {submitting ? "Removing…" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
