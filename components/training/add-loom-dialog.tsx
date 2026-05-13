"use client"

import { useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { extractLoomVideoId } from "@/lib/loom"
import type { TrainingCategory } from "./types"

/**
 * Two-tab dialog for adding videos:
 *
 *  - "Single video": one URL with full metadata (category, department,
 *    description, tags). The default tab because most adds are one-offs.
 *
 *  - "Bulk paste": textarea of share URLs, one per line or comma/space
 *    separated. All videos get the same category + department.
 *    Closest thing we have to "auto-sync a Loom folder" without Loom
 *    Enterprise API access — a teammate can highlight a folder in
 *    Loom, copy the URLs out, and paste them all at once.
 *
 * Both paths call the same enrichment pipeline server-side (Loom
 * oEmbed) so titles, thumbnails, and durations are auto-populated.
 */
interface AddLoomDialogProps {
  categories: TrainingCategory[]
  onAdded: () => void
}

export function AddLoomDialog({ categories, onAdded }: AddLoomDialogProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"single" | "bulk">("single")

  // Single-video state
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [categoryId, setCategoryId] = useState<string>("__none__")
  const [department, setDepartment] = useState<string>("__none__")
  const [tagsText, setTagsText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Bulk state
  const [bulkText, setBulkText] = useState("")
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("__none__")
  const [bulkDepartment, setBulkDepartment] = useState<string>("__none__")

  // Department list mirrors the firm's operational taxonomy from the
  // sidebar nav (Tax, Accounting, Special Teams) plus a few cross-cutting
  // buckets. Stored as a free-text column so adding new ones later is
  // a one-line tweak.
  const departmentOptions = [
    "Tax",
    "Accounting",
    "Sales",
    "Operations",
    "Onboarding",
    "Talent",
    "Engineering",
  ]

  /** Reset everything before close so the next open is clean. */
  const reset = () => {
    setUrl("")
    setTitle("")
    setDescription("")
    setCategoryId("__none__")
    setDepartment("__none__")
    setTagsText("")
    setBulkText("")
    setBulkCategoryId("__none__")
    setBulkDepartment("__none__")
    setMode("single")
  }

  const submitSingle = async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      toast.error("Paste a Loom URL first")
      return
    }
    if (!extractLoomVideoId(trimmed)) {
      toast.error("That doesn't look like a Loom URL")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/training/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loom_url: trimmed,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          category_id: categoryId === "__none__" ? null : categoryId,
          department: department === "__none__" ? null : department,
          // Tags: comma-separated text → trimmed array, empties dropped.
          tags: tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || "Couldn't save video")
        return
      }
      toast.success("Video added to library")
      reset()
      setOpen(false)
      onAdded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  const submitBulk = async () => {
    const trimmed = bulkText.trim()
    if (!trimmed) {
      toast.error("Paste at least one Loom URL")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/training/videos/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: trimmed,
          category_id: bulkCategoryId === "__none__" ? null : bulkCategoryId,
          department: bulkDepartment === "__none__" ? null : bulkDepartment,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        summary?: {
          added: number
          duplicate: number
          invalid: number
          error: number
        }
      }
      if (!res.ok || !json.summary) {
        toast.error(json.error || "Bulk add failed")
        return
      }
      const { added, duplicate, invalid, error } = json.summary
      // Build a single human-readable message so the teammate sees the
      // outcome at a glance instead of having to scan a list.
      const parts: string[] = []
      if (added) parts.push(`${added} added`)
      if (duplicate) parts.push(`${duplicate} already in library`)
      if (invalid) parts.push(`${invalid} invalid`)
      if (error) parts.push(`${error} errored`)
      const msg = parts.length > 0 ? parts.join(" · ") : "Nothing to add"
      if (added > 0) {
        toast.success(msg)
        reset()
        setOpen(false)
        onAdded()
      } else {
        // No new additions — keep the dialog open so the teammate can fix
        // their input without losing the textarea contents.
        toast.warning(msg)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Loom
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add training video</DialogTitle>
          <DialogDescription>
            Paste a Loom share URL — we&apos;ll pull the title, thumbnail, and
            duration automatically.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as "single" | "bulk")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">Single video</TabsTrigger>
            <TabsTrigger value="bulk">Bulk paste</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="loom-url">Loom share URL</Label>
              <Input
                id="loom-url"
                placeholder="https://www.loom.com/share/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="loom-category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="loom-category">
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Uncategorized</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loom-department">Department</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger id="loom-department">
                    <SelectValue placeholder="Pick a department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {departmentOptions.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loom-title">
                Title{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (optional — auto-filled from Loom)
                </span>
              </Label>
              <Input
                id="loom-title"
                placeholder="Leave blank to use Loom title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loom-description">
                Description{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="loom-description"
                placeholder="Add context for the team — what's in this video, who's it for?"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loom-tags">
                Tags{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (comma separated, optional)
                </span>
              </Label>
              <Input
                id="loom-tags"
                placeholder="onboarding, karbon, weekly-review"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
              />
            </div>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-urls">Loom share URLs</Label>
              <Textarea
                id="bulk-urls"
                placeholder={
                  "Paste one Loom URL per line.\nhttps://www.loom.com/share/...\nhttps://www.loom.com/share/...\nhttps://www.loom.com/share/..."
                }
                rows={8}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="font-mono text-xs"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Up to 50 at a time. Duplicates are skipped automatically.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-category">Category (applied to all)</Label>
                <Select
                  value={bulkCategoryId}
                  onValueChange={setBulkCategoryId}
                >
                  <SelectTrigger id="bulk-category">
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Uncategorized</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bulk-department">Department (applied to all)</Label>
                <Select
                  value={bulkDepartment}
                  onValueChange={setBulkDepartment}
                >
                  <SelectTrigger id="bulk-department">
                    <SelectValue placeholder="Pick a department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {departmentOptions.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={mode === "single" ? submitSingle : submitBulk}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : mode === "single" ? (
              "Add video"
            ) : (
              "Add all"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
