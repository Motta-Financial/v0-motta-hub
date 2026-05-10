"use client"

/**
 * Side-sheet detail view for a single intake submission.
 *
 * Renders three regions:
 *  1. Header — submitter identity + status badge + quick triage controls
 *  2. Structured summary — every denormalized column we care about,
 *     grouped into Personal / Business / Services sections
 *  3. Raw answers — every Jotform Q/A pair, in form order, so triagers
 *     can see anything the parser may not have promoted to a column
 *
 * State:
 * - The sheet is purely controlled by `open` + `submissionId` props
 *   from the parent list. We fetch detail on demand whenever a new
 *   `submissionId` is supplied so opening different rows doesn't reuse
 *   stale data.
 * - Triage edits PATCH `/api/jotform/intake/[id]` and call `onChanged`
 *   so the parent list revalidates and the row updates in place.
 */

import { useEffect, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  User,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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

interface JotformAnswer {
  name?: string
  text?: string
  type?: string
  order?: string | number
  answer?: unknown
  prettyFormat?: string
}

interface SubmissionDetail {
  id: string
  jotform_submission_id: string
  jotform_form_id: string
  jotform_created_at: string | null
  status: string | null
  submitter_full_name: string | null
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_email: string | null
  submitter_phone: string | null
  submitter_city: string | null
  submitter_state: string | null
  submitter_zip: string | null
  submitter_address: Record<string, unknown> | null
  services_requested: string[] | null
  service_focus: string | null
  entity_types: string[] | null
  business_situation: string | null
  business_name: string | null
  business_email: string | null
  business_phone: string | null
  business_state: string | null
  business_summary: string | null
  business_revenue_range: string | null
  business_employee_count: string | null
  business_tax_classification: string | null
  business_uses_accounting_system: string | null
  questions_or_concerns: string | null
  additional_notes: string | null
  raw_answers: Record<string, JotformAnswer> | null
  lead_status: string | null
  triage_notes: string | null
  assigned_to_id: string | null
  assignedTo: { id: string; name: string; avatarUrl: string | null } | null

  // ── ALFRED post-processing surface ────────────────────────────
  // These three columns are populated asynchronously after the
  // webhook persists the row (see `runIntakePostProcessing` in
  // lib/jotform/ingest.ts). They may all be null on a freshly
  // received submission — the UI degrades gracefully in that case.
  preferred_team_member: string | null
  enrichment: IntakeEnrichment | null
  question_research: IntakeQuestionResearch | null
  notified_at: string | null

  // ── Linked client ─────────────────────────────────────────────
  // Populated when the intake has been matched (or auto-created)
  // against a Karbon contact. Used by the Karbon work-item action
  // to decide whether the button is enabled.
  contact_id: string | null
  organization_id: string | null

  // ── Karbon work-item action result ────────────────────────────
  // Populated when a teammate has already clicked "Create Karbon
  // Work Item" on this intake. All four are null until the action
  // has succeeded once; after that the section renders as a
  // success card instead of the button.
  karbon_work_item_key: string | null
  karbon_work_item_title: string | null
  karbon_work_item_url: string | null
  karbon_work_item_created_at: string | null
}

/**
 * Persisted shape of `lib/jotform/enrich.ts` `EnrichmentBlob`. Kept
 * loose (every nested field optional/nullable) so a partial payload
 * — for example if the model returned text but no sources — never
 * blows up rendering. The sheet renders each piece defensively.
 */
interface IntakeEnrichment {
  summary?: string | null
  websites?: Array<{ url: string; title?: string | null; note?: string | null }> | null
  sources?: Array<{ url: string; title?: string | null; snippet?: string | null }> | null
  generated_at?: string | null
  model?: string | null
}

/**
 * Persisted shape of `lib/jotform/research-questions.ts`
 * `QuestionResearchBlob`. Same defensive-nullable treatment.
 */
interface IntakeQuestionResearch {
  questions?: string | null
  summary?: string | null
  key_points?: string[] | null
  references?: Array<{ url: string; title?: string | null }> | null
  disclaimer?: string | null
  generated_at?: string | null
  model?: string | null
}

interface TeamMember {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
  is_active: boolean
}

interface Props {
  submissionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

export function IntakeDetailSheet({ submissionId, open, onOpenChange, onChanged }: Props) {
  const { data, isLoading, mutate } = useSWR<{ submission: SubmissionDetail }>(
    submissionId && open ? `/api/jotform/intake/${submissionId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const { data: teamData } = useSWR<{ team_members: TeamMember[] }>(
    open ? "/api/team-members" : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  // `/api/team-members` already filters out system accounts and
  // inactive humans by default, so we just take what it returns.
  const teamMembers = teamData?.team_members ?? []

  const submission = data?.submission

  const [savingField, setSavingField] = useState<null | "status" | "owner" | "notes">(null)
  const [notesDraft, setNotesDraft] = useState("")
  const [notesDirty, setNotesDirty] = useState(false)

  // ── Karbon work-item action ──────────────────────────────────────
  // The action is gated on (a) a linked Karbon contact and (b) an
  // assigned teammate; the server enforces the same prereqs. The
  // fiscal-year field defaults to the current calendar year — matching
  // the firm convention demonstrated by the example "Le, Dat | 2026".
  const [fiscalYearDraft, setFiscalYearDraft] = useState(
    () => String(new Date().getUTCFullYear()),
  )
  const [creatingWorkItem, setCreatingWorkItem] = useState(false)
  const [workItemError, setWorkItemError] = useState<string | null>(null)

  // Keep the notes draft in sync whenever a new submission is loaded.
  // Also reset the work-item action's transient UI state so opening
  // a different row doesn't carry an error or in-flight spinner over.
  useEffect(() => {
    if (submission) {
      setNotesDraft(submission.triage_notes ?? "")
      setNotesDirty(false)
      setWorkItemError(null)
      setCreatingWorkItem(false)
      // Default fiscal year on a per-row basis so opening a different
      // intake reflects "the current year" rather than whatever the
      // previous row's teammate typed in.
      setFiscalYearDraft(String(new Date().getUTCFullYear()))
    }
  }, [submission?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * POST to the work-item route. On success the SWR cache is
   * revalidated so the section flips from the button to the success
   * card; on failure we surface the server-provided error message
   * inline (the API route returns user-friendly strings for the
   * 422 prereq errors).
   */
  async function createWorkItem() {
    if (!submissionId) return
    setWorkItemError(null)
    setCreatingWorkItem(true)
    try {
      const res = await fetch(
        `/api/jotform/intake/${submissionId}/karbon-work-item`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fiscalYear: fiscalYearDraft.trim() }),
        },
      )
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        workItem?: {
          key: string
          title: string | null
          url: string | null
          createdAt: string | null
        }
      }
      if (!res.ok) {
        throw new Error(json?.error || `Karbon work item failed (${res.status})`)
      }
      await mutate()
      onChanged?.()
    } catch (err: any) {
      console.error("[v0] create karbon work item error:", err)
      setWorkItemError(err?.message ?? "Failed to create Karbon work item")
    } finally {
      setCreatingWorkItem(false)
    }
  }

  async function patch(body: Record<string, unknown>, field: typeof savingField) {
    if (!submissionId) return
    setSavingField(field)
    try {
      const res = await fetch(`/api/jotform/intake/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      await mutate()
      onChanged?.()
    } catch (err) {
      console.error("[v0] intake PATCH error:", err)
    } finally {
      setSavingField(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="text-xl">Intake submission</SheetTitle>
          <SheetDescription>
            Submitted via the embedded form on mottafinancial.com/intake-form.
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {submission && (
          <div className="space-y-6 py-4">
            {/* ───── Identity ───── */}
            <section className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-foreground text-background">
                      {(submission.submitter_full_name ?? submission.business_name ?? "?")
                        .split(" ")
                        .map((s) => s[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-base font-semibold text-foreground">
                      {submission.submitter_full_name ?? submission.business_name ?? "Unknown submitter"}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Submission #{submission.jotform_submission_id} ·{" "}
                      {submission.jotform_created_at
                        ? new Date(submission.jotform_created_at).toLocaleString()
                        : "unknown date"}
                    </div>
                  </div>
                </div>
                <a
                  href={`https://www.jotform.com/submission/${submission.jotform_submission_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open in Jotform
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                {submission.submitter_email && (
                  <ContactLine icon={Mail} value={submission.submitter_email} href={`mailto:${submission.submitter_email}`} />
                )}
                {submission.submitter_phone && (
                  <ContactLine
                    icon={Phone}
                    value={submission.submitter_phone}
                    href={`tel:${submission.submitter_phone.replace(/[^\d+]/g, "")}`}
                  />
                )}
                {(submission.submitter_city || submission.submitter_state) && (
                  <ContactLine
                    icon={MapPin}
                    value={[submission.submitter_city, submission.submitter_state, submission.submitter_zip]
                      .filter(Boolean)
                      .join(", ")}
                  />
                )}
                {submission.business_name && (
                  <ContactLine icon={Building2} value={submission.business_name} />
                )}
              </div>
            </section>

            {/* ───── Triage controls ───── */}
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Triage
              </h3>

              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => {
                  const active = (submission.lead_status ?? "new") === opt.value
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
                  value={submission.assigned_to_id ?? "unassigned"}
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
                {/* Prospect-requested teammate name. ALFRED auto-assigns
                    when this matches an active team_members row (see
                    lib/jotform/assign.ts); if it doesn't match we still
                    show the raw text here so the triager knows who the
                    prospect actually asked for. */}
                {submission.preferred_team_member && (
                  <p className="text-xs text-muted-foreground">
                    Prospect asked for{" "}
                    <span className="font-medium text-foreground">
                      {submission.preferred_team_member}
                    </span>
                    {submission.assigned_to_id ? null : (
                      <span className="text-amber-700"> — no auto-match</span>
                    )}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Internal notes</Label>
                <Textarea
                  value={notesDraft}
                  onChange={(e) => {
                    setNotesDraft(e.target.value)
                    setNotesDirty(e.target.value !== (submission.triage_notes ?? ""))
                  }}
                  placeholder="Add context for the team — never visible to the prospect."
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
            </section>

            {/* ───── Karbon work-item action ─────
             *
             * Renders one of three states:
             *   1. Success card — work item already exists for this
             *      intake; show the title + a deep-link into Karbon.
             *   2. Prereq error — no linked contact OR no assignee;
             *      explain what's missing instead of a dead button.
             *   3. Action — the canonical "Create Karbon Work Item"
             *      button with the fiscal-year input + a live preview
             *      of the title that will be posted.
             *
             * The fiscal-year preview matches the title formula in
             * `lib/karbon/create-intake-work-item.ts` so what the
             * teammate sees here is exactly what Karbon receives.
             */}
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Karbon
                </h3>
              </div>

              {submission.karbon_work_item_key ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div className="flex-1 space-y-1">
                      <div className="font-medium text-emerald-900">
                        Karbon Work Item created
                      </div>
                      <div className="break-all font-mono text-xs text-emerald-900/80">
                        {submission.karbon_work_item_title ??
                          "TAX | Individual (1040)"}
                      </div>
                      {submission.karbon_work_item_created_at && (
                        <div className="text-xs text-emerald-900/70">
                          {new Date(
                            submission.karbon_work_item_created_at,
                          ).toLocaleString()}
                        </div>
                      )}
                      {submission.karbon_work_item_url && (
                        <a
                          href={submission.karbon_work_item_url}
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
                  {/* Prereqs — surface as a callout, not as a disabled
                      button with no explanation. The "Convert to client"
                      / "Assign owner" affordances live in the Triage
                      section right above so the teammate doesn't have
                      to hunt. */}
                  {!submission.contact_id && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        This intake isn't linked to a Karbon contact yet. The
                        ingest pipeline normally auto-creates one — if it
                        didn't, link or create the contact before creating
                        a work item.
                      </span>
                    </div>
                  )}
                  {!submission.assigned_to_id && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Assign an owner above — Karbon needs an assignee to
                        attach the work item to.
                      </span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label
                      htmlFor="karbon-fiscal-year"
                      className="text-xs text-muted-foreground"
                    >
                      Fiscal year / period
                    </Label>
                    <input
                      id="karbon-fiscal-year"
                      type="text"
                      value={fiscalYearDraft}
                      onChange={(e) => setFiscalYearDraft(e.target.value)}
                      placeholder="2026"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground">
                      Used as the final segment of the title. Use{" "}
                      <code className="rounded bg-muted px-1 font-mono text-[11px]">
                        LEAD
                      </code>{" "}
                      for prospects without a confirmed return year.
                    </p>
                  </div>

                  {/* Live preview matches the server-side title formula. */}
                  <div className="rounded-md border border-dashed bg-muted/40 p-2.5">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Preview
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-foreground">
                      TAX | Individual (1040) |{" "}
                      {(submission.submitter_last_name ?? "Last")},{" "}
                      {(submission.submitter_first_name ?? "First")} |{" "}
                      {fiscalYearDraft.trim() || "—"}
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
                      !submission.contact_id ||
                      !submission.assigned_to_id ||
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
            </section>

            {/* ───── Summary sections ───── */}
            <section className="space-y-4">
              <Section title="Services">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Service focus" value={submission.service_focus} />
                  <Field label="Business situation" value={submission.business_situation} />
                </div>
                {submission.services_requested && submission.services_requested.length > 0 && (
                  <div className="mt-3">
                    <Label className="text-xs text-muted-foreground">Requested services</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {submission.services_requested.map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {submission.entity_types && submission.entity_types.length > 0 && (
                  <div className="mt-3">
                    <Label className="text-xs text-muted-foreground">Entity types</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {submission.entity_types.map((s) => (
                        <Badge key={s} variant="outline" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              {(submission.business_name ||
                submission.business_revenue_range ||
                submission.business_summary ||
                submission.business_tax_classification) && (
                <Section title="Business">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label="Business name" value={submission.business_name} />
                    <Field label="Tax classification" value={submission.business_tax_classification} />
                    <Field label="Revenue range" value={submission.business_revenue_range} />
                    <Field label="Employees" value={submission.business_employee_count} />
                    <Field label="Uses accounting system" value={submission.business_uses_accounting_system} />
                    <Field label="Business state" value={submission.business_state} />
                  </div>
                  {submission.business_summary && (
                    <div className="mt-3">
                      <Label className="text-xs text-muted-foreground">Business summary</Label>
                      <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm text-foreground">
                        {submission.business_summary}
                      </p>
                    </div>
                  )}
                </Section>
              )}

              {(submission.questions_or_concerns || submission.additional_notes) && (
                <Section title="Prospect notes">
                  {submission.questions_or_concerns && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Questions or concerns</Label>
                      <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm text-foreground">
                        {submission.questions_or_concerns}
                      </p>
                    </div>
                  )}
                  {submission.additional_notes && (
                    <div className="mt-3">
                      <Label className="text-xs text-muted-foreground">Additional notes</Label>
                      <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm text-foreground">
                        {submission.additional_notes}
                      </p>
                    </div>
                  )}
                </Section>
              )}

              {/* ALFRED prospect research. Rendered only when the
                  post-processing pipeline has actually populated the
                  `enrichment` column — a freshly received submission
                  shows nothing here until the async job completes. */}
              {submission.enrichment &&
                (submission.enrichment.summary ||
                  (submission.enrichment.websites?.length ?? 0) > 0 ||
                  (submission.enrichment.sources?.length ?? 0) > 0) && (
                  <AlfredSection
                    title="ALFRED prospect research"
                    generatedAt={submission.enrichment.generated_at ?? null}
                    model={submission.enrichment.model ?? null}
                  >
                    {submission.enrichment.summary && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {submission.enrichment.summary}
                      </p>
                    )}
                    {submission.enrichment.websites &&
                      submission.enrichment.websites.length > 0 && (
                        <div className="mt-4 space-y-1.5">
                          <Label className="text-xs text-muted-foreground">
                            Researched sites
                          </Label>
                          <ul className="space-y-1.5">
                            {submission.enrichment.websites.map((w) => (
                              <li key={w.url} className="flex items-start gap-2 text-sm">
                                <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <a
                                    href={w.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="truncate font-medium text-foreground hover:underline"
                                  >
                                    {w.title || w.url}
                                  </a>
                                  {w.note && (
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                      ({w.note})
                                    </span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    {submission.enrichment.sources &&
                      submission.enrichment.sources.length > 0 && (
                        <details className="mt-3 group">
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            Show {submission.enrichment.sources.length} source snippet
                            {submission.enrichment.sources.length === 1 ? "" : "s"}
                          </summary>
                          <ul className="mt-2 space-y-2 border-l pl-3">
                            {submission.enrichment.sources.map((s) => (
                              <li key={s.url} className="text-xs text-muted-foreground">
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-foreground hover:underline"
                                >
                                  {s.title || s.url}
                                </a>
                                {s.snippet && (
                                  <p className="mt-0.5 line-clamp-2">{s.snippet}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                  </AlfredSection>
                )}

              {/* ALFRED-drafted response to the prospect's questions.
                  Rendered separately from the enrichment because the
                  inputs and audiences differ — enrichment briefs the
                  triager, this drafts an actual reply. */}
              {submission.question_research &&
                (submission.question_research.summary ||
                  (submission.question_research.key_points?.length ?? 0) > 0) && (
                  <AlfredSection
                    title="ALFRED suggested response"
                    generatedAt={submission.question_research.generated_at ?? null}
                    model={submission.question_research.model ?? null}
                  >
                    {submission.question_research.questions && (
                      <div className="mb-3 rounded-md border bg-muted/30 p-2.5">
                        <Label className="text-xs text-muted-foreground">
                          Prospect asked
                        </Label>
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground">
                          {submission.question_research.questions}
                        </p>
                      </div>
                    )}
                    {submission.question_research.summary && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {submission.question_research.summary}
                      </p>
                    )}
                    {submission.question_research.key_points &&
                      submission.question_research.key_points.length > 0 && (
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground">
                          {submission.question_research.key_points.map((p, i) => (
                            <li key={i} className="leading-relaxed">
                              {p}
                            </li>
                          ))}
                        </ul>
                      )}
                    {submission.question_research.references &&
                      submission.question_research.references.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            References
                          </Label>
                          <ul className="space-y-0.5">
                            {submission.question_research.references.map((r) => (
                              <li
                                key={r.url}
                                className="flex items-start gap-1.5 text-xs"
                              >
                                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-muted-foreground hover:text-foreground hover:underline"
                                >
                                  {r.title || r.url}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    {submission.question_research.disclaimer && (
                      <p className="mt-3 text-xs italic text-muted-foreground">
                        {submission.question_research.disclaimer}
                      </p>
                    )}
                  </AlfredSection>
                )}

              {submission.raw_answers && (
                <Section title="All answers">
                  <RawAnswers answers={submission.raw_answers} />
                </Section>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}

/**
 * Branded variant of `Section` for content authored by ALFRED Ai. The
 * olive accent + Sparkles icon and the "Generated …" footer make it
 * unambiguous to the triager that the prose came from an AI, not a
 * teammate. Matches the olive-green ALFRED brand established on the
 * chat launcher (see components/alfred-chat-trigger.tsx).
 */
function AlfredSection({
  title,
  generatedAt,
  model,
  children,
}: {
  title: string
  generatedAt: string | null
  model: string | null
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[#C4CB8B] bg-[#FBFCF5] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-[#7E8845]" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#5C6432]">
          {title}
        </h3>
      </div>
      {children}
      {(generatedAt || model) && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Generated by ALFRED Ai
          {model ? ` (${model})` : ""}
          {generatedAt ? ` · ${formatRelativeTimestamp(generatedAt)}` : ""}
        </p>
      )}
    </div>
  )
}

/**
 * Short, human-readable timestamp suffix for the AlfredSection footer
 * — "just now", "5m ago", "2h ago", or a calendar date for anything
 * older than a day. Failures fall back to the raw string so the
 * footer never crashes on a malformed value.
 */
function formatRelativeTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const diff = Date.now() - d.getTime()
    if (diff < 0 || Number.isNaN(diff)) return iso
    const m = Math.floor(diff / 60_000)
    if (m < 1) return "just now"
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  } catch {
    return iso
  }
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-0.5 text-sm text-foreground">{value || "—"}</div>
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
    <span className="flex items-center gap-1.5 text-sm text-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{value}</span>
    </span>
  )
  if (!href) return inner
  return (
    <a href={href} className="hover:underline">
      {inner}
    </a>
  )
}

/**
 * Render every Jotform Q/A pair, in form order, skipping decorative
 * elements (`control_head`, `control_pagebreak`, etc.) that don't carry
 * an answer. Long answers are pre-line wrapped to preserve newlines
 * from textarea fields.
 */
function RawAnswers({ answers }: { answers: Record<string, JotformAnswer> }) {
  const sorted = Object.entries(answers)
    .filter(([, a]) => {
      if (!a) return false
      if (typeof a.type === "string" && (a.type === "control_head" || a.type === "control_pagebreak")) return false
      const ans = a.answer
      if (ans == null || ans === "") return false
      if (Array.isArray(ans) && ans.length === 0) return false
      if (typeof ans === "object" && Object.keys(ans as object).length === 0) return false
      return true
    })
    .sort((a, b) => Number(a[1].order ?? 0) - Number(b[1].order ?? 0))

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No answer detail available.</p>
  }

  return (
    <dl className="space-y-3">
      {sorted.map(([qid, a]) => (
        <div key={qid} className="grid grid-cols-1 gap-1 md:grid-cols-3">
          <dt className="text-xs font-medium text-muted-foreground md:col-span-1">{a.text || a.name || `Q${qid}`}</dt>
          <dd className="whitespace-pre-wrap text-sm text-foreground md:col-span-2">{stringifyAnswer(a)}</dd>
        </div>
      ))}
    </dl>
  )
}

function stringifyAnswer(a: JotformAnswer): string {
  if (a.prettyFormat && typeof a.prettyFormat === "string") return a.prettyFormat
  const ans = a.answer
  if (ans == null) return "—"
  if (typeof ans === "string") return ans
  if (typeof ans === "number" || typeof ans === "boolean") return String(ans)
  if (Array.isArray(ans)) return ans.filter(Boolean).join(", ")
  if (typeof ans === "object") {
    // Common shapes: { first, last } / { full } / { addr_line1, city, state, postal }
    const obj = ans as Record<string, unknown>
    if (obj.first || obj.last) return `${obj.first ?? ""} ${obj.last ?? ""}`.trim()
    if (obj.full) return String(obj.full)
    return Object.entries(obj)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ")
  }
  return String(ans)
}

// Kept exported so the icon imports above tree-shake without warnings.
export { User }
