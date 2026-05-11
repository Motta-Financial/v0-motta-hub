"use client"

/**
 * <ProspectForm /> — internal, Hub-native intake.
 *
 * Mirrors the public Jotform intake's information architecture so the
 * downstream pipeline (Karbon contact creation, work-item action,
 * intake auto-matcher) can reuse the same data shape verbatim. The
 * key semantic differences vs. the public form:
 *
 *   - Author is the logged-in teammate (created_by_id), not the
 *     prospect.
 *   - The "Internal notes" textarea replaces the prospect-authored
 *     "questions or concerns" — the teammate captures their own
 *     read of the conversation.
 *   - Attachments (screenshots of prior texts, photos of business
 *     cards, PDFs) are supported via the /attachments endpoint and
 *     stored on the Vercel Blob store.
 *   - The form auto-fills assignee = creator (the teammate filing
 *     the form is usually the same person who'll own the follow-up,
 *     so this is the right default).
 *
 * Flow:
 *   1. Teammate fills out the form.
 *   2. Submit -> POST /api/prospects (creates the row + auto-links
 *      a Karbon contact).
 *   3. If attachments are queued, they upload to
 *      /api/prospects/[id]/attachments in parallel.
 *   4. router.push("/prospects/[id]") for the detail/review page,
 *      where the "Create Karbon Work Item" action lives.
 */

import { useCallback, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  FileText,
  Loader2,
  NotebookPen,
  Paperclip,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useUser } from "@/hooks/use-user"

// ─────────────────────────────────────────────────────────────────────
// Option sets — sourced from the actual values observed in
// `jotform_intake_submissions` so the prospect form's data shape stays
// 100% compatible with the existing intake pipeline. Where the public
// form has near-duplicate options ("Tax Preparation" vs. "Tax
// Services"), we consolidate to the canonical one — these are
// internal-only.
// ─────────────────────────────────────────────────────────────────────

const SERVICE_FOCUSES = [
  "Personal Only",
  "Business Only",
  "Both Personal & Business",
] as const

const SERVICES = [
  "Tax Preparation",
  "Tax Planning & Advisory",
  "Accounting & Bookkeeping",
  "Payroll Services",
  "Business Advisory",
  "Financial Planning & Wealth Management",
  "IRS Support & Resolution",
  "LLC Formation",
  "Legal Entity Services",
] as const

const ENTITY_TYPES = [
  "Individual (1040)",
  "Single Member LLC (Sch C)",
  "Partnership (1065)",
  "S-Corp (1120-S)",
  "C-Corp (1065)",
  "Exempt Entities (990)",
  "N/A",
] as const

const REVENUE_RANGES = [
  "<$50k",
  "$50k-$250k",
  "$250k-$500k",
  "$500k-$1M",
  "$1M+",
] as const

const TAX_CLASSIFICATIONS = [
  "Sole Proprietorship",
  "Limited Liability Company (LLC)",
  "Partnership",
  "S-Corp",
  "C-Corp",
  "Nonprofit",
] as const

const BUSINESS_SITUATIONS = [
  "I am seeking services for an existing business",
  "I am looking for help setting up a new business",
] as const

// Hard ceiling matched to the server-side check in the attachments
// route. Surfaced as 25 MB in the UI copy too so the teammate sees
// the limit without trying-and-failing.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

interface QueuedAttachment {
  // Temp UUID for keying the list before upload — discarded after.
  tempId: string
  file: File
  status: "queued" | "uploading" | "uploaded" | "error"
  error?: string
  // The pathname returned by Blob — set once status === "uploaded".
  pathname?: string
}

type ServiceFocus = (typeof SERVICE_FOCUSES)[number]

// ─────────────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────────────

