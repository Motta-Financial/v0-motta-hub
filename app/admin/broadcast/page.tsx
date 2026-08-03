"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { useUser, useDisplayName } from "@/hooks/use-user"
import { Megaphone, Send, Loader2, Eye, Inbox, Mail, Paperclip, X } from "lucide-react"
import { buildAnnouncementHtml } from "@/lib/email-preview"
import { cn } from "@/lib/utils"

// 25 MB ceiling — matches debriefs/prospects
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

interface QueuedAttachment {
  tempId: string
  file: File
  status: "queued" | "uploading" | "uploaded" | "error"
  error?: string
  url?: string
  pathname?: string
  name?: string
  content_type?: string
  size_bytes?: number
  uploaded_at?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function BroadcastPage() {
  const { teamMember } = useUser()
  const senderName = useDisplayName()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [topic, setTopic] = useState("")
  const [announcement, setAnnouncement] = useState("")
  const [actionItems, setActionItems] = useState("")
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([])
  const [force, setForce] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [sending, setSending] = useState(false)

  // Attachment handlers — same pattern as debrief-form.tsx
  const uploadAttachment = useCallback(async (tempId: string, file: File) => {
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/email/broadcast/attachments", {
        method: "POST",
        body: form,
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || `Upload failed (${res.status})`)
      }
      const a = json.attachment as {
        url: string
        pathname: string
        name: string
        content_type: string
        size_bytes: number
        uploaded_at: string
      }
      setAttachments((prev) =>
        prev.map((row) =>
          row.tempId === tempId
            ? {
                ...row,
                status: "uploaded",
                url: a.url,
                pathname: a.pathname,
                name: a.name,
                content_type: a.content_type,
                size_bytes: a.size_bytes,
                uploaded_at: a.uploaded_at,
              }
            : row,
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed"
      setAttachments((prev) =>
        prev.map((row) =>
          row.tempId === tempId ? { ...row, status: "error", error: message } : row,
        ),
      )
    }
  }, [])

