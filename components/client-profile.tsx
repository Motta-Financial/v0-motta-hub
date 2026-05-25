"use client"

/**
 * ClientProfile — Hub-as-Master rewrite (v2)
 *
 * Replaces the old Karbon-shaped profile (3.4k lines, 8 tabs, three
 * near-duplicate render branches for org / contact-with-org /
 * individual). The mental model is now:
 *
 *   "The Hub contact / organization IS the client. Karbon, ProConnect,
 *    Ignition, Calendly, Zoom, and Jotform are just systems that hold
 *    facts about that client."
 *
 * Tabs:
 *   1. Overview         — at-a-glance: key facts + recent activity
 *   2. Communications   — Emails | Notes | Meetings | Intakes & Debriefs
 *                          (sub-tabs; merges Karbon + Hub sources with
 *                           provenance chips so users always know where
 *                           a record came from)
 *   3. Projects         — Karbon work items with rich status/blocking
 *                          info, time logged, assignee, due date.
 *   4. Finance          — Proposals + unified invoices + payment
 *                          history, all rolled up into one money tab.
 *   5. Tax              — Year-grouped ProConnect returns with
 *                          status + key totals; degrades cleanly when
 *                          Phase 1 data isn't imported yet.
 *   6. Documents        — Files uploaded to the Hub + Karbon docs.
 *   7. People           — Related contacts / orgs / client groups,
 *                          plus PlatformLinksCard for cross-system IDs.
 *
 * Backed by `/api/clients/[id]` — that response shape is untouched and
 * the type definitions for the bundle are preserved verbatim from the
 * old file so other code that imports from here keeps compiling.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { format, formatDistanceToNow, parseISO } from "date-fns"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Files,
  Globe,
  Linkedin,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  PiggyBank,
  Plus,
  Receipt,
  RefreshCw,
  StickyNote,
  Tag,
  User,
  Users,
  Video,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { summarizePayments, isPaid } from "@/lib/ignition/payments"
import { cn } from "@/lib/utils"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import { PlatformLinksCard } from "@/components/clients/platform-links-card"
import {
  LinkOrganizationDialog,
  type LinkOrganizationInitial,
} from "@/components/clients/link-organization-dialog"
import { AlfredErrorCard } from "@/components/alfred-error"
import { clientTypeBadgeClass, type ClientType } from "@/lib/client-type"

// ─────────────────────────────────────────────────────────────────────────────
// Types matching /api/clients/[id] response
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientBundle {
  client: {
    id: string
    kind: "contact" | "organization"
    isOrganization: boolean
    karbonKey: string | null
    karbonUrl: string | null
    clientName: string
    avatarUrl: string | null
    type: string
    entityType: string | null
    contactType: string | null
    /**
     * Unified, filing-form-aware client type derived on the server via
     * `lib/client-type.getClientType()`. The full structured object — not
     * just a string — so the badge can pick a colour variant (.variant)
     * and the rest of the app can filter by .code without having to
     * re-parse a label.
     */
    clientType: ClientType
    status: string | null
    isProspect: boolean
    contactInfo: {
      primaryEmail: string | null
      secondaryEmail: string | null
      phonePrimary: string | null
      phoneMobile: string | null
      phoneWork: string | null
      phoneFax: string | null
      address: string | null
      mailingAddress: string | null
      website: string | null
      linkedin: string | null
      twitter: string | null
      facebook: string | null
    }
    identity: Record<string, unknown> | null
    business: Record<string, unknown> | null
    ownership: {
      clientOwnerKey: string | null
      clientManagerKey: string | null
      clientPartnerKey: string | null
      source: string | null
      referredBy: string | null
      taxProviderName: string | null
      legalFirmName: string | null
    }
    tags: string[] | null
    notes: string | null
    karbonCreatedAt: string | null
    karbonModifiedAt: string | null
    lastSyncedAt: string | null
    lastActivityAt: string | null
  }
  workItems: Array<{
    id: string
    karbon_work_item_key: string | null
    title: string | null
    work_type: string | null
    status: string | null
    primary_status: string | null
    secondary_status: string | null
    due_date: string | null
    completed_date: string | null
    assignee_name: string | null
    client_owner_name: string | null
    todo_count: number | null
    completed_todo_count: number | null
    has_blocking_todos: boolean | null
    karbon_url: string | null
  }>
  karbonNotes: Array<{
    id: string
    karbon_note_key: string | null
    subject: string | null
    body: string | null
    note_type: string | null
    is_pinned: boolean | null
    author_name: string | null
    karbon_created_at: string | null
    karbon_modified_at: string | null
    work_item_title: string | null
    karbon_url: string | null
  }>
  manualNotes: Array<{
    id: string
    title: string | null
    content: string
    note_type: string | null
    is_pinned: boolean | null
    created_at: string
  }>
  emails: Array<{
    id: string
    subject: string | null
    from_name: string | null
    from_email: string | null
    to_emails: string[] | null
    body_text: string | null
    sent_at: string | null
    received_at: string | null
    direction: string | null
    is_read: boolean | null
  }>
  karbonTasks: Array<{
    id: string
    title: string | null
    description: string | null
    status: string | null
    priority: string | null
    assignee_name: string | null
    due_date: string | null
    completed_date: string | null
    is_blocking: boolean | null
    karbon_url: string | null
  }>
  karbonTimesheets: Array<{
    id: string
    date: string | null
    minutes: number | null
    description: string | null
    user_name: string | null
    work_item_title: string | null
    billing_status: string | null
    billed_amount: number | null
    is_billable: boolean | null
  }>
  karbonInvoices: Array<{
    id: string
    invoice_number: string | null
    status: string | null
    issued_date: string | null
    due_date: string | null
    paid_date: string | null
    total_amount: number | null
    currency: string | null
    work_item_title: string | null
    karbon_url: string | null
  }>
  unifiedInvoices: Array<{
    id: string
    source: "karbon" | "ignition" | "hubspot"
    invoice_number: string | null
    status: string | null
    amount: number
    amount_paid: number
    amount_outstanding: number
    currency: string
    issued_date: string | null
    due_date: string | null
    paid_date: string | null
    work_item_title: string | null
    external_url: string | null
  }>
  ignitionProposals: Array<{
    proposal_id: string
    proposal_number: string | null
    title: string | null
    status: string | null
    client_name: string | null
    client_email: string | null
    total_value: number | null
    one_time_total: number | null
    recurring_total: number | null
    recurring_frequency: string | null
    currency: string | null
    sent_at: string | null
    accepted_at: string | null
    completed_at: string | null
    lost_at: string | null
    lost_reason: string | null
    archived_at: string | null
    revoked_at: string | null
    signed_url: string | null
    client_manager: string | null
    client_partner: string | null
    proposal_sent_by: string | null
    billing_starts_on: string | null
    effective_start_date: string | null
    last_event_at: string | null
    created_at: string | null
    updated_at: string | null
    services?: Array<{
      id: string
      service_name: string
      description: string | null
      quantity: number | null
      unit_price: number | null
      total_amount: number | null
      currency: string | null
      billing_frequency: string | null
      billing_type: string | null
      status: string | null
      ordinal: number | null
    }> | null
  }>
  ignitionClients: Array<{
    ignition_client_id: string
    name: string | null
    email: string | null
    phone: string | null
    business_name: string | null
    client_type: string | null
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip_code: string | null
    country: string | null
    match_status: string | null
    match_confidence: number | null
    match_method: string | null
    match_notes: string | null
    ignition_created_at: string | null
    ignition_updated_at: string | null
    last_event_at: string | null
  }>
  documents: Array<{
    id: string
    name: string | null
    description: string | null
    document_type: string | null
    file_type: string | null
    file_size_bytes: number | null
    storage_url: string | null
    uploaded_at: string | null
    tax_year: number | null
  }>
  meetings: Array<{
    id: string
    title: string | null
    meeting_type: string | null
    status: string | null
    scheduled_start: string | null
    scheduled_end: string | null
    duration_minutes: number | null
  }>
  calendlyEvents?: Array<{
    id: string
    name: string | null
    status: string | null
    event_type_name: string | null
    location: string | null
    location_type: string | null
    join_url: string | null
    calendly_uri: string | null
    start_time: string | null
    end_time: string | null
    calendly_user_name: string | null
    calendly_user_email: string | null
    canceled_at: string | null
    cancel_reason: string | null
    rescheduled: boolean | null
    link_source: string | null
    confidence: number | null
    needs_review: boolean
    link_id: string | null
  }>
  zoomMeetings?: Array<{
    id: string
    zoom_meeting_id: number | string | null
    topic: string | null
    agenda: string | null
    status: string | null
    host_email: string | null
    start_time: string | null
    started_at: string | null
    ended_at: string | null
    duration: number | null
    join_url: string | null
    calendly_event_id: string | null
    link_source: string | null
    confidence: number | null
    needs_review: boolean
    link_id: string | null
  }>
  debriefs: Array<{
    id: string
    debrief_date: string | null
    debrief_type: string | null
    status: string | null
    notes: string | null
    tax_year: number | null
    filing_status: string | null
    follow_up_date: string | null
    action_items: { items?: Array<{ description: string; assignee_name?: string; due_date?: string | null; priority?: string }> } | null
    client_owner_name: string | null
    client_manager_name: string | null
    work_item_id: string | null
    work_item_title: string | null
    work_item_karbon_url: string | null
    karbon_work_url: string | null
    team_member_id: string | null
    team_member_full_name: string | null
    created_at: string | null
  }>
  intakeSubmissions: Array<{
    id: string
    created_at: string | null
    submitter_full_name: string | null
    submitter_email: string | null
    submitter_phone: string | null
    service_focus: string | null
    services_requested: string[] | null
    business_name: string | null
    business_state: string | null
    business_situation: string | null
    entity_types: string[] | null
    questions_or_concerns: string | null
    additional_notes: string | null
    referral_source: string | null
    lead_status: string | null
    link_method: "auto_email" | "auto_business_name" | "auto_name" | "manual" | null
    linked_at: string | null
    karbon_work_item_key: string | null
    karbon_work_item_title: string | null
    karbon_work_item_url: string | null
    raw_answers: Record<string, unknown> | null
  }>
  clientGroups: Array<{
    id: string
    name: string | null
    group_type: string | null
    role: string | null
    relationship: string | null
    isPrimary: boolean | null
  }>
  relatedContacts: Array<{
    id: string
    relationshipId: string | null
    full_name: string | null
    primary_email: string | null
    phone_primary: string | null
    roleOrTitle: string | null
    ownershipPercentage: number | null
    isPrimaryContact: boolean | null
  }>
  relatedOrganizations: Array<{
    id: string
    relationshipId: string | null
    name: string | null
    full_name: string | null
    primary_email: string | null
    industry: string | null
    roleOrTitle: string | null
    ownershipPercentage: number | null
    isPrimaryContact: boolean | null
  }>
  teamMembers: Array<{ name: string; email: string | null; key: string | null }>
  serviceLinesUsed: string[]
  stats: {
    totalWorkItems: number
    activeWorkItems: number
    completedWorkItems: number
    openTasks: number
    totalTasks: number
    totalEmails: number
    totalNotes: number
    totalDocuments: number
    totalMeetings: number
    totalCalendlyEvents?: number
    totalZoomMeetings?: number
    totalDebriefs: number
    totalIntakeSubmissions: number
    totalInvoices: number
    totalInvoicedAmount: number
    totalUnpaidAmount: number
    totalBillableMinutes: number
    totalProposals: number
    activeProposals: number
    acceptedProposals: number
    totalProposalValue: number
  }
  ignitionPayments: Array<{
    ignition_payment_id: string
    ignition_invoice_id: string | null
    proposal_id: string | null
    amount: number | null
    fees: number | null
    net_amount: number | null
    currency: string | null
    payment_method: string | null
    payment_status: string | null
    paid_at: string | null
    refunded_at: string | null
    refund_amount: number | null
    stripe_charge_id: string | null
    stripe_payment_intent_id: string | null
  }>
  paymentsSummary: {
    totalAmount: number
    totalFees: number
    totalNet: number
    totalRefunded: number
    currency: string
    paymentCount: number
    refundCount: number
    mostRecentPaidAt: string | null
  }
  proconnect: {
    clientId: string
    client: Record<string, unknown> | null
    returns: Array<{
      form: "1040" | "1065" | "1120" | "1120S" | "990"
      taxYear: number | null
      status: string | null
      efileStatus: string | null
      amended: boolean | null
      preparer: string | null
      totalRevenue: number | null
      totalIncome: number | null
      totalTax: number | null
      refund: number | null
      amountOwed: number | null
      raw: Record<string, unknown>
      updatedAt: string | null
    }>
    returnCount: number
    latestTaxYear: number | null
  } | null
}