export function ProspectForm() {
  const router = useRouter()
  const { teamMember } = useUser()

  // ── Section state ──────────────────────────────────────────────────
  const [meetingContext, setMeetingContext] = useState("")

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zip, setZip] = useState("")

  const [serviceFocus, setServiceFocus] = useState<ServiceFocus | "">("")
  const [services, setServices] = useState<string[]>([])
  const [entityTypes, setEntityTypes] = useState<string[]>([])

  const [businessSituation, setBusinessSituation] = useState<string>("")
  const [businessName, setBusinessName] = useState("")
  const [businessEmail, setBusinessEmail] = useState("")
  const [businessPhone, setBusinessPhone] = useState("")
  const [businessState, setBusinessState] = useState("")
  const [businessTaxClass, setBusinessTaxClass] = useState<string>("")
  const [businessRevenue, setBusinessRevenue] = useState<string>("")
  const [businessEmployees, setBusinessEmployees] = useState("")
  const [businessUsesSystem, setBusinessUsesSystem] = useState<string>("")
  const [businessSummary, setBusinessSummary] = useState("")

  const [internalNotes, setInternalNotes] = useState("")

  const [attachments, setAttachments] = useState<QueuedAttachment[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Disable the business section when the focus is personal-only —
  // mirrors the public form's branching so the teammate isn't
  // tempted to fill out business fields that the pipeline will
  // ignore.
  const businessDisabled = serviceFocus === "Personal Only"

  // ── Validation ─────────────────────────────────────────────────────
  // We require either a complete personal name OR a business name so
  // the row can always render with a sensible identity.
  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (!teamMember?.id) return false
    const hasPersonal = firstName.trim() && lastName.trim()
    const hasBusiness = businessName.trim()
    return Boolean(hasPersonal || hasBusiness)
  }, [submitting, teamMember?.id, firstName, lastName, businessName])

  // ── Helpers ────────────────────────────────────────────────────────
  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  const onPickFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    const incoming: QueuedAttachment[] = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        incoming.push({
          tempId: crypto.randomUUID(),
          file: f,
          status: "error",
          error: `Larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`,
        })
        continue
      }
      incoming.push({
        tempId: crypto.randomUUID(),
        file: f,
        status: "queued",
      })
    }
    setAttachments((prev) => [...prev, ...incoming])
  }, [])

  function removeAttachment(tempId: string) {
    setAttachments((prev) => prev.filter((a) => a.tempId !== tempId))
  }

  // ── Submit ─────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !teamMember) return
    setSubmitting(true)
    setError(null)

    try {
      // Step 1 — create the row + auto-link Karbon contact.
      const createRes = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          created_by_id: teamMember.id,
          meeting_context: meetingContext,

          submitter_first_name: firstName,
          submitter_last_name: lastName,
          submitter_email: email,
          submitter_phone: phone,
          submitter_city: city,
          submitter_state: state,
          submitter_zip: zip,

          services_requested: services,
          service_focus: serviceFocus || null,
          entity_types: entityTypes,

          business_situation: businessDisabled ? null : businessSituation || null,
          business_name: businessDisabled ? null : businessName,
          business_email: businessDisabled ? null : businessEmail,
          business_phone: businessDisabled ? null : businessPhone,
          business_state: businessDisabled ? null : businessState,
          business_tax_classification: businessDisabled ? null : businessTaxClass || null,
          business_revenue_range: businessDisabled ? null : businessRevenue || null,
          business_employee_count: businessDisabled ? null : businessEmployees,
          business_uses_accounting_system: businessDisabled
            ? null
            : businessUsesSystem || null,
          business_summary: businessDisabled ? null : businessSummary,

          internal_notes: internalNotes,
        }),
      })

      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}))
        throw new Error(j?.error || `Failed to create prospect (${createRes.status})`)
      }

      const { id: prospectId } = (await createRes.json()) as { id: string }

      // Step 2 — upload attachments. Sequential to keep error
      // handling simple; this set is small (typically 0-3 files)
      // so parallel uploads aren't worth the complexity here.
      const toUpload = attachments.filter((a) => a.status === "queued")
      for (const att of toUpload) {
        const form = new FormData()
        form.append("file", att.file)
        form.append("uploaded_by_id", teamMember.id)
        await fetch(`/api/prospects/${prospectId}/attachments`, {
          method: "POST",
          body: form,
        })
        // We don't surface individual upload errors here — the
        // detail page will show the actual saved attachments so
        // the teammate can re-attach if one slipped through.
      }

      // Step 3 — go to the detail page for review + Karbon
      // work-item creation.
      router.push(`/prospects/${prospectId}`)
    } catch (err: any) {
      console.error("[v0] ProspectForm submit error:", err)
      setError(err?.message ?? "Submission failed")
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Page header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          New Prospect
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Use this internal form when you meet a prospect out in the world — at a
          conference, by referral, by text — and want to capture them in Motta Hub
          without asking them to fill out the public intake form.
        </p>
      </header>

      {/* ─── Meeting context ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">How you met</CardTitle>
          </div>
          <CardDescription>
            Where and when you connected. Surfaces on the Karbon timeline so partners reading the
            contact later understand the provenance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={meetingContext}
            onChange={(e) => setMeetingContext(e.target.value)}
            placeholder='e.g. "Met at AICPA Engage 06/10. Referred by Jane Doe. Sat next to him at lunch — runs a 6-person CPA firm in Atlanta and wants to outsource bookkeeping."'
            className="min-h-[88px]"
          />
        </CardContent>
      </Card>

      {/* ─── Personal info ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Prospect details</CardTitle>
          </div>
          <CardDescription>
            Anything you know about the person. Email or phone is what powers
            the Karbon contact match.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="first">First name</Label>
            <Input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last">Last name</Label>
            <Input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prospect@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="state">State</Label>
            <Input id="state" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zip">ZIP</Label>
            <Input id="zip" value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* ─── Services ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Services & interest</CardTitle>
          </div>
          <CardDescription>
            What is the prospect actually asking for? Matches the option set on the public
            intake form so downstream Karbon work-template selection stays consistent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="focus">Service focus</Label>
            <Select
              value={serviceFocus}
              onValueChange={(v) => setServiceFocus(v as ServiceFocus)}
            >
              <SelectTrigger id="focus">
                <SelectValue placeholder="Personal, business, or both?" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_FOCUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Services requested</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SERVICES.map((s) => (
                <label
                  key={s}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                    services.includes(s) && "border-foreground/40 bg-muted/60",
                  )}
                >
                  <Checkbox
                    checked={services.includes(s)}
                    onCheckedChange={() => setServices((prev) => toggle(prev, s))}
                  />
                  <span className="text-foreground">{s}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Entity types (if known)</Label>
            <div className="flex flex-wrap gap-2">
              {ENTITY_TYPES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEntityTypes((prev) => toggle(prev, e))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    entityTypes.includes(e)
                      ? "border-foreground/40 bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Business info ─── */}
      <Card className={cn(businessDisabled && "opacity-60")}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Business details</CardTitle>
            {businessDisabled && (
              <Badge variant="outline" className="text-[10px]">
                Skipped — Personal Only
              </Badge>
            )}
          </div>
          <CardDescription>
            Fill in whatever you know. Leave the rest blank — the form mirrors the
            public intake and tolerates partial data the same way.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset disabled={businessDisabled} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="biz-name">Business name</Label>
                <Input
                  id="biz-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-situation">Situation</Label>
                <Select value={businessSituation} onValueChange={setBusinessSituation}>
                  <SelectTrigger id="biz-situation">
                    <SelectValue placeholder="Existing or new?" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_SITUATIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-email">Business email</Label>
                <Input
                  id="biz-email"
                  type="email"
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-phone">Business phone</Label>
                <Input
                  id="biz-phone"
                  type="tel"
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-state">Business state</Label>
                <Input
                  id="biz-state"
                  value={businessState}
                  onChange={(e) => setBusinessState(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-tax">Tax classification</Label>
                <Select value={businessTaxClass} onValueChange={setBusinessTaxClass}>
                  <SelectTrigger id="biz-tax">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_CLASSIFICATIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-rev">Revenue range</Label>
                <Select value={businessRevenue} onValueChange={setBusinessRevenue}>
                  <SelectTrigger id="biz-rev">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {REVENUE_RANGES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-emp">Employees (approx.)</Label>
                <Input
                  id="biz-emp"
                  value={businessEmployees}
                  onChange={(e) => setBusinessEmployees(e.target.value)}
                  placeholder="e.g. 12"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-acct">Uses accounting system?</Label>
                <Input
                  id="biz-acct"
                  value={businessUsesSystem}
                  onChange={(e) => setBusinessUsesSystem(e.target.value)}
                  placeholder="e.g. QuickBooks Online"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="biz-summary">Business summary</Label>
              <Textarea
                id="biz-summary"
                value={businessSummary}
                onChange={(e) => setBusinessSummary(e.target.value)}
                className="min-h-[80px]"
                placeholder="What the business does, customers, anything else relevant."
              />
            </div>
          </fieldset>
        </CardContent>
      </Card>

      {/* ─── Internal notes ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Internal notes</CardTitle>
          </div>
          <CardDescription>
            Your read of the conversation — pain points they mentioned, services they'd
            be a fit for, references they shared, anything else. Never visible to the
            prospect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            className="min-h-[140px]"
            placeholder="Free-form. Bullet points, paragraphs, whatever's quickest."
          />
        </CardContent>
      </Card>

      {/* ─── Attachments ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Attachments</CardTitle>
          </div>
          <CardDescription>
            Optional: screenshots of prior text messages, photos of business cards, PDFs.
            Up to 25 MB per file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              onPickFiles(e.dataTransfer.files)
            }}
            className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <Paperclip className="h-5 w-5" />
            <p>
              <span className="font-medium text-foreground">Click to upload</span> or
              drag & drop
            </p>
            <p className="text-xs">PNG, JPG, PDF, screenshots, etc.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onPickFiles(e.target.files)}
          />

          {attachments.length > 0 && (
            <ul className="space-y-2">
              {attachments.map((a) => (
                <li
                  key={a.tempId}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm",
                    a.status === "error" && "border-destructive/40 bg-destructive/5",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{a.file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(a.file.size)}
                      {a.status === "error" && a.error ? ` · ${a.error}` : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.tempId)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Remove attachment"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ─── Submit ─── */}
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          On submit, we'll auto-match a Karbon contact (or create one) and take you to
          the prospect's detail page where you can create the Karbon Work Item.
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs font-medium text-destructive">{error}</span>
          )}
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save prospect"
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
