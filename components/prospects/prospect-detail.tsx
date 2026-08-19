"use client"

/**
 * <ProspectDetail /> — review screen shown after the Prospect Form
 * is submitted. The structure mirrors the right-half of
 * `IntakeDetailSheet` so the two surfaces are visually consistent:
 *
 *   1. Identity header — submitter name, contact info, linked Karbon
 *      client chip (if auto-matched/created).
 *   2. Triage controls — status, owner, internal notes.
 *   3. Karbon work-item action — same fiscal-year preview +
 *      "Create Karbon Work Item" button as the intake flow.
 *   4. ProConnect tax return action — shows the read-only match preview
 *      (GET /proconnect-match) and, only once a single ProConnect client
 *      is matched, lets a lead re-confirm module/year/name and POST
 *      /create-tax-return. Module is hard-limited to IND (1040) in the
 *      UI to match the server-side SUPPORTED_RETURN_TYPES gate — other
 *      modules are documented as "will follow" and are shown disabled
 *      rather than hidden, so it's clear they exist but aren't live yet.
 *   5. Captured detail — service focus, services, business,
 *      attachments, meeting context.
 *
 * Data flows through SWR on /api/prospects/[id]; mutations PATCH the
 * same route. The Karbon work-item button POSTs
 * /api/prospects/[id]/karbon-work-item. The ProConnect card reads
 * /api/prospects/[id]/proconnect-match and POSTs
 * /api/prospects/[id]/create-tax-return.
 */

