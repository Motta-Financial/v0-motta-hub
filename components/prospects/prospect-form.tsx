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
 *   - The "Internal notes" textarea replaces both the prospect-authored
 *     "questions or concerns" AND the older "How you met" capture — the
 *     teammate puts where/when they met the prospect, the conversation,
 *     and their read of it all in one free-form field (same convention
 *     as a debrief's notes).
 *   - Attachments (screenshots of prior texts, photos of business
 *     cards, PDFs) are supported via the /attachments endpoint and
 *     stored on the Vercel Blob store.
 *   - The form auto-fills assignee = creator (the teammate filing
 *     the form is usually the same person who'll own the follow-up,
 *     so this is the right default).
 *
 * Services selected drive the form's shape:
 *   - Personal services (Tax Prep, Tax Planning, IRS Support) → show personal block
 *   - Business services (Bookkeeping, Payroll, etc.) → show business block
 *   - Selecting both shows both sections
 *
 * Flow:
 *   1. Teammate fills out the form.
 *   2. Submit -> POST /api/prospects (creates the row + auto-links
 *      a Karbon contact + broadcasts a team-wide email).
 *   3. If attachments are queued, they upload to
 *      /api/prospects/[id]/attachments in parallel.
 *   4. router.push("/prospects/[id]") for the detail/review page,
 *      where the "Create Karbon Work Item" action lives.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  Building2,
  CalendarIcon,
  ListTodo,
  Loader2,
  NotebookPen,
  Paperclip,
  Target,
  Trash2,
  User,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import { PlatformPushRow } from "@/components/prospects/platform-push-row"

// ─────────────────────────────────────────────────────────────────────
// Option sets — sourced from the actual values observed in
// `jotform_intake_submissions` so the prospect form's data shape stays
// 100% compatible with the existing intake pipeline. Where the public
// form has near-duplicate options ("Tax Preparation" vs. "Tax
// Services"), we consolidate to the canonical one — these are
// internal-only.
// ─────────────────────────────────────────────────────────────────────

// Services are the primary driver now. We categorize them by which
// sections they imply. Personal services imply we need personal info;
// business services imply we need business info; some imply both.
const SERVICES = [
  // Personal-focused services
  { label: "Tax Preparation", category: "personal" },
  { label: "Tax Planning & Advisory", category: "personal" },
  { label: "IRS Support & Resolution", category: "personal" },
  { label: "Financial Planning & Wealth Management", category: "personal" },
  // Business-focused services
  { label: "Accounting & Bookkeeping", category: "business" },
  { label: "Payroll Services", category: "business" },
  { label: "Business Advisory", category: "business" },
  { label: "LLC Formation", category: "business" },
  { label: "Legal Entity Services", category: "business" },
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

interface ActionItem {
  id: string
  description: string
  assignee_id: string
  assignee_name: string
  due_date: Date | null
  priority: "low" | "medium" | "high"
  create_task: boolean
}

interface TeamMember {
  id: string
  full_name: string
  email: string
  role?: string
}

// ─────────────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────────────

export function ProspectForm() {
  const router = useRouter()
  const { teamMember } = useUser()

  // ── Services (drives the rest of the form) ─────────────────────────
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  // Free-text description shown when "Other" is checked. We keep this
  // as a separate state (rather than stuffing it into selectedServices)
  // so checking/unchecking "Other" doesn't blow away what the teammate
  // typed -- they can toggle off, change their mind, and the text is
  // preserved until submit. On submit we collapse `"Other" + text` to
  // a single `"Other: <text>"` string in the services array so the
  // server, Karbon sync, and email template don't need a new field.
  const [otherServiceText, setOtherServiceText] = useState("")
  const includesOther = selectedServices.includes("Other")

  // Derive which sections to show based on selected services
  const hasPersonalServices = useMemo(() => {
    return selectedServices.some((s) =>
      SERVICES.find((svc) => svc.label === s && svc.category === "personal"),
    )
  }, [selectedServices])

  const hasBusinessServices = useMemo(() => {
    return selectedServices.some((s) =>
      SERVICES.find((svc) => svc.label === s && svc.category === "business"),
    )
  }, [selectedServices])

  // Show sections: if no services selected, show both; otherwise show based on selection
  const personalVisible = selectedServices.length === 0 || hasPersonalServices
  const businessVisible = selectedServices.length === 0 || hasBusinessServices

  // Required: Personal is required if ONLY personal services selected (no business services)
  const personalRequired = hasPersonalServices && !hasBusinessServices
  // Required: Business is required if ONLY business services selected (no personal services)
  const businessRequired = hasBusinessServices && !hasPersonalServices

  // ── Personal ───────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zip, setZip] = useState("")

  // ── Business (entity types now lives in this section) ─────────────
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

  // ── Internal notes (also captures the "how/where you met" context
  //    that used to live in its own card — same convention as a
  //    debrief, where everything goes in one free-form notes field) ──
  const [internalNotes, setInternalNotes] = useState("")

  // ── Platform-push picker ───────────────────────────────────────────
  // The Master Hub Contact is always created from the form. These
  // toggles only control which downstream platforms we ALSO push to
  // at submit time. Karbon is the only push that is fully wired today
  // (it auto-creates the Karbon contact + mirrors Karbon keys back).
  // ProConnect / Ignition pushes are recorded as intent — the
  // contact detail page will show a "Push now" affordance once those
  // workers are wired up.
  //
  // We initialize each toggle to undefined and let the auto-recommend
  // effect below set it based on the selected services. The teammate
  // can override at any time; once they touch a toggle we stop
  // auto-recommending for that platform (tracked via the *Touched
  // refs).
  const [pushToKarbon, setPushToKarbon] = useState(true)
  const [pushToProconnect, setPushToProconnect] = useState(false)
  const [pushToIgnition, setPushToIgnition] = useState(false)
  const karbonTouched = useRef(false)
  const proconnectTouched = useRef(false)
  const ignitionTouched = useRef(false)

  // ── Action Items ───────────────────────────────────────────────────
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false)

  const [attachments, setAttachments] = useState<QueuedAttachment[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Fetch team members for action item assignees
  useEffect(() => {
    async function fetchTeamMembers() {
      setLoadingTeamMembers(true)
      try {
        const res = await fetch("/api/team-members")
        const data = await res.json()
        setTeamMembers(
          (data.team_members || []).map((t: any) => ({
            id: t.id,
            full_name: t.full_name,
            email: t.email,
            role: t.role,
          })),
        )
      } catch (err) {
        console.error("Error fetching team members:", err)
      } finally {
        setLoadingTeamMembers(false)
      }
    }
    fetchTeamMembers()
  }, [])

  // ── Auto-recommend platform pushes ─────────────────────────────────
  // Re-runs whenever the teammate adjusts services or business name.
  // We only update toggles that the teammate has not explicitly
  // touched — once they uncheck a recommendation we never reinstate
  // it from a downstream service change.
  useEffect(() => {
    const services = selectedServices.map((s) => s.toLowerCase())
    const looksTax = services.some(
      (s) => s.includes("tax") || s.includes("1040") || s.includes("return"),
    )
    const hasBiz = !!businessName.trim() || hasBusinessServices
    if (!karbonTouched.current) setPushToKarbon(true)
    if (!proconnectTouched.current) setPushToProconnect(looksTax)
    if (!ignitionTouched.current) setPushToIgnition(hasBiz)
  }, [selectedServices, businessName, hasBusinessServices])

  // ── Validation ─────────────────────────────────────────────────────
  // Required fields are driven by the selected services:
  //   Personal only services → First, Last, Email, Phone
  //   Business only services → Business Name
  //   Both types of services → both sets of fields
  //   No services selected   → fall back to "first+last OR business" so
  //                            the form still works as a quick capture
  //                            while a teammate is mid-thought.
  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (!teamMember?.id) return false

    // If personal services only — require personal info
    if (personalRequired) {
      return Boolean(
        firstName.trim() && lastName.trim() && email.trim() && phone.trim(),
      )
    }

    // If business services only — require business name
    if (businessRequired) {
      return Boolean(businessName.trim())
    }

    // If both types selected — require both
    if (hasPersonalServices && hasBusinessServices) {
      return Boolean(
        firstName.trim() &&
          lastName.trim() &&
          email.trim() &&
          phone.trim() &&
          businessName.trim(),
      )
    }

    // No services selected yet — fall back to the original rule.
    const hasPersonal = firstName.trim() && lastName.trim()
    const hasBusiness = businessName.trim()
    return Boolean(hasPersonal || hasBusiness)
  }, [
    submitting,
    teamMember?.id,
    personalRequired,
    businessRequired,
    hasPersonalServices,
    hasBusinessServices,
    firstName,
    lastName,
    email,
    phone,
    businessName,
  ])

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

  // ── Action Item Helpers ────────────────────────────────────────────
  function addActionItem() {
    const newItem: ActionItem = {
      id: crypto.randomUUID(),
      description: "",
      assignee_id: teamMember?.id || "",
      assignee_name: teamMember?.full_name || "",
      due_date: null,
      priority: "medium",
      create_task: true,
    }
    setActionItems((prev) => [...prev, newItem])
  }

  function updateActionItem(id: string, updates: Partial<ActionItem>) {
    setActionItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    )
  }

  function removeActionItem(id: string) {
    setActionItems((prev) => prev.filter((item) => item.id !== id))
  }

  // ── Submit ─────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !teamMember) return
    setSubmitting(true)
    setError(null)

    try {
      // When the teammate selected only personal services we explicitly
      // null out the business payload so the server doesn't persist
      // half-typed-then-abandoned fields if the user toggled services
      // late in the session.
      const onlyPersonal = hasPersonalServices && !hasBusinessServices

      // Derive a "service_focus" value for backward compatibility
      let serviceFocus: string | null = null
      if (hasPersonalServices && hasBusinessServices) {
        serviceFocus = "Both Personal & Business"
      } else if (hasPersonalServices) {
        serviceFocus = "Personal Only"
      } else if (hasBusinessServices) {
        serviceFocus = "Business Only"
      }

      // Step 1 — create the row + auto-link Karbon contact + send
      // the team-wide email (server-side).
      const createRes = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          created_by_id: teamMember.id,

          submitter_first_name: firstName,
          submitter_last_name: lastName,
          submitter_email: email,
          submitter_phone: phone,
          submitter_city: city,
          submitter_state: state,
          submitter_zip: zip,

          // Collapse the "Other" sentinel + the free-text description
          // into a single string so the downstream pipeline (server,
          // Karbon sync, broadcast email) keeps using a flat string[].
          // If "Other" is checked but the description is empty we just
          // pass through "Other" -- the team can see it in the email
          // and ask follow-up questions.
          services_requested: selectedServices.map((s) =>
            s === "Other" && otherServiceText.trim()
              ? `Other: ${otherServiceText.trim()}`
              : s,
          ),
          service_focus: serviceFocus,
          entity_types: onlyPersonal ? null : entityTypes,

          business_situation: onlyPersonal ? null : businessSituation || null,
          business_name: onlyPersonal ? null : businessName,
          business_email: onlyPersonal ? null : businessEmail,
          business_phone: onlyPersonal ? null : businessPhone,
          business_state: onlyPersonal ? null : businessState,
          business_tax_classification: onlyPersonal ? null : businessTaxClass || null,
          business_revenue_range: onlyPersonal ? null : businessRevenue || null,
          business_employee_count: onlyPersonal ? null : businessEmployees,
          business_uses_accounting_system: onlyPersonal
            ? null
            : businessUsesSystem || null,
          business_summary: onlyPersonal ? null : businessSummary,

          internal_notes: internalNotes,

          // Platform-push intent (see Platform Sync card below).
          push_to_karbon: pushToKarbon,
          push_to_proconnect: pushToProconnect,
          push_to_ignition: pushToIgnition,

          // Action items — same shape as debriefs
          action_items: actionItems.map((item) => ({
            description: item.description,
            assignee_id: item.assignee_id,
            assignee_name: item.assignee_name,
            due_date: item.due_date?.toISOString().split("T")[0] || null,
            priority: item.priority,
            create_task: item.create_task,
          })),
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
        <p className="text-xs text-muted-foreground">
          Required fields are marked with{" "}
          <span className="text-destructive">*</span> — which fields are required
          depends on which services you select below.
        </p>
      </header>

      {/* ─── Services (hoisted to top — drives the rest of the form) ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Services requested</CardTitle>
          </div>
          <CardDescription>
            What services is this prospect interested in? Your selection determines which
            sections appear below — personal services show the personal info block, business
            services show the business info block.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SERVICES.map((svc) => (
              <label
                key={svc.label}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                  selectedServices.includes(svc.label) && "border-foreground/40 bg-muted/60",
                )}
              >
                <Checkbox
                  checked={selectedServices.includes(svc.label)}
                  onCheckedChange={() =>
                    setSelectedServices((prev) => toggle(prev, svc.label))
                  }
                />
                <span className="text-foreground">{svc.label}</span>
                <Badge variant="outline" className="ml-auto text-[10px] capitalize">
                  {svc.category}
                </Badge>
              </label>
            ))}

            {/* "Other" tile -- full-width so the description input has
                room to read. Intentionally not added to the SERVICES
                array (which has category-based section gating); "Other"
                has no implied category so it doesn't toggle the personal
                or business sections on its own. If a teammate selects
                ONLY "Other", the form falls back to the no-services
                rule (first+last OR business name) and both sections
                stay visible. */}
            <div
              className={cn(
                "flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors sm:col-span-2",
                includesOther && "border-foreground/40 bg-muted/60",
              )}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={includesOther}
                  onCheckedChange={() =>
                    setSelectedServices((prev) => toggle(prev, "Other"))
                  }
                />
                <span className="text-foreground">Other</span>
                <Badge variant="outline" className="ml-auto text-[10px] capitalize">
                  Custom
                </Badge>
              </label>
              {includesOther && (
                <Textarea
                  value={otherServiceText}
                  onChange={(e) => setOtherServiceText(e.target.value)}
                  placeholder='Describe the service the prospect is interested in — e.g. "M&A due diligence", "Quarterly CFO advisory", "Estate planning for a recent inheritance"'
                  className="min-h-[64px] text-sm"
                />
              )}
            </div>
          </div>
          {selectedServices.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Selected:{" "}
              {selectedServices
                .map((s) =>
                  s === "Other" && otherServiceText.trim()
                    ? `Other: ${otherServiceText.trim()}`
                    : s,
                )
                .join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ─── Personal info ─── */}
      {personalVisible && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Prospect details</CardTitle>
              {personalRequired && (
                <Badge variant="outline" className="text-[10px]">
                  Required
                </Badge>
              )}
            </div>
            <CardDescription>
              {personalRequired
                ? "First name, last name, email, and phone are required."
                : "Anything you know about the person. Email or phone is what powers the Karbon contact match."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first">
                First name {personalRequired && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required={personalRequired}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last">
                Last name {personalRequired && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required={personalRequired}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">
                Email {personalRequired && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prospect@example.com"
                required={personalRequired}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                Phone {personalRequired && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                required={personalRequired}
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
      )}

      {/* ─── Business info (includes Entity types) ─── */}
      {businessVisible && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Business details</CardTitle>
              {businessRequired && (
                <Badge variant="outline" className="text-[10px]">
                  Required
                </Badge>
              )}
            </div>
            <CardDescription>
              {businessRequired
                ? "Business name is required. Fill in everything else you know."
                : "Fill in whatever you know. Leave the rest blank — the form mirrors the public intake and tolerates partial data the same way."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="biz-name">
                  Business name{" "}
                  {businessRequired && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="biz-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required={businessRequired}
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
          </CardContent>
        </Card>
      )}

      {/* ─── Internal notes (also captures how/where you met — same
           convention as a debrief, free-form) ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Internal notes</CardTitle>
          </div>
          <CardDescription>
            Where and when you met them, your read of the conversation, pain points
            they mentioned, services they&apos;d be a fit for, references they shared
            — anything else. Never visible to the prospect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            className="min-h-[160px]"
            placeholder='e.g. "Met at AICPA Engage 06/10. Referred by Jane Doe. Runs a 6-person CPA firm in Atlanta — wants to outsource bookkeeping. Pain point: month-end close takes them 3 weeks."'
          />
        </CardContent>
      </Card>

      {/* ─── Action Items ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            Action Items & Follow-ups
          </CardTitle>
          <CardDescription>
            Add tasks with assignees. Enable "Create Task" to automatically create a task in the system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionItems.map((item, index) => (
            <div key={item.id} className="p-4 border rounded-lg space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Action Item {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeActionItem(item.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <Input
                placeholder="Describe the action item..."
                value={item.description}
                onChange={(e) => updateActionItem(item.id, { description: e.target.value })}
              />

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Assignee</Label>
                  <Select
                    value={item.assignee_id}
                    onValueChange={(value) => {
                      const member = teamMembers.find((m) => m.id === value)
                      updateActionItem(item.id, {
                        assignee_id: value,
                        assignee_name: member?.full_name || "",
                      })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teamMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Priority</Label>
                  <Select
                    value={item.priority}
                    onValueChange={(value: "low" | "medium" | "high") =>
                      updateActionItem(item.id, { priority: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Due Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !item.due_date && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-3 w-3" />
                        {item.due_date ? format(item.due_date, "MM/dd/yy") : "Set date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={item.due_date || undefined}
                        onSelect={(date) => updateActionItem(item.id, { due_date: date || null })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id={`create-task-${item.id}`}
                  checked={item.create_task}
                  onCheckedChange={(checked) =>
                    updateActionItem(item.id, { create_task: !!checked })
                  }
                />
                <Label htmlFor={`create-task-${item.id}`} className="text-xs">
                  Create as task in system
                </Label>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" className="w-full" onClick={addActionItem}>
            <ListTodo className="mr-2 h-4 w-4" />
            Add Action Item
          </Button>
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
              drag &amp; drop
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

      {/* ─── Platform Sync ─── */}
      {/*
        Master Hub Contact is always created on submit (Hub-first).
        These toggles let the teammate decide which downstream
        platforms to ALSO create-or-link a contact in. The picker
        auto-recommends:
          • Karbon — always recommended (every prospect is billable).
          • ProConnect — when services include tax / 1040 / returns.
          • Ignition — when the prospect has a business (proposal flow).
        Touching any toggle "pins" the teammate's choice; we never
        re-recommend after that.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform Sync</CardTitle>
          <CardDescription>
            We always create the Master Hub Contact. Pick which other
            platforms to also create or link this prospect in. Recommendations
            update automatically as you fill out the form — uncheck any that
            don&apos;t apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PlatformPushRow
            id="push-karbon"
            label="Karbon"
            description="CRM + work-item home. Pushes immediately on submit."
            recommended
            checked={pushToKarbon}
            onChange={(v) => {
              karbonTouched.current = true
              setPushToKarbon(v)
            }}
          />
          <PlatformPushRow
            id="push-proconnect"
            label="ProConnect"
            description="Tax-prep platform. Recommended for tax engagements."
            recommended={(() => {
              const s = selectedServices.map((x) => x.toLowerCase())
              return s.some(
                (x) => x.includes("tax") || x.includes("1040") || x.includes("return"),
              )
            })()}
            checked={pushToProconnect}
            onChange={(v) => {
              proconnectTouched.current = true
              setPushToProconnect(v)
            }}
            queuedNote="Queued — sync runs from contact detail page."
          />
          <PlatformPushRow
            id="push-ignition"
            label="Ignition"
            description="Proposals + engagement letters. Recommended for businesses."
            recommended={!!businessName.trim() || hasBusinessServices}
            checked={pushToIgnition}
            onChange={(v) => {
              ignitionTouched.current = true
              setPushToIgnition(v)
            }}
            queuedNote="Queued — sync runs from contact detail page."
          />
        </CardContent>
      </Card>

      {/* ─── Submit ─── */}
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          On submit, we&apos;ll create the Master Hub Contact, push to any
          selected platforms above, email the team, and take you to the
          prospect&apos;s detail page.
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
