"use client"

/**
 * <ProspectForm /> — internal, Hub-native intake.
 *
 * Type-driven: the teammate first picks whether the prospect is an
 * Individual, a Business, or "Individual & Business" (business owners —
 * a person AND their company). That choice drives which blocks are
 * required:
 *
 *   - Individual           → first/last name, email, phone (state optional)
 *   - Business             → business name, email, phone (tax class +
 *                            state optional). "Same as owner" copies the
 *                            individual's email/phone.
 *   - Individual & Business→ both of the above.
 *
 * Socials (website, LinkedIn, X, Facebook, Instagram) are optional for
 * both the person and the business, and feed ALFRED's enrichment +
 * the Karbon BusinessCard.
 *
 * A referral lookup links the prospect to an existing Hub contact (or
 * records a free-text referrer for human review). Services, action
 * items, attachments, and the platform-push toggles are preserved as
 * optional secondary sections.
 *
 * An optional "Create Karbon Work Item" section lets the teammate pick a
 * Karbon work template and fill in the core WorkItem fields up front.
 *
 * Flow:
 *   1. Teammate fills out the form.
 *   2. Submit -> POST /api/prospects (creates the row, the master Hub
 *      contact/org, links the referral, creates the Karbon contact +
 *      pinned note + optional work item, and emails the team as ALFRED).
 *   3. Queued attachments upload to /api/prospects/[id]/attachments.
 *   4. router.push("/prospects/[id]") for the detail/review page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  Building2,
  CalendarIcon,
  Check,
  ChevronsUpDown,
  ClipboardList,
  ListTodo,
  Loader2,
  NotebookPen,
  Paperclip,
  Search,
  Share2,
  Target,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
// Option sets
// ─────────────────────────────────────────────────────────────────────

type ProspectType = "individual" | "business" | "individual_business"

const PROSPECT_TYPES: {
  value: ProspectType
  label: string
  hint: string
  icon: typeof User
}[] = [
  {
    value: "individual",
    label: "Individual",
    hint: "A person — 1040, tax planning, IRS support.",
    icon: User,
  },
  {
    value: "business",
    label: "Business",
    hint: "A company — bookkeeping, payroll, entity work.",
    icon: Building2,
  },
  {
    value: "individual_business",
    label: "Individual & Business",
    hint: "Business owners — a person and their company.",
    icon: Users,
  },
]

const SERVICES = [
  { label: "Tax Preparation", category: "personal" },
  { label: "Tax Planning & Advisory", category: "personal" },
  { label: "IRS Support & Resolution", category: "personal" },
  { label: "Financial Planning & Wealth Management", category: "personal" },
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

const REVENUE_RANGES = ["<$50k", "$50k-$250k", "$250k-$500k", "$500k-$1M", "$1M+"] as const

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

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

interface QueuedAttachment {
  tempId: string
  file: File
  status: "queued" | "uploading" | "uploaded" | "error"
  error?: string
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

interface WorkTemplate {
  key: string
  title: string
  workTypeKey: string | null
  estimatedBudgetMinutes: number | null
}

interface WorkStatus {
  key: string
  primary: string | null
  secondary: string | null
  label: string
  workTypeKeys: string[]
}

interface SearchHit {
  id: string
  name: string
  email: string | null
  kind: "contact" | "organization"
}

// ─────────────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────────────

export function ProspectForm() {
  const router = useRouter()
  const { teamMember } = useUser()

  // ── Prospect type (drives required fields + which blocks show) ─────
  const [prospectType, setProspectType] = useState<ProspectType>("individual")
  const showPersonal = prospectType === "individual" || prospectType === "individual_business"
  const showBusiness = prospectType === "business" || prospectType === "individual_business"
  const isOwner = prospectType === "individual_business"

  // ── Services (optional now — no longer drives the form) ────────────
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [otherServiceText, setOtherServiceText] = useState("")
  const includesOther = selectedServices.includes("Other")
  const hasBusinessServices = useMemo(
    () =>
      selectedServices.some((s) =>
        SERVICES.find((svc) => svc.label === s && svc.category === "business"),
      ),
    [selectedServices],
  )

  // ── Personal ───────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zip, setZip] = useState("")

  // ── Personal socials ───────────────────────────────────────────────
  const [website, setWebsite] = useState("")
  const [linkedin, setLinkedin] = useState("")
  const [twitter, setTwitter] = useState("")
  const [facebook, setFacebook] = useState("")
  const [instagram, setInstagram] = useState("")

  // ── Business ───────────────────────────────────────────────────────
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
  const [bizEmailSameAsOwner, setBizEmailSameAsOwner] = useState(false)
  const [bizPhoneSameAsOwner, setBizPhoneSameAsOwner] = useState(false)

  // ── Business socials ───────────────────────────────────────────────
  const [bizWebsite, setBizWebsite] = useState("")
  const [bizLinkedin, setBizLinkedin] = useState("")
  const [bizTwitter, setBizTwitter] = useState("")
  const [bizFacebook, setBizFacebook] = useState("")
  const [bizInstagram, setBizInstagram] = useState("")

  // Effective business contact values (handles "same as owner").
  const effectiveBusinessEmail = isOwner && bizEmailSameAsOwner ? email : businessEmail
  const effectiveBusinessPhone = isOwner && bizPhoneSameAsOwner ? phone : businessPhone

  // ── Referral lookup ────────────────────────────────────────────────
  const [referralQuery, setReferralQuery] = useState("")
  const [referralResults, setReferralResults] = useState<SearchHit[]>([])
  const [referralLoading, setReferralLoading] = useState(false)
  const [referralOpen, setReferralOpen] = useState(false)
  const [selectedReferrer, setSelectedReferrer] = useState<SearchHit | null>(null)
  const referralDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Internal notes ─────────────────────────────────────────────────
  const [internalNotes, setInternalNotes] = useState("")

  // ── Platform-push picker ───────────────────────────────────────────
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

  // ── Karbon work item (optional) ────────────────────────────────────
  const [createWorkItem, setCreateWorkItem] = useState(false)
  const [workTemplates, setWorkTemplates] = useState<WorkTemplate[]>([])
  const [workStatuses, setWorkStatuses] = useState<WorkStatus[]>([])
  const [wiTemplateKey, setWiTemplateKey] = useState("")
  const [wiTemplatePickerOpen, setWiTemplatePickerOpen] = useState(false)
  const [wiTitle, setWiTitle] = useState("")
  const [wiTitleTouched, setWiTitleTouched] = useState(false)
  const [wiAssigneeId, setWiAssigneeId] = useState("")
  const [wiStartDate, setWiStartDate] = useState<Date | null>(null)
  const [wiDueDate, setWiDueDate] = useState<Date | null>(null)
  const [wiBudgetHours, setWiBudgetHours] = useState("")
  const [wiStatusKey, setWiStatusKey] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Default the work-item assignee to the logged-in teammate.
  useEffect(() => {
    if (teamMember?.id && !wiAssigneeId) setWiAssigneeId(teamMember.id)
  }, [teamMember?.id, wiAssigneeId])

  // Fetch team members for action item + work-item assignees.
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

  // Lazy-load Karbon work templates + statuses the first time the
  // teammate opens the work-item section.
  useEffect(() => {
    if (!createWorkItem || workTemplates.length > 0) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/karbon/work-templates")
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setWorkTemplates(data.templates || [])
        setWorkStatuses(data.statuses || [])
      } catch (err) {
        console.error("[v0] failed to load work templates:", err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [createWorkItem, workTemplates.length])

  // Auto-suggest a work-item title from the template + prospect name,
  // until the teammate edits it themselves.
  const selectedTemplate = useMemo(
    () => workTemplates.find((t) => t.key === wiTemplateKey) || null,
    [workTemplates, wiTemplateKey],
  )
  useEffect(() => {
    if (wiTitleTouched || !selectedTemplate) return
    const who =
      showBusiness && businessName.trim()
        ? businessName.trim()
        : [lastName.trim(), firstName.trim()].filter(Boolean).join(", ")
    const fy = String(new Date().getUTCFullYear())
    setWiTitle(who ? `${selectedTemplate.title} | ${who} | ${fy}` : selectedTemplate.title)
  }, [selectedTemplate, wiTitleTouched, showBusiness, businessName, firstName, lastName])

  // Statuses available for the selected template's work type.
  const availableStatuses = useMemo(() => {
    if (!selectedTemplate?.workTypeKey) return workStatuses
    const filtered = workStatuses.filter((s) =>
      s.workTypeKeys.includes(selectedTemplate.workTypeKey as string),
    )
    return filtered.length > 0 ? filtered : workStatuses
  }, [workStatuses, selectedTemplate])

  // ── Referral search (debounced) ────────────────────────────────────
  useEffect(() => {
    if (selectedReferrer && referralQuery === selectedReferrer.name) return
    if (referralDebounce.current) clearTimeout(referralDebounce.current)
    const q = referralQuery.trim()
    if (q.length < 2) {
      setReferralResults([])
      setReferralLoading(false)
      return
    }
    setReferralLoading(true)
    referralDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts-and-orgs/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setReferralResults(data.results || [])
        setReferralOpen(true)
      } catch (err) {
        console.error("[v0] referral search failed:", err)
      } finally {
        setReferralLoading(false)
      }
    }, 250)
    return () => {
      if (referralDebounce.current) clearTimeout(referralDebounce.current)
    }
  }, [referralQuery, selectedReferrer])

  // ── Auto-recommend platform pushes ─────────────────────────────────
  useEffect(() => {
    const services = selectedServices.map((s) => s.toLowerCase())
    const looksTax = services.some(
      (s) => s.includes("tax") || s.includes("1040") || s.includes("return"),
    )
    if (!karbonTouched.current) setPushToKarbon(true)
    if (!proconnectTouched.current) setPushToProconnect(looksTax || showPersonal)
    if (!ignitionTouched.current) setPushToIgnition(showBusiness)
  }, [selectedServices, showPersonal, showBusiness])

  // ── Validation ─────────────────────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (!teamMember?.id) return false

    if (showPersonal) {
      if (!(firstName.trim() && lastName.trim() && email.trim() && phone.trim())) return false
    }
    if (showBusiness) {
      const bizEmailOk = bizEmailSameAsOwner ? !!email.trim() : !!businessEmail.trim()
      const bizPhoneOk = bizPhoneSameAsOwner ? !!phone.trim() : !!businessPhone.trim()
      if (!(businessName.trim() && bizEmailOk && bizPhoneOk)) return false
    }
    if (createWorkItem && !wiTemplateKey) return false
    return true
  }, [
    submitting,
    teamMember?.id,
    showPersonal,
    showBusiness,
    firstName,
    lastName,
    email,
    phone,
    businessName,
    businessEmail,
    businessPhone,
    bizEmailSameAsOwner,
    bizPhoneSameAsOwner,
    createWorkItem,
    wiTemplateKey,
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
      incoming.push({ tempId: crypto.randomUUID(), file: f, status: "queued" })
    }
    setAttachments((prev) => [...prev, ...incoming])
  }, [])

  function removeAttachment(tempId: string) {
    setAttachments((prev) => prev.filter((a) => a.tempId !== tempId))
  }

  function pickReferrer(hit: SearchHit) {
    setSelectedReferrer(hit)
    setReferralQuery(hit.name)
    setReferralOpen(false)
  }

  function clearReferrer() {
    setSelectedReferrer(null)
    setReferralQuery("")
    setReferralResults([])
  }

  function addActionItem() {
    setActionItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        description: "",
        assignee_id: teamMember?.id || "",
        assignee_name: teamMember?.full_name || "",
        due_date: null,
        priority: "medium",
        create_task: true,
      },
    ])
  }

  function updateActionItem(id: string, updates: Partial<ActionItem>) {
    setActionItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)))
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
      const onlyPersonal = prospectType === "individual"

      let serviceFocus: string | null = null
      if (prospectType === "individual_business") serviceFocus = "Both Personal & Business"
      else if (prospectType === "individual") serviceFocus = "Personal Only"
      else if (prospectType === "business") serviceFocus = "Business Only"

      const workItemPayload =
        createWorkItem && wiTemplateKey
          ? {
              template_key: wiTemplateKey,
              work_type: selectedTemplate?.workTypeKey ?? null,
              title: wiTitle.trim() || selectedTemplate?.title || "",
              assignee_id: wiAssigneeId || null,
              start_date: wiStartDate?.toISOString().split("T")[0] || null,
              due_date: wiDueDate?.toISOString().split("T")[0] || null,
              budgeted_hours: wiBudgetHours.trim() ? Number(wiBudgetHours) : null,
              work_status_key: wiStatusKey || null,
            }
          : null

      const createRes = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          created_by_id: teamMember.id,
          prospect_type: prospectType,

          submitter_first_name: showPersonal ? firstName : null,
          submitter_last_name: showPersonal ? lastName : null,
          submitter_email: showPersonal ? email : null,
          submitter_phone: showPersonal ? phone : null,
          submitter_city: showPersonal ? city : null,
          submitter_state: showPersonal ? state : null,
          submitter_zip: showPersonal ? zip : null,

          // Personal socials
          website: showPersonal ? website || null : null,
          linkedin_url: showPersonal ? linkedin || null : null,
          twitter_url: showPersonal ? twitter || null : null,
          facebook_url: showPersonal ? facebook || null : null,
          instagram_url: showPersonal ? instagram || null : null,

          services_requested: selectedServices.map((s) =>
            s === "Other" && otherServiceText.trim() ? `Other: ${otherServiceText.trim()}` : s,
          ),
          service_focus: serviceFocus,
          entity_types: onlyPersonal ? null : entityTypes,

          business_situation: onlyPersonal ? null : businessSituation || null,
          business_name: onlyPersonal ? null : businessName,
          business_email: onlyPersonal ? null : effectiveBusinessEmail,
          business_phone: onlyPersonal ? null : effectiveBusinessPhone,
          business_email_same_as_owner: isOwner ? bizEmailSameAsOwner : false,
          business_phone_same_as_owner: isOwner ? bizPhoneSameAsOwner : false,
          business_state: onlyPersonal ? null : businessState,
          business_tax_classification: onlyPersonal ? null : businessTaxClass || null,
          business_revenue_range: onlyPersonal ? null : businessRevenue || null,
          business_employee_count: onlyPersonal ? null : businessEmployees,
          business_uses_accounting_system: onlyPersonal ? null : businessUsesSystem || null,
          business_summary: onlyPersonal ? null : businessSummary,

          // Business socials
          business_website: onlyPersonal ? null : bizWebsite || null,
          business_linkedin_url: onlyPersonal ? null : bizLinkedin || null,
          business_twitter_url: onlyPersonal ? null : bizTwitter || null,
          business_facebook_url: onlyPersonal ? null : bizFacebook || null,
          business_instagram_url: onlyPersonal ? null : bizInstagram || null,

          // Referral — link a matched contact, else record free text.
          referred_by_contact_id:
            selectedReferrer?.kind === "contact" ? selectedReferrer.id : null,
          referred_by_raw:
            selectedReferrer?.kind === "organization"
              ? selectedReferrer.name
              : selectedReferrer
                ? null
                : referralQuery.trim() || null,

          internal_notes: internalNotes,

          push_to_karbon: pushToKarbon,
          push_to_proconnect: pushToProconnect,
          push_to_ignition: pushToIgnition,

          action_items: actionItems.map((item) => ({
            description: item.description,
            assignee_id: item.assignee_id,
            assignee_name: item.assignee_name,
            due_date: item.due_date?.toISOString().split("T")[0] || null,
            priority: item.priority,
            create_task: item.create_task,
          })),

          work_item: workItemPayload,
        }),
      })

      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}))
        throw new Error(j?.error || `Failed to create prospect (${createRes.status})`)
      }

      const { id: prospectId } = (await createRes.json()) as { id: string }

      const toUpload = attachments.filter((a) => a.status === "queued")
      for (const att of toUpload) {
        const form = new FormData()
        form.append("file", att.file)
        form.append("uploaded_by_id", teamMember.id)
        await fetch(`/api/prospects/${prospectId}/attachments`, {
          method: "POST",
          body: form,
        })
      }

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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New Prospect</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Use this internal form when you meet a prospect out in the world — at a conference, by
          referral, by text — and want to capture them in the Hub without asking them to fill out
          the public intake form.
        </p>
        <p className="text-xs text-muted-foreground">
          Required fields are marked with <span className="text-destructive">*</span> — which
          fields are required depends on the prospect type you pick below.
        </p>
      </header>

      {/* ─── Prospect type (primary driver) ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Prospect type</CardTitle>
          </div>
          <CardDescription>
            Is this an individual, a business, or a business owner (both)? This determines which
            details are required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Prospect type">
            {PROSPECT_TYPES.map((t) => {
              const Icon = t.icon
              const active = prospectType === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setProspectType(t.value)}
                  className={cn(
                    "flex flex-col items-start gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40",
                    active && "border-foreground/50 bg-muted/60 ring-1 ring-foreground/20",
                  )}
                >
                  <div className="flex w-full items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t.label}</span>
                    {active && <Check className="ml-auto h-4 w-4 text-foreground" />}
                  </div>
                  <span className="text-xs text-muted-foreground text-pretty">{t.hint}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ─── Personal info ─── */}
      {showPersonal && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Prospect details</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                Required
              </Badge>
            </div>
            <CardDescription>
              Name, email, and phone are required. State and the rest are optional.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="first">
                First name <span className="text-destructive">*</span>
              </Label>
              <Input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last">
                Last name <span className="text-destructive">*</span>
              </Label>
              <Input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prospect@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                required
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

      {/* ─── Personal socials ─── */}
      {showPersonal && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Online presence</CardTitle>
            </div>
            <CardDescription>
              Optional. Anything here helps ALFRED enrich the prospect&apos;s profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="website">Website</Label>
              <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="linkedin">LinkedIn</Label>
              <Input id="linkedin" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twitter">X (Twitter)</Label>
              <Input id="twitter" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@handle or url" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="facebook">Facebook</Label>
              <Input id="facebook" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="facebook.com/…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="instagram">Instagram</Label>
              <Input id="instagram" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@handle or url" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Business info ─── */}
      {showBusiness && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Business details</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                Required
              </Badge>
            </div>
            <CardDescription>
              Business name, email, and phone are required. Tax classification and state are
              optional.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="biz-name">
                  Business name <span className="text-destructive">*</span>
                </Label>
                <Input id="biz-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="biz-email">
                    Business email <span className="text-destructive">*</span>
                  </Label>
                  {isOwner && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={bizEmailSameAsOwner}
                        onCheckedChange={(c) => setBizEmailSameAsOwner(!!c)}
                      />
                      Same as owner
                    </label>
                  )}
                </div>
                <Input
                  id="biz-email"
                  type="email"
                  value={isOwner && bizEmailSameAsOwner ? email : businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  disabled={isOwner && bizEmailSameAsOwner}
                  required={!(isOwner && bizEmailSameAsOwner)}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="biz-phone">
                    Business phone <span className="text-destructive">*</span>
                  </Label>
                  {isOwner && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={bizPhoneSameAsOwner}
                        onCheckedChange={(c) => setBizPhoneSameAsOwner(!!c)}
                      />
                      Same as owner
                    </label>
                  )}
                </div>
                <Input
                  id="biz-phone"
                  type="tel"
                  value={isOwner && bizPhoneSameAsOwner ? phone : businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                  disabled={isOwner && bizPhoneSameAsOwner}
                  required={!(isOwner && bizPhoneSameAsOwner)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-state">Business state</Label>
                <Input id="biz-state" value={businessState} onChange={(e) => setBusinessState(e.target.value)} />
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
                <Input id="biz-emp" value={businessEmployees} onChange={(e) => setBusinessEmployees(e.target.value)} placeholder="e.g. 12" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-acct">Uses accounting system?</Label>
                <Input id="biz-acct" value={businessUsesSystem} onChange={(e) => setBusinessUsesSystem(e.target.value)} placeholder="e.g. QuickBooks Online" />
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

            {/* Business socials */}
            <div className="space-y-1.5 border-t pt-4">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm">Business online presence (optional)</Label>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input value={bizWebsite} onChange={(e) => setBizWebsite(e.target.value)} placeholder="Website (https://)" />
                <Input value={bizLinkedin} onChange={(e) => setBizLinkedin(e.target.value)} placeholder="LinkedIn" />
                <Input value={bizTwitter} onChange={(e) => setBizTwitter(e.target.value)} placeholder="X (Twitter)" />
                <Input value={bizFacebook} onChange={(e) => setBizFacebook(e.target.value)} placeholder="Facebook" />
                <Input value={bizInstagram} onChange={(e) => setBizInstagram(e.target.value)} placeholder="Instagram" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Referral ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Referral</CardTitle>
          </div>
          <CardDescription>
            Who referred this prospect? Search the contacts database to link the referrer. If you
            can&apos;t find them, type the name and we&apos;ll flag it for review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="relative">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={referralQuery}
                onChange={(e) => {
                  setReferralQuery(e.target.value)
                  if (selectedReferrer) setSelectedReferrer(null)
                }}
                onFocus={() => referralResults.length > 0 && setReferralOpen(true)}
                placeholder="Search by name or email…"
                className="pl-8 pr-8"
                aria-label="Referrer search"
              />
              {referralLoading && (
                <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {!referralLoading && (selectedReferrer || referralQuery) && (
                <button
                  type="button"
                  onClick={clearReferrer}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear referrer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {referralOpen && referralResults.length > 0 && !selectedReferrer && (
              <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                {referralResults.map((hit) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <button
                      type="button"
                      onClick={() => pickReferrer(hit)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      {hit.kind === "organization" ? (
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-foreground">{hit.name}</span>
                      {hit.email && (
                        <span className="truncate text-xs text-muted-foreground">{hit.email}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedReferrer && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-foreground" />
              Linked to{" "}
              <span className="font-medium text-foreground">{selectedReferrer.name}</span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {selectedReferrer.kind}
              </Badge>
            </p>
          )}
          {!selectedReferrer && referralQuery.trim().length >= 2 && !referralLoading && (
            <p className="text-xs text-muted-foreground">
              No match selected — &ldquo;{referralQuery.trim()}&rdquo; will be saved as a referrer
              to review.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ─── Services (optional) ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Services of interest</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              Optional
            </Badge>
          </div>
          <CardDescription>What is this prospect interested in? Select any that apply.</CardDescription>
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
                  onCheckedChange={() => setSelectedServices((prev) => toggle(prev, svc.label))}
                />
                <span className="text-foreground">{svc.label}</span>
                <Badge variant="outline" className="ml-auto text-[10px] capitalize">
                  {svc.category}
                </Badge>
              </label>
            ))}

            <div
              className={cn(
                "flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors sm:col-span-2",
                includesOther && "border-foreground/40 bg-muted/60",
              )}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={includesOther}
                  onCheckedChange={() => setSelectedServices((prev) => toggle(prev, "Other"))}
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
                  placeholder='Describe the service the prospect is interested in — e.g. "Quarterly CFO advisory", "Estate planning"'
                  className="min-h-[64px] text-sm"
                />
              )}
            </div>
          </div>
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
            Where and when you met them, your read of the conversation, pain points they
            mentioned, services they&apos;d be a fit for — anything else. Never visible to the
            prospect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            className="min-h-[160px]"
            placeholder='e.g. "Met at AICPA Engage 06/10. Runs a 6-person CPA firm in Atlanta — wants to outsource bookkeeping. Pain point: month-end close takes 3 weeks."'
          />
        </CardContent>
      </Card>

      {/* ─── Create Karbon Work Item (optional) ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Create Karbon work item</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              Optional
            </Badge>
          </div>
          <CardDescription>
            Kick off work in Karbon right away by picking a template and filling in the core
            fields. Created on the prospect&apos;s Karbon timeline when you submit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={createWorkItem} onCheckedChange={(c) => setCreateWorkItem(!!c)} />
            <span className="text-foreground">Create a Karbon work item for this prospect</span>
          </label>

          {createWorkItem && (
            <div className="space-y-4 rounded-md border bg-muted/30 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="wi-template">
                  Work template <span className="text-destructive">*</span>
                </Label>
                <Popover open={wiTemplatePickerOpen} onOpenChange={setWiTemplatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="wi-template"
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={wiTemplatePickerOpen}
                      disabled={!workTemplates.length}
                      className={cn(
                        "w-full justify-between font-normal",
                        !selectedTemplate && "text-muted-foreground",
                      )}
                    >
                      <span className="truncate">
                        {selectedTemplate
                          ? selectedTemplate.title
                          : workTemplates.length
                            ? "Select a Karbon template…"
                            : "Loading templates…"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[--radix-popover-trigger-width] p-0"
                    align="start"
                  >
                    <Command
                      filter={(value, search) =>
                        value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                      }
                    >
                      <CommandInput placeholder="Search templates by name…" />
                      <CommandList>
                        <CommandEmpty>No templates match.</CommandEmpty>
                        <CommandGroup>
                          {workTemplates.map((t) => (
                            <CommandItem
                              key={t.key}
                              value={t.title}
                              onSelect={() => {
                                setWiTemplateKey(t.key)
                                setWiTemplatePickerOpen(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  wiTemplateKey === t.key ? "opacity-100" : "opacity-0",
                                )}
                                aria-hidden
                              />
                              <span className="truncate">{t.title}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wi-title">Title</Label>
                <Input
                  id="wi-title"
                  value={wiTitle}
                  onChange={(e) => {
                    setWiTitle(e.target.value)
                    setWiTitleTouched(true)
                  }}
                  placeholder="Auto-generated from the template + prospect"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wi-assignee">Assignee</Label>
                  <Select value={wiAssigneeId} onValueChange={setWiAssigneeId}>
                    <SelectTrigger id="wi-assignee">
                      <SelectValue placeholder="Select teammate…" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wi-status">Status</Label>
                  <Select value={wiStatusKey} onValueChange={setWiStatusKey}>
                    <SelectTrigger id="wi-status">
                      <SelectValue placeholder="Template default" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {availableStatuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Start date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !wiStartDate && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {wiStartDate ? format(wiStartDate, "MM/dd/yyyy") : "Set date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={wiStartDate || undefined}
                        onSelect={(d) => setWiStartDate(d || null)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1.5">
                  <Label>Due date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !wiDueDate && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {wiDueDate ? format(wiDueDate, "MM/dd/yyyy") : "Set date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={wiDueDate || undefined}
                        onSelect={(d) => setWiDueDate(d || null)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wi-budget">Budget (hours)</Label>
                  <Input
                    id="wi-budget"
                    type="number"
                    min="0"
                    step="0.25"
                    value={wiBudgetHours}
                    onChange={(e) => setWiBudgetHours(e.target.value)}
                    placeholder="e.g. 4"
                  />
                </div>
              </div>
            </div>
          )}
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
            Add tasks with assignees. Enable &ldquo;Create Task&rdquo; to automatically create a
            task in the system.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionItems.map((item, index) => (
            <div key={item.id} className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Action Item {index + 1}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeActionItem(item.id)}>
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
                  onCheckedChange={(checked) => updateActionItem(item.id, { create_task: !!checked })}
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
            Optional: screenshots of prior text messages, photos of business cards, PDFs. Up to 25
            MB per file.
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
              <span className="font-medium text-foreground">Click to upload</span> or drag &amp;
              drop
            </p>
            <p className="text-xs">PNG, JPG, PDF, screenshots, etc.</p>
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => onPickFiles(e.target.files)} />

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform Sync</CardTitle>
          <CardDescription>
            We always create the Master Hub Contact. Pick which other platforms to also create or
            link this prospect in. Recommendations update automatically as you fill out the form —
            uncheck any that don&apos;t apply.
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
              return showPersonal || s.some((x) => x.includes("tax") || x.includes("1040") || x.includes("return"))
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
            recommended={showBusiness}
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
          On submit, we&apos;ll create the Master Hub Contact, link the referral, push to Karbon
          (contact + pinned note{createWorkItem ? " + work item" : ""}), email the team as ALFRED,
          and take you to the prospect&apos;s detail page.
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs font-medium text-destructive">{error}</span>}
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
