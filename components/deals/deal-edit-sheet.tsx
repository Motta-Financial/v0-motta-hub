"use client"

/**
 * Edit sheet for Hub deals.
 * Slide-out panel for editing deal details:
 * - Title, Stage, Status
 * - Owner, Estimated Value, Source
 * - Notes
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

interface Deal {
  id: string
  title?: string | null
  stage?: string | null
  status?: string | null
  owner_team_member_id?: string | null
  owner_name?: string | null
  estimated_value?: number | null
  source?: string | null
  notes?: string | null
  contact_name?: string | null
  organization_name?: string | null
}

interface Props {
  deal: Deal | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Deal) => void
}

const DEAL_STAGES = [
  { value: "new", label: "New" },
  { value: "meeting_scheduled", label: "Meeting Scheduled" },
  { value: "met", label: "Met" },
  { value: "debriefed", label: "Debriefed" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
]

const DEAL_SOURCES = [
  "referral",
  "website",
  "calendly",
  "intake_form",
  "cold_outreach",
  "conference",
  "existing_client",
  "other",
]

export function DealEditSheet({ deal, open, onOpenChange, onSaved }: Props) {
  const [saving, setSaving] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])

  // Form state
  const [title, setTitle] = useState("")
  const [stage, setStage] = useState("")
  const [status, setStatus] = useState("")
  const [ownerTeamMemberId, setOwnerTeamMemberId] = useState("")
  const [estimatedValue, setEstimatedValue] = useState("")
  const [source, setSource] = useState("")
  const [notes, setNotes] = useState("")

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

  // Load deal data when opened
  useEffect(() => {
    if (deal && open) {
      setTitle(deal.title || "")
      setStage(deal.stage || "")
      setStatus(deal.status || "open")
      setOwnerTeamMemberId(deal.owner_team_member_id || "")
      setEstimatedValue(
        deal.estimated_value != null ? deal.estimated_value.toString() : ""
      )
      setSource(deal.source || "")
      setNotes(deal.notes || "")
    }
  }, [deal, open])

  async function handleSave() {
    if (!deal) return

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: title || null,
        stage: stage || null,
        owner_team_member_id: ownerTeamMemberId || null,
        estimated_value: estimatedValue
          ? parseFloat(estimatedValue)
          : null,
        source: source || null,
        notes: notes || null,
      }

      // Only include status if changing to closed (won/lost stages handle this)
      if (status && status !== (deal.status || "open")) {
        payload.status = status
      }

      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save")
      }

      const { deal: updated } = await res.json()
      toast.success("Deal updated successfully")
      onSaved(updated || deal)
      onOpenChange(false)
    } catch (err) {
      console.error("[DealEditSheet] save error:", err)
      toast.error(err instanceof Error ? err.message : "Failed to save deal")
    } finally {
      setSaving(false)
    }
  }

  const clientDisplay =
    deal?.contact_name || deal?.organization_name || "No client linked"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md w-full flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit Deal</SheetTitle>
          <SheetDescription>
            Update deal information. Changes are saved to the audit trail.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-6">
            {/* Client (read-only display) */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">Client</Label>
              <p className="text-sm font-medium">{clientDisplay}</p>
            </div>

            <Separator />

            {/* Deal Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Deal Information
              </h3>

              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Deal title..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="stage">Stage</Label>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger id="stage">
                    <SelectValue placeholder="Select stage..." />
                  </SelectTrigger>
                  <SelectContent>
                    {DEAL_STAGES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(stage === "won" || stage === "lost") && (
                  <p className="text-xs text-muted-foreground">
                    Setting to {stage} will close this deal.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner">Owner</Label>
                <Select
                  value={ownerTeamMemberId}
                  onValueChange={setOwnerTeamMemberId}
                >
                  <SelectTrigger id="owner">
                    <SelectValue placeholder="Select owner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No owner</SelectItem>
                    {teamMembers.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.full_name || tm.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="estimatedValue">Estimated Value</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="estimatedValue"
                    type="number"
                    value={estimatedValue}
                    onChange={(e) => setEstimatedValue(e.target.value)}
                    className="pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="source">Source</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id="source">
                    <SelectValue placeholder="Select source..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unknown</SelectItem>
                    {DEAL_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s
                          .replace(/_/g, " ")
                          .replace(/\b\w/g, (c) => c.toUpperCase())}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Notes */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">Notes</h3>

              <div className="space-y-2">
                <Label htmlFor="notes">Deal Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Add notes about this deal..."
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
