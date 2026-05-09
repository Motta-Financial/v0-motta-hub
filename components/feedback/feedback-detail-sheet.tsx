"use client"

/**
 * Side-sheet detail view for a single feedback submission.
 *
 * Sections:
 *  1. Header — submitter, submission timestamp, link out to Jotform
 *  2. Triage controls — status pills, reviewer assignment, internal notes,
 *     optional Karbon Work Item link (free text + URL the firm can paste
 *     in until we wire the live Karbon work-item picker)
 *  3. Ratings panel — overall + four sub-ratings, rendered as full
 *     5-star rows so you can see exactly which dimension dragged the
 *     overall score down
 *  4. Comments + share permission
 *  5. Referrals list — name + email + notes for each
 *  6. Raw answers — every Q/A pair, in form order, as a fallback
 */

import { useEffect, useState } from "react"
import useSWR from "swr"
import {
  AtSign,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquareQuote,
  Share2,
  Star,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const STATUS_OPTIONS = [
  { value: "new", label: "New", className: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "reviewed", label: "Reviewed", className: "bg-sky-50 text-sky-700 border-sky-200" },
  { value: "responded", label: "Responded", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { value: "closed", label: "Closed", className: "bg-slate-50 text-slate-600 border-slate-200" },
] as const

interface JotformAnswer {
  name?: string
  text?: string
  type?: string
  order?: string | number
  answer?: unknown
  prettyFormat?: string
}

interface Referral {
  name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}

interface FeedbackDetail {
  id: string
  jotform_submission_id: string
  jotform_form_id: string
  jotform_created_at: string | null
  status: string | null
  submitter_full_name: string | null
  submitter_first_name: string | null
  submitter_last_name: string | null
  submitter_email: string | null
  client_status: string | null
  rating_overall: number | null
  rating_service_quality: number | null
  rating_communication: number | null
  rating_responsiveness: number | null
  rating_friendliness: number | null
  feedback_comments: string | null
  permission_to_share: boolean | null
  has_referral_interest: boolean | null
  referral_count: number | null
  referrals: Referral[] | null
  triage_status: string | null
  reviewed_by_id: string | null
  reviewed_at: string | null
  internal_notes: string | null
  karbon_work_item_id: string | null
  karbon_work_item_title: string | null
  karbon_work_item_url: string | null
  raw_answers: Record<string, JotformAnswer> | null
  reviewedBy: { id: string; name: string; avatarUrl: string | null } | null
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

export function FeedbackDetailSheet({ submissionId, open, onOpenChange, onChanged }: Props) {
  const { data, isLoading, mutate } = useSWR<{ submission: FeedbackDetail }>(
    submissionId && open ? `/api/jotform/feedback/${submissionId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const { data: teamData } = useSWR<{ team_members: TeamMember[] }>(
    open ? "/api/team-members" : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const teamMembers = teamData?.team_members ?? []

  const submission = data?.submission

  const [savingField, setSavingField] = useState<null | "status" | "reviewer" | "notes" | "karbon">(null)
  const [notesDraft, setNotesDraft] = useState("")
  const [notesDirty, setNotesDirty] = useState(false)
  const [karbonTitle, setKarbonTitle] = useState("")
  const [karbonUrl, setKarbonUrl] = useState("")
  const [karbonDirty, setKarbonDirty] = useState(false)

  // Reset drafts whenever a new submission opens
  useEffect(() => {
    if (submission) {
      setNotesDraft(submission.internal_notes ?? "")
      setNotesDirty(false)
      setKarbonTitle(submission.karbon_work_item_title ?? "")
      setKarbonUrl(submission.karbon_work_item_url ?? "")
      setKarbonDirty(false)
    }
  }, [submission?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(body: Record<string, unknown>, field: typeof savingField) {
    if (!submissionId) return
    setSavingField(field)
    try {
      const res = await fetch(`/api/jotform/feedback/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      await mutate()
      onChanged?.()
    } catch (err) {
      console.error("[v0] feedback PATCH error:", err)
    } finally {
      setSavingField(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="text-xl">Client Feedback</SheetTitle>
          <SheetDescription>
            Submitted via the Feedback &amp; Referral form.
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
                      {(submission.submitter_full_name ?? "?")
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
                      {submission.submitter_full_name ?? "Unknown client"}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>Submission #{submission.jotform_submission_id}</span>
                      <span>·</span>
                      <span>
                        {submission.jotform_created_at
                          ? new Date(submission.jotform_created_at).toLocaleString()
                          : "unknown date"}
                      </span>
                      {submission.client_status && (
                        <>
                          <span>·</span>
                          <Badge variant="outline" className="font-normal">
                            {submission.client_status}
                          </Badge>
                        </>
                      )}
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
                  <ContactLine
                    icon={Mail}
                    value={submission.submitter_email}
                    href={`mailto:${submission.submitter_email}`}
                  />
                )}
                {submission.permission_to_share && (
                  <ContactLine
                    icon={Share2}
                    value="Approved for testimonial / share"
                  />
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
                  const active = (submission.triage_status ?? "new") === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => patch({ triage_status: opt.value }, "status")}
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
                <Label className="text-xs text-muted-foreground">Reviewer</Label>
                <Select
                  value={submission.reviewed_by_id ?? "unassigned"}
                  onValueChange={(v) =>
                    patch({ reviewed_by_id: v === "unassigned" ? null : v }, "reviewer")
                  }
                  disabled={savingField === "reviewer"}
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
                    setNotesDirty(e.target.value !== (submission.internal_notes ?? ""))
                  }}
                  placeholder="Why we routed this here, what action was taken, who needs to follow up…"
                  className="min-h-[80px] text-sm"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant={notesDirty ? "default" : "outline"}
                    disabled={!notesDirty || savingField === "notes"}
                    onClick={() => patch({ internal_notes: notesDraft }, "notes")}
                  >
                    {savingField === "notes" ? "Saving…" : "Save notes"}
                  </Button>
                </div>
              </div>
            </section>

            {/* ───── Linked Karbon Work Item (manual until live picker lands) ───── */}
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Linked Karbon Work Item
              </h3>
              <p className="text-xs text-muted-foreground">
                If this feedback came from a specific engagement, paste the Karbon Work Item title and URL
                so the team can jump from this row to Karbon. The form doesn&apos;t capture this directly
                today, so it&apos;s a manual link until a live picker is added.
              </p>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Title</Label>
                  <Input
                    value={karbonTitle}
                    onChange={(e) => {
                      setKarbonTitle(e.target.value)
                      setKarbonDirty(true)
                    }}
                    placeholder="e.g. 2024 Tax Return — Caswell"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Karbon URL</Label>
                  <Input
                    value={karbonUrl}
                    onChange={(e) => {
                      setKarbonUrl(e.target.value)
                      setKarbonDirty(true)
                    }}
                    placeholder="https://app.karbonhq.com/…"
                    className="text-sm"
                    type="url"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant={karbonDirty ? "default" : "outline"}
                  disabled={!karbonDirty || savingField === "karbon"}
                  onClick={() =>
                    patch(
                      {
                        karbon_work_item_title: karbonTitle.trim() || null,
                        karbon_work_item_url: karbonUrl.trim() || null,
                      },
                      "karbon",
                    )
                  }
                >
                  {savingField === "karbon" ? "Saving…" : "Save Karbon link"}
                </Button>
              </div>
            </section>

            {/* ───── Ratings ───── */}
            <Section title="Ratings">
              <div className="space-y-2">
                <RatingRow label="Overall experience" value={submission.rating_overall} emphasize />
                <RatingRow label="Service quality" value={submission.rating_service_quality} />
                <RatingRow label="Communication" value={submission.rating_communication} />
                <RatingRow label="Responsiveness" value={submission.rating_responsiveness} />
                <RatingRow label="Friendliness" value={submission.rating_friendliness} />
              </div>
            </Section>

            {/* ───── Comments ───── */}
            {submission.feedback_comments && (
              <Section title="What the client said">
                <div className="rounded-md border bg-muted/30 p-3">
                  <MessageSquareQuote className="mb-2 h-4 w-4 text-muted-foreground" />
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {submission.feedback_comments}
                  </p>
                </div>
                {submission.permission_to_share && (
                  <p className="mt-2 text-xs text-emerald-700">
                    Client granted permission to share this feedback publicly.
                  </p>
                )}
              </Section>
            )}

            {/* ───── Referrals ───── */}
            {(submission.referrals?.length ?? 0) > 0 && (
              <Section title={`Referrals (${submission.referrals?.length ?? 0})`}>
                <ul className="space-y-2">
                  {submission.referrals!.map((ref, i) => {
                    const name =
                      ref.name ?? `${ref.first_name ?? ""} ${ref.last_name ?? ""}`.trim() ?? `Referral ${i + 1}`
                    return (
                      <li key={i} className="flex items-start gap-3 rounded-md border p-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-foreground">{name || "Unnamed"}</div>
                          {ref.email && (
                            <a
                              href={`mailto:${ref.email}`}
                              className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <AtSign className="h-3 w-3" />
                              {ref.email}
                            </a>
                          )}
                          {ref.phone && (
                            <div className="text-xs text-muted-foreground">{ref.phone}</div>
                          )}
                          {ref.notes && (
                            <p className="mt-1 text-xs text-muted-foreground">{ref.notes}</p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Section>
            )}

            {/* ───── Raw answers fallback ───── */}
            {submission.raw_answers && (
              <Section title="All answers">
                <RawAnswers answers={submission.raw_answers} />
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
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

function RatingRow({
  label,
  value,
  emphasize,
}: {
  label: string
  value: number | null
  emphasize?: boolean
}) {
  const v = value ?? 0
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <span className={cn("text-sm", emphasize ? "font-medium text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className={cn(
                "h-4 w-4",
                i < v ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/40",
              )}
            />
          ))}
        </span>
        <span className={cn("min-w-[2ch] text-right text-sm tabular-nums", emphasize ? "font-medium" : "text-muted-foreground")}>
          {value != null ? value.toFixed(0) : "—"}
        </span>
      </span>
    </div>
  )
}

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
          <dt className="text-xs font-medium text-muted-foreground md:col-span-1">
            {a.text || a.name || `Q${qid}`}
          </dt>
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
