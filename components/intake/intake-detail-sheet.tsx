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
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Phone,
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

  // Keep the notes draft in sync whenever a new submission is loaded.
  useEffect(() => {
    if (submission) {
      setNotesDraft(submission.triage_notes ?? "")
      setNotesDirty(false)
    }
  }, [submission?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
