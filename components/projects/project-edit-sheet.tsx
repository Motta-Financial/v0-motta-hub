"use client"

/**
 * Edit sheet for Hub projects.
 * Slide-out panel for editing project details:
 * - Name, Kind, Status
 * - Description, Owner
 * - Dates, Work Patterns
 */

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface TeamMember {
  id: string
  full_name: string | null
}

interface Project {
  id: string
  name?: string | null
  kind?: string | null
  status?: string | null
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  owner_team_member_id?: string | null
  owner?: { full_name?: string | null } | null
  work_type_pattern?: string | null
  work_template_pattern?: string | null
  project_type_key?: string | null
  project_template_key?: string | null
}

interface Props {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Project) => void
}

// Radix Select forbids empty-string item values; use a sentinel for "no selection"
const NONE_VALUE = "__none__"

const PROJECT_KINDS = [
  { value: "tax", label: "Tax" },
  { value: "accounting", label: "Accounting" },
  { value: "advisory", label: "Advisory" },
  { value: "bookkeeping", label: "Bookkeeping" },
  { value: "payroll", label: "Payroll" },
  { value: "other", label: "Other" },
]

const PROJECT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

export function ProjectEditSheet({
  project,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])

  // Form state
  const [name, setName] = useState("")
  const [kind, setKind] = useState("")
  const [status, setStatus] = useState("")
  const [description, setDescription] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [ownerTeamMemberId, setOwnerTeamMemberId] = useState("")
  const [workTypePattern, setWorkTypePattern] = useState("")
  const [workTemplatePattern, setWorkTemplatePattern] = useState("")

  // Fetch team members for owner picker
  useEffect(() => {
    async function loadTeamMembers() {
      try {
        const res = await fetch("/api/team-members")
        if (res.ok) {
          const data = await res.json()
          setTeamMembers(data.teamMembers || [])
        }
      } catch (err) {
        console.error("Failed to load team members:", err)
      }
    }
    if (open) loadTeamMembers()
  }, [open])

  // Load project data when opened
  useEffect(() => {
    if (project && open) {
      setName(project.name || "")
      setKind(project.kind || "")
      setStatus(project.status || "active")
      setDescription(project.description || "")
      setStartDate(project.start_date?.split("T")[0] || "")
      setEndDate(project.end_date?.split("T")[0] || "")
      setOwnerTeamMemberId(project.owner_team_member_id || "")
      setWorkTypePattern(project.work_type_pattern || "")
      setWorkTemplatePattern(project.work_template_pattern || "")
    }
  }, [project, open])

  async function handleSave() {
    if (!project) return

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: name || null,
        kind: kind || null,
        status: status || null,
        description: description || null,
        start_date: startDate || null,
        end_date: endDate || null,
        owner_team_member_id: ownerTeamMemberId || null,
        work_type_pattern: workTypePattern || null,
        work_template_pattern: workTemplatePattern || null,
      }

      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save")
      }

      const { project: updated } = await res.json()
      toast.success("Project updated successfully")
      onSaved(updated || project)
      onOpenChange(false)
    } catch (err) {
      console.error("[ProjectEditSheet] save error:", err)
      toast.error(
        err instanceof Error ? err.message : "Failed to save project"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md w-full flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit Project</SheetTitle>
          <SheetDescription>
            Update project information. Changes are saved to the audit trail.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Project Information
              </h3>

              <div className="space-y-2">
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., 2025 Tax Return"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="kind">Kind</Label>
                  <Select value={kind} onValueChange={setKind}>
                    <SelectTrigger id="kind">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of this project..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner">Owner</Label>
                <Select
                  value={ownerTeamMemberId || NONE_VALUE}
                  onValueChange={(v) =>
                    setOwnerTeamMemberId(v === NONE_VALUE ? "" : v)
                  }
                >
                  <SelectTrigger id="owner">
                    <SelectValue placeholder="Select owner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>No owner</SelectItem>
                    {teamMembers.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.full_name || tm.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Dates */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">Dates</h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Work Item Matching */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Work Item Matching
              </h3>
              <p className="text-xs text-muted-foreground">
                These patterns filter which Karbon work items appear under this
                project.
              </p>

              <div className="space-y-2">
                <Label htmlFor="workTypePattern">Work Type Pattern</Label>
                <Input
                  id="workTypePattern"
                  value={workTypePattern}
                  onChange={(e) => setWorkTypePattern(e.target.value)}
                  placeholder="e.g., 1040, bookkeeping"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="workTemplatePattern">
                  Work Template Pattern
                </Label>
                <Input
                  id="workTemplatePattern"
                  value={workTemplatePattern}
                  onChange={(e) => setWorkTemplatePattern(e.target.value)}
                  placeholder="e.g., Monthly, Quarterly"
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
