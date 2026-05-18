"use client"

/**
 * ClientProfile — comprehensive client detail view backed by Supabase.
 *
 * Consumes /api/clients/[id] which bundles the contact/organization plus
 * every related Karbon entity (work items, notes, emails, tasks, invoices,
 * timesheets, documents, meetings, debriefs, related contacts/orgs, team
 * members, service lines, stats) in a single request.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { format, formatDistanceToNow, parseISO } from "date-fns"
import {
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  DollarSign,
  ExternalLink,
  Facebook,
  FileText,
  Flame,
  Globe,
  Inbox,
  Landmark,
  Linkedin,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  StickyNote,
  TrendingUp,
  Twitter,
  User,
  Users,
  Wallet,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { summarizePayments, isPaid } from "@/lib/ignition/payments"
import { cn } from "@/lib/utils"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"
import { AlfredErrorCard } from "@/components/alfred-error"
import { clientTypeBadgeClass, type ClientType } from "@/lib/client-type"

// ─────────────────────────────────────────────────────────────────────────────
// Types matching /api/clients/[id] response
// ─────────────────────────────────────────────────────────────────────────────

interface ClientBundle {
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
     * re-parse a label. Examples of .labelWithForm: "Individual (1040)",
     * "Partnership (1065)", "S-Corp (1120-S)", "Trust (1041)".
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
  /**
   * Server-merged invoice list spanning Karbon, Ignition, and the legacy
   * HubSpot import. Use this in the Invoices tab — the source-specific
   * arrays (karbonInvoices) remain available only for backward compat.
   */
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
    /**
     * Live recurring service line items from ignition_proposal_services. Only
     * present on accepted proposals — drafts/sent proposals don't yet have an
     * "active services" snapshot in Ignition.
     */
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
  /**
   * Ignition billing records linked to this client. Contains contact info
   * from the billing platform which may differ from Karbon-sourced data.
   */
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
    /** From debriefs_full view: title of the linked work_items row */
    work_item_title: string | null
    /** Direct Karbon URL on the joined work item (canonical, prefer this) */
    work_item_karbon_url: string | null
    /** User-pasted Karbon URL on the debrief itself (legacy fallback) */
    karbon_work_url: string | null
    team_member_id: string | null
    team_member_full_name: string | null
    created_at: string | null
  }>
  /**
   * Jotform intake submissions linked to this client by the
   * auto-matcher in lib/jotform/match-client.ts (or pinned manually
   * via the intake admin queue). Renders in the Intakes tab as a
   * collapsible list mirroring the Debriefs section, since both are
   * "client said something to us in their own words" artifacts.
   */
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
    full_name: string | null
    primary_email: string | null
    phone_primary: string | null
    roleOrTitle: string | null
    ownershipPercentage: number | null
  }>
  relatedOrganizations: Array<{
    id: string
    name: string | null
    full_name: string | null
    primary_email: string | null
    industry: string | null
    roleOrTitle: string | null
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
  /**
   * Every `payment_status='collected'` payment we have for this
   * client, sorted newest first. Rolled-up totals live on
   * `paymentsSummary` below — use that for the KPI strip, this
   * array for the Payments tab table.
   */
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
  /** Aggregate roll-up of ignitionPayments. */
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
  /**
   * ProConnect data, present only when this client is linked in
   * `client_mapping`. `returns` collapses all five form-specific
   * schemas into one normalized row shape for table rendering.
   */
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────���────────────────────────────────────

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

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?"
}

function statusVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" | "destructive" {
  if (!status) return "secondary"
  const s = status.toLowerCase()
  if (s === "completed" || s === "paid") return "default"
  if (s === "in progress" || s === "ready to start") return "default"
  if (s === "waiting" || s === "blocked" || s === "overdue") return "destructive"
  return "secondary"
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
  // Two layers of expand-state for the Debriefs tab. Work-item groups default
  // to expanded so users land on a fully-visible list; individual debrief
  // cards default to collapsed (only date + type visible) so a client with
  // many debriefs doesn't drown the view in walls of notes text.
  const [collapsedDebriefGroups, setCollapsedDebriefGroups] = useState<Set<string>>(
    () => new Set(),
  )
  // Each intake submission is collapsible — default-collapsed so a
  // long history of submissions doesn't dominate the tab. The Set
  // shape mirrors expandedDebriefIds for symmetry / muscle-memory.
  const [expandedIntakeIds, setExpandedIntakeIds] = useState<Set<string>>(() => new Set())
  const [expandedDebriefIds, setExpandedDebriefIds] = useState<Set<string>>(
    () => new Set(),
  )

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
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/sync`, {
        method: "POST",
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      setSyncMessage(
        json?.synced ? `Synced from Karbon at ${new Date().toLocaleTimeString()}` : "Sync queued",
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

  // Build a unified communications timeline: emails + karbon notes
  const communicationsTimeline = useMemo(() => {
    if (!data) return []
    const items: Array<{
      id: string
      kind: "email" | "note"
      timestamp: string | null
      subject: string | null
      preview: string
      author: string | null
      direction?: string | null
      isPinned?: boolean
      url?: string | null
    }> = []
    // NOTE: this useMemo runs during render, BEFORE the destructure below
    // that pulls `karbonNotes` etc. off `data`. We must read those fields
    // straight off `data` here -- referencing the destructured const names
    // would hit a Temporal Dead Zone error ("Cannot access 'X' before
    // initialization") because the const bindings are hoisted into the
    // function scope but not yet initialized at this point in execution.
    // Each `?? []` also defends against older API responses that omit a
    // collection entirely (the cause of the original blank-page crash).
    for (const e of data.emails ?? []) {
      items.push({
        id: `email-${e.id}`,
        kind: "email",
        timestamp: e.sent_at || e.received_at,
        subject: e.subject,
        preview: (e.body_text || "").slice(0, 200),
        author: e.from_name || e.from_email,
        direction: e.direction,
      })
    }
    for (const n of data.karbonNotes ?? []) {
      items.push({
        id: `note-${n.id}`,
        kind: "note",
        timestamp: n.karbon_created_at,
        subject: n.subject || "(no subject)",
        preview: (n.body || "").replace(/<[^>]+>/g, " ").slice(0, 200),
        author: n.author_name,
        isPinned: !!n.is_pinned,
        url: n.karbon_url,
      })
    }
    return items
      .filter((i) => i.timestamp)
      .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
  }, [data])

  // Group debriefs by their linked Karbon work item so users can scan past
  // debriefs in the context of the engagement they belong to. Debriefs with
  // no linked work item land in a synthetic "(No Work Item)" bucket — these
  // are the residual cases the Karbon webhook backfill couldn't resolve.
  const debriefsByWorkItem = useMemo(() => {
    if (!data) return [] as Array<{
      key: string
      workItemId: string | null
      title: string
      karbonUrl: string | null
      latestDate: string | null
      debriefs: ClientBundle["debriefs"]
    }>
    const groups = new Map<
      string,
      {
        key: string
        workItemId: string | null
        title: string
        karbonUrl: string | null
        latestDate: string | null
        debriefs: ClientBundle["debriefs"]
      }
    >()
    for (const d of data.debriefs ?? []) {
      const key = d.work_item_id || "__none__"
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          workItemId: d.work_item_id,
          title: d.work_item_title || "(No Work Item)",
          karbonUrl: d.work_item_karbon_url || d.karbon_work_url || null,
          latestDate: null,
          debriefs: [],
        })
      }
      const g = groups.get(key)!
      g.debriefs.push(d)
      // Track the most-recent date in the group for sorting groups by recency.
      const ts = d.debrief_date || d.created_at
      if (ts && (!g.latestDate || new Date(ts) > new Date(g.latestDate))) {
        g.latestDate = ts
      }
    }
    // Each group: most-recent debrief first.
    for (const g of groups.values()) {
      g.debriefs.sort((a, b) => {
        const at = new Date(a.debrief_date || a.created_at || 0).getTime()
        const bt = new Date(b.debrief_date || b.created_at || 0).getTime()
        return bt - at
      })
    }
    // Groups sorted by most-recent activity, "(No Work Item)" pinned to the
    // bottom regardless of recency so it doesn't visually swamp the real
    // engagements.
    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === "__none__") return 1
      if (b.key === "__none__") return -1
      const at = a.latestDate ? new Date(a.latestDate).getTime() : 0
      const bt = b.latestDate ? new Date(b.latestDate).getTime() : 0
      return bt - at
    })
  }, [data])

  // ───────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading client...</p>
      </div>
    )
  }

  if (error || !data) {
    // Frame the failure as ALFRED reporting back: friendlier than a stock
    // "Failed to load" card and consistent with the route-level error
    // boundary's branding, so a 500 from /api/clients/[id] looks the same
    // as an unhandled render crash from the user's point of view.
    const isNotFound = !!error && /HTTP\s*404/i.test(error)
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <AlfredErrorCard
          title={
            isNotFound
              ? "ALFRED here �� I couldn't find that client in our records."
              : "ALFRED here — I couldn't pull up that client just now."
          }
          message={
            isNotFound
              ? "The client may have been merged, archived, or never synced from Karbon. Let me take you back to the directory."
              : "I tried fetching the file but something went wrong on the way. You can try again, or head back to the directory."
          }
          error={error ? new Error(error) : undefined}
          onRetry={fetchClient}
          homeHref="/clients"
        />
      </div>
    )
  }

  // Defensive destructure with `?? []` fallbacks. Older deployments of
  // /api/clients/[id] sometimes shipped responses missing one of these
  // arrays (e.g. `ignitionClients` was added later, `unifiedInvoices` was
  // added later). When that happens, hitting `.length` or `.map(...)` on
  // an undefined value throws and bubbles all the way up to the route
  // error boundary — better to render an empty section than to crash the
  // entire page.
  const {
    client,
    workItems = [],
    karbonTasks = [],
    karbonInvoices = [],
    unifiedInvoices,
    ignitionProposals = [],
    ignitionClients = [],
    documents = [],
    karbonTimesheets = [],
    debriefs = [],
    intakeSubmissions = [],
    karbonNotes = [],
    manualNotes = [],
    serviceLinesUsed = [],
    teamMembers = [],
    clientGroups = [],
    relatedContacts = [],
    relatedOrganizations = [],
    stats,
    ignitionPayments = [],
    paymentsSummary,
    proconnect,
  } = data
  // Use the server-merged unified list when present. Older API responses
  // didn't include it — in that case we synthesize the same shape from
  // karbonInvoices so the Invoices tab still renders something useful.
  const invoices =
    unifiedInvoices ??
    (karbonInvoices ?? []).map((inv) => ({
      id: `karbon:${inv.id}`,
      source: "karbon" as const,
      invoice_number: inv.invoice_number,
      status: inv.status,
      amount: Number(inv.total_amount) || 0,
      amount_paid:
        inv.status?.toLowerCase() === "paid" ? Number(inv.total_amount) || 0 : 0,
      amount_outstanding:
        inv.status?.toLowerCase() === "paid" ? 0 : Number(inv.total_amount) || 0,
      currency: inv.currency || "USD",
      issued_date: inv.issued_date,
      due_date: inv.due_date,
      paid_date: inv.paid_date,
      work_item_title: inv.work_item_title,
      external_url: inv.karbon_url,
    }))

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* ═════ Header ═════ */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                {client.avatarUrl ? <AvatarImage src={client.avatarUrl} alt={client.clientName} /> : null}
                <AvatarFallback className="text-lg">{initials(client.clientName)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-semibold tracking-tight text-balance">
                    {client.clientName}
                  </h1>
                  {client.isOrganization ? (
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <User className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/*
                   * Single, filing-form-aware Client Type badge replaces the
                   * old triple-stack of {type, entityType, contactType}. The
                   * server resolves a unified label like "Partnership (1065)"
                   * via lib/client-type so the badge is consistent with the
                   * Clients list and any future filters.
                   */}
                  {client.clientType ? (
                    <Badge
                      variant="outline"
                      className={cn("font-medium", clientTypeBadgeClass(client.clientType.variant))}
                    >
                      {client.clientType.labelWithForm}
                    </Badge>
                  ) : client.type ? (
                    <Badge variant="secondary">{client.type}</Badge>
                  ) : null}
                  {/*
                   * Suppress the secondary contactType chip when it duplicates
                   * what the unified Client Type badge already says. We compare
                   * against both label fields because Karbon's contact_type
                   * sometimes carries the bare label ("S Corporation") and
                   * sometimes the form-suffixed variant ("S-Corp (1120-S)").
                   */}
                  {client.contactType &&
                  client.contactType !== client.clientType?.label &&
                  client.contactType !== client.clientType?.labelWithForm ? (
                    <Badge variant="outline">{client.contactType}</Badge>
                  ) : null}
                  {client.status ? (
                    <Badge variant={statusVariant(client.status)}>{client.status}</Badge>
                  ) : null}
                  {client.isProspect ? <Badge variant="outline">Prospect</Badge> : null}
                  {(client.tags || []).slice(0, 5).map((t) => (
                    <Badge key={t} variant="outline" className="font-normal">
                      {t}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap mt-1">
                  {client.lastActivityAt ? (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last activity {relativeTime(client.lastActivityAt)}
                    </span>
                  ) : null}
                  {client.lastSyncedAt ? (
                    <span className="flex items-center gap-1">
                      <RefreshCw className="h-3 w-3" />
                      Synced {relativeTime(client.lastSyncedAt)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 items-stretch md:items-end">
              <div className="flex gap-2">
                {client.karbonUrl ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={client.karbonUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open in Karbon
                    </a>
                  </Button>
                ) : null}
                <Button onClick={handleSync} disabled={syncing} size="sm">
                  <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
                  {syncing ? "Syncing..." : "Sync from Karbon"}
                </Button>
              </div>
              {syncMessage ? (
                <p className="text-xs text-muted-foreground">{syncMessage}</p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═════ Stats row ═════ */}
      {/* Eight cards on lg+ so Total Paid sits next to Unpaid for an
          at-a-glance money-in / money-owed pairing. On md we keep the
          original 4-per-row layout and let the row wrap. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard icon={Briefcase} label="Active Work" value={stats.activeWorkItems} sub={`${stats.totalWorkItems} total`} />
        <StatCard
          icon={ClipboardList}
          label="Proposals"
          value={stats.totalProposals}
          sub={
            stats.acceptedProposals
              ? `${stats.acceptedProposals} accepted`
              : stats.activeProposals
              ? `${stats.activeProposals} active`
              : undefined
          }
        />
        <StatCard icon={CheckSquare} label="Open Tasks" value={stats.openTasks} sub={`${stats.totalTasks} total`} />
        <StatCard icon={Mail} label="Emails" value={stats.totalEmails} />
        <StatCard icon={StickyNote} label="Notes" value={stats.totalNotes} />
        <StatCard icon={FileText} label="Documents" value={stats.totalDocuments} />
        {/*
         * Lifetime net paid — the firm's actual cash-in-the-door from
         * this client, after Ignition/Stripe fees, across all time. We
         * deliberately use `totalNet` rather than `totalAmount` so this
         * always reflects what hit the bank, and we leave it as a
         * lifetime figure (not filtered by the Payments tab date range
         * below) so it stays a stable "client value" headline number.
         */}
        <StatCard
          icon={Wallet}
          label="Total Paid"
          value={formatCurrency(paymentsSummary?.totalNet ?? 0, paymentsSummary?.currency)}
          sub={
            paymentsSummary && paymentsSummary.paymentCount > 0
              ? `${paymentsSummary.paymentCount} payment${paymentsSummary.paymentCount === 1 ? "" : "s"} · lifetime net`
              : "no payments yet"
          }
        />
        <StatCard
          icon={DollarSign}
          label="Unpaid"
          value={formatCurrency(stats.totalUnpaidAmount)}
          sub={`${stats.totalInvoices} invoices`}
        />
      </div>

      {/* ═════ Tabs ═════ */}
      {/*
       * Consolidated tab strip (rev 2026-05). Several previously separate
       * tabs were merged so the profile reads more like a story than a
       * directory listing:
       *   • Communications + Intakes folded into Overview — they're
       *     read-mostly context, not destinations of their own.
       *   • Work Items + Tasks → "Work & Tasks" (one engagement view).
       *   • Notes + Debriefs → "Notes & Debriefs" (one narrative view).
       *   • Proposals + Invoices + Payments → "Finance" (one billing
       *     timeline).
       * Timesheets is hidden from the strip (data still flows through
       * Karbon, just not surfaced here). Tax stays conditional on a
       * ProConnect link, Payments collapses into Finance, Documents and
       * Relationships remain top-level. Multiple <TabsContent value=...>
       * with the same value all render together inside that tab — Radix
       * supports this and it lets us merge UIs without duplicating the
       * card markup.
       */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="work">
            Work &amp; Tasks
            {stats.totalWorkItems + stats.totalTasks > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalWorkItems + stats.totalTasks}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="notes">
            Notes &amp; Debriefs
            {stats.totalNotes + stats.totalDebriefs > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalNotes + stats.totalDebriefs}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="finance">
            Finance
            {stats.totalProposals + stats.totalInvoices > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalProposals + stats.totalInvoices}
              </Badge>
            ) : null}
          </TabsTrigger>
          {/* Tax tab — only shown when this client is linked in
              ProConnect. The badge counts returns across all five
              form types (1040/1065/1120/1120S/990). */}
          {proconnect && proconnect.returnCount > 0 ? (
            <TabsTrigger value="tax">
              Tax
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {proconnect.returnCount}
              </Badge>
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="documents">
            Documents
            {stats.totalDocuments > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalDocuments}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
        </TabsList>

        {/* ── Overview ──────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Contact Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <InfoRow icon={Mail} label="Primary Email" value={client.contactInfo.primaryEmail} href={client.contactInfo.primaryEmail ? `mailto:${client.contactInfo.primaryEmail}` : null} />
                <InfoRow icon={Mail} label="Secondary Email" value={client.contactInfo.secondaryEmail} />
                <InfoRow icon={Phone} label="Primary Phone" value={client.contactInfo.phonePrimary} href={client.contactInfo.phonePrimary ? `tel:${client.contactInfo.phonePrimary}` : null} />
                <InfoRow icon={Phone} label="Mobile" value={client.contactInfo.phoneMobile} href={client.contactInfo.phoneMobile ? `tel:${client.contactInfo.phoneMobile}` : null} />
                <InfoRow icon={Phone} label="Work" value={client.contactInfo.phoneWork} />
                <InfoRow icon={MapPin} label="Address" value={client.contactInfo.address} />
                {client.contactInfo.mailingAddress &&
                client.contactInfo.mailingAddress !== client.contactInfo.address ? (
                  <InfoRow icon={MapPin} label="Mailing Address" value={client.contactInfo.mailingAddress} />
                ) : null}
                <InfoRow icon={Globe} label="Website" value={client.contactInfo.website} href={client.contactInfo.website} />
                {/* Social rows — Karbon syncs these as part of the
                    contact / organization record. We render each only
                    when populated so the card stays tight on clients
                    without a digital presence. Twitter handles are
                    stored as the bare handle (e.g. "@motta"); we
                    rebuild the canonical URL on the fly. */}
                {client.contactInfo.linkedin ? (
                  <InfoRow
                    icon={Linkedin}
                    label="LinkedIn"
                    value={client.contactInfo.linkedin}
                    href={client.contactInfo.linkedin}
                  />
                ) : null}
                {client.contactInfo.twitter ? (
                  <InfoRow
                    icon={Twitter}
                    label="Twitter / X"
                    value={client.contactInfo.twitter}
                    href={
                      client.contactInfo.twitter.startsWith("http")
                        ? client.contactInfo.twitter
                        : `https://twitter.com/${client.contactInfo.twitter.replace(/^@/, "")}`
                    }
                  />
                ) : null}
                {client.contactInfo.facebook ? (
                  <InfoRow
                    icon={Facebook}
                    label="Facebook"
                    value={client.contactInfo.facebook}
                    href={client.contactInfo.facebook}
                  />
                ) : null}
              </CardContent>
            </Card>

            {/* Identity / Business */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {client.isOrganization ? "Business Details" : "Personal Details"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {client.isOrganization && client.business
                  ? Object.entries({
                      "Legal Name": client.business.legalName,
                      "Trading Name": client.business.tradingName,
                      "Industry": client.business.industry,
                      "Entity Type": client.business.entityType,
                      "EIN": client.business.ein,
                      "Incorporated": client.business.incorporationDate
                        ? formatDate(client.business.incorporationDate as string)
                        : null,
                      "Inc. State": client.business.incorporationState,
                      "Fiscal Year End": client.business.fiscalYearEnd,
                      "Employees": client.business.numberOfEmployees,
                    })
                      .filter(([, v]) => v != null && v !== "")
                      .map(([k, v]) => <KvRow key={k} label={k} value={String(v)} />)
                  : null}
                {!client.isOrganization && client.identity
                  ? Object.entries({
                      "Preferred Name": client.identity.preferredName,
                      "Date of Birth": client.identity.dateOfBirth
                        ? formatDate(client.identity.dateOfBirth as string)
                        : null,
                      "Occupation": client.identity.occupation,
                      "Employer": client.identity.employer,
                      "EIN": client.identity.ein,
                      "SSN (last 4)": client.identity.ssnLastFour
                        ? `***-**-${client.identity.ssnLastFour}`
                        : null,
                    })
                      .filter(([, v]) => v != null && v !== "")
                      .map(([k, v]) => <KvRow key={k} label={k} value={String(v)} />)
                  : null}
                {(client.isOrganization && !client.business) ||
                (!client.isOrganization && !client.identity) ? (
                  <p className="text-muted-foreground">No additional details synced.</p>
                ) : null}
              </CardContent>
            </Card>

            {/* Ownership / Service Lines */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Engagement</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {client.ownership.source ? (
                  <KvRow label="Source" value={client.ownership.source} />
                ) : null}
                {client.ownership.referredBy ? (
                  <KvRow label="Referred By" value={client.ownership.referredBy} />
                ) : null}
                {client.ownership.taxProviderName ? (
                  <KvRow label="Tax Provider" value={client.ownership.taxProviderName} />
                ) : null}
                {client.ownership.legalFirmName ? (
                  <KvRow label="Legal Firm" value={client.ownership.legalFirmName} />
                ) : null}
                {serviceLinesUsed.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Service Lines
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {serviceLinesUsed.map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {teamMembers.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Assigned Team
                    </span>
                    <div className="flex flex-col gap-1">
                      {teamMembers.slice(0, 6).map((m) => (
                        <div key={m.key || m.name} className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback>
                          </Avatar>
                          <span className="text-xs">{m.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Ignition Billing Info (if linked) */}
          {ignitionClients && ignitionClients.length > 0 ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Flame className="h-4 w-4 text-orange-500" />
                  Ignition Billing
                  <Badge variant="secondary" className="ml-auto text-xs font-normal">
                    {ignitionClients.length} record{ignitionClients.length > 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ignitionClients.map((ic) => {
                    const address = [
                      ic.address_line1,
                      ic.address_line2,
                      ic.city,
                      ic.state,
                      ic.zip_code,
                      ic.country,
                    ]
                      .filter(Boolean)
                      .join(", ")
                    return (
                      <div
                        key={ic.ignition_client_id}
                        className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-sm truncate">
                            {ic.name || ic.business_name || "Unnamed"}
                          </div>
                          {ic.client_type ? (
                            <Badge variant="outline" className="text-xs capitalize shrink-0">
                              {ic.client_type}
                            </Badge>
                          ) : null}
                        </div>
                        {ic.business_name && ic.name && ic.business_name !== ic.name ? (
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Building2 className="h-3 w-3" />
                            {ic.business_name}
                          </div>
                        ) : null}
                        {ic.email ? (
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Mail className="h-3 w-3" />
                            <a
                              href={`mailto:${ic.email}`}
                              className="hover:underline truncate"
                            >
                              {ic.email}
                            </a>
                          </div>
                        ) : null}
                        {ic.phone ? (
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Phone className="h-3 w-3" />
                            <a href={`tel:${ic.phone}`} className="hover:underline">
                              {ic.phone}
                            </a>
                          </div>
                        ) : null}
                        {address ? (
                          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
                            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{address}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2 mt-1 pt-1 border-t text-xs text-muted-foreground">
                          {ic.match_status ? (
                            <Badge
                              variant={
                                ic.match_status === "auto_matched"
                                  ? "default"
                                  : ic.match_status === "manual_matched"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="text-[10px] h-4 px-1"
                            >
                              {ic.match_status.replace(/_/g, " ")}
                            </Badge>
                          ) : null}
                          {ic.ignition_updated_at ? (
                            <span className="ml-auto">
                              Updated {relativeTime(ic.ignition_updated_at)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Recent Activity */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {communicationsTimeline.length === 0 && workItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No activity yet. Click <strong>Sync from Karbon</strong> to pull latest data.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {[...workItems.slice(0, 3), ...communicationsTimeline.slice(0, 5)]
                    .slice(0, 8)
                    .map((item, i) => (
                      <ActivityRow key={`act-${i}`} item={item} />
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Work Items ────────────────────────────────────────────────── */}
        <TabsContent value="work" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Work Items ({workItems.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {workItems.length === 0 ? (
                <EmptyState message="No work items synced for this client." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <div className="divide-y">
                    {workItems.map((wi) => (
                      <div key={wi.id} className="p-4 flex flex-col gap-2 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-medium text-sm truncate">{wi.title || "(untitled)"}</h3>
                              {wi.has_blocking_todos ? (
                                <Badge variant="destructive" className="text-xs">
                                  Blocked
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                              {wi.work_type ? <span>{wi.work_type}</span> : null}
                              {wi.assignee_name ? (
                                <>
                                  <span>•</span>
                                  <span>{wi.assignee_name}</span>
                                </>
                              ) : null}
                              {wi.due_date ? (
                                <>
                                  <span>•</span>
                                  <span>Due {formatDate(wi.due_date)}</span>
                                </>
                              ) : null}
                              {wi.todo_count != null && wi.todo_count > 0 ? (
                                <>
                                  <span>•</span>
                                  <span>
                                    {wi.completed_todo_count || 0}/{wi.todo_count} todos
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant={statusVariant(wi.primary_status || wi.status)} className="text-xs">
                              {wi.primary_status || wi.status || "Unknown"}
                            </Badge>
                            {wi.karbon_work_item_key ? (
                              <Button asChild size="icon" variant="ghost" className="h-7 w-7">
                                <a
                                  href={wi.karbon_url || getKarbonWorkItemUrl(wi.karbon_work_item_key)}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Open in Karbon"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Communications ────────────────────────────────────────────── */}
        {/* ── Communications (folded into Overview) ───────────────────── */}
        {/* Lives under Overview because the timeline is read-mostly
            context (recent emails + Karbon notes) and tells the story
            of what's been said with the client. Pinned items still get
            a "Pinned" badge. */}
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Communications Timeline</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {communicationsTimeline.length === 0 ? (
                <EmptyState
                  message="No emails or notes synced yet for this client."
                  hint="Karbon notes and emails will appear here once they're synced. Use the Sync button above to pull the latest."
                />
              ) : (
                <ScrollArea className="max-h-[700px]">
                  <div className="divide-y">
                    {communicationsTimeline.map((c) => (
                      <div key={c.id} className="p-4 flex flex-col gap-1.5 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {c.kind === "email" ? (
                              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                            ) : (
                              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <h3 className="font-medium text-sm truncate">{c.subject || "(no subject)"}</h3>
                            {c.isPinned ? (
                              <Badge variant="outline" className="text-xs">
                                Pinned
                              </Badge>
                            ) : null}
                            {c.direction ? (
                              <Badge variant="outline" className="text-xs capitalize">
                                {c.direction}
                              </Badge>
                            ) : null}
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {relativeTime(c.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {c.author ? <span>{c.author}</span> : null}
                          {c.url ? (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open
                            </a>
                          ) : null}
                        </div>
                        {c.preview ? (
                          <p className="text-sm text-foreground/80 line-clamp-2 leading-relaxed">{c.preview}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tasks ────────────────────────���────────────────────────────── */}
        {/* ── Tasks (folded into Work & Tasks) ─────────────────────────── */}
        <TabsContent value="work" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tasks</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {karbonTasks.length === 0 ? (
                <EmptyState message="No tasks synced for this client yet." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <div className="divide-y">
                    {karbonTasks.map((t) => (
                      <div key={t.id} className="p-4 flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          {t.completed_date ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                          ) : (
                            <CheckSquare className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          )}
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <h3 className={cn("text-sm font-medium", t.completed_date && "line-through text-muted-foreground")}>
                              {t.title || "(untitled)"}
                            </h3>
                            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                              {t.assignee_name ? <span>{t.assignee_name}</span> : null}
                              {t.due_date ? (
                                <>
                                  <span>•</span>
                                  <span>Due {formatDate(t.due_date)}</span>
                                </>
                              ) : null}
                              {t.priority ? (
                                <>
                                  <span>•</span>
                                  <span className="capitalize">{t.priority} priority</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {t.is_blocking ? (
                            <Badge variant="destructive" className="text-xs">
                              Blocking
                            </Badge>
                          ) : null}
                          <Badge variant={statusVariant(t.status)} className="text-xs">
                            {t.status || "Open"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Notes ─────────────────────────────────────────────────────── */}
        <TabsContent value="notes" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Karbon Notes ({karbonNotes.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {karbonNotes.length === 0 ? (
                  <EmptyState message="No Karbon notes synced." />
                ) : (
                  <ScrollArea className="max-h-[500px]">
                    <div className="divide-y">
                      {karbonNotes.map((n) => (
                        <div key={n.id} className="p-4 flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-medium text-sm">{n.subject || "(no subject)"}</h3>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {relativeTime(n.karbon_created_at)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {n.author_name ? <span>{n.author_name}</span> : null}
                            {n.work_item_title ? (
                              <>
                                <span>•</span>
                                <span>{n.work_item_title}</span>
                              </>
                            ) : null}
                            {n.is_pinned ? (
                              <Badge variant="outline" className="text-xs">
                                Pinned
                              </Badge>
                            ) : null}
                          </div>
                          {n.body ? (
                            <p className="text-sm text-foreground/80 line-clamp-3">
                              {n.body.replace(/<[^>]+>/g, " ")}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Internal Notes ({manualNotes.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {manualNotes.length === 0 ? (
                  <EmptyState message="No internal notes yet." />
                ) : (
                  <ScrollArea className="max-h-[500px]">
                    <div className="divide-y">
                      {manualNotes.map((n) => (
                        <div key={n.id} className="p-4 flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-medium text-sm">{n.title || "(untitled)"}</h3>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {relativeTime(n.created_at)}
                            </span>
                          </div>
                          {n.content ? (
                            <p className="text-sm text-foreground/80 line-clamp-3 whitespace-pre-wrap">
                              {n.content}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Debriefs (grouped by Karbon work item) ────────────────────── */}
        {/* ── Debriefs (folded into Notes & Debriefs) ──────────────────── */}
        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Debriefs ({debriefs.length})</span>
                {debriefsByWorkItem.length > 0 ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {debriefsByWorkItem.length}{" "}
                    {debriefsByWorkItem.length === 1 ? "engagement" : "engagements"}
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {debriefs.length === 0 ? (
                <EmptyState message="No debriefs recorded for this client yet." />
              ) : (
                <ul className="divide-y">
                  {debriefsByWorkItem.map((group) => {
                    const isCollapsed = collapsedDebriefGroups.has(group.key)
                    return (
                      <li key={group.key} className="bg-background">
                        {/* Work-item header — click to expand/collapse the group */}
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                          onClick={() =>
                            setCollapsedDebriefGroups((prev) => {
                              const next = new Set(prev)
                              if (next.has(group.key)) next.delete(group.key)
                              else next.add(group.key)
                              return next
                            })
                          }
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm flex-1 truncate">
                            {group.title}
                          </span>
                          <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                            {group.debriefs.length}
                          </Badge>
                          {group.latestDate ? (
                            <span className="text-xs text-muted-foreground hidden sm:inline whitespace-nowrap">
                              latest {formatDate(group.latestDate)}
                            </span>
                          ) : null}
                          {group.karbonUrl ? (
                            <a
                              href={group.karbonUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                              title="Open work item in Karbon"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </button>
                        {!isCollapsed ? (
                          <ul className="divide-y border-t bg-muted/20">
                            {group.debriefs.map((d) => {
                              const isOpen = expandedDebriefIds.has(d.id)
                              const cleanedNotes = d.notes
                                ? d.notes.replace(/<[^>]+>/g, " ")
                                : ""
                              const actionItemList = d.action_items?.items || []
                              return (
                                <li key={d.id} className="bg-background">
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-3 px-6 py-2.5 text-left hover:bg-muted/40 transition-colors"
                                    onClick={() =>
                                      setExpandedDebriefIds((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(d.id)) next.delete(d.id)
                                        else next.add(d.id)
                                        return next
                                      })
                                    }
                                  >
                                    {isOpen ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    )}
                                    <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    <span className="text-sm font-medium whitespace-nowrap">
                                      {formatDate(d.debrief_date)}
                                    </span>
                                    {d.debrief_type ? (
                                      <Badge variant="outline" className="h-5 px-1.5 text-xs">
                                        {d.debrief_type}
                                      </Badge>
                                    ) : null}
                                    {d.tax_year ? (
                                      <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                                        TY {d.tax_year}
                                      </Badge>
                                    ) : null}
                                    {d.team_member_full_name ? (
                                      <span className="text-xs text-muted-foreground hidden sm:inline truncate">
                                        {d.team_member_full_name}
                                      </span>
                                    ) : null}
                                    {!isOpen && cleanedNotes ? (
                                      <span className="text-xs text-muted-foreground truncate hidden md:inline flex-1">
                                        {cleanedNotes.slice(0, 120)}
                                      </span>
                                    ) : null}
                                    {actionItemList.length > 0 ? (
                                      <Badge
                                        variant="outline"
                                        className="ml-auto h-5 px-1.5 text-xs"
                                      >
                                        {actionItemList.length} action
                                        {actionItemList.length === 1 ? "" : "s"}
                                      </Badge>
                                    ) : null}
                                  </button>
                                  {isOpen ? (
                                    <div className="px-6 pb-4 pt-1 space-y-3 text-sm">
                                      {/* Notes — the full debrief content */}
                                      {cleanedNotes ? (
                                        <div>
                                          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                            Notes
                                          </h4>
                                          <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">
                                            {cleanedNotes}
                                          </p>
                                        </div>
                                      ) : (
                                        <p className="text-muted-foreground italic">
                                          No notes captured for this debrief.
                                        </p>
                                      )}

                                      {/* Action items */}
                                      {actionItemList.length > 0 ? (
                                        <div>
                                          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                            Action Items ({actionItemList.length})
                                          </h4>
                                          <ul className="space-y-1.5">
                                            {actionItemList.map((item, idx) => (
                                              <li
                                                key={idx}
                                                className="flex items-start gap-2"
                                              >
                                                <CheckSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                                <div className="flex-1 min-w-0">
                                                  <p className="text-foreground/90">
                                                    {item.description}
                                                  </p>
                                                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5">
                                                    {item.assignee_name ? (
                                                      <span>{item.assignee_name}</span>
                                                    ) : null}
                                                    {item.due_date ? (
                                                      <span>
                                                        Due {formatDate(item.due_date)}
                                                      </span>
                                                    ) : null}
                                                    {item.priority ? (
                                                      <Badge
                                                        variant="outline"
                                                        className="h-4 px-1 text-[10px]"
                                                      >
                                                        {item.priority}
                                                      </Badge>
                                                    ) : null}
                                                  </div>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ) : null}

                                      {/* Footer — owner / manager / follow-up */}
                                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                                        {d.client_owner_name ? (
                                          <span>Owner: {d.client_owner_name}</span>
                                        ) : null}
                                        {d.client_manager_name ? (
                                          <span>Manager: {d.client_manager_name}</span>
                                        ) : null}
                                        {d.follow_up_date ? (
                                          <span>
                                            Follow-up: {formatDate(d.follow_up_date)}
                                          </span>
                                        ) : null}
                                        {d.filing_status ? (
                                          <span>Filing: {d.filing_status}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Intake Submissions (Jotform — folded into Overview) ──────── */}
        {/* Mirrors the Debriefs tab visually: each submission is a
            collapsible row keyed by its submitted-at date. Click a
            row to reveal the full Q/A breakdown captured at the time
            of intake — useful for understanding what the client
            originally asked for vs. what they ended up engaging on.
            Submissions reach this section via lib/jotform/match-client.ts
            (auto-link on email or business name) and via the manual
            "Link to client" button on /sales/intake. Rendered only when
            at least one submission is linked, so long-time clients who
            joined pre-Jotform don't see an empty card. */}
        {intakeSubmissions.length > 0 ? (
          <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Intake Submissions ({intakeSubmissions.length})</span>
                <Link
                  href="/sales/intake"
                  className="text-xs font-normal text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  Open Intake Queue
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {intakeSubmissions.length === 0 ? (
                <EmptyState message="No intake submissions linked to this client yet." />
              ) : (
                <ul className="divide-y">
                  {intakeSubmissions.map((sub) => {
                    const isOpen = expandedIntakeIds.has(sub.id)
                    const submittedAt = sub.created_at
                    // Surface a brief one-line preview when the row is
                    // collapsed. Prefer the free-text "questions or
                    // concerns" field because it's where prospects say
                    // the actual interesting thing; fall back to the
                    // service focus if that's blank.
                    const preview =
                      (sub.questions_or_concerns?.replace(/\s+/g, " ").trim() ||
                        sub.service_focus ||
                        "")
                    return (
                      <li key={sub.id} className="bg-background">
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
                          onClick={() =>
                            setExpandedIntakeIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(sub.id)) next.delete(sub.id)
                              else next.add(sub.id)
                              return next
                            })
                          }
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <Inbox className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium whitespace-nowrap">
                            {submittedAt ? formatDate(submittedAt) : "—"}
                          </span>
                          {sub.service_focus ? (
                            <Badge variant="outline" className="h-5 px-1.5 text-xs whitespace-nowrap">
                              {sub.service_focus}
                            </Badge>
                          ) : null}
                          {sub.lead_status ? (
                            <Badge variant="secondary" className="h-5 px-1.5 text-xs whitespace-nowrap">
                              {sub.lead_status}
                            </Badge>
                          ) : null}
                          {/* Show whether this link came from the
                              auto-matcher or a human pin so a CSM can
                              decide how much to trust it at a glance. */}
                          {sub.link_method && sub.link_method !== "manual" ? (
                            <Badge
                              variant="outline"
                              className="h-5 px-1.5 text-xs whitespace-nowrap text-muted-foreground"
                              title={`Linked automatically via ${sub.link_method.replace("auto_", "").replace("_", " ")}`}
                            >
                              auto
                            </Badge>
                          ) : null}
                          {!isOpen && preview ? (
                            <span className="text-xs text-muted-foreground truncate hidden md:inline flex-1">
                              {preview.slice(0, 140)}
                            </span>
                          ) : null}
                        </button>
                        {isOpen ? (
                          <div className="px-6 pb-4 pt-1 space-y-3 text-sm">
                            {/* Submitter identity — included on every
                                row even though it's redundant for the
                                client we're already on the page for,
                                because intake forms can be filled out
                                by spouses, accountants, or assistants
                                on the client's behalf. */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                              {sub.submitter_full_name ? (
                                <div>
                                  <span className="text-muted-foreground">Submitter: </span>
                                  <span className="font-medium">{sub.submitter_full_name}</span>
                                </div>
                              ) : null}
                              {sub.submitter_email ? (
                                <div>
                                  <span className="text-muted-foreground">Email: </span>
                                  <a href={`mailto:${sub.submitter_email}`} className="font-medium hover:underline">
                                    {sub.submitter_email}
                                  </a>
                                </div>
                              ) : null}
                              {sub.submitter_phone ? (
                                <div>
                                  <span className="text-muted-foreground">Phone: </span>
                                  <a href={`tel:${sub.submitter_phone}`} className="font-medium hover:underline">
                                    {sub.submitter_phone}
                                  </a>
                                </div>
                              ) : null}
                              {sub.business_name ? (
                                <div>
                                  <span className="text-muted-foreground">Business: </span>
                                  <span className="font-medium">{sub.business_name}</span>
                                  {sub.business_state ? (
                                    <span className="text-muted-foreground"> ({sub.business_state})</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {sub.business_situation ? (
                                <div>
                                  <span className="text-muted-foreground">Situation: </span>
                                  <span className="font-medium">{sub.business_situation}</span>
                                </div>
                              ) : null}
                              {sub.entity_types && sub.entity_types.length > 0 ? (
                                <div>
                                  <span className="text-muted-foreground">Entity types: </span>
                                  <span className="font-medium">{sub.entity_types.join(", ")}</span>
                                </div>
                              ) : null}
                              {sub.referral_source ? (
                                <div>
                                  <span className="text-muted-foreground">Heard about us: </span>
                                  <span className="font-medium">{sub.referral_source}</span>
                                </div>
                              ) : null}
                            </div>

                            {sub.services_requested && sub.services_requested.length > 0 ? (
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                  Services Requested
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                  {sub.services_requested.map((s, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">
                                      {s}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {sub.questions_or_concerns ? (
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                  Questions / Concerns
                                </h4>
                                <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">
                                  {sub.questions_or_concerns}
                                </p>
                              </div>
                            ) : null}

                            <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
                              <Link
                                href={`/sales/intake?id=${sub.id}`}
                                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Open full intake
                              </Link>
                              <span>·</span>
                              <span>
                                Submission {sub.id.slice(0, 8)}
                              </span>
                              {sub.linked_at ? (
                                <>
                                  <span>·</span>
                                  <span title={sub.linked_at}>
                                    Linked {formatDistanceToNow(parseISO(sub.linked_at), { addSuffix: true })}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          </TabsContent>
        ) : null}

        {/* ── Finance: Proposals → Invoices → Payments ─────────────────── */}
        {/* All three live under the single Finance tab so the billing
            story reads top-to-bottom: what we proposed, what we billed,
            what we collected. Each section is its own card to keep the
            existing layout / interactions intact. */}
        <TabsContent value="finance" className="mt-4 flex flex-col gap-4">
          {/* Proposals (Ignition) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Proposals ({ignitionProposals.length})</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {stats.acceptedProposals > 0 ? (
                    <>
                      Accepted: {stats.acceptedProposals}
                      <span className="mx-2">•</span>
                    </>
                  ) : null}
                  Total Value: {formatCurrency(stats.totalProposalValue)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {ignitionProposals.length === 0 ? (
                <EmptyState message="No proposals synced from Ignition for this client." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <div className="divide-y">
                    {ignitionProposals.map((p) => {
                      // Resolve the most informative status label and a date stamp
                      // describing the most recent state transition. Lifecycle
                      // priority: revoked > archived > lost > completed > accepted > sent > draft.
                      const lifecycle =
                        p.revoked_at
                          ? { label: "Revoked", date: p.revoked_at, variant: "destructive" as const }
                          : p.archived_at
                          ? { label: "Archived", date: p.archived_at, variant: "outline" as const }
                          : p.lost_at || (p.status || "").toLowerCase() === "lost"
                          ? { label: "Lost", date: p.lost_at, variant: "destructive" as const }
                          : p.completed_at
                          ? { label: "Completed", date: p.completed_at, variant: "default" as const }
                          : p.accepted_at || (p.status || "").toLowerCase() === "accepted"
                          ? { label: "Accepted", date: p.accepted_at, variant: "default" as const }
                          : p.sent_at || (p.status || "").toLowerCase() === "sent"
                          ? { label: "Sent", date: p.sent_at, variant: "secondary" as const }
                          : { label: p.status || "Draft", date: p.created_at, variant: "outline" as const }

                      return (
                        <div key={p.proposal_id} className="p-4 flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors">
                          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-medium text-sm truncate">
                                {p.title || `Proposal ${p.proposal_number || p.proposal_id.slice(0, 8)}`}
                              </h3>
                              <Badge variant={lifecycle.variant} className="text-xs">
                                {lifecycle.label}
                              </Badge>
                              {p.proposal_number && p.title ? (
                                <span className="text-xs text-muted-foreground">#{p.proposal_number}</span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                              {lifecycle.date ? (
                                <span>
                                  {lifecycle.label} {formatDate(lifecycle.date)}
                                </span>
                              ) : null}
                              {p.billing_starts_on ? (
                                <>
                                  <span>•</span>
                                  <span>Billing starts {formatDate(p.billing_starts_on)}</span>
                                </>
                              ) : null}
                              {p.client_partner ? (
                                <>
                                  <span>•</span>
                                  <span>Partner: {p.client_partner}</span>
                                </>
                              ) : null}
                              {p.client_manager && p.client_manager !== p.client_partner ? (
                                <>
                                  <span>•</span>
                                  <span>Manager: {p.client_manager}</span>
                                </>
                              ) : null}
                            </div>
                            {p.lost_reason ? (
                              <p className="text-xs text-muted-foreground italic">
                                Reason: {p.lost_reason}
                              </p>
                            ) : null}
                            {/*
                             * Inline service line items. We sort by ordinal to
                             * preserve the proposal's original line order and
                             * suppress the section entirely when there are no
                             * services (typical for non-accepted proposals).
                             */}
                            {p.services && p.services.length > 0 ? (
                              <ul className="mt-1.5 flex flex-col gap-1 rounded-md border bg-muted/30 px-2.5 py-1.5">
                                {[...p.services]
                                  .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
                                  .map((s) => (
                                    <li
                                      key={s.id}
                                      className="flex items-center justify-between gap-3 text-xs"
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className="truncate font-medium">{s.service_name}</span>
                                        {s.billing_frequency ? (
                                          <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal capitalize">
                                            {s.billing_frequency.replace(/_/g, " ")}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <span className="text-muted-foreground shrink-0">
                                        {formatCurrency(s.total_amount, s.currency || p.currency || "USD")}
                                        {s.quantity && s.quantity > 1 ? (
                                          <span className="ml-1 text-[10px]">x{s.quantity}</span>
                                        ) : null}
                                      </span>
                                    </li>
                                  ))}
                              </ul>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="font-semibold">
                              {formatCurrency(p.total_value, p.currency || "USD")}
                            </span>
                            {p.recurring_total && p.recurring_total > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {formatCurrency(p.recurring_total, p.currency || "USD")}/
                                {(p.recurring_frequency || "month").toLowerCase()}
                              </span>
                            ) : null}
                            {p.signed_url ? (
                              <Button asChild variant="ghost" size="sm" className="h-7 px-2 -mr-2">
                                <a href={p.signed_url} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                  View
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Invoices (Karbon / Ignition / HubSpot) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Invoices ({invoices.length})</span>
                <span className="text-sm font-normal text-muted-foreground">
                  Unpaid: {formatCurrency(stats.totalUnpaidAmount)}
                  <span className="mx-2">•</span>
                  Total: {formatCurrency(stats.totalInvoicedAmount)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {invoices.length === 0 ? (
                <EmptyState message="No invoices on file for this client." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <div className="divide-y">
                    {invoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="p-4 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-sm">
                              #{inv.invoice_number || inv.id.split(":").pop()?.slice(0, 8)}
                            </h3>
                            <Badge
                              variant={statusVariant(inv.status)}
                              className="text-xs capitalize"
                            >
                              {inv.status || "draft"}
                            </Badge>
                            {/*
                             * Source pill — distinguishes Karbon (current),
                             * Ignition (current proposals → invoices), and
                             * HubSpot (legacy pre-Ignition billing).
                             */}
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4 px-1 font-normal capitalize text-muted-foreground"
                            >
                              {inv.source}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                            {inv.work_item_title ? <span>{inv.work_item_title}</span> : null}
                            {inv.issued_date ? (
                              <>
                                {inv.work_item_title ? <span>•</span> : null}
                                <span>Issued {formatDate(inv.issued_date)}</span>
                              </>
                            ) : null}
                            {inv.due_date ? (
                              <>
                                <span>•</span>
                                <span>Due {formatDate(inv.due_date)}</span>
                              </>
                            ) : null}
                            {inv.paid_date ? (
                              <>
                                <span>•</span>
                                <span>Paid {formatDate(inv.paid_date)}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex flex-col items-end">
                            <span className="font-semibold">
                              {formatCurrency(inv.amount, inv.currency || "USD")}
                            </span>
                            {inv.amount_outstanding > 0 &&
                            inv.amount_outstanding < inv.amount ? (
                              <span className="text-xs text-muted-foreground">
                                {formatCurrency(inv.amount_outstanding, inv.currency || "USD")}{" "}
                                outstanding
                              </span>
                            ) : null}
                          </div>
                          {inv.external_url ? (
                            <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                              <a
                                href={inv.external_url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Open invoice"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Payments — only rendered when this client has at least one
              payment on file. The PaymentsTab component owns its own
              date-range state (preset + custom range) and recomputes
              its KPI strip and table independently; the lifetime
              context line keeps the bigger picture visible when a
              narrow window is selected. */}
          {paymentsSummary && paymentsSummary.paymentCount > 0 ? (
            <PaymentsTab
              payments={ignitionPayments}
              lifetimeSummary={paymentsSummary}
            />
          ) : null}
        </TabsContent>

        {/* ── Tax (ProConnect) ──────────────────────────────────────────── */}
        {/* Only rendered when the client is linked in ProConnect. The
            normalized `returns` shape lets us render every form type in
            one table without form-specific conditionals. */}
        {proconnect && proconnect.returnCount > 0 ? (
          <TabsContent value="tax" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Landmark className="h-4 w-4" />
                  ProConnect Tax Returns
                  <Badge variant="secondary" className="ml-auto text-xs font-normal">
                    {proconnect.returnCount} return
                    {proconnect.returnCount === 1 ? "" : "s"}
                    {proconnect.latestTaxYear ? ` • latest ${proconnect.latestTaxYear}` : ""}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="px-4 py-2 font-medium">Form</th>
                        <th className="px-4 py-2 font-medium">Tax Year</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 font-medium">E-file</th>
                        <th className="px-4 py-2 font-medium">Preparer</th>
                        <th className="px-4 py-2 font-medium text-right">Revenue / AGI</th>
                        <th className="px-4 py-2 font-medium text-right">Income</th>
                        <th className="px-4 py-2 font-medium text-right">Tax</th>
                        <th className="px-4 py-2 font-medium text-right">Refund</th>
                        <th className="px-4 py-2 font-medium text-right">Owed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proconnect.returns.map((r, idx) => (
                        <tr
                          key={`${r.form}-${r.taxYear}-${idx}`}
                          className="border-b last:border-0 hover:bg-muted/20"
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="font-mono text-xs">
                                {r.form}
                              </Badge>
                              {r.amended ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-amber-50 text-amber-900 border-amber-200"
                                >
                                  amended
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2 tabular-nums">{r.taxYear ?? "—"}</td>
                          <td className="px-4 py-2 capitalize text-muted-foreground">
                            {r.status || "—"}
                          </td>
                          <td className="px-4 py-2">
                            {r.efileStatus ? (
                              <Badge
                                variant={
                                  r.efileStatus.toLowerCase().includes("accepted")
                                    ? "default"
                                    : "secondary"
                                }
                                className="text-xs capitalize"
                              >
                                {r.efileStatus.replace(/_/g, " ")}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {r.preparer || "—"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.totalRevenue != null ? formatCurrency(r.totalRevenue) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.totalIncome != null ? formatCurrency(r.totalIncome) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.totalTax != null ? formatCurrency(r.totalTax) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                            {r.refund != null ? formatCurrency(r.refund) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                            {r.amountOwed != null ? formatCurrency(r.amountOwed) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {/* ── Documents ─────────────────────────────────────────────────── */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents ({documents.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {documents.length === 0 ? (
                <EmptyState message="No documents on file." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <div className="divide-y">
                    {documents.map((d) => (
                      <div key={d.id} className="p-4 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-sm font-medium truncate">{d.name || "(untitled)"}</span>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                              {d.document_type ? <span>{d.document_type}</span> : null}
                              {d.file_type ? (
                                <>
                                  <span>•</span>
                                  <span>{d.file_type}</span>
                                </>
                              ) : null}
                              <span>•</span>
                              <span>{formatBytes(d.file_size_bytes)}</span>
                              {d.uploaded_at ? (
                                <>
                                  <span>•</span>
                                  <span>{relativeTime(d.uploaded_at)}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        {d.storage_url ? (
                          <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                            <a href={d.storage_url} target="_blank" rel="noreferrer" aria-label="Download">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Timesheets ────────────────────────────────────────────────── */}
        {/* Hidden from the tab strip in 2026-05 to keep the profile
            focused on client-facing surfaces. The Karbon timesheet
            data still syncs and feeds stats.totalBillableMinutes for
            internal reporting; if it ever needs surfacing again, just
            re-add a <TabsTrigger value="time"> entry above and restore
            this panel. */}

        {/* ── Relationships ─────────────────────────────────────────────── */}
        <TabsContent value="relationships" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {clientGroups.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Client Groups
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {clientGroups.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-2 text-sm border rounded-md p-3">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-medium">{g.name || "(unnamed)"}</span>
                        <span className="text-xs text-muted-foreground">
                          {[g.group_type, g.role, g.relationship].filter(Boolean).join(" • ")}
                        </span>
                      </div>
                      {g.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {relatedContacts.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Related Contacts ({relatedContacts.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {relatedContacts.map((c) => (
                    <Link
                      key={c.id}
                      href={`/clients/${c.id}`}
                      className="flex items-center justify-between gap-2 text-sm border rounded-md p-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-medium">{c.full_name || "Unnamed"}</span>
                        <span className="text-xs text-muted-foreground">
                          {[c.roleOrTitle, c.primary_email].filter(Boolean).join(" • ")}
                        </span>
                      </div>
                      {c.ownershipPercentage != null ? (
                        <Badge variant="outline">{c.ownershipPercentage}%</Badge>
                      ) : null}
                    </Link>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {relatedOrganizations.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Related Organizations ({relatedOrganizations.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {relatedOrganizations.map((o) => (
                    <Link
                      key={o.id}
                      href={`/clients/${o.id}`}
                      className="flex items-center justify-between gap-2 text-sm border rounded-md p-3 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-medium">{o.full_name || o.name || "Unnamed"}</span>
                        <span className="text-xs text-muted-foreground">
                          {[o.roleOrTitle, o.industry, o.primary_email].filter(Boolean).join(" • ")}
                        </span>
                      </div>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {clientGroups.length === 0 &&
            relatedContacts.length === 0 &&
            relatedOrganizations.length === 0 ? (
              <Card className="lg:col-span-2">
                <CardContent className="pt-6">
                  <EmptyState message="No related contacts, organizations, or client groups." />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ───────────────────────────────────────────────────���─��───────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Payments tab
//
// The payments tab is the only one of the in-tab views with substantive
// client-side logic (date filtering + on-the-fly summary recomputation),
// so it's extracted from the main JSX tree to keep the parent function
// readable. It still lives in this file because it leans on several
// private helpers (`StatCard`, `formatCurrency`, `formatDate`,
// `relativeTime`) defined above; exporting them just to import them in
// a sibling file would be net-noise.
// ─────────────────────────────────────────────────────────────────────────────

type DateRangePreset =
  | "ytd"
  | "last_30"
  | "last_90"
  | "last_12_months"
  | "previous_year"
  | "all_time"
  | "custom"

const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  ytd: "Year to date",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  last_12_months: "Last 12 months",
  previous_year: "Previous year",
  all_time: "All time",
  custom: "Custom range",
}

/**
 * Resolve a preset key + optional custom inputs to a concrete
 * [start, end] window. `null` on either side means open-ended on that
 * side ("since beginning of time" / "up to right now"). The custom
 * inputs use the `Input type="date"` value format (`YYYY-MM-DD`) and
 * are interpreted in the user's local timezone, matching how the
 * native picker presents them.
 */
function resolveDateRange(
  preset: DateRangePreset,
  customStart: string,
  customEnd: string,
): { start: Date | null; end: Date | null } {
  const now = new Date()
  switch (preset) {
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end: null }
    case "last_30": {
      const d = new Date(now)
      d.setDate(d.getDate() - 30)
      return { start: d, end: null }
    }
    case "last_90": {
      const d = new Date(now)
      d.setDate(d.getDate() - 90)
      return { start: d, end: null }
    }
    case "last_12_months": {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 12)
      return { start: d, end: null }
    }
    case "previous_year":
      return {
        start: new Date(now.getFullYear() - 1, 0, 1),
        end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      }
    case "all_time":
      return { start: null, end: null }
    case "custom":
      return {
        // Append explicit times so `new Date("2024-01-01")` doesn't
        // get parsed as UTC midnight and shift a day in negative-UTC
        // timezones.
        start: customStart ? new Date(`${customStart}T00:00:00`) : null,
        end: customEnd ? new Date(`${customEnd}T23:59:59.999`) : null,
      }
  }
}

function PaymentsTab({
  payments,
  lifetimeSummary,
}: {
  payments: Array<{
    ignition_payment_id: string
    ignition_invoice_id: string | null
    amount: number | null
    fees: number | null
    net_amount: number | null
    currency: string | null
    payment_method: string | null
    payment_status: string | null
    paid_at: string | null
    refunded_at: string | null
    refund_amount: number | null
  }>
  lifetimeSummary: {
    totalNet: number
    paymentCount: number
    currency: string
    mostRecentPaidAt: string | null
  }
}) {
  // Default to YTD per product spec. The custom inputs are kept in
  // state independently of the preset so switching back from "custom"
  // to e.g. "ytd" doesn't blow them away — useful when an admin is
  // toggling between a saved custom window and a quick comparison.
  const [preset, setPreset] = useState<DateRangePreset>("ytd")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")

  const range = useMemo(
    () => resolveDateRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  )

  const filteredPayments = useMemo(() => {
    // Open-ended on both sides → no filtering. Saves a pass over the
    // (potentially long) payments array on the "All time" preset.
    if (!range.start && !range.end) return payments
    return payments.filter((p) => {
      if (!p.paid_at) return false
      const t = new Date(p.paid_at).getTime()
      if (range.start && t < range.start.getTime()) return false
      if (range.end && t > range.end.getTime()) return false
      return true
    })
  }, [payments, range])

  // Re-summarise on the client using the same helper the server
  // route uses, so the in-tab KPI strip stays in lockstep with the
  // top-of-page "Total Paid" card. `summarizePayments` correctly
  // counts both `collected` (in-transit) and `disbursed` (settled)
  // rows as paid — see `lib/ignition/payments.ts` for the full
  // lifecycle rationale.
  const filteredSummary = useMemo(
    () => summarizePayments(filteredPayments),
    [filteredPayments],
  )

  const currency = lifetimeSummary.currency
  const isFiltered = preset !== "all_time"

  // Format the actual resolved range for the "Showing" label so the
  // user can see exactly what window they're looking at, not just the
  // preset name (which is meaningful but ambiguous for things like
  // "last 90 days" if you forgot the current date).
  const showingLabel = (() => {
    if (preset === "all_time") return "All payments on file"
    const startStr = range.start ? format(range.start, "MMM d, yyyy") : "—"
    const endStr = range.end ? format(range.end, "MMM d, yyyy") : "today"
    return `${startStr} → ${endStr}`
  })()

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter bar ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              Showing
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {showingLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={preset}
              onValueChange={(v) => setPreset(v as DateRangePreset)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DATE_RANGE_LABELS) as DateRangePreset[]).map(
                  (k) => (
                    <SelectItem key={k} value={k}>
                      {DATE_RANGE_LABELS[k]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            {preset === "custom" ? (
              <>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-[160px]"
                  aria-label="Start date"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-[160px]"
                  aria-label="End date"
                />
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ── KPI strip (reflects the filtered range) ────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Wallet}
          label="Total Collected"
          value={formatCurrency(filteredSummary.totalAmount, currency)}
          sub={`${filteredSummary.paymentCount} payment${
            filteredSummary.paymentCount === 1 ? "" : "s"
          }`}
        />
        <StatCard
          icon={DollarSign}
          label="Net to Firm"
          value={formatCurrency(filteredSummary.totalNet, currency)}
          sub={
            filteredSummary.totalFees > 0
              ? `after ${formatCurrency(
                  filteredSummary.totalFees,
                  currency,
                )} fees`
              : undefined
          }
        />
        <StatCard
          icon={TrendingUp}
          label="Refunded"
          value={formatCurrency(filteredSummary.totalRefunded, currency)}
          sub={
            filteredSummary.refundCount > 0
              ? `${filteredSummary.refundCount} refund${
                  filteredSummary.refundCount === 1 ? "" : "s"
                }`
              : "none"
          }
        />
        <StatCard
          icon={Calendar}
          label="Most Recent"
          value={
            filteredSummary.mostRecentPaidAt
              ? formatDate(filteredSummary.mostRecentPaidAt) || "—"
              : "—"
          }
          sub={
            filteredSummary.mostRecentPaidAt
              ? relativeTime(filteredSummary.mostRecentPaidAt) || undefined
              : undefined
          }
        />
      </div>

      {/* Lifetime context line — only when filtering, so the user
          always knows what the cumulative picture looks like even
          when they've narrowed to a tight window. */}
      {isFiltered ? (
        <p className="text-xs text-muted-foreground px-1">
          Lifetime:{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(lifetimeSummary.totalNet, currency)}
          </span>{" "}
          net across {lifetimeSummary.paymentCount} payment
          {lifetimeSummary.paymentCount === 1 ? "" : "s"}
          {lifetimeSummary.mostRecentPaidAt
            ? `, most recent ${
                formatDate(lifetimeSummary.mostRecentPaidAt) || "—"
              }`
            : ""}
          .
        </p>
      ) : null}

      {/* ── Payments table ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Payment History
          </CardTitle>
          <Badge variant="outline" className="text-xs font-normal">
            {filteredPayments.length} of {payments.length}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {filteredPayments.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No payments in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Method</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                    <th className="px-4 py-2 font-medium text-right">Fees</th>
                    <th className="px-4 py-2 font-medium text-right">Net</th>
                    <th className="px-4 py-2 font-medium">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((p) => {
                    const isRefunded = !!p.refunded_at
                    return (
                      <tr
                        key={p.ignition_payment_id}
                        className="border-b last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-4 py-2 whitespace-nowrap">
                          {p.paid_at ? formatDate(p.paid_at) : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {/* Treat both `collected` (just charged,
                              funds in transit) and `disbursed`
                              (settled to firm) as the same "paid"
                              state for badge styling — they're
                              consecutive lifecycle stages of a
                              successful payment, not distinct
                              outcomes. */}
                          <Badge
                            variant={
                              isRefunded
                                ? "destructive"
                                : isPaid(p)
                                  ? "default"
                                  : "secondary"
                            }
                            className="text-xs capitalize"
                          >
                            {isRefunded
                              ? "refunded"
                              : p.payment_status || "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 capitalize text-muted-foreground">
                          {p.payment_method || "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">
                          {formatCurrency(
                            Number(p.amount) || 0,
                            p.currency || "USD",
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {p.fees != null
                            ? formatCurrency(
                                Number(p.fees),
                                p.currency || "USD",
                              )
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {p.net_amount != null
                            ? formatCurrency(
                                Number(p.net_amount),
                                p.currency || "USD",
                              )
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                          {p.ignition_invoice_id || "—"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <span className="text-xl font-semibold tabular-nums">{value}</span>
            {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
          </div>
          <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null | undefined
  href?: string | null
}) {
  if (!value) return null
  const content = (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span className="text-sm break-words">{value}</span>
      </div>
    </div>
  )
  if (href) {
    return (
      <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="hover:opacity-80 transition-opacity">
        {content}
      </a>
    )
  }
  return content
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">
        {label}
      </span>
      <span className="text-sm text-right break-words">{value}</span>
    </div>
  )
}

function ActivityRow({ item }: { item: any }) {
  // Heuristic rendering for either work item or comm timeline item
  if (item.kind === "email" || item.kind === "note") {
    return (
      <div className="flex items-start gap-3 text-sm">
        {item.kind === "email" ? (
          <Mail className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        )}
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">{item.subject || "(no subject)"}</span>
            <span className="text-xs text-muted-foreground shrink-0">{relativeTime(item.timestamp)}</span>
          </div>
          {item.preview ? (
            <span className="text-xs text-muted-foreground line-clamp-1">{item.preview}</span>
          ) : null}
        </div>
      </div>
    )
  }
  // Work item
  return (
    <div className="flex items-start gap-3 text-sm">
      <Briefcase className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{item.title || "(untitled)"}</span>
          <Badge variant={statusVariant(item.primary_status || item.status)} className="text-xs shrink-0">
            {item.primary_status || item.status || "Unknown"}
          </Badge>
        </div>
        {item.due_date ? (
          <span className="text-xs text-muted-foreground">Due {formatDate(item.due_date)}</span>
        ) : null}
      </div>
    </div>
  )
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center px-4">
      <ClipboardList className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {hint ? <p className="text-xs text-muted-foreground max-w-md">{hint}</p> : null}
    </div>
  )
}