import { useEffect, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  Mail,
  MapPin,
  NotebookPen,
  Paperclip,
  Phone,
  User,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const STATUS_OPTIONS = [
  { value: "new", label: "New", className: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "contacted", label: "Contacted", className: "bg-sky-50 text-sky-700 border-sky-200" },
  { value: "qualified", label: "Qualified", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { value: "converted", label: "Converted", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "declined", label: "Declined", className: "bg-slate-50 text-slate-600 border-slate-200" },
] as const

interface AttachmentRecord {
  url: string
  pathname: string
  name: string
  content_type: string
  size_bytes: number
  uploaded_at: string
  uploaded_by_id: string | null
  uploaded_by_name: string | null
}

interface Prospect {
  id: string
  created_by_id: string
  meeting_context: string | null
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_full_name: string | null
  submitter_email: string | null
  submitter_phone: string | null
  submitter_city: string | null
  submitter_state: string | null
  submitter_zip: string | null
  services_requested: string[] | null
  service_focus: string | null
  entity_types: string[] | null
  business_situation: string | null
  business_name: string | null
  business_email: string | null
  business_phone: string | null
  business_state: string | null
  business_tax_classification: string | null
  business_revenue_range: string | null
  business_summary: string | null
  internal_notes: string | null
  attachments: AttachmentRecord[] | null
  lead_status: string | null
  assigned_to_id: string | null
  triage_notes: string | null
  contact_id: string | null
  organization_id: string | null
  link_method: string | null
  karbon_work_item_key: string | null
  karbon_work_item_title: string | null
  karbon_work_item_url: string | null
  karbon_work_item_created_at: string | null
  proconnect_push_status: string | null
  proconnect_pushed_at: string | null
  proconnect_push_error: string | null
  created_at: string
}

type ProConnectMatchState = "no_hub_link" | "no_match" | "ambiguous" | "matched"

interface ProConnectClientCandidate {
  proconnect_client_id: string
  client_type: string | null
  display_name: string | null
  first_name: string | null
  last_name: string | null
  business_name: string | null
  email: string | null
}

interface ProConnectMatchResponse {
  ok: boolean
  matchState: ProConnectMatchState
  message?: string
  client: ProConnectClientCandidate | null
  candidates?: ProConnectClientCandidate[]
  suggestedName?: string
}

const RETURN_TYPE_LABELS: Record<string, string> = {
  IND: "Individual (1040)",
  COR: "Corporate (1120)",
  PAR: "Partnership (1065)",
  SCO: "S-Corp (1120S)",
  FID: "Fiduciary (1041)",
  EXM: "Exempt Org (990)",
  GFT: "Gift (709)",
}

// Only IND is confirmed live in ProConnect's Phase 1 Open API — see
// lib/proconnect/client.ts SUPPORTED_RETURN_TYPES. Keep this list in sync;
// the server enforces the same restriction and will reject anything else.
const SUPPORTED_RETURN_TYPES_UI = ["IND"] as const

interface TeamMember {
  id: string
  full_name: string | null
  first_name?: string | null
  last_name?: string | null
  email: string | null
  avatar_url: string | null
  is_active?: boolean
}

interface DetailResponse {
  prospect: Prospect
  createdBy: TeamMember | null
  assignedTo: TeamMember | null
  linkedClient: { type: "contact" | "organization"; id: string; name: string } | null
}

export function ProspectDetail({ prospectId }: { prospectId: string }) {
  const { data, isLoading, mutate } = useSWR<DetailResponse>(
    `/api/prospects/${prospectId}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const { data: teamData } = useSWR<{ team_members: TeamMember[] }>(
    "/api/team-members",
    fetcher,
    { revalidateOnFocus: false },
  )
  const teamMembers = teamData?.team_members ?? []

  const prospect = data?.prospect ?? null

  const [savingField, setSavingField] = useState<null | "status" | "owner" | "notes">(null)
  const [notesDraft, setNotesDraft] = useState("")
  const [notesDirty, setNotesDirty] = useState(false)

  const [fiscalYearDraft, setFiscalYearDraft] = useState(
    () => String(new Date().getUTCFullYear()),
  )
  const [creatingWorkItem, setCreatingWorkItem] = useState(false)
  const [workItemError, setWorkItemError] = useState<string | null>(null)

  const [returnTypeDraft, setReturnTypeDraft] = useState<string>("IND")
  const [returnYearDraft, setReturnYearDraft] = useState(
    () => String(new Date().getUTCFullYear()),
  )
  const [returnNameDraft, setReturnNameDraft] = useState("")
  const [creatingTaxReturn, setCreatingTaxReturn] = useState(false)
  const [taxReturnError, setTaxReturnError] = useState<string | null>(null)
  const [taxReturnResult, setTaxReturnResult] = useState<{
    jobId: string
    createdEngagementId: string | null
  } | null>(null)

  useEffect(() => {
    if (prospect) {
      setNotesDraft(prospect.triage_notes ?? "")
      setNotesDirty(false)
      setWorkItemError(null)
      setCreatingWorkItem(false)
      setFiscalYearDraft(String(new Date().getUTCFullYear()))
      setReturnYearDraft(String(new Date().getUTCFullYear()))
      setTaxReturnError(null)
      setTaxReturnResult(null)
    }
  }, [prospect?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Read-only preview of whether this prospect already has a matching
  // ProConnect client. Only fetched once we know the prospect id, and
  // only meaningful once triage has linked a Hub contact/org — but we
  // still fetch regardless so the card can explain *why* it's blocked.
  const { data: matchData, isLoading: matchLoading } = useSWR<ProConnectMatchResponse>(
    prospect ? `/api/prospects/${prospectId}/proconnect-match` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  useEffect(() => {
    if (matchData?.suggestedName) {
      setReturnNameDraft(matchData.suggestedName)
    }
  }, [matchData?.suggestedName])

  async function patch(body: Record<string, unknown>, field: typeof savingField) {
    setSavingField(field)
    try {
      const res = await fetch(`/api/prospects/${prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      await mutate()
    } catch (err) {
      console.error("[v0] prospect PATCH error:", err)
    } finally {
      setSavingField(null)
    }
  }

  async function createWorkItem() {
    setWorkItemError(null)
    setCreatingWorkItem(true)
    try {
      const res = await fetch(`/api/prospects/${prospectId}/karbon-work-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalYear: fiscalYearDraft.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error || `Karbon work item failed (${res.status})`)
      }
      await mutate()
    } catch (err: any) {
      console.error("[v0] create prospect karbon work item error:", err)
      setWorkItemError(err?.message ?? "Failed to create Karbon work item")
    } finally {
      setCreatingWorkItem(false)
    }
  }

  async function createTaxReturnHandler() {
    if (!matchData?.client) return
    setTaxReturnError(null)
    setCreatingTaxReturn(true)
    try {
      const res = await fetch(`/api/prospects/${prospectId}/create-tax-return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proconnectClientId: matchData.client.proconnect_client_id,
          name: returnNameDraft.trim(),
          type: returnTypeDraft,
          year: Number(returnYearDraft),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error || `Create Tax Return failed (${res.status})`)
      }
      setTaxReturnResult({ jobId: json.jobId, createdEngagementId: json.createdEngagementId ?? null })
      await mutate()
    } catch (err: any) {
      console.error("[v0] create tax return error:", err)
      setTaxReturnError(err?.message ?? "Failed to create tax return")
    } finally {
      setCreatingTaxReturn(false)
    }
  }

  // Guard on `data` (not just the derived `prospect`) so TypeScript can
  // narrow both inside the render block below — otherwise it keeps
  // flagging every `data.linkedClient` / `data.createdBy` access as
  // possibly undefined.
  if (isLoading || !data || !prospect) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading prospect…
        </div>
      </div>
    )
  }

  const displayName =
    prospect.submitter_full_name ||
    [prospect.submitter_first_name, prospect.submitter_last_name].filter(Boolean).join(" ") ||
    prospect.business_name ||
    "Unnamed prospect"

  const initials = (displayName || "?")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Page header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{displayName}</h1>
        <p className="text-sm text-muted-foreground">
          Internal prospect captured by{" "}
          <span className="font-medium text-foreground">
            {data.createdBy?.full_name || "you"}
          </span>{" "}
          on {new Date(prospect.created_at).toLocaleString()}.
        </p>
      </header>

      {/* Identity */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-foreground text-background">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-foreground">{displayName}</div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 text-sm md:grid-cols-2">
                {prospect.submitter_email && (
                  <ContactLine
                    icon={Mail}
                    value={prospect.submitter_email}
                    href={`mailto:${prospect.submitter_email}`}
                  />
                )}
                {prospect.submitter_phone && (
                  <ContactLine
                    icon={Phone}
                    value={prospect.submitter_phone}
                    href={`tel:${prospect.submitter_phone.replace(/[^\d+]/g, "")}`}
                  />
                )}
                {(prospect.submitter_city || prospect.submitter_state) && (
                  <ContactLine
                    icon={MapPin}
                    value={[prospect.submitter_city, prospect.submitter_state, prospect.submitter_zip]
                      .filter(Boolean)
                      .join(", ")}
                  />
                )}
                {prospect.business_name && (
                  <ContactLine icon={Building2} value={prospect.business_name} />
                )}
              </div>

              {data.linkedClient && (
                <div className="mt-3">
                  <a
                    href={
                      data.linkedClient.type === "contact"
                        ? `/contacts/${data.linkedClient.id}`
                        : `/organizations/${data.linkedClient.id}`
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    <Link2 className="h-3 w-3" />
                    Linked to {data.linkedClient.name}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Triage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Triage</CardTitle>
          <CardDescription>Status, owner, and internal notes for the team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((opt) => {
              const active = (prospect.lead_status ?? "new") === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => patch({ lead_status: opt.value }, "status")}
                  disabled={savingField === "status"}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    active ? opt.className : "border-border text-muted-foreground hover:bg-muted",
                    savingField === "status" && "opacity-60",
                  )}
                >
                  {opt.label}
                  {active && <CheckCircle2 className="ml-1 inline h-3 w-3" />}
                </button>
              )
            })}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Owner</Label>
            <Select
              value={prospect.assigned_to_id ?? "unassigned"}
              onValueChange={(v) =>
                patch({ assigned_to_id: v === "unassigned" ? null : v }, "owner")
              }
              disabled={savingField === "owner"}
            >
              <SelectTrigger>
                <SelectValue placeholder="Assign to teammate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {teamMembers.map((m) => {
                  const name = m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim()
                  return (
                    <SelectItem key={m.id} value={m.id}>
                      {name || "Unnamed teammate"}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Triage notes</Label>
            <Textarea
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.target.value)
                setNotesDirty(e.target.value !== (prospect.triage_notes ?? ""))
              }}
              placeholder="Add follow-up context for the team — separate from the original meeting notes."
              className="min-h-[80px] text-sm"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant={notesDirty ? "default" : "outline"}
                disabled={!notesDirty || savingField === "notes"}
                onClick={() => patch({ triage_notes: notesDraft }, "notes")}
              >
                {savingField === "notes" ? "Saving…" : "Save notes"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Karbon work-item action */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Karbon</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {prospect.karbon_work_item_key ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="flex-1 space-y-1">
                  <div className="font-medium text-emerald-900">Karbon Work Item created</div>
                  <div className="break-all font-mono text-xs text-emerald-900/80">
                    {prospect.karbon_work_item_title ?? "TAX | Individual (1040)"}
                  </div>
                  {prospect.karbon_work_item_created_at && (
                    <div className="text-xs text-emerald-900/70">
                      {new Date(prospect.karbon_work_item_created_at).toLocaleString()}
                    </div>
                  )}
                  {prospect.karbon_work_item_url && (
                    <a
                      href={prospect.karbon_work_item_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                    >
                      View in Karbon
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {!prospect.contact_id && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    No Karbon contact linked yet. Karbon needs a contact to attach the work
                    item to.
                  </span>
                </div>
              )}
              {!prospect.assigned_to_id && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Assign an owner above before creating the Karbon work item.</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="fy" className="text-xs text-muted-foreground">
                  Fiscal year / period
                </Label>
                <Input
                  id="fy"
                  type="text"
                  value={fiscalYearDraft}
                  onChange={(e) => setFiscalYearDraft(e.target.value)}
                  placeholder="2026"
                />
                <p className="text-xs text-muted-foreground">
                  Final segment of the work-item title. Use{" "}
                  <code className="rounded bg-muted px-1 font-mono text-[11px]">LEAD</code>{" "}
                  for prospects without a confirmed return year.
                </p>
              </div>

              <div className="rounded-md border border-dashed bg-muted/40 p-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Preview
                </div>
                <div className="mt-1 break-all font-mono text-xs text-foreground">
                  TAX | Individual (1040) | {prospect.submitter_last_name ?? "Last"},{" "}
                  {prospect.submitter_first_name ?? "First"} | {fiscalYearDraft.trim() || "—"}
                </div>
              </div>

              {workItemError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                  {workItemError}
                </div>
              )}

              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={
                  creatingWorkItem ||
                  !prospect.contact_id ||
                  !prospect.assigned_to_id ||
                  !fiscalYearDraft.trim()
                }
                onClick={createWorkItem}
              >
                {creatingWorkItem ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Creating in Karbon…
                  </>
                ) : (
                  <>
                    <Briefcase className="mr-2 h-3.5 w-3.5" />
                    Create Karbon Work Item
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ProConnect tax return action */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">ProConnect</CardTitle>
          </div>
          <CardDescription>
            Create a tax return in Intuit ProConnect for this prospect&apos;s matched client.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {taxReturnResult ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="flex-1 space-y-1">
                  <div className="font-medium text-emerald-900">Tax return created in ProConnect</div>
                  {taxReturnResult.createdEngagementId && (
                    <div className="break-all font-mono text-xs text-emerald-900/80">
                      Engagement ID: {taxReturnResult.createdEngagementId}
                    </div>
                  )}
                  <div className="text-xs text-emerald-900/70">
                    Job {taxReturnResult.jobId} — there is no delete endpoint for a created
                    return; double-check in ProConnect before creating another.
                  </div>
                </div>
              </div>
            </div>
          ) : matchLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Checking ProConnect match…
            </div>
          ) : !matchData || matchData.matchState !== "matched" ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {matchData?.message ??
                  "Unable to determine a ProConnect client match for this prospect."}
              </span>
            </div>
          ) : (
            <>
              <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
                <div className="font-medium uppercase tracking-wide text-muted-foreground">
                  Matched ProConnect client
                </div>
                <div className="mt-1 text-sm text-foreground">
                  {matchData.client!.display_name ||
                    matchData.client!.business_name ||
                    [matchData.client!.first_name, matchData.client!.last_name]
                      .filter(Boolean)
                      .join(" ")}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {matchData.client!.proconnect_client_id}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Module</Label>
                  <Select value={returnTypeDraft} onValueChange={setReturnTypeDraft}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RETURN_TYPE_LABELS).map(([code, label]) => (
                        <SelectItem
                          key={code}
                          value={code}
                          disabled={!(SUPPORTED_RETURN_TYPES_UI as readonly string[]).includes(code)}
                        >
                          {label}
                          {!(SUPPORTED_RETURN_TYPES_UI as readonly string[]).includes(code) &&
                            " (not yet available)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="return-year" className="text-xs text-muted-foreground">
                    Tax year
                  </Label>
                  <Input
                    id="return-year"
                    type="text"
                    inputMode="numeric"
                    value={returnYearDraft}
                    onChange={(e) => setReturnYearDraft(e.target.value)}
                    placeholder="2025"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="return-name" className="text-xs text-muted-foreground">
                  Return display name
                </Label>
                <Input
                  id="return-name"
                  type="text"
                  value={returnNameDraft}
                  onChange={(e) => setReturnNameDraft(e.target.value)}
                  placeholder="Doe, John"
                />
              </div>

              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This creates a real return in ProConnect with no way to delete it via the API.
                  Confirm the client, module, and year above before continuing.
                </span>
              </div>

              {taxReturnError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                  {taxReturnError}
                </div>
              )}

              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={
                  creatingTaxReturn ||
                  !returnNameDraft.trim() ||
                  !returnYearDraft.trim() ||
                  !(SUPPORTED_RETURN_TYPES_UI as readonly string[]).includes(returnTypeDraft)
                }
                onClick={createTaxReturnHandler}
              >
                {creatingTaxReturn ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Creating in ProConnect…
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                    Create Tax Return
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Meeting context */}
      {prospect.meeting_context && (
        <Section title="How you met" icon={NotebookPen}>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm text-foreground">
            {prospect.meeting_context}
          </p>
        </Section>
      )}

      {/* Services */}
      {(prospect.services_requested?.length ||
        prospect.entity_types?.length ||
        prospect.service_focus) && (
        <Section title="Services & interest" icon={FileText}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Service focus" value={prospect.service_focus} />
            <Field label="Business situation" value={prospect.business_situation} />
          </div>
          {prospect.services_requested && prospect.services_requested.length > 0 && (
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">Requested services</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {prospect.services_requested.map((s) => (
                  <Badge key={s} variant="secondary" className="font-normal">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {prospect.entity_types && prospect.entity_types.length > 0 && (
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">Entity types</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {prospect.entity_types.map((e) => (
                  <Badge key={e} variant="outline" className="font-normal">
                    {e}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Business */}
      {(prospect.business_name ||
        prospect.business_revenue_range ||
        prospect.business_summary ||
        prospect.business_tax_classification) && (
        <Section title="Business" icon={Building2}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Business name" value={prospect.business_name} />
            <Field label="Tax classification" value={prospect.business_tax_classification} />
            <Field label="Revenue range" value={prospect.business_revenue_range} />
            <Field label="Business state" value={prospect.business_state} />
            <Field label="Business email" value={prospect.business_email} />
            <Field label="Business phone" value={prospect.business_phone} />
          </div>
          {prospect.business_summary && (
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">Business summary</Label>
              <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm text-foreground">
                {prospect.business_summary}
              </p>
            </div>
          )}
        </Section>
      )}

      {/* Internal notes */}
      {prospect.internal_notes && (
        <Section title="Internal notes" icon={NotebookPen}>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm text-foreground">
            {prospect.internal_notes}
          </p>
        </Section>
      )}

      {/* Attachments */}
      {prospect.attachments && prospect.attachments.length > 0 && (
        <Section title="Attachments" icon={Paperclip}>
          <ul className="space-y-2">
            {prospect.attachments.map((a) => {
              const isImage = a.content_type.startsWith("image/")
              return (
                <li
                  key={a.pathname}
                  className="flex items-center justify-between gap-3 rounded-md border bg-card p-3 text-sm"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {isImage ? (
                      // Public-by-obscurity URLs (random suffix) — safe
                      // to render directly as a thumbnail.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.url}
                        alt={a.name}
                        className="h-12 w-12 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded bg-muted text-muted-foreground">
                        <FileText className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-foreground hover:underline"
                      >
                        {a.name}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {(a.size_bytes / 1024).toFixed(0)} KB
                        {a.uploaded_by_name ? ` · uploaded by ${a.uploaded_by_name}` : null}
                      </div>
                    </div>
                  </div>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Open
                  </a>
                </li>
              )
            })}
          </ul>
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="space-y-0.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  )
}

function ContactLine({
  icon: Icon,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string
  href?: string
}) {
  const inner = (
    <span className="flex items-center gap-2 truncate text-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{value}</span>
    </span>
  )
  return href ? (
    <a href={href} className="block truncate hover:underline">
      {inner}
    </a>
  ) : (
    inner
  )
}
