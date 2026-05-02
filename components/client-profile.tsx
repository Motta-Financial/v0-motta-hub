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
  AlertCircle,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Globe,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  StickyNote,
  TrendingUp,
  User,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { getKarbonWorkItemUrl } from "@/lib/karbon-utils"

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
     * Unified, filing-form-aware client type label derived on the server via
     * `lib/client-type.getClientType()`. Examples: "Individual (1040)",
     * "Partnership (1065)", "S-Corp (1120-S)", "C-Corp (1120)", "Trust (1041)",
     * "Non-Profit (990)", "Sole Proprietor (Schedule C)", or "Business" /
     * "Individual" when the source data is too sparse to classify.
     */
    clientType: string
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
    totalInvoices: number
    totalInvoicedAmount: number
    totalUnpaidAmount: number
    totalBillableMinutes: number
    totalProposals: number
    activeProposals: number
    acceptedProposals: number
    totalProposalValue: number
  }
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
    for (const e of data.emails) {
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
    for (const n of data.karbonNotes) {
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
    return (
      <Card className="max-w-2xl mx-auto mt-12">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Failed to load client
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{error || "Client not found"}</p>
          <div className="flex gap-2">
            <Button onClick={fetchClient} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
            <Button asChild variant="ghost">
              <Link href="/clients">Back to Clients</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const {
    client,
    workItems,
    karbonTasks,
    karbonInvoices,
    unifiedInvoices,
    ignitionProposals,
    documents,
    karbonTimesheets,
    stats,
  } = data
  // Use the server-merged unified list when present. Older API responses
  // didn't include it — in that case we synthesize the same shape from
  // karbonInvoices so the Invoices tab still renders something useful.
  const invoices =
    unifiedInvoices ??
    karbonInvoices.map((inv) => ({
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
                  <Badge variant="secondary">{client.clientType || client.type}</Badge>
                  {client.contactType && client.contactType !== client.clientType ? (
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
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
        <StatCard
          icon={DollarSign}
          label="Unpaid"
          value={formatCurrency(stats.totalUnpaidAmount)}
          sub={`${stats.totalInvoices} invoices`}
        />
      </div>

      {/* ═════ Tabs ═════ */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="work">
            Work Items
            {stats.totalWorkItems > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalWorkItems}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="comms">
            Communications
            {communicationsTimeline.length > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {communicationsTimeline.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks
            {stats.totalTasks > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalTasks}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="notes">
            Notes
            {stats.totalNotes > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalNotes}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="proposals">
            Proposals
            {stats.totalProposals > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalProposals}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices
            {stats.totalInvoices > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalInvoices}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="documents">
            Documents
            {stats.totalDocuments > 0 ? (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {stats.totalDocuments}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="time">Timesheets</TabsTrigger>
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
                {data.serviceLinesUsed.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Service Lines
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {data.serviceLinesUsed.map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {data.teamMembers.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Assigned Team
                    </span>
                    <div className="flex flex-col gap-1">
                      {data.teamMembers.slice(0, 6).map((m) => (
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
        <TabsContent value="comms" className="mt-4">
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

        {/* ── Tasks ─────────────────────────────────────────────────────── */}
        <TabsContent value="tasks" className="mt-4">
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
                <CardTitle className="text-base">Karbon Notes ({data.karbonNotes.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.karbonNotes.length === 0 ? (
                  <EmptyState message="No Karbon notes synced." />
                ) : (
                  <ScrollArea className="max-h-[500px]">
                    <div className="divide-y">
                      {data.karbonNotes.map((n) => (
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
                <CardTitle className="text-base">Internal Notes ({data.manualNotes.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.manualNotes.length === 0 ? (
                  <EmptyState message="No internal notes yet." />
                ) : (
                  <ScrollArea className="max-h-[500px]">
                    <div className="divide-y">
                      {data.manualNotes.map((n) => (
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

        {/* ── Invoices ──────────────────────────────────────────────────── */}
        {/* ── Proposals (Ignition) ──────────────────────────────────────── */}
        <TabsContent value="proposals" className="mt-4">
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
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
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
        </TabsContent>

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
        <TabsContent value="time" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Time Entries ({karbonTimesheets.length})</span>
                <span className="text-sm font-normal text-muted-foreground">
                  Total: {(stats.totalBillableMinutes / 60).toFixed(1)}h
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {karbonTimesheets.length === 0 ? (
                <EmptyState message="No time entries logged." />
              ) : (
                <ScrollArea className="max-h-[600px]">
                  <div className="divide-y">
                    {karbonTimesheets.map((t) => (
                      <div key={t.id} className="p-4 flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="text-sm font-medium truncate">
                            {t.description || t.work_item_title || "(no description)"}
                          </span>
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                            {t.user_name ? <span>{t.user_name}</span> : null}
                            {t.date ? (
                              <>
                                <span>•</span>
                                <span>{formatDate(t.date)}</span>
                              </>
                            ) : null}
                            {t.is_billable ? (
                              <>
                                <span>•</span>
                                <Badge variant="outline" className="text-xs">
                                  Billable
                                </Badge>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="text-sm font-medium">
                            {((t.minutes || 0) / 60).toFixed(2)}h
                          </span>
                          {t.billed_amount ? (
                            <span className="text-sm text-muted-foreground">
                              {formatCurrency(t.billed_amount)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Relationships ─────────────────────────────────────────────── */}
        <TabsContent value="relationships" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.clientGroups.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Client Groups
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {data.clientGroups.map((g) => (
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

            {data.relatedContacts.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Related Contacts ({data.relatedContacts.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {data.relatedContacts.map((c) => (
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

            {data.relatedOrganizations.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Related Organizations ({data.relatedOrganizations.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {data.relatedOrganizations.map((o) => (
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

            {data.clientGroups.length === 0 &&
            data.relatedContacts.length === 0 &&
            data.relatedOrganizations.length === 0 ? (
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

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

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
