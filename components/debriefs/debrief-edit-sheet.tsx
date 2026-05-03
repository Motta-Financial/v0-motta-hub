"use client"

/**
 * Edit sheet for an existing debrief.
 *
 * Now covers the full set of editable fields so partners can backfill
 * missing values without dropping into Supabase:
 *   - Date, debrief type, status
 *   - Client mapping (org or contact)
 *   - Team member, client manager, client owner
 *   - Notes
 *   - Tax block (year, filing status, AGI, taxable income, schedules)
 *   - Recurring revenue
 *   - Action items (add / remove / edit)
 *   - Follow-up date
 *   - Karbon work item URL
 *
 * Save target: PATCH /api/debriefs/[id]. The endpoint whitelists the
 * fields we send and refreshes denormalized columns
 * (organization_name, client_manager_name, client_owner_name) server-side
 * so the table view stays consistent.
 */

import { useEffect, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

interface ActionItem {
  description: string
  assignee_name: string
  due_date: string | null
  priority: string
}

interface Debrief {
  id: string
  debrief_date: string | null
  debrief_type: string | null
  status: string | null
  notes: string | null
  // People
  team_member: string | null
  team_member_id: string | null
  client_manager_id: string | null
  client_owner_id: string | null
  // Tax
  tax_year: number | null
  filing_status: string | null
  adjusted_gross_income: number | null
  taxable_income: number | null
  has_schedule_c: boolean | null
  has_schedule_e: boolean | null
  // Money
  recurring_revenue: number | null
  // Follow-up & links
  follow_up_date: string | null
  karbon_work_url: string | null
  // Mapping
  contact_id: string | null
  organization_id: string | null
  organization_name: string | null
  organization_display_name: string | null
  contact_full_name: string | null
  // Structured payload
  action_items: { items?: ActionItem[] } | null
}

interface Props {
  debrief: Debrief | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: any) => void
}

interface TeamMember {
  id: string
  full_name: string
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

// IRS filing-status taxonomy. Stored exactly as written so reports can
// roll up by status; the display layer prettifies underscores.
const FILING_STATUSES = [
  "single",
  "married_filing_jointly",
  "married_filing_separately",
  "head_of_household",
  "qualifying_widow",
]

const PRIORITIES = ["low", "medium", "high"]

// Sentinel value used by Radix <Select> to represent "no choice". Using
// the empty string would crash the Select; using a sentinel lets us round
// trip a "none" selection back to a null FK on save.
const UNSET = "__unset__"

// Pretty-print snake_case values for the Select options.
function formatLabel(s: string) {
  return s.replace(/_/g, " ")
}

export function DebriefEditSheet({ debrief, open, onOpenChange, onSaved }: Props) {
  // Mapping
  const [client, setClient] = useState<ClientPickerValue | null>(null)
  // Date / classification
  const [debriefDate, setDebriefDate] = useState("")
  const [debriefType, setDebriefType] = useState<string>("")
  const [status, setStatus] = useState<string>("")
  // People
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamMemberId, setTeamMemberId] = useState<string>("")
  const [clientManagerId, setClientManagerId] = useState<string>("")
  const [clientOwnerId, setClientOwnerId] = useState<string>("")
  // Notes
  const [notes, setNotes] = useState("")
  // Tax
  const [taxYear, setTaxYear] = useState<string>("")
  const [filingStatus, setFilingStatus] = useState<string>("")
  const [agi, setAgi] = useState<string>("")
  const [taxableIncome, setTaxableIncome] = useState<string>("")
  const [hasScheduleC, setHasScheduleC] = useState(false)
  const [hasScheduleE, setHasScheduleE] = useState(false)
  // Money
  const [recurringRevenue, setRecurringRevenue] = useState<string>("")
  // Follow-up & link
  const [followUp, setFollowUp] = useState("")
  const [karbonUrl, setKarbonUrl] = useState("")
  // Action items
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  // Save state
  const [saving, setSaving] = useState(false)

