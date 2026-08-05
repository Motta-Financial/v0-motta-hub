"use client"

/**
 * Edit sheet for a single Ignition proposal. Opens off the Sales > Proposals
 * row click and lets the user fix the org mapping, status, totals, and the
 * recurring-frequency flag. Saves via PATCH /api/sales/proposals/[id].
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
import {
  ClientPicker,
  type ClientPickerValue,
} from "@/components/clients/client-picker"

interface Proposal {
  proposal_id: string
  proposal_number: string | null
  title: string | null
  status: string | null
  total_value: number | null
  one_time_total: number | null
  recurring_total: number | null
  recurring_frequency: string | null
  currency: string | null
  client_name: string | null
  organization_id: string | null
  organizations: { id: string; name: string } | null
  /** Read-only contract framing synced from the Ignition Reporting API
   *  (migration 377). Optional so older callers keep compiling. */
  contract_term?: string | null
  minimum_contract_length?: number | null
  proposal_start_type?: string | null
  proposal_start_date?: string | null
  proposal_end_date?: string | null
  created_by?: string | null
  client_tags?: string[]
}

interface Props {
  proposal: Proposal | null
  statuses: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful save so the parent can re-fetch. */
  onSaved: (updated: any) => void
}

function fmtSheetDate(s: string | null | undefined): string {
  if (!s) return "—"
  try {
    return new Date(s).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return s
  }
}

export function ProposalEditSheet({ proposal, statuses, open, onOpenChange, onSaved }: Props) {
  const [client, setClient] = useState<ClientPickerValue | null>(null)
  const [title, setTitle] = useState("")
  const [status, setStatus] = useState<string>("")
  const [totalValue, setTotalValue] = useState<string>("")
  const [oneTimeTotal, setOneTimeTotal] = useState<string>("")
  const [recurringTotal, setRecurringTotal] = useState<string>("")
  const [recurringFrequency, setRecurringFrequency] = useState<string>("")
  const [clientName, setClientName] = useState("")
  const [saving, setSaving] = useState(false)

  // Hydrate the form whenever a new proposal is selected.
  useEffect(() => {
    if (!proposal) return
    setClient(
      proposal.organization_id && proposal.organizations
        ? {
            id: proposal.organization_id,
            name: proposal.organizations.name,
            kind: "organization",
          }
        : null,
    )
    setTitle(proposal.title || "")
    setStatus(proposal.status || "")
    setTotalValue(proposal.total_value?.toString() || "")
    setOneTimeTotal(proposal.one_time_total?.toString() || "")
    setRecurringTotal(proposal.recurring_total?.toString() || "")
    setRecurringFrequency(proposal.recurring_frequency || "")
    setClientName(proposal.client_name || "")
  }, [proposal])

  async function handleSave() {
    if (!proposal) return
    setSaving(true)
    try {
      const res = await fetch(`/api/sales/proposals/${proposal.proposal_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The picker is org-only here so we only ever set organization_id.
          organization_id: client?.id ?? null,
          client_name: clientName || null,
          title: title || null,
          status: status || null,
          total_value: totalValue,
          one_time_total: oneTimeTotal,
          recurring_total: recurringTotal,
          recurring_frequency: recurringFrequency || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || "Failed to save proposal")
      }
      toast.success("Proposal updated")
      onSaved(json.proposal)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save proposal")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Proposal</SheetTitle>
          <SheetDescription>
            {proposal?.proposal_number ? `#${proposal.proposal_number}` : "Update the fields below"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>Organization</Label>
            <ClientPicker
              value={client}
              onChange={setClient}
              kindFilter="organization"
              placeholder="Search organizations…"
            />
            <p className="text-xs text-muted-foreground">
              Proposals only attach to organizations. Use Client Name below for one-off contacts.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="proposal-client-name">Client Name (display)</Label>
            <Input
              id="proposal-client-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Falls back to organization name"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="proposal-title">Title</Label>
            <Input
              id="proposal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="proposal-total">Total Value</Label>
              <Input
                id="proposal-total"
                type="number"
                step="0.01"
                value={totalValue}
                onChange={(e) => setTotalValue(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proposal-currency">Currency</Label>
              <Input
                id="proposal-currency"
                value={proposal?.currency || "USD"}
                disabled
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="proposal-onetime">One-time</Label>
              <Input
                id="proposal-onetime"
                type="number"
                step="0.01"
                value={oneTimeTotal}
                onChange={(e) => setOneTimeTotal(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proposal-recurring">Recurring</Label>
              <Input
                id="proposal-recurring"
                type="number"
                step="0.01"
                value={recurringTotal}
                onChange={(e) => setRecurringTotal(e.target.value)}
              />
            </div>
          </div>

          {/* Read-only contract details synced from Ignition. These are
              Ignition's source-of-truth fields (contract term, engagement
              period, creator, client tags) — they can't be edited here
              because the next sync would overwrite any local change. */}
          {proposal &&
          (proposal.contract_term ||
            proposal.proposal_start_date ||
            proposal.created_by ||
            (proposal.client_tags?.length ?? 0) > 0) ? (
            <div className="rounded-md border bg-stone-50 p-3 flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                From Ignition (read-only)
              </div>
              <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {proposal.contract_term ? (
                  <>
                    <dt className="text-muted-foreground">Contract term</dt>
                    <dd className="capitalize">
                      {proposal.contract_term}
                      {proposal.minimum_contract_length
                        ? ` · ${proposal.minimum_contract_length} mo minimum`
                        : ""}
                    </dd>
                  </>
                ) : null}
                {proposal.proposal_start_date ? (
                  <>
                    <dt className="text-muted-foreground">Engagement</dt>
                    <dd>
                      {fmtSheetDate(proposal.proposal_start_date)} –{" "}
                      {proposal.proposal_end_date
                        ? fmtSheetDate(proposal.proposal_end_date)
                        : "ongoing"}
                      {proposal.proposal_start_type === "acceptance"
                        ? " (starts on acceptance)"
                        : ""}
                    </dd>
                  </>
                ) : null}
                {proposal.created_by ? (
                  <>
                    <dt className="text-muted-foreground">Created by</dt>
                    <dd>{proposal.created_by}</dd>
                  </>
                ) : null}
                {(proposal.client_tags?.length ?? 0) > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Client tags</dt>
                    <dd className="flex flex-wrap gap-1">
                      {proposal.client_tags!.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-800 border-violet-200"
                        >
                          {t}
                        </span>
                      ))}
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label>Recurring Frequency</Label>
            <Select
              value={recurringFrequency || "none"}
              onValueChange={(v) => setRecurringFrequency(v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Not recurring" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not recurring</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="annually">Annually</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !proposal}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
