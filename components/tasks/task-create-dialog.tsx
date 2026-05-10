"use client"

import { useState } from "react"
import { Plus, Calendar, Flag, Link2, Building2, User, FileText, Briefcase, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ClientPicker, ClientPickerValue } from "@/components/clients/client-picker"
import { cn } from "@/lib/utils"

interface TaskCreateDialogProps {
  trigger?: React.ReactNode
  onTaskCreated?: (task: any) => void
  defaultAssigneeId?: string
}

export function TaskCreateDialog({ trigger, onTaskCreated, defaultAssigneeId }: TaskCreateDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showLinking, setShowLinking] = useState(false)

  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<string>("medium")
  const [dueDate, setDueDate] = useState("")
  
  // Entity linking state
  const [linkedClient, setLinkedClient] = useState<ClientPickerValue | null>(null)
  const [karbonWorkItemId, setKarbonWorkItemId] = useState("")

  const resetForm = () => {
    setTitle("")
    setDescription("")
    setPriority("medium")
    setDueDate("")
    setLinkedClient(null)
    setKarbonWorkItemId("")
    setShowLinking(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setLoading(true)
    try {
      const body: Record<string, any> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_date: dueDate || null,
        assignee_id: defaultAssigneeId || null,
      }

      // Add entity linking based on selection
      if (linkedClient) {
        if (linkedClient.kind === "organization") {
          body.organization_id = linkedClient.id
        } else {
          body.contact_id = linkedClient.id
        }
      }
      if (karbonWorkItemId.trim()) {
        body.karbon_work_item_id = karbonWorkItemId.trim()
      }

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        throw new Error("Failed to create task")
      }

      const { task } = await res.json()
      onTaskCreated?.(task)
      setOpen(false)
      resetForm()
    } catch (err) {
      console.error("Error creating task:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
            <DialogDescription>
              Add a personal task to your to-do list. Optionally link it to a client or work item.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="title">Task Title</Label>
              <Input
                id="title"
                placeholder="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Add more details..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* Priority and Due Date row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">
                      <span className="flex items-center gap-2">
                        <Flag className="h-3 w-3 text-red-500" />
                        High
                      </span>
                    </SelectItem>
                    <SelectItem value="medium">
                      <span className="flex items-center gap-2">
                        <Flag className="h-3 w-3 text-amber-500" />
                        Medium
                      </span>
                    </SelectItem>
                    <SelectItem value="low">
                      <span className="flex items-center gap-2">
                        <Flag className="h-3 w-3 text-slate-400" />
                        Low
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>

            {/* Entity Linking Section */}
            <Collapsible open={showLinking} onOpenChange={setShowLinking}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                  <Link2 className="h-4 w-4" />
                  {showLinking ? "Hide linking options" : "Link to client or work item"}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                {/* Client Picker */}
                <div className="grid gap-2">
                  <Label className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    Link to Client
                  </Label>
                  <ClientPicker
                    value={linkedClient}
                    onChange={setLinkedClient}
                    placeholder="Search clients..."
                    allowClear
                  />
                </div>

                {/* Karbon Work Item ID */}
                <div className="grid gap-2">
                  <Label htmlFor="workItem" className="flex items-center gap-2 text-sm">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    Karbon Work Item ID (optional)
                  </Label>
                  <Input
                    id="workItem"
                    placeholder="e.g., WI-12345"
                    value={karbonWorkItemId}
                    onChange={(e) => setKarbonWorkItemId(e.target.value)}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || loading}>
              {loading ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