  const onPickFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      const incoming: QueuedAttachment[] = []
      for (const f of Array.from(files)) {
        if (f.size > MAX_ATTACHMENT_BYTES) {
          incoming.push({
            tempId: crypto.randomUUID(),
            file: f,
            status: "error",
            error: `Larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`,
          })
          continue
        }
        incoming.push({
          tempId: crypto.randomUUID(),
          file: f,
          status: "uploading",
        })
      }
      setAttachments((prev) => [...prev, ...incoming])
      for (const row of incoming) {
        if (row.status === "uploading") {
          void uploadAttachment(row.tempId, row.file)
        }
      }
    },
    [uploadAttachment],
  )

  const removeAttachment = useCallback((tempId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.tempId === tempId)
      if (target?.status === "uploaded" && target.url) {
        const qs = new URLSearchParams({ url: target.url })
        void fetch(`/api/email/broadcast/attachments?${qs.toString()}`, {
          method: "DELETE",
        }).catch(() => {})
      }
      return prev.filter((a) => a.tempId !== tempId)
    })
  }, [])

  // Build attachments array for preview and submit
  const uploadedAttachments = attachments
    .filter((a) => a.status === "uploaded" && a.url && a.name)
    .map((a) => ({ url: a.url!, name: a.name!, size_bytes: a.size_bytes }))

  const previewHtml = useMemo(
    () =>
      buildAnnouncementHtml({
        topic: topic || "(your topic)",
        announcement,
        actionItems,
        attachments: uploadedAttachments,
        fromName: senderName || "ALFRED Ai",
      }),
    [topic, announcement, actionItems, uploadedAttachments, senderName],
  )

  const uploadInProgress = attachments.some((a) => a.status === "uploading")

  const handleSend = async () => {
    if (!topic.trim() || !announcement.trim()) {
      toast({
        title: "Missing fields",
        description: "Topic and Announcement are required.",
        variant: "destructive",
      })
      return
    }

    setSending(true)
    try {
      const res = await fetch("/api/email/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          announcement: announcement.trim(),
          actionItems: actionItems.trim() || undefined,
          attachments: uploadedAttachments,
          createdById: teamMember?.id,
          createdByName: senderName || undefined,
          force,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Send failed")

      toast({
        title: "Announcement published",
        description: `Posted to everyone's triage and emailed ${json.sent} of ${json.attempted} teammates${
          json.skipped ? ` (${json.skipped} opted out)` : ""
        }.`,
      })
      setTopic("")
      setAnnouncement("")
      setActionItems("")
      setAttachments([])
    } catch (err) {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Megaphone className="h-6 w-6 text-[#C97B3F]" />
              Firm Announcement
            </h1>
            <p className="mt-1 text-sm text-gray-500 max-w-2xl">
              Post a firm-wide announcement. It lands in everyone&apos;s Triage feed and is emailed
              to the team from ALFRED with the subject{" "}
              <span className="font-medium text-gray-700">&ldquo;BREAKING NEWS: &lt;Topic&gt;&rdquo;</span>.
              Anyone on the team can post.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Compose */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compose</CardTitle>
                <CardDescription>Line breaks are preserved in both the email and triage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Input
                    id="topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Office closed Friday for the holiday"
                  />
                  <p className="text-xs text-gray-500">
                    Becomes the email subject: <span className="font-medium">BREAKING NEWS: {topic || "…"}</span>
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="announcement">Announcement</Label>
                  <Textarea
                    id="announcement"
                    value={announcement}
                    onChange={(e) => setAnnouncement(e.target.value)}
                    rows={8}
                    placeholder="Write the announcement here…"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="actionItems">Action Items (if any)</Label>
                  <Textarea
                    id="actionItems"
                    value={actionItems}
                    onChange={(e) => setActionItems(e.target.value)}
                    rows={4}
                    placeholder="Optional — anything the team needs to do."
                  />
                </div>

                {/* Attachments */}
                <div className="space-y-2">
                  <Label>Attachments</Label>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      onPickFiles(e.dataTransfer.files)
                    }}
                    className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50"
                  >
                    <Paperclip className="h-5 w-5" />
                    <p>
                      <span className="font-medium text-foreground">Click to upload</span> or drag &amp; drop
                    </p>
                    <p className="text-xs">PNG, JPG, PDF, etc. — up to 25 MB each</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      onPickFiles(e.target.files)
                      e.target.value = ""
                    }}
                  />
                  {attachments.length > 0 && (
                    <ul className="space-y-2 mt-2">
                      {attachments.map((a) => (
                        <li
                          key={a.tempId}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm",
                            a.status === "error" && "border-destructive/40 bg-destructive/5",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {a.status === "uploading" ? (
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                            ) : a.status === "error" ? (
                              <X className="h-4 w-4 shrink-0 text-destructive" />
                            ) : (
                              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-foreground">{a.file.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatBytes(a.file.size)}
                                {a.status === "uploading" ? " · Uploading…" : null}
                                {a.status === "uploaded" ? " · Ready" : null}
                                {a.status === "error" && a.error ? ` · ${a.error}` : null}
                              </div>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeAttachment(a.tempId)}
                            aria-label="Remove attachment"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Switch id="force" checked={force} onCheckedChange={setForce} />
                  <Label htmlFor="force" className="cursor-pointer">
                    Override email opt-outs (use sparingly)
                  </Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Inbox className="h-4 w-4 text-[#6B745D]" />
                    Everyone&apos;s Triage
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-[#6B745D]" />
                    All active team members
                  </span>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPreview((v) => !v)}
                className="lg:hidden"
              >
                <Eye className="mr-2 h-4 w-4" />
                {showPreview ? "Hide preview" : "Show preview"}
              </Button>
              <Button
                onClick={handleSend}
                disabled={sending || uploadInProgress}
                className="bg-[#C97B3F] hover:bg-[#b06a33] text-white ml-auto"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Publishing…
                  </>
                ) : uploadInProgress ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Publish announcement
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Preview */}
          <div className={showPreview ? "block" : "hidden lg:block"}>
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[#6B745D]" />
                  Email Preview
                </CardTitle>
                <CardDescription>Approximation of what recipients will see.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden bg-[#f5f5f5]">
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className="w-full h-[600px] border-0 bg-white"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
