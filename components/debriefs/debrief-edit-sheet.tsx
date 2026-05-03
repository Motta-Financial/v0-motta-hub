"use client"

/**
 * Edit sheet for an existing debrief. Lets the user fix the client
 * mapping (org or contact), debrief type/status, notes, follow-up date,
 * and the Karbon work item URL.
 *
 * Save target: PATCH /api/debriefs/[id]
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
import {
  ClientPicker,
  type ClientPickerValue,
} from "@/components/clients/client-picker"

interface Debrief {
  id: string
  debrief_type: string | null
  status: string | null
  notes: string | null
  tax_year: number | null
  follow_up_date: string | null
  karbon_work_url: string | null
  contact_id: string | null
  organization_id: string | null
  organization_name: string | null
  organization_display_name: string | null
  contact_full_name: string | null
}

interface Props {
  debrief: Debrief | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: any) => void
}

const DEBRIEF_TYPES = [
  "meeting",
  "tax_planning",
  "advisory",
  "preparation",
  "onboarding",
  "follow_up",
  "other",
]
const DEBRIEF_STATUSES = ["draft", "completed", "needs_followup"]

export function DebriefEditSheet({ debrief, open, onOpenChange, onSaved }: Props) {
  const [client, setClient] = useState<ClientPickerValue | null>(null)
  const [debriefType, setDebriefType] = useState<string>("")
  const [status, setStatus] = useState<string>("")
  const [notes, setNotes] = useState("")
  const [taxYear, setTaxYear] = useState<string>("")
  const [followUp, setFollowUp] = useState("")
  const [karbonUrl, setKarbonUrl] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!debrief) return
    if (debrief.organization_id) {
      setClient({
        id: debrief.organization_id,
        name: debrief.organization_display_name || debrief.organization_name || "Organization",
        kind: "organization",
      })
    } else if (debrief.contact_id) {
      setClient({
        id: debrief.contact_id,
        name: debrief.contact_full_name || debrief.organization_name || "Contact",
        kind: "contact",
      })
    } else {
      setClient(null)
    }
    setDebriefType(debrief.debrief_type || "")
    setStatus(debrief.status || "")
    setNotes(debrief.notes || "")
    setTaxYear(debrief.tax_year?.toString() || "")
    setFollowUp(debrief.follow_up_date ? debrief.follow_up_date.slice(0, 10) : "")
    setKarbonUrl(debrief.karbon_work_url || "")
  }, [debrief])

  async function handleSave() {
    if (!debrief) return
    setSaving(true)
    try {
      const payload: Record<string, any> = {
        organization_id: client?.kind === "organization" ? client.id : null,
        contact_id: client?.kind === "contact" ? client.id : null,
        debrief_type: debriefType || null,
        status: status || null,
        notes: notes || null,
        tax_year: taxYear ? Number(taxYear) : null,
        follow_up_date: followUp || null,
        karbon_work_url: karbonUrl || null,
      }
      const res = await fetch(`/api/debriefs/${debrief.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || "Failed to save debrief")
      }
      toast.success("Debrief updated")
      onSaved(json.debrief)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save debrief")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Debrief</SheetTitle>
          <SheetDescription>Fix client mapping, type, notes, or follow-up.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>Client</Label>
            <ClientPicker
              value={client}
              onChange={setClient}
              placeholder="Search organizations and contacts…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>Type</Label>
              <Select value={debriefType} onValueChange={setDebriefType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {DEBRIEF_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {DEBRIEF_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="debrief-notes">Notes</Label>
            <Textarea
              id="debrief-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              placeholder="Meeting notes, takeaways, decisions..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="debrief-tax-year">Tax Year</Label>
              <Input
                id="debrief-tax-year"
                type="number"
                value={taxYear}
                onChange={(e) => setTaxYear(e.target.value)}
                placeholder="e.g. 2025"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="debrief-followup">Follow-up Date</Label>
              <Input
                id="debrief-followup"
                type="date"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="debrief-karbon">Karbon Work Item URL</Label>
            <Input
              id="debrief-karbon"
              type="url"
              value={karbonUrl}
              onChange={(e) => setKarbonUrl(e.target.value)}
              placeholder="https://app2.karbonhq.com/…/work/…"
            />
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !debrief}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