  // Fetch the team-member list once when the sheet opens. Used by the
  // three "who" pickers (team member / manager / owner). Kept in local
  // state because the directory is small (~50 rows) and the sheet is
  // short-lived — no need for SWR caching.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        const members: TeamMember[] = (json?.team_members || []).map((t: any) => ({
          id: t.id,
          full_name: t.full_name,
        }))
        // Sort alphabetically — easier to scan than the API's default order.
        members.sort((a, b) => a.full_name.localeCompare(b.full_name))
        setTeamMembers(members)
      })
      .catch(() => {
        // Non-fatal: the sheet still saves; the dropdowns will just be empty.
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Hydrate every controlled input from the debrief whenever a different
  // row gets passed in. Numeric / boolean / date columns get coerced to
  // the string form their <Input> expects.
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
    setDebriefDate(debrief.debrief_date ? debrief.debrief_date.slice(0, 10) : "")
    setDebriefType(debrief.debrief_type || "")
    setStatus(debrief.status || "")
    setTeamMemberId(debrief.team_member_id || "")
    setClientManagerId(debrief.client_manager_id || "")
    setClientOwnerId(debrief.client_owner_id || "")
    setNotes(debrief.notes || "")
    setTaxYear(debrief.tax_year?.toString() || "")
    setFilingStatus(debrief.filing_status || "")
    setAgi(debrief.adjusted_gross_income?.toString() || "")
    setTaxableIncome(debrief.taxable_income?.toString() || "")
    setHasScheduleC(!!debrief.has_schedule_c)
    setHasScheduleE(!!debrief.has_schedule_e)
    setRecurringRevenue(debrief.recurring_revenue?.toString() || "")
    setFollowUp(debrief.follow_up_date ? debrief.follow_up_date.slice(0, 10) : "")
    setKarbonUrl(debrief.karbon_work_url || "")
    setActionItems(
      Array.isArray(debrief.action_items?.items)
        ? debrief.action_items!.items!.map((i) => ({
            description: i.description || "",
            assignee_name: i.assignee_name || "",
            due_date: i.due_date || null,
            priority: i.priority || "medium",
          }))
        : [],
    )
  }, [debrief])

  // Action item helpers — local mutations only; the array gets shipped on save.
  const addActionItem = () => {
    setActionItems((prev) => [
      ...prev,
      { description: "", assignee_name: "", due_date: null, priority: "medium" },
    ])
  }
  const updateActionItem = (idx: number, patch: Partial<ActionItem>) => {
    setActionItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }
  const removeActionItem = (idx: number) => {
    setActionItems((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!debrief) return
    setSaving(true)
    try {
      // Strip blank action items so we don't persist empty rows that
      // would later show up as orphan placeholders in the details view.
      const cleanActionItems = actionItems
        .map((i) => ({
          description: i.description.trim(),
          assignee_name: i.assignee_name.trim(),
          due_date: i.due_date || null,
          priority: i.priority || "medium",
        }))
        .filter((i) => i.description || i.assignee_name)

      const payload: Record<string, any> = {
        // Mapping
        organization_id: client?.kind === "organization" ? client.id : null,
        contact_id: client?.kind === "contact" ? client.id : null,
        // Date & classification
        debrief_date: debriefDate || null,
        debrief_type: debriefType || null,
        status: status || null,
        // People — empty string clears, the API coerces to null
        team_member_id: teamMemberId || null,
        client_manager_id: clientManagerId || null,
        client_owner_id: clientOwnerId || null,
        // Notes
        notes: notes || null,
        // Tax
        tax_year: taxYear || null,
        filing_status: filingStatus || null,
        adjusted_gross_income: agi || null,
        taxable_income: taxableIncome || null,
        has_schedule_c: hasScheduleC,
        has_schedule_e: hasScheduleE,
        // Money
        recurring_revenue: recurringRevenue || null,
        // Follow-up & link
        follow_up_date: followUp || null,
        karbon_work_url: karbonUrl || null,
        // Action items — the API tolerates either a bare array or the
        // canonical { items } object; we send the array since the local
        // state is array-shaped.
        action_items: cleanActionItems,
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
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Debrief</SheetTitle>
          <SheetDescription>
            Backfill missing fields, fix the client mapping, or update notes and action items.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 py-4">
          {/* ─── Date / classification / mapping ─────────────────────── */}
          <section className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="debrief-date">Date</Label>
                <Input
                  id="debrief-date"
                  type="date"
                  value={debriefDate}
                  onChange={(e) => setDebriefDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Type</Label>
                <Select
                  value={debriefType || UNSET}
                  onValueChange={(v) => setDebriefType(v === UNSET ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {DEBRIEF_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {formatLabel(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Status</Label>
                <Select
                  value={status || UNSET}
                  onValueChange={(v) => setStatus(v === UNSET ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {DEBRIEF_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {formatLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Client</Label>
              <ClientPicker
                value={client}
                onChange={setClient}
                placeholder="Search organizations and contacts…"
              />
            </div>
          </section>

          <hr className="border-border" />

          {/* ─── People ───────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Team</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <Label>Team Member</Label>
                <Select
                  value={teamMemberId || UNSET}
                  onValueChange={(v) => setTeamMemberId(v === UNSET ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick teammate" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {teamMembers.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Client Manager</Label>
                <Select
                  value={clientManagerId || UNSET}
                  onValueChange={(v) => setClientManagerId(v === UNSET ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {teamMembers.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Client Owner</Label>
                <Select
                  value={clientOwnerId || UNSET}
                  onValueChange={(v) => setClientOwnerId(v === UNSET ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {teamMembers.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <hr className="border-border" />

          {/* ─── Notes ────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <Label htmlFor="debrief-notes">Notes</Label>
            <Textarea
              id="debrief-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              placeholder="Meeting notes, takeaways, decisions..."
            />
          </section>

          <hr className="border-border" />

          {/* ─── Tax block ────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Tax Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                <Label>Filing Status</Label>
                <Select
                  value={filingStatus || UNSET}
                  onValueChange={(v) => setFilingStatus(v === UNSET ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Not set</SelectItem>
                    {FILING_STATUSES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {formatLabel(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="debrief-agi">AGI</Label>
                <Input
                  id="debrief-agi"
                  type="number"
                  value={agi}
                  onChange={(e) => setAgi(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="debrief-taxable">Taxable Income</Label>
                <Input
                  id="debrief-taxable"
                  type="number"
                  value={taxableIncome}
                  onChange={(e) => setTaxableIncome(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="debrief-recurring">Recurring Revenue</Label>
                <Input
                  id="debrief-recurring"
                  type="number"
                  value={recurringRevenue}
                  onChange={(e) => setRecurringRevenue(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={hasScheduleC}
                  onCheckedChange={(v) => setHasScheduleC(v === true)}
                />
                Schedule C
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={hasScheduleE}
                  onCheckedChange={(v) => setHasScheduleE(v === true)}
                />
                Schedule E
              </label>
            </div>
          </section>

          <hr className="border-border" />

          {/* ─── Action items ─────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Action Items {actionItems.length > 0 && `(${actionItems.length})`}
              </h3>
              <Button type="button" variant="outline" size="sm" onClick={addActionItem}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
            {actionItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No action items yet. Use the button above to add one.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {actionItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/30"
                  >
                    <div className="flex items-start gap-2">
                      <Input
                        value={item.description}
                        onChange={(e) =>
                          updateActionItem(idx, { description: e.target.value })
                        }
                        placeholder="Describe the action item…"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeActionItem(idx)}
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Input
                        value={item.assignee_name}
                        onChange={(e) =>
                          updateActionItem(idx, { assignee_name: e.target.value })
                        }
                        placeholder="Assignee"
                      />
                      <Input
                        type="date"
                        value={item.due_date || ""}
                        onChange={(e) =>
                          updateActionItem(idx, { due_date: e.target.value || null })
                        }
                      />
                      <Select
                        value={item.priority || "medium"}
                        onValueChange={(v) => updateActionItem(idx, { priority: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {formatLabel(p)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <hr className="border-border" />

          {/* ─── Follow-up & Karbon link ──────────────────────────────── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="debrief-followup">Follow-up Date</Label>
              <Input
                id="debrief-followup"
                type="date"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
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
          </section>
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
