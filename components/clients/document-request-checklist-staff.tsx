"use client"

/**
 * Staff-side "Requested documents" panel — lives inside a project in the
 * Hub. Lets the team draft, reorder, and track the checklist of
 * documents they've asked (or plan to ask) a client for.
 *
 * Prototype only: there's no `document_requests` table yet, so this
 * manages a local copy of the shared mock set (lib/mock/document-
 * requests.ts) in component state. See that file's header comment.
 */

import { useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FileStack,
  GripVertical,
  LayoutTemplate,
  Plus,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DOCUMENT_REQUEST_TEMPLATES,
  INITIAL_DOCUMENT_REQUESTS,
  STATUS_CHIP_CLASS,
  STATUS_LABEL,
  type DocRequest,
  type DocRequestStatus,
} from "@/lib/mock/document-requests"

const DEEP_GREEN = "#6B745D"

function isFulfilled(status: DocRequestStatus) {
  return status === "received" || status === "accepted"
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable row
// ─────────────────────────────────────────────────────────────────────────────

function SortableRequestRow({
  request,
  onStatusChange,
  onRemove,
}: {
  request: DocRequest
  onStatusChange: (id: string, status: DocRequestStatus) => void
  onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: request.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-start gap-3 border-b px-4 py-3 last:border-b-0",
        isDragging && "relative z-10 bg-card opacity-90 shadow-lg",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="mt-1 shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
        aria-label="Reorder document request"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{request.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[11px] font-normal",
              request.required
                ? "border-[#8E9B79] text-[#4A5240]"
                : "border-border text-muted-foreground",
            )}
          >
            {request.required ? "Required" : "Optional"}
          </Badge>
        </div>
        {request.instruction && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {request.instruction}
          </p>
        )}
        {request.upload && (
          <p className="mt-1 text-xs text-muted-foreground">
            {request.upload.fileName}
            {request.upload.note && (
              <span className="italic"> — &ldquo;{request.upload.note}&rdquo;</span>
            )}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Select
          value={request.status}
          onValueChange={(v) => onStatusChange(request.id, v as DocRequestStatus)}
        >
          <SelectTrigger
            className={cn(
              "h-7 w-[150px] rounded-full border px-2.5 text-xs font-medium [&_svg]:size-3.5",
              STATUS_CHIP_CLASS[request.status],
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABEL) as DocRequestStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(request.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only">Remove request</span>
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Add request dialog
// ─────────────────────────────────────────────────────────────────────────────

function AddRequestDialog({ onAdd }: { onAdd: (item: { name: string; instruction: string | null; required: boolean }) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [instruction, setInstruction] = useState("")
  const [required, setRequired] = useState(true)

  function reset() {
    setName("")
    setInstruction("")
    setRequired(true)
  }

  function handleSubmit() {
    if (!name.trim()) return
    onAdd({ name: name.trim(), instruction: instruction.trim() || null, required })
    reset()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 bg-[#6B745D] text-white hover:bg-[#8E9B79]">
          <Plus className="h-3.5 w-3.5" />
          Add request
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a document</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-name">Document name</Label>
            <Input
              id="doc-name"
              placeholder="e.g. 2024 W-2 — second employer"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-instruction">Instruction to the client</Label>
            <Textarea
              id="doc-instruction"
              placeholder="Optional — anything that helps them find or prepare it."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="doc-required" className="text-sm font-medium">
                Required
              </Label>
              <p className="text-xs text-muted-foreground">
                Required documents block the return from moving forward.
              </p>
            </div>
            <Switch
              id="doc-required"
              checked={required}
              onCheckedChange={setRequired}
              className="data-[state=checked]:bg-[#6B745D]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="bg-[#6B745D] text-white hover:bg-[#8E9B79]"
          >
            Add request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

export function DocumentRequestChecklistStaff({
  clientName,
}: {
  clientName?: string
}) {
  const [requests, setRequests] = useState<DocRequest[]>(INITIAL_DOCUMENT_REQUESTS)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const sorted = [...requests].sort((a, b) => a.sortOrder - b.sortOrder)
  const fulfilledCount = requests.filter((r) => isFulfilled(r.status)).length
  const total = requests.length
  const progressPct = total > 0 ? Math.round((fulfilledCount / total) * 100) : 0

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sorted.findIndex((r) => r.id === active.id)
    const newIndex = sorted.findIndex((r) => r.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(sorted, oldIndex, newIndex)
    setRequests(reordered.map((r, i) => ({ ...r, sortOrder: i })))
  }

  function handleStatusChange(id: string, status: DocRequestStatus) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
  }

  function handleRemove(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id))
  }

  function handleAdd(item: { name: string; instruction: string | null; required: boolean }) {
    setRequests((prev) => [
      ...prev,
      {
        id: `dr-new-${Date.now()}`,
        name: item.name,
        instruction: item.instruction,
        required: item.required,
        status: "not_requested",
        sortOrder: prev.length,
        upload: null,
      },
    ])
  }

  function handleAddTemplate(templateId: string) {
    const template = DOCUMENT_REQUEST_TEMPLATES.find((t) => t.id === templateId)
    if (!template) return
    const existingNames = new Set(requests.map((r) => r.name.toLowerCase()))
    setRequests((prev) => {
      let nextSort = prev.length
      const additions: DocRequest[] = []
      for (const item of template.items) {
        if (existingNames.has(item.name.toLowerCase())) continue
        additions.push({
          id: `dr-tpl-${templateId}-${item.name}-${Date.now()}-${nextSort}`,
          name: item.name,
          instruction: item.instruction,
          required: item.required,
          status: "not_requested",
          sortOrder: nextSort,
          upload: null,
        })
        nextSort += 1
      }
      return [...prev, ...additions]
    })
  }

  return (
    <Card className="border-0 shadow-sm rounded-xl">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileStack className="h-4 w-4" style={{ color: DEEP_GREEN }} />
            Requested documents
          </CardTitle>
          {clientName && (
            <p className="mt-0.5 text-xs text-muted-foreground">{clientName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-[#8E9B79] text-[#4A5240] hover:bg-[#8E9B79]/10 hover:text-[#4A5240]"
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                Add from template
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Preset bundles</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DOCUMENT_REQUEST_TEMPLATES.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  className="flex flex-col items-start gap-0.5 py-2"
                  onClick={() => handleAddTemplate(t.id)}
                >
                  <span className="text-sm font-medium">{t.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.description} · {t.items.length} documents
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <AddRequestDialog onAdd={handleAdd} />
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Progress summary */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Progress
            value={progressPct}
            className="h-1.5 flex-1 bg-[#B5BFA8]/30 [&>div]:bg-[#6B745D]"
          />
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {fulfilledCount} of {total} received
          </span>
        </div>

        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No documents requested yet. Add one, or start from a template.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sorted.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div>
                {sorted.map((request) => (
                  <SortableRequestRow
                    key={request.id}
                    request={request}
                    onStatusChange={handleStatusChange}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  )
}