// ────────────────────────────────────────────────────────────────────��────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined, pattern = "MMM d, yyyy"): string | null {
  if (!iso) return null
  try {
    return format(parseISO(iso), pattern)
  } catch {
    return null
  }
}

function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true })
  } catch {
    return null
  }
}

function formatCurrency(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null) return "—"
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?"
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Map a domain link_source value (set by ALFRED / Calendly bridge /
 * participant sweep / manual tagging) to a stable, human-readable
 * provenance label. We only render a chip when the source is
 * non-default — manual tags are the unstated baseline, so a missing
 * chip just means "a teammate did this".
 */
function provenanceLabel(source: string | null | undefined): {
  label: string
  className: string
} | null {
  if (!source || source === "manual") return null
  switch (source) {
    case "auto":
      return { label: "auto", className: "bg-muted text-muted-foreground" }
    case "calendly_bridge":
      return {
        label: "Calendly",
        className: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
      }
    case "alfred":
      return {
        label: "ALFRED",
        className:
          "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
      }
    default:
      return { label: source, className: "bg-muted text-muted-foreground" }
  }
}

const FORM_LABELS: Record<string, string> = {
  "1040": "Individual (1040)",
  "1065": "Partnership (1065)",
  "1120": "C-Corp (1120)",
  "1120S": "S-Corp (1120-S)",
  "990": "Nonprofit (990)",
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface ClientProfileProps {
  clientId?: string
}

export function ClientProfile({ clientId = "" }: ClientProfileProps) {
  const [data, setData] = useState<ClientBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("overview")
  const [communicationsTab, setCommunicationsTab] = useState("emails")

  const fetchClient = useCallback(async () => {
    if (!clientId) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as ClientBundle
      setData(json)
    } catch (err) {
      console.error("[v0] ClientProfile fetch error:", err)
      setError(err instanceof Error ? err.message : "Failed to load client")
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void fetchClient()
  }, [fetchClient])

  const handleSync = async () => {
    if (!clientId || syncing) return
    try {
      setSyncing(true)
      setSyncMessage(null)
      const res = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/sync`,
        { method: "POST" },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setSyncMessage(
        json?.synced
          ? `Synced from Karbon at ${new Date().toLocaleTimeString()}`
          : "Sync queued",
      )
      await fetchClient()
    } catch (err) {
      console.error("[v0] Sync error:", err)
      setSyncMessage(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMessage(null), 5000)
    }
  }

  if (loading && !data) return <ClientProfileSkeleton />
  if (error)
    return (
      <AlfredErrorCard
        title="Couldn't load this client"
        message={error}
        onRetry={fetchClient}
      />
    )
  if (!data) return null

  const { client, stats } = data

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* ═════ Identity card + action rail ═════ */}
      <ClientHeader
        client={client}
        syncing={syncing}
        syncMessage={syncMessage}
        onSync={handleSync}
      />

      {/* ═════ Sticky KPI strip ═════ */}
      <KpiStrip data={data} />

      {/* ═════ Tabs ═════
        TabsList is wrapped in a sticky container so navigation stays
        visible on long pages (Comms / Projects / Finance can each have
        hundreds of rows). The KPI strip above is non-sticky so the tab
        bar can dock cleanly to the top of the viewport. */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-stone-200">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-7">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="communications">
            Comms
            {stats.totalEmails + stats.totalNotes > 0 && (
              <CountChip n={stats.totalEmails + stats.totalNotes} />
            )}
          </TabsTrigger>
          <TabsTrigger value="projects">
            Projects
            {stats.activeWorkItems > 0 && <CountChip n={stats.activeWorkItems} />}
          </TabsTrigger>
          <TabsTrigger value="finance">
            Finance
            {stats.totalProposals + stats.totalInvoices > 0 && (
              <CountChip n={stats.totalProposals + stats.totalInvoices} />
            )}
          </TabsTrigger>
          <TabsTrigger value="tax">
            Tax
            {data.proconnect && data.proconnect.returnCount > 0 && (
              <CountChip n={data.proconnect.returnCount} />
            )}
          </TabsTrigger>
          <TabsTrigger value="documents">
            Files
            {stats.totalDocuments > 0 && <CountChip n={stats.totalDocuments} />}
          </TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab data={data} onJump={setActiveTab} />
        </TabsContent>

        <TabsContent value="communications" className="mt-4">
          <CommunicationsTab
            data={data}
            tab={communicationsTab}
            onTabChange={setCommunicationsTab}
          />
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <ProjectsTab data={data} />
        </TabsContent>

        <TabsContent value="finance" className="mt-4">
          <FinanceTab data={data} />
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <TaxTab data={data} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <DocumentsTab data={data} />
        </TabsContent>

              <TabsContent value="people" className="mt-4">
                <PeopleTab
                  data={data}
                  clientId={clientId}
                  onChange={fetchClient}
                />
              </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

function ClientHeader({
  client,
  syncing,
  syncMessage,
  onSync,
}: {
  client: ClientBundle["client"]
  syncing: boolean
  syncMessage: string | null
  onSync: () => void
}) {
  const isOrg = client.isOrganization
  const subtitleParts = [
    client.clientType?.labelWithForm || client.clientType?.label,
    client.contactType,
    client.entityType,
  ].filter(Boolean)

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          {/* Identity */}
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <Avatar className="h-16 w-16 shrink-0">
              <AvatarImage src={client.avatarUrl || undefined} alt={client.clientName} />
              <AvatarFallback className="text-base font-medium">
                {isOrg ? <Building2 className="h-7 w-7" /> : initials(client.clientName)}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-balance">
                  {client.clientName}
                </h1>
                {client.clientType && (
                  <Badge
                    variant="outline"
                    className={cn("font-medium", clientTypeBadgeClass(client.clientType.variant))}
                  >
                    {client.clientType.labelWithForm || client.clientType.label}
                  </Badge>
                )}
                {client.isProspect && (
                  <Badge variant="secondary" className="font-medium">
                    Prospect
                  </Badge>
                )}
                {client.status && !client.isProspect && (
                  <Badge variant="outline">{client.status}</Badge>
                )}
              </div>

              {subtitleParts.length > 0 && (
                <p className="text-sm text-muted-foreground">{subtitleParts.join(" · ")}</p>
              )}

              {/* Inline contact rail */}
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground mt-1">
                {client.contactInfo.primaryEmail && (
                  <ContactLink
                    icon={<Mail className="h-3.5 w-3.5" />}
                    href={`mailto:${client.contactInfo.primaryEmail}`}
                    label={client.contactInfo.primaryEmail}
                  />
                )}
                {client.contactInfo.phonePrimary && (
                  <ContactLink
                    icon={<Phone className="h-3.5 w-3.5" />}
                    href={`tel:${client.contactInfo.phonePrimary}`}
                    label={client.contactInfo.phonePrimary}
                  />
                )}
                {client.contactInfo.website && (
                  <ContactLink
                    icon={<Globe className="h-3.5 w-3.5" />}
                    href={client.contactInfo.website}
                    label={
                      client.contactInfo.website
                        .replace(/^https?:\/\//, "")
                        .replace(/\/$/, "")
                    }
                    external
                  />
                )}
                {client.contactInfo.linkedin && (
                  <ContactLink
                    icon={<Linkedin className="h-3.5 w-3.5" />}
                    href={client.contactInfo.linkedin}
                    label="LinkedIn"
                    external
                  />
                )}
                {client.contactInfo.address && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="truncate max-w-[280px]">
                      {client.contactInfo.address}
                    </span>
                  </span>
                )}
              </div>

              {client.tags && client.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {client.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs font-normal">
                      <Tag className="h-2.5 w-2.5 mr-1" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action rail */}
          <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch lg:w-48">
            {client.contactInfo.primaryEmail && (
              <Button variant="outline" size="sm" asChild>
                <a href={`mailto:${client.contactInfo.primaryEmail}`}>
                  <Mail className="h-3.5 w-3.5 mr-1.5" />
                  Email
                </a>
              </Button>
            )}
            {client.karbonUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={client.karbonUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open in Karbon
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              disabled={syncing}
              title="Re-sync this client from Karbon"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")}
              />
              {syncing ? "Syncing…" : "Sync from Karbon"}
            </Button>
            {syncMessage && (
              <span className="text-xs text-muted-foreground">{syncMessage}</span>
            )}
            {client.lastActivityAt && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Active {relativeTime(client.lastActivityAt)}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ContactLink({
  icon,
  href,
  label,
  external,
}: {
  icon: React.ReactNode
  href: string
  label: string
  external?: boolean
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
    >
      {icon}
      <span className="truncate max-w-[260px]">{label}</span>
    </a>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI strip
// ─────────────────────────────────────────────────────────────────────────────

function KpiStrip({ data }: { data: ClientBundle }) {
  const { stats, paymentsSummary } = data
  const lifetimeRevenue = paymentsSummary.totalAmount || stats.totalProposalValue
  const nextMeeting = useMemo(() => {
    const now = Date.now()
    const upcoming: Array<{ when: string; what: string }> = []
    for (const ev of data.calendlyEvents || []) {
      if (!ev.start_time) continue
      const t = new Date(ev.start_time).getTime()
      if (t >= now && !ev.canceled_at)
        upcoming.push({
          when: ev.start_time,
          what: ev.name || ev.event_type_name || "Calendly meeting",
        })
    }
    for (const m of data.zoomMeetings || []) {
      if (!m.start_time) continue
      const t = new Date(m.start_time).getTime()
      if (t >= now)
        upcoming.push({
          when: m.start_time,
          what: m.topic || "Zoom meeting",
        })
    }
    upcoming.sort(
      (a, b) => new Date(a.when).getTime() - new Date(b.when).getTime(),
    )
    return upcoming[0] || null
  }, [data.calendlyEvents, data.zoomMeetings])

  const lastContactAt = useMemo(() => {
    const candidates: Array<string | null | undefined> = [
      data.client.lastActivityAt,
      ...(data.emails.slice(0, 5).map((e) => e.sent_at || e.received_at)),
    ]
    const parsed = candidates
      .filter((v): v is string => !!v)
      .map((v) => new Date(v).getTime())
      .filter((n) => !Number.isNaN(n))
    if (parsed.length === 0) return null
    return new Date(Math.max(...parsed)).toISOString()
  }, [data.client.lastActivityAt, data.emails])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        icon={<Briefcase className="h-4 w-4 text-muted-foreground" />}
        label="Open projects"
        value={stats.activeWorkItems.toString()}
        sub={
          stats.totalWorkItems > 0
            ? `${stats.completedWorkItems} done · ${stats.totalWorkItems} total`
            : "No work items yet"
        }
      />
      <KpiCard
        icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
        label="Lifetime revenue"
        value={formatCurrency(lifetimeRevenue, paymentsSummary.currency || "USD")}
        sub={
          stats.totalUnpaidAmount > 0
            ? `${formatCurrency(stats.totalUnpaidAmount)} outstanding`
            : stats.totalProposalValue > 0
              ? `${formatCurrency(stats.totalProposalValue)} proposal value`
              : "No revenue yet"
        }
      />
      <KpiCard
        icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
        label="Last contact"
        value={lastContactAt ? (relativeTime(lastContactAt) ?? "—") : "—"}
        sub={lastContactAt ? formatDate(lastContactAt) || "" : "No recorded contact"}
      />
      <KpiCard
        icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
        label="Next meeting"
        value={nextMeeting ? (relativeTime(nextMeeting.when) ?? "—") : "None scheduled"}
        sub={nextMeeting ? nextMeeting.what : "—"}
      />
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span className="uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-xl font-semibold tracking-tight truncate">{value}</div>
        <div className="text-xs text-muted-foreground truncate">{sub}</div>
      </CardContent>
    </Card>
  )
}

function CountChip({ n }: { n: number }) {
  return (
    <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs font-normal">
      {n}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview tab
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({
  data,
  onJump,
}: {
  data: ClientBundle
  onJump: (tab: string) => void
}) {
  const { client } = data
  const recentEmails = data.emails.slice(0, 3)
  const recentNotes = [...(data.karbonNotes || []), ...(data.manualNotes || [])]
    .map((n: any) => ({
      id: n.id,
      subject: n.subject || n.title || "(no subject)",
      preview: ((n.body || n.content || "") as string)
        .replace(/<[^>]+>/g, " ")
        .slice(0, 160),
      when: n.karbon_created_at || n.created_at,
      author: n.author_name || null,
      isPinned: !!n.is_pinned,
    }))
    .sort(
      (a, b) =>
        new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime(),
    )
    .slice(0, 3)

  const activeWork = data.workItems
    .filter((w) => (w.status || "").toLowerCase() !== "completed")
    .slice(0, 4)

  const ownerName =
    data.teamMembers.find((tm) => tm.key === client.ownership.clientOwnerKey)?.name ||
    null
  const managerName =
    data.teamMembers.find((tm) => tm.key === client.ownership.clientManagerKey)
      ?.name || null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Key facts */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base">Key facts</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <FactRow label="Type" value={client.clientType?.labelWithForm || client.clientType?.label || "—"} />
          <FactRow label="Status" value={client.isProspect ? "Prospect" : (client.status || "—")} />
          <FactRow label="Owner" value={ownerName || "—"} />
          <FactRow label="Manager" value={managerName || "—"} />
          <FactRow
            label="Source"
            value={client.ownership.referredBy || client.ownership.source || "—"}
          />
          {client.business && (
            <>
              <Separator />
              <FactRow
                label="Industry"
                value={(client.business.industry as string) || "—"}
              />
              <FactRow
                label="Entity"
                value={(client.business.entityType as string) || "—"}
              />
              <FactRow
                label="EIN"
                value={(client.business.ein as string) || "—"}
              />
            </>
          )}
          <Separator />
          <FactRow
            label="Created"
            value={formatDate(client.karbonCreatedAt) || "—"}
          />
          <FactRow
            label="Last synced"
            value={relativeTime(client.lastSyncedAt) || "—"}
          />
        </CardContent>
      </Card>

      {/* Recent activity */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent emails</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onJump("communications")}>
              View all
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {recentEmails.length === 0 ? (
              <EmptyState message="No emails on file." />
            ) : (
              <div className="divide-y">
                {recentEmails.map((e) => (
                  <div
                    key={e.id}
                    className="p-4 flex flex-col gap-1 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">
                        {e.subject || "(no subject)"}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {relativeTime(e.sent_at || e.received_at) || "—"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">
                      {e.from_name || e.from_email || "Unknown sender"}
                      {e.direction ? ` · ${e.direction}` : ""}
                    </span>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {(e.body_text || "").slice(0, 200)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Active projects</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onJump("projects")}>
              View all
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {activeWork.length === 0 ? (
              <EmptyState message="No active work items." />
            ) : (
              <div className="divide-y">
                {activeWork.map((w) => (
                  <ProjectRow key={w.id} workItem={w} compact />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent notes</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onJump("communications")}>
              View all
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {recentNotes.length === 0 ? (
              <EmptyState message="No notes recorded." />
            ) : (
              <div className="divide-y">
                {recentNotes.map((n) => (
                  <div key={n.id} className="p-4 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{n.subject}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {relativeTime(n.when) || "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {n.preview}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground text-xs uppercase tracking-wide pt-0.5">
        {label}
      </span>
      <span className="text-sm font-medium text-right truncate max-w-[60%]">
        {value}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Communications tab
// ─────────────────────────────────────────────────────────────────────────────

function CommunicationsTab({
  data,
  tab,
  onTabChange,
}: {
  data: ClientBundle
  tab: string
  onTabChange: (t: string) => void
}) {
  const intakeAndDebriefCount =
    (data.intakeSubmissions?.length || 0) + (data.debriefs?.length || 0)
  const meetingCount =
    (data.calendlyEvents?.length || 0) +
    (data.zoomMeetings?.length || 0) +
    (data.meetings?.length || 0)
  const noteCount =
    (data.karbonNotes?.length || 0) + (data.manualNotes?.length || 0)

  return (
    <Tabs value={tab} onValueChange={onTabChange} className="w-full">
      <TabsList className="grid grid-cols-4 w-full max-w-2xl">
        <TabsTrigger value="emails">
          Emails
          {data.emails.length > 0 && <CountChip n={data.emails.length} />}
        </TabsTrigger>
        <TabsTrigger value="notes">
          Notes
          {noteCount > 0 && <CountChip n={noteCount} />}
        </TabsTrigger>
        <TabsTrigger value="meetings">
          Meetings
          {meetingCount > 0 && <CountChip n={meetingCount} />}
        </TabsTrigger>
        <TabsTrigger value="intakes">
          Intakes
          {intakeAndDebriefCount > 0 && <CountChip n={intakeAndDebriefCount} />}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="emails" className="mt-4">
        <EmailsCard emails={data.emails} />
      </TabsContent>
      <TabsContent value="notes" className="mt-4">
        <NotesCard
          karbonNotes={data.karbonNotes}
          manualNotes={data.manualNotes}
        />
      </TabsContent>
      <TabsContent value="meetings" className="mt-4">
        <MeetingsCard data={data} />
      </TabsContent>
      <TabsContent value="intakes" className="mt-4">
        <IntakesAndDebriefsCard
          intakes={data.intakeSubmissions}
          debriefs={data.debriefs}
        />
      </TabsContent>
    </Tabs>
  )
}

function EmailsCard({ emails }: { emails: ClientBundle["emails"] }) {
  if (emails.length === 0) return <EmptyCard message="No emails on file for this client." />
  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[700px]">
          <div className="divide-y">
            {emails.map((e) => (
              <div key={e.id} className="p-4 flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {e.subject || "(no subject)"}
                      </span>
                      {e.direction && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {e.direction}
                        </Badge>
                      )}
                      {e.is_read === false && (
                        <Badge variant="default" className="text-xs">
                          Unread
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {e.from_name || e.from_email || "Unknown"}
                      {e.to_emails?.length
                        ? ` → ${e.to_emails.slice(0, 2).join(", ")}${e.to_emails.length > 2 ? "…" : ""}`
                        : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDate(e.sent_at || e.received_at, "MMM d") || "—"}
                  </span>
                </div>
                {e.body_text && (
                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {e.body_text.slice(0, 400)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function NotesCard({
  karbonNotes,
  manualNotes,
}: {
  karbonNotes: ClientBundle["karbonNotes"]
  manualNotes: ClientBundle["manualNotes"]
}) {
  const merged = useMemo(() => {
    const all = [
      ...karbonNotes.map((n) => ({
        id: `k-${n.id}`,
        source: "karbon" as const,
        subject: n.subject || "(no subject)",
        body: (n.body || "").replace(/<[^>]+>/g, " "),
        when: n.karbon_created_at,
        author: n.author_name,
        isPinned: !!n.is_pinned,
        url: n.karbon_url,
        workItem: n.work_item_title,
      })),
      ...manualNotes.map((n) => ({
        id: `m-${n.id}`,
        source: "hub" as const,
        subject: n.title || "(no subject)",
        body: n.content || "",
        when: n.created_at,
        author: null as string | null,
        isPinned: !!n.is_pinned,
        url: null as string | null,
        workItem: null as string | null,
      })),
    ]
    return all.sort((a, b) => {
      // pinned first, then newest first
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      return new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime()
    })
  }, [karbonNotes, manualNotes])

  if (merged.length === 0) return <EmptyCard message="No notes recorded for this client yet." />

  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[700px]">
          <div className="divide-y">
            {merged.map((n) => (
              <div key={n.id} className="p-4 flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                    {n.isPinned && (
                      <Badge variant="default" className="text-xs">
                        Pinned
                      </Badge>
                    )}
                    <span className="font-medium text-sm truncate">{n.subject}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs uppercase",
                        n.source === "karbon"
                          ? "text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900"
                          : "text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900",
                      )}
                    >
                      {n.source === "karbon" ? "Karbon" : "Hub"}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDate(n.when, "MMM d, yyyy") || "—"}
                  </span>
                </div>
                {(n.author || n.workItem) && (
                  <p className="text-xs text-muted-foreground">
                    {n.author && <>by {n.author}</>}
                    {n.workItem && (
                      <>
                        {n.author ? " · " : ""}on {n.workItem}
                      </>
                    )}
                  </p>
                )}
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                  {n.body}
                </p>
                {n.url && (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs inline-flex items-center gap-1 text-primary hover:underline w-fit"
                  >
                    Open in Karbon
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function MeetingsCard({ data }: { data: ClientBundle }) {
  // Combine all three sources into one list with provenance.
  const items = useMemo(() => {
    const out: Array<{
      id: string
      source: "calendly" | "zoom" | "meeting"
      title: string
      when: string | null
      end: string | null
      duration: number | null
      status: string | null
      host: string | null
      joinUrl: string | null
      provenance: ReturnType<typeof provenanceLabel>
      needsReview: boolean
      cancelled: boolean
      bridgedFromCalendly: boolean
    }> = []

    for (const ev of data.calendlyEvents || []) {
      out.push({
        id: `cal-${ev.id}`,
        source: "calendly",
        title: ev.name || ev.event_type_name || "(Calendly meeting)",
        when: ev.start_time,
        end: ev.end_time,
        duration: null,
        status: ev.canceled_at ? "Cancelled" : ev.status,
        host: ev.calendly_user_name,
        joinUrl: ev.canceled_at ? null : ev.join_url,
        provenance: provenanceLabel(ev.link_source),
        needsReview: !!ev.needs_review,
        cancelled: !!ev.canceled_at,
        bridgedFromCalendly: false,
      })
    }
    for (const m of data.zoomMeetings || []) {
      const dur =
        m.duration && m.duration > 0
          ? m.duration > 1000
            ? Math.round(m.duration / 60)
            : m.duration
          : null
      out.push({
        id: `zoom-${m.id}`,
        source: "zoom",
        title: m.topic || "(Zoom meeting)",
        when: m.start_time || m.started_at,
        end: m.ended_at,
        duration: dur,
        status: m.status,
        host: m.host_email,
        joinUrl: m.join_url,
        provenance: provenanceLabel(m.link_source),
        needsReview: !!m.needs_review,
        cancelled: false,
        bridgedFromCalendly: !!m.calendly_event_id,
      })
    }
    for (const m of data.meetings || []) {
      out.push({
        id: `kmtg-${m.id}`,
        source: "meeting",
        title: m.title || "(Meeting)",
        when: m.scheduled_start,
        end: m.scheduled_end,
        duration: m.duration_minutes,
        status: m.status,
        host: null,
        joinUrl: null,
        provenance: null,
        needsReview: false,
        cancelled: false,
        bridgedFromCalendly: false,
      })
    }
    return out.sort(
      (a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime(),
    )
  }, [data])

  if (items.length === 0)
    return <EmptyCard message="No Calendly bookings or Zoom meetings linked to this client yet." />

  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[700px]">
          <div className="divide-y">
            {items.map((m) => {
              const start = m.when ? new Date(m.when) : null
              const end = m.end ? new Date(m.end) : null
              return (
                <div
                  key={m.id}
                  className={cn(
                    "p-4 flex flex-col gap-1.5",
                    m.cancelled && "opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">
                          {m.title}
                        </span>
                        <SourceChip source={m.source} />
                        {m.cancelled && (
                          <Badge variant="destructive" className="text-xs">
                            Cancelled
                          </Badge>
                        )}
                        {m.bridgedFromCalendly && (
                          <Badge variant="outline" className="text-xs">
                            From Calendly
                          </Badge>
                        )}
                        {m.provenance && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] uppercase tracking-wide font-medium",
                              m.provenance.className,
                            )}
                          >
                            {m.provenance.label}
                          </Badge>
                        )}
                        {m.needsReview && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wide font-medium bg-amber-50 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border-amber-200 dark:border-amber-700/60"
                          >
                            review
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {start ? format(start, "EEE, MMM d, yyyy · h:mm a") : "Unknown date"}
                        {end ? ` – ${format(end, "h:mm a")}` : ""}
                        {m.duration ? ` · ${m.duration} min` : ""}
                        {m.host ? ` · Host: ${m.host}` : ""}
                      </p>
                    </div>
                    {m.joinUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={m.joinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Video className="h-3.5 w-3.5 mr-1.5" />
                          Join
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function SourceChip({ source }: { source: "calendly" | "zoom" | "meeting" }) {
  if (source === "calendly")
    return (
      <Badge
        variant="outline"
        className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-900"
      >
        Calendly
      </Badge>
    )
  if (source === "zoom")
    return (
      <Badge
        variant="outline"
        className="text-xs bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300 border-sky-200 dark:border-sky-900"
      >
        Zoom
      </Badge>
    )
  return (
    <Badge variant="outline" className="text-xs">
      Karbon
    </Badge>
  )
}

function IntakesAndDebriefsCard({
  intakes,
  debriefs,
}: {
  intakes: ClientBundle["intakeSubmissions"]
  debriefs: ClientBundle["debriefs"]
}) {
  const hasContent = intakes.length > 0 || debriefs.length > 0
  if (!hasContent)
    return (
      <EmptyCard message="No intake submissions or debrief notes for this client yet." />
    )

  return (
    <div className="flex flex-col gap-4">
      {intakes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Intake submissions ({intakes.length})
            </CardTitle>
            <CardDescription>
              What this client said about themselves at the front door — first‑contact
              answers, pain points, and the services they asked us about.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {intakes.map((i) => (
                <div key={i.id} className="p-4 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {i.submitter_full_name || i.business_name || "Unknown submitter"}
                      </span>
                      {i.service_focus && (
                        <Badge variant="secondary" className="text-xs">
                          {i.service_focus}
                        </Badge>
                      )}
                      {i.lead_status && (
                        <Badge variant="outline" className="text-xs">
                          {i.lead_status}
                        </Badge>
                      )}
                      {i.link_method && i.link_method !== "manual" && (
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {i.link_method.replace("auto_", "auto · ")}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(i.created_at) || "—"}
                    </span>
                  </div>
                  {i.business_situation && (
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {i.business_situation}
                    </p>
                  )}
                  {i.questions_or_concerns && (
                    <p className="text-xs italic text-muted-foreground line-clamp-2">
                      “{i.questions_or_concerns}”
                    </p>
                  )}
                  {i.karbon_work_item_url && (
                    <a
                      href={i.karbon_work_item_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs inline-flex items-center gap-1 text-primary hover:underline w-fit"
                    >
                      {i.karbon_work_item_title || "Open work item"}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {debriefs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <StickyNote className="h-4 w-4" />
              Debriefs ({debriefs.length})
            </CardTitle>
            <CardDescription>
              Internal post-meeting recaps and action items captured by the team.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {debriefs.map((d) => {
                const itemCount = d.action_items?.items?.length || 0
                return (
                  <div key={d.id} className="p-4 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {d.debrief_type || "Debrief"}
                          {d.tax_year ? ` · TY ${d.tax_year}` : ""}
                        </span>
                        {d.status && (
                          <Badge variant="outline" className="text-xs">
                            {d.status}
                          </Badge>
                        )}
                        {itemCount > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {itemCount} action{itemCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(d.debrief_date) || formatDate(d.created_at) || "—"}
                      </span>
                    </div>
                    {d.team_member_full_name && (
                      <p className="text-xs text-muted-foreground">
                        by {d.team_member_full_name}
                        {d.work_item_title ? ` · on ${d.work_item_title}` : ""}
                      </p>
                    )}
                    {d.notes && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
                        {d.notes}
                      </p>
                    )}
                    {d.work_item_karbon_url && (
                      <a
                        href={d.work_item_karbon_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs inline-flex items-center gap-1 text-primary hover:underline w-fit"
                      >
                        Open work item
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects tab
// ─────────────────────────────────────────────────────────────────────────────

function ProjectsTab({ data }: { data: ClientBundle }) {
  const active = data.workItems.filter(
    (w) => (w.status || "").toLowerCase() !== "completed",
  )
  const completed = data.workItems.filter(
    (w) => (w.status || "").toLowerCase() === "completed",
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Active projects ({active.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {active.length === 0 ? (
            <EmptyState message="No active projects." />
          ) : (
            <div className="divide-y">
              {active.map((w) => (
                <ProjectRow key={w.id} workItem={w} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {completed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Completed projects ({completed.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[400px]">
              <div className="divide-y">
                {completed.map((w) => (
                  <ProjectRow key={w.id} workItem={w} />
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ProjectRow({
  workItem: w,
  compact,
}: {
  workItem: ClientBundle["workItems"][number]
  compact?: boolean
}) {
  const url =
    w.karbon_url ||
    (w.karbon_work_item_key ? getKarbonWorkItemUrl(w.karbon_work_item_key) : null)
  const todoProgress =
    w.todo_count && w.todo_count > 0
      ? `${w.completed_todo_count || 0}/${w.todo_count} todos`
      : null
  const isOverdue =
    !!w.due_date &&
    !w.completed_date &&
    new Date(w.due_date).getTime() < Date.now()

  return (
    <div className={cn("p-4 flex flex-col gap-1.5", compact && "p-3")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {w.title || "(untitled)"}
            </span>
            {w.work_type && (
              <Badge variant="outline" className="text-xs">
                {w.work_type}
              </Badge>
            )}
            {w.has_blocking_todos && (
              <Badge
                variant="outline"
                className="text-xs bg-amber-50 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border-amber-200 dark:border-amber-700/60"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Blocked
              </Badge>
            )}
            {isOverdue && (
              <Badge variant="destructive" className="text-xs">
                Overdue
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-muted-foreground mt-0.5">
            {w.primary_status && <span>{w.primary_status}</span>}
            {w.secondary_status && (
              <>
                <span>·</span>
                <span>{w.secondary_status}</span>
              </>
            )}
            {w.assignee_name && (
              <>
                <span>·</span>
                <span>Assigned to {w.assignee_name}</span>
              </>
            )}
            {w.due_date && (
              <>
                <span>·</span>
                <span>Due {formatDate(w.due_date) || "—"}</span>
              </>
            )}
            {todoProgress && (
              <>
                <span>·</span>
                <span>{todoProgress}</span>
              </>
            )}
          </div>
        </div>
        {url && (
          <Button variant="ghost" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only">Open in Karbon</span>
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Finance tab
// ─────────────────────────────────────────────────────────────────────────────

function FinanceTab({ data }: { data: ClientBundle }) {
  const summary = useMemo(
    () => summarizePayments(data.ignitionPayments),
    [data.ignitionPayments],
  )

  const acceptedProposals = data.ignitionProposals.filter(
    (p) => p.accepted_at || p.status === "accepted" || p.status === "completed",
  )
  const openProposals = data.ignitionProposals.filter(
    (p) =>
      !p.accepted_at &&
      !p.lost_at &&
      !p.archived_at &&
      !p.revoked_at &&
      p.status !== "completed",
  )

  const recurringMonthly = acceptedProposals.reduce((sum, p) => {
    const total = p.recurring_total || 0
    const freq = (p.recurring_frequency || "").toLowerCase()
    if (freq === "monthly") return sum + total
    if (freq === "annually" || freq === "yearly") return sum + total / 12
    if (freq === "quarterly") return sum + total / 3
    return sum
  }, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Money KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<PiggyBank className="h-4 w-4 text-muted-foreground" />}
          label="Total collected"
          value={formatCurrency(summary.totalAmount, summary.currency)}
          sub={`${summary.paymentCount} payment${summary.paymentCount === 1 ? "" : "s"}`}
        />
        <KpiCard
          icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
          label="Outstanding"
          value={formatCurrency(data.stats.totalUnpaidAmount)}
          sub={`${data.stats.totalInvoices} invoice${data.stats.totalInvoices === 1 ? "" : "s"} on file`}
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          label="Active proposals"
          value={data.stats.acceptedProposals.toString()}
          sub={`${formatCurrency(data.stats.totalProposalValue)} total value`}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          label="Recurring"
          value={formatCurrency(recurringMonthly)}
          sub="per month (annualised)"
        />
      </div>

      {/* Proposals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Proposals ({data.ignitionProposals.length})
          </CardTitle>
          <CardDescription>
            Ignition is the source of truth for "is this actually a client?" — a
            signed proposal here is what flips a contact from prospect to active.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.ignitionProposals.length === 0 ? (
            <EmptyState message="No Ignition proposals on file." />
          ) : (
            <div className="divide-y">
              {[...openProposals, ...acceptedProposals].map((p) => (
                <ProposalRow key={p.proposal_id} proposal={p} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Invoices ({data.unifiedInvoices.length})
          </CardTitle>
          <CardDescription>
            Merged from Karbon, Ignition, and the legacy HubSpot import.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.unifiedInvoices.length === 0 ? (
            <EmptyState message="No invoices on file." />
          ) : (
            <div className="divide-y">
              {data.unifiedInvoices.map((inv) => (
                <InvoiceRow key={inv.id} invoice={inv} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Payments ({data.ignitionPayments.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.ignitionPayments.length === 0 ? (
            <EmptyState message="No payments collected yet." />
          ) : (
            <div className="divide-y">
              {data.ignitionPayments.map((p) => (
                <div
                  key={p.ignition_payment_id}
                  className="p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {formatCurrency(p.amount, p.currency || "USD")}
                      </span>
                      {p.payment_method && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {p.payment_method.replace(/_/g, " ")}
                        </Badge>
                      )}
                      {p.payment_status && (
                        <Badge
                          variant={isPaid(p) ? "default" : "secondary"}
                          className="text-xs capitalize"
                        >
                          {p.payment_status}
                        </Badge>
                      )}
                      {p.refunded_at && (
                        <Badge variant="destructive" className="text-xs">
                          Refunded {formatDate(p.refunded_at) || ""}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.paid_at, "MMM d, yyyy") || "—"}
                      {p.fees && p.fees > 0
                        ? ` · fees ${formatCurrency(p.fees, p.currency || "USD")}`
                        : ""}
                      {p.net_amount != null
                        ? ` · net ${formatCurrency(p.net_amount, p.currency || "USD")}`
                        : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProposalRow({
  proposal: p,
}: {
  proposal: ClientBundle["ignitionProposals"][number]
}) {
  const isAccepted = !!p.accepted_at || p.status === "accepted" || p.status === "completed"
  const isLost = !!p.lost_at
  const isArchived = !!p.archived_at || !!p.revoked_at
  const value = p.total_value || (p.one_time_total || 0) + (p.recurring_total || 0)
  return (
    <div className="p-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">
            {p.title || `Proposal ${p.proposal_number || ""}`.trim() || "Untitled proposal"}
          </span>
          <Badge
            variant={isAccepted ? "default" : isLost ? "destructive" : "secondary"}
            className="text-xs capitalize"
          >
            {isAccepted ? "Accepted" : isLost ? "Lost" : isArchived ? "Archived" : (p.status || "Draft")}
          </Badge>
          {p.recurring_frequency && (
            <Badge variant="outline" className="text-xs capitalize">
              {p.recurring_frequency}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {p.accepted_at
            ? `Signed ${formatDate(p.accepted_at) || ""}`
            : p.sent_at
              ? `Sent ${formatDate(p.sent_at) || ""}`
              : `Created ${formatDate(p.created_at) || "—"}`}
          {p.client_manager ? ` · Manager: ${p.client_manager}` : ""}
        </p>
        {p.lost_reason && (
          <p className="text-xs text-muted-foreground italic">
            Reason: {p.lost_reason}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="font-medium text-sm">
          {formatCurrency(value, p.currency || "USD")}
        </div>
        {p.recurring_total ? (
          <div className="text-xs text-muted-foreground">
            {formatCurrency(p.recurring_total, p.currency || "USD")}/{p.recurring_frequency || "—"}
          </div>
        ) : null}
        {p.signed_url && (
          <a
            href={p.signed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs inline-flex items-center gap-1 text-primary hover:underline mt-0.5"
          >
            View
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}

function InvoiceRow({
  invoice: inv,
}: {
  invoice: ClientBundle["unifiedInvoices"][number]
}) {
  return (
    <div className="p-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {inv.invoice_number || "Invoice"}
          </span>
          <Badge variant="outline" className="text-xs uppercase">
            {inv.source}
          </Badge>
          {inv.status && (
            <Badge
              variant={
                inv.status.toLowerCase() === "paid"
                  ? "default"
                  : inv.amount_outstanding > 0
                    ? "destructive"
                    : "secondary"
              }
              className="text-xs capitalize"
            >
              {inv.status}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {inv.work_item_title ? `${inv.work_item_title} · ` : ""}
          Issued {formatDate(inv.issued_date) || "—"}
          {inv.due_date ? ` · Due ${formatDate(inv.due_date)}` : ""}
          {inv.paid_date ? ` · Paid ${formatDate(inv.paid_date)}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div className="font-medium text-sm">
          {formatCurrency(inv.amount, inv.currency)}
        </div>
        {inv.amount_outstanding > 0 ? (
          <div className="text-xs text-destructive">
            {formatCurrency(inv.amount_outstanding, inv.currency)} outstanding
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Paid</div>
        )}
        {inv.external_url && (
          <a
            href={inv.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs inline-flex items-center gap-1 text-primary hover:underline mt-0.5"
          >
            Open
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax tab
// ─────────────────────────────────────────────────────────────────────────────

function TaxTab({ data }: { data: ClientBundle }) {
  if (!data.proconnect)
    return (
      <Alert>
        <FileText className="h-4 w-4" />
        <AlertTitle>No ProConnect link yet</AlertTitle>
        <AlertDescription>
          This client isn't linked in ProConnect. Map them in the Tax dashboard or use
          the People → Platform links card below.
        </AlertDescription>
      </Alert>
    )

  const { returns, latestTaxYear, returnCount } = data.proconnect

  if (returnCount === 0)
    return (
      <Alert>
        <FileText className="h-4 w-4" />
        <AlertTitle>Linked, but no returns imported</AlertTitle>
        <AlertDescription>
          We have a ProConnect mapping for this client but no Phase 1 return data has
          been imported yet. Trigger an import from the Tax dashboard — once it
          completes, returns will appear here grouped by year.
        </AlertDescription>
      </Alert>
    )

  // Group by year (newest first)
  const byYear = useMemo(() => {
    const groups = new Map<number | "unknown", typeof returns>()
    for (const r of returns) {
      const key = r.taxYear ?? "unknown"
      const arr = groups.get(key) || []
      arr.push(r)
      groups.set(key, arr)
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === "unknown") return 1
      if (b[0] === "unknown") return -1
      return (b[0] as number) - (a[0] as number)
    })
  }, [returns])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {returnCount} return{returnCount === 1 ? "" : "s"}
          {latestTaxYear ? ` · most recent TY ${latestTaxYear}` : ""}
        </div>
      </div>

      {byYear.map(([year, list]) => (
        <Card key={String(year)}>
          <CardHeader>
            <CardTitle className="text-base">
              {year === "unknown" ? "Unscheduled" : `Tax year ${year}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {list.map((r, idx) => (
                <div key={`${r.form}-${idx}`} className="p-4 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {FORM_LABELS[r.form] || r.form}
                      </Badge>
                      {r.amended && (
                        <Badge variant="secondary" className="text-xs">
                          Amended
                        </Badge>
                      )}
                      {r.status && (
                        <Badge variant="secondary" className="text-xs capitalize">
                          {r.status}
                        </Badge>
                      )}
                      {r.efileStatus && (
                        <Badge
                          variant="outline"
                          className="text-xs capitalize bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900"
                        >
                          e-file: {r.efileStatus}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {r.preparer ? `Prepared by ${r.preparer}` : ""}
                      {r.updatedAt
                        ? ` · updated ${relativeTime(r.updatedAt) || "—"}`
                        : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm pt-1">
                    {r.totalRevenue != null && (
                      <TaxStat label="Total revenue" value={formatCurrency(r.totalRevenue)} />
                    )}
                    {r.totalIncome != null && (
                      <TaxStat label="Total income" value={formatCurrency(r.totalIncome)} />
                    )}
                    {r.totalTax != null && (
                      <TaxStat label="Total tax" value={formatCurrency(r.totalTax)} />
                    )}
                    {r.refund != null && r.refund > 0 && (
                      <TaxStat
                        label="Refund"
                        value={formatCurrency(r.refund)}
                        positive
                      />
                    )}
                    {r.amountOwed != null && r.amountOwed > 0 && (
                      <TaxStat
                        label="Amount owed"
                        value={formatCurrency(r.amountOwed)}
                        negative
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function TaxStat({
  label,
  value,
  positive,
  negative,
}: {
  label: string
  value: string
  positive?: boolean
  negative?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-medium",
          positive && "text-emerald-700 dark:text-emerald-400",
          negative && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents tab
// ─────────────────────────────────────────────────────────────────────────────

function DocumentsTab({ data }: { data: ClientBundle }) {
  if (data.documents.length === 0)
    return <EmptyCard message="No documents uploaded for this client yet." />
  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[700px]">
          <div className="divide-y">
            {data.documents.map((d) => (
              <div
                key={d.id}
                className="p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Files className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm truncate">
                      {d.name || "(untitled)"}
                    </span>
                    {d.document_type && (
                      <Badge variant="outline" className="text-xs">
                        {d.document_type}
                      </Badge>
                    )}
                    {d.tax_year && (
                      <Badge variant="secondary" className="text-xs">
                        TY {d.tax_year}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {d.file_type ? `${d.file_type.toUpperCase()} · ` : ""}
                    {formatBytes(d.file_size_bytes)}
                    {d.uploaded_at ? ` · uploaded ${formatDate(d.uploaded_at)}` : ""}
                  </p>
                  {d.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {d.description}
                    </p>
                  )}
                </div>
                {d.storage_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={d.storage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Open
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// People tab
// ─────────────────────────────────────────────────────────────────────────────

function PeopleTab({
  data,
  clientId,
  onChange,
}: {
  data: ClientBundle
  clientId: string
  onChange?: () => void | Promise<void>
}) {
  const { client } = data
  const isOrg = client.isOrganization

  // Dialog state for linking / editing a contact↔organization tie.
  // Only used on the contact side (isOrg === false). When `editing` is
  // null and the dialog is open, we're creating a new link.
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LinkOrganizationInitial | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)

  function openCreateDialog() {
    setEditing(null)
    setLinkDialogOpen(true)
  }

  function openEditDialog(o: ClientBundle["relatedOrganizations"][number]) {
    if (!o.relationshipId) return
    setEditing({
      relationshipId: o.relationshipId,
      organizationId: o.id,
      organizationName: o.name || o.full_name || null,
      roleOrTitle: o.roleOrTitle,
      ownershipPercentage: o.ownershipPercentage,
      isPrimaryContact: o.isPrimaryContact ?? false,
    })
    setLinkDialogOpen(true)
  }

  async function handleUnlink(relationshipId: string, name: string) {
    if (!relationshipId) return
    if (
      !window.confirm(
        `Remove ${name || "this organization"} from this contact's affiliations?`,
      )
    ) {
      return
    }
    try {
      setUnlinkingId(relationshipId)
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(
          clientId,
        )}/organizations?relationship_id=${encodeURIComponent(relationshipId)}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      toast.success("Organization unlinked.")
      await onChange?.()
    } catch (err) {
      console.error("[v0] unlink organization failed:", err)
      toast.error(err instanceof Error ? err.message : "Unlink failed.")
    } finally {
      setUnlinkingId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Related people */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            {isOrg
              ? `Related contacts (${data.relatedContacts.length})`
              : `Affiliated organizations (${data.relatedOrganizations.length})`}
          </CardTitle>
          {!isOrg && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openCreateDialog}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Link organization
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isOrg && data.relatedContacts.length === 0 && (
            <EmptyState message="No contacts linked to this organization." />
          )}
          {!isOrg && data.relatedOrganizations.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <span>No organizations affiliated with this contact.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={openCreateDialog}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Link an organization
              </Button>
            </div>
          )}
          {isOrg ? (
            <div className="divide-y">
              {data.relatedContacts.map((c) => (
                <div key={c.id} className="p-3 flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-xs">
                      {initials(c.full_name || "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/clients/${c.id}`}
                      className="font-medium text-sm hover:underline truncate block"
                    >
                      {c.full_name || "(unnamed)"}
                    </a>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.roleOrTitle ||
                        c.primary_email ||
                        c.phone_primary ||
                        "—"}
                      {c.ownershipPercentage != null
                        ? ` · ${c.ownershipPercentage}%`
                        : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y">
              {data.relatedOrganizations.map((o) => (
                <div key={o.id} className="p-3 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/clients/${o.id}`}
                        className="font-medium text-sm hover:underline truncate"
                      >
                        {o.name || o.full_name || "(unnamed org)"}
                      </a>
                      {o.isPrimaryContact && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          Primary
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {o.roleOrTitle ? (
                        <span className="font-medium text-foreground">
                          {o.roleOrTitle}
                        </span>
                      ) : (
                        <span className="italic">No role set</span>
                      )}
                      {o.ownershipPercentage != null
                        ? ` · ${o.ownershipPercentage}%`
                        : ""}
                      {o.industry || o.primary_email
                        ? ` · ${o.industry || o.primary_email}`
                        : ""}
                    </p>
                  </div>
                  {o.relationshipId && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDialog(o)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          handleUnlink(
                            o.relationshipId!,
                            o.name || o.full_name || "",
                          )
                        }
                        disabled={unlinkingId === o.relationshipId}
                      >
                        {unlinkingId === o.relationshipId
                          ? "Removing…"
                          : "Unlink"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Client groups & team */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            Internal team
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 flex flex-col gap-3 text-sm">
          {data.teamMembers.length === 0 ? (
            <span className="text-muted-foreground text-sm">
              No team members assigned.
            </span>
          ) : (
            data.teamMembers.map((tm) => (
              <div key={tm.key || tm.email || tm.name} className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="text-xs">
                    {initials(tm.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-sm">{tm.name}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {tm.email || "—"}
                  </p>
                </div>
              </div>
            ))
          )}
          {data.clientGroups.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Client groups
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {data.clientGroups.map((g) => (
                    <Badge key={g.id} variant="secondary" className="text-xs">
                      {g.name || "(unnamed)"}
                      {g.role ? ` · ${g.role}` : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
          {data.serviceLinesUsed.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Services used
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {data.serviceLinesUsed.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Platform links */}
      <div className="lg:col-span-2">
        <PlatformLinksCard contactId={clientId} />
      </div>

      {!isOrg && (
        <LinkOrganizationDialog
          open={linkDialogOpen}
          onOpenChange={(o) => {
            setLinkDialogOpen(o)
            if (!o) setEditing(null)
          }}
          contactId={clientId}
          initial={editing ?? undefined}
          onSaved={() => {
            void onChange?.()
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function EmptyCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="p-8">
        <EmptyState message={message} />
      </CardContent>
    </Card>
  )
}

function ClientProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="p-6 flex items-start gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
