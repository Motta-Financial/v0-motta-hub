/**
 * Comprehensive client detail endpoint backed by Supabase.
 *
 * Resolves a client by:
 *   - UUID against contacts.id / organizations.id, OR
 *   - Karbon perma-key against contacts.karbon_contact_key / organizations.karbon_organization_key.
 *
 * Returns the full record plus every piece of related data we sync from Karbon
 * (work items, notes, emails, tasks, timesheets, invoices, documents, meetings,
 * debriefs, related contacts/orgs, team members, service lines) so that the
 * Clients > Detail page can render everything from a single round-trip without
 * ever hitting Karbon's live API.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getClientType } from "@/lib/client-type"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type EntityKind = "contact" | "organization"

async function resolveEntity(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<{ kind: EntityKind; row: any } | null> {
  const isUuid = UUID_RE.test(id)

  // Try contacts (by id or karbon_contact_key)
  {
    const filter = isUuid
      ? `id.eq.${id},karbon_contact_key.eq.${id}`
      : `karbon_contact_key.eq.${id}`
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .or(filter)
      .limit(1)
      .maybeSingle()
    if (data) return { kind: "contact", row: data }
  }

  // Try organizations (by id or karbon_organization_key)
  {
    const filter = isUuid
      ? `id.eq.${id},karbon_organization_key.eq.${id}`
      : `karbon_organization_key.eq.${id}`
    const { data } = await supabase
      .from("organizations")
      .select("*")
      .or(filter)
      .limit(1)
      .maybeSingle()
    if (data) return { kind: "organization", row: data }
  }

  return null
}

function toAddress(parts: Array<string | null | undefined>): string | null {
  const cleaned = parts.map((p) => (p || "").trim()).filter(Boolean)
  return cleaned.length ? cleaned.join(", ") : null
}

function uniqBy<T>(arr: T[], keyFn: (item: T) => string | null | undefined): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of arr) {
    const k = keyFn(item)
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const resolved = await resolveEntity(supabase, id)
    if (!resolved) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const { kind, row } = resolved
    const isOrg = kind === "organization"
    const entityId: string = row.id
    const karbonKey: string | null = isOrg ? row.karbon_organization_key : row.karbon_contact_key

    // ── Build query filters ────────────────────────────────────────────────
    // For each related table we filter by both the FK column (when present)
    // AND the karbon_*_key column (when present), to be resilient against
    // partial linking — webhooks set FKs going forward, but historical rows
    // may only have the karbon key.

    const idCol = isOrg ? "organization_id" : "contact_id"
    const karbonCol = isOrg ? "karbon_organization_key" : "karbon_contact_key"

    const orFilter = (table: {
      hasIdCol?: boolean
      hasKarbonCol?: boolean
      hasClientKey?: boolean
    }): string | null => {
      const parts: string[] = []
      if (table.hasIdCol && entityId) parts.push(`${idCol}.eq.${entityId}`)
      if (table.hasKarbonCol && karbonKey) parts.push(`${karbonCol}.eq.${karbonKey}`)
      if (table.hasClientKey && karbonKey) parts.push(`client_key.eq.${karbonKey}`)
      return parts.length ? parts.join(",") : null
    }

    // ── Fan-out queries in parallel ────────────────────────────────────────
    const [
      workItemsRes,
      karbonNotesRes,
      manualNotesRes,
      emailsRes,
      karbonTasksRes,
      karbonTimesheetsRes,
      karbonInvoicesRes,
      ignitionInvoicesRes,
      ignitionProposalsRes,
      documentsRes,
      meetingsRes,
      debriefsRes,
      groupMembersRes,
      contactOrgsRes,
      ignitionClientsRes,
    ] = await Promise.all([
      // Work items: filter by karbon_client_key (always populated) — covers both
      // contact and organization clients in one query.
      karbonKey
        ? supabase
            .from("work_items")
            .select(
              "id, karbon_work_item_key, karbon_client_key, client_type, title, work_type, status, primary_status, secondary_status, workflow_status, due_date, start_date, completed_date, assignee_name, assignee_key, client_owner_name, client_manager_name, priority, tax_year, estimated_fee, actual_fee, budget_hours, actual_hours, todo_count, completed_todo_count, has_blocking_todos, karbon_url, karbon_modified_at",
            )
            .eq("karbon_client_key", karbonKey)
            .order("due_date", { ascending: true, nullsFirst: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),

      // Karbon notes
      (() => {
        const f = orFilter({ hasIdCol: true, hasKarbonCol: true })
        if (!f) return Promise.resolve({ data: [], error: null })
        return supabase
          .from("karbon_notes")
          .select(
            "id, karbon_note_key, subject, body, note_type, is_pinned, author_name, assignee_email, due_date, todo_date, comments, karbon_created_at, karbon_modified_at, karbon_url, karbon_work_item_key, work_item_title",
          )
          .or(f)
          .order("karbon_created_at", { ascending: false, nullsFirst: false })
          .limit(200)
      })(),

      // Manual notes (notes table) - by FK only
      supabase
        .from("notes")
        .select("id, title, content, note_type, is_pinned, created_at, author_id, tags")
        .or(`${idCol}.eq.${entityId}`)
        .order("created_at", { ascending: false })
        .limit(100),

      // Emails - by FK only (no karbon key column on this table)
      supabase
        .from("emails")
        .select(
          "id, karbon_email_key, subject, from_name, from_email, to_emails, cc_emails, body_text, body_html, sent_at, received_at, direction, is_read, thread_id",
        )
        .or(`${idCol}.eq.${entityId}`)
        .order("sent_at", { ascending: false, nullsFirst: false })
        .limit(200),

      // Karbon tasks
      (() => {
        const f = orFilter({ hasIdCol: true, hasKarbonCol: true })
        if (!f) return Promise.resolve({ data: [], error: null })
        return supabase
          .from("karbon_tasks")
          .select(
            "id, karbon_task_key, title, description, status, priority, assignee_name, assignee_email, due_date, completed_date, estimated_minutes, actual_minutes, is_blocking, karbon_url, karbon_work_item_key",
          )
          .or(f)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(200)
      })(),

      // Timesheets (by client_key text)
      karbonKey
        ? supabase
            .from("karbon_timesheets")
            .select(
              "id, karbon_timesheet_key, date, minutes, description, user_name, role_name, work_item_title, billing_status, billed_amount, hourly_rate, is_billable, task_type_name",
            )
            .eq("client_key", karbonKey)
            .order("date", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),

      // Karbon invoices (by FK or client_key)
      (() => {
        const f = orFilter({ hasIdCol: true, hasClientKey: true })
        if (!f) return Promise.resolve({ data: [], error: null })
        return supabase
          .from("karbon_invoices")
          .select(
            "id, karbon_invoice_key, invoice_number, status, issued_date, due_date, paid_date, amount, tax, total_amount, currency, work_item_title, karbon_url",
          )
          .or(f)
          .order("issued_date", { ascending: false, nullsFirst: false })
          .limit(100)
      })(),

      // Ignition invoices — covers both native Ignition syncs (future) and the
      // historical HubSpot import (ignition_invoice_id LIKE 'hubspot:%').
      // Linked via the same contact_id / organization_id FK pattern.
      (() => {
        const fkClause = `${idCol}.eq.${entityId}`
        return supabase
          .from("ignition_invoices")
          .select(
            `ignition_invoice_id, invoice_number, status, amount, amount_paid,
             amount_outstanding, currency, invoice_date, due_date, paid_at,
             voided_at, sent_at, raw_payload, last_event_at`,
          )
          .or(fkClause)
          .order("invoice_date", { ascending: false, nullsFirst: false })
          .limit(200)
      })(),

      // Ignition proposals — linked via FK (organization_id / contact_id).
      // Embeds the active service line items (ignition_proposal_services) so the
      // UI can show recurring cadence and per-service price breakdowns under
      // each proposal without an extra round-trip.
      (() => {
        const fkClause = `${idCol}.eq.${entityId}`
        return supabase
          .from("ignition_proposals")
          .select(
            `proposal_id, proposal_number, title, status, client_name, client_email,
             total_value, one_time_total, recurring_total, recurring_frequency, currency,
             sent_at, accepted_at, completed_at, lost_at, lost_reason, archived_at, revoked_at,
             signed_url, client_manager, client_partner, proposal_sent_by,
             billing_starts_on, effective_start_date, last_event_at, created_at, updated_at,
             services:ignition_proposal_services (
               id, service_name, description, quantity, unit_price, total_amount,
               currency, billing_frequency, billing_type, status, ordinal
             )`,
          )
          .or(fkClause)
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(100)
      })(),

      // Documents
      supabase
        .from("documents")
        .select(
          "id, name, description, document_type, file_type, mime_type, file_size_bytes, storage_url, thumbnail_url, status, tax_year, uploaded_at, uploaded_by_id, tags",
        )
        .or(`${idCol}.eq.${entityId}`)
        .order("uploaded_at", { ascending: false, nullsFirst: false })
        .limit(100),

      // Meetings
      supabase
        .from("meetings")
        .select(
          "id, title, description, meeting_type, status, location, location_type, video_link, scheduled_start, scheduled_end, duration_minutes, host_id",
        )
        .or(`${idCol}.eq.${entityId}`)
        .order("scheduled_start", { ascending: false, nullsFirst: false })
        .limit(50),

      // Debriefs — pull from the pre-joined debriefs_full view so we get the
      // work-item title + Karbon URL + team-member name in a single query.
      // The client profile groups debriefs by work item, so the work-item
      // columns are required for that grouping to render labels.
      supabase
        .from("debriefs_full")
        .select(
          "id, debrief_date, debrief_type, status, follow_up_date, tax_year, filing_status, notes, action_items, client_owner_name, client_manager_name, work_item_id, work_item_title, work_item_karbon_url, contact_id, organization_id, team_member_id, team_member_full_name, karbon_work_url, created_at",
        )
        .or(`${idCol}.eq.${entityId}`)
        .order("debrief_date", { ascending: false, nullsFirst: false })
        .limit(100),

      // Client-group memberships (only contacts can be members directly)
      kind === "contact"
        ? supabase
            .from("client_group_members")
            .select(
              "id, role, relationship, is_primary, client_group:client_groups(id, karbon_client_group_key, name, group_type, primary_contact_name, client_owner_name, client_manager_name)",
            )
            .eq("contact_id", entityId)
        : Promise.resolve({ data: [], error: null }),

      // Contact ↔ Organization relationships
      isOrg
        ? supabase
            .from("contact_organizations")
            .select(
              "id, role_or_title, ownership_percentage, is_primary_contact, start_date, end_date, contact:contacts(id, karbon_contact_key, full_name, primary_email, phone_primary)",
            )
            .eq("organization_id", entityId)
        : supabase
            .from("contact_organizations")
            .select(
              "id, role_or_title, ownership_percentage, is_primary_contact, start_date, end_date, organization:organizations(id, karbon_organization_key, name, full_name, primary_email, phone, industry)",
            )
            .eq("contact_id", entityId),

      // Ignition clients — billing/contact records from Ignition that have been
      // linked to this organization/contact. Contains address + phone from the
      // billing platform which may differ from the Karbon-sourced data.
      supabase
        .from("ignition_clients")
        .select(
          `ignition_client_id, name, email, phone, business_name, client_type,
           address_line1, address_line2, city, state, zip_code, country,
           match_status, match_confidence, match_method, match_notes,
           ignition_created_at, ignition_updated_at, last_event_at`,
        )
        .or(`${idCol}.eq.${entityId}`)
        .order("ignition_updated_at", { ascending: false, nullsFirst: false })
        .limit(20),
    ])

    const workItems = workItemsRes.data || []
    const karbonNotes = karbonNotesRes.data || []
    const manualNotes = manualNotesRes.data || []
    const emails = emailsRes.data || []
    const karbonTasks = karbonTasksRes.data || []
    const karbonTimesheets = karbonTimesheetsRes.data || []
    const karbonInvoices = karbonInvoicesRes.data || []
    const ignitionInvoices = ignitionInvoicesRes.data || []
    const ignitionProposals = ignitionProposalsRes.data || []
    const ignitionClients = ignitionClientsRes.data || []

    // ── Unified Invoices ─────────────────────────────────────────────────
    // Normalizes Karbon and Ignition (incl. legacy HubSpot) invoices into a
    // single shape so the UI can render one list. The original arrays remain
    // available for any downstream consumer that needs source-specific fields.
    type UnifiedInvoice = {
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
      sort_key: number
    }
    const dateMs = (d: any) =>
      d ? new Date(d).getTime() || 0 : 0
    const unifiedInvoices: UnifiedInvoice[] = [
      ...karbonInvoices.map((inv: any): UnifiedInvoice => ({
        id: `karbon:${inv.id}`,
        source: "karbon",
        invoice_number: inv.invoice_number ?? null,
        status: (inv.status || "").toLowerCase() || null,
        amount: Number(inv.total_amount) || 0,
        amount_paid:
          inv.status?.toLowerCase() === "paid" ? Number(inv.total_amount) || 0 : 0,
        amount_outstanding:
          inv.status?.toLowerCase() === "paid" ? 0 : Number(inv.total_amount) || 0,
        currency: inv.currency || "USD",
        issued_date: inv.issued_date ?? null,
        due_date: inv.due_date ?? null,
        paid_date: inv.paid_date ?? null,
        work_item_title: inv.work_item_title ?? null,
        external_url: inv.karbon_url ?? null,
        sort_key: dateMs(inv.issued_date) || dateMs(inv.due_date),
      })),
      ...ignitionInvoices.map((inv: any): UnifiedInvoice => {
        // HubSpot rows are flagged via the ignition_invoice_id namespace;
        // raw_payload.associated_deal preserves the original deal title for
        // display so users see context that's missing from the bare invoice.
        const isHubspot =
          typeof inv.ignition_invoice_id === "string" &&
          inv.ignition_invoice_id.startsWith("hubspot:")
        const dealTitle =
          inv.raw_payload && typeof inv.raw_payload === "object"
            ? (inv.raw_payload.associated_deal as string | null) || null
            : null
        return {
          id: inv.ignition_invoice_id,
          source: isHubspot ? "hubspot" : "ignition",
          invoice_number: inv.invoice_number ?? null,
          status: inv.status || null,
          amount: Number(inv.amount) || 0,
          amount_paid: Number(inv.amount_paid) || 0,
          amount_outstanding: Number(inv.amount_outstanding) || 0,
          currency: inv.currency || "USD",
          issued_date: inv.invoice_date ?? null,
          due_date: inv.due_date ?? null,
          paid_date: inv.paid_at ?? null,
          work_item_title: dealTitle,
          external_url: null, // HubSpot URLs aren't exported; native Ignition has no public URL
          sort_key: dateMs(inv.invoice_date) || dateMs(inv.due_date),
        }
      }),
    ].sort((a, b) => b.sort_key - a.sort_key)
    const documents = documentsRes.data || []
    const meetings = meetingsRes.data || []
    const debriefs = debriefsRes.data || []
    const groupMembers = (groupMembersRes.data || []) as any[]
    const contactOrgs = (contactOrgsRes.data || []) as any[]

    // ── Derived data ───────────────────────────────────────────────────────

    // Service lines used = unique work_type values from work items
    const serviceLinesUsed = uniqBy(
      workItems
        .map((w: any) => w.work_type)
        .filter(Boolean)
        .map((s: string) => ({ name: s })),
      (s) => s.name,
    ).map((s) => s.name)

    // Team members assigned (from work items + entity.assigned_team_members)
    const teamMembersMap = new Map<string, { name: string; email: string | null; key: string | null }>()
    for (const wi of workItems) {
      const k = wi.assignee_key || wi.assignee_name
      if (wi.assignee_name && k && !teamMembersMap.has(k)) {
        teamMembersMap.set(k, { name: wi.assignee_name, email: null, key: wi.assignee_key })
      }
    }
    const assignedRaw = (row.assigned_team_members || []) as any[]
    if (Array.isArray(assignedRaw)) {
      for (const m of assignedRaw) {
        const k = m?.UserKey || m?.user_key || m?.Key || m?.Email || m?.FullName
        if (!k || teamMembersMap.has(k)) continue
        teamMembersMap.set(k, {
          name: m?.FullName || m?.full_name || m?.Name || k,
          email: m?.Email || m?.email || null,
          key: m?.UserKey || m?.user_key || null,
        })
      }
    }
    const teamMembers = Array.from(teamMembersMap.values())

    // Stats
    const isActiveStatus = (s: string | null | undefined) =>
      !!s &&
      ["In Progress", "Ready To Start", "Waiting", "Planned", "Not Started"].includes(s)
    const isCompletedStatus = (s: string | null | undefined) =>
      !!s && s.toLowerCase() === "completed"

    const stats = {
      totalWorkItems: workItems.length,
      activeWorkItems: workItems.filter((w: any) => isActiveStatus(w.primary_status || w.status)).length,
      completedWorkItems: workItems.filter((w: any) => isCompletedStatus(w.primary_status || w.status))
        .length,
      openTasks: karbonTasks.filter((t: any) => t.status && t.status.toLowerCase() !== "completed").length,
      totalTasks: karbonTasks.length,
      totalEmails: emails.length,
      totalNotes: karbonNotes.length + manualNotes.length,
      totalDocuments: documents.length,
      totalMeetings: meetings.length,
      totalDebriefs: debriefs.length,
      // Unified invoice stats span Karbon + Ignition + legacy HubSpot.
      totalInvoices: unifiedInvoices.length,
      totalInvoicedAmount: unifiedInvoices.reduce(
        (sum, inv) => sum + inv.amount,
        0,
      ),
      totalPaidAmount: unifiedInvoices.reduce(
        (sum, inv) => sum + inv.amount_paid,
        0,
      ),
      totalUnpaidAmount: unifiedInvoices.reduce(
        (sum, inv) => sum + inv.amount_outstanding,
        0,
      ),
      // Legacy field kept for any downstream consumers still referencing only
      // Karbon-sourced billing. Will go away once the UI is fully migrated.
      totalKarbonInvoices: karbonInvoices.length,
      totalKarbonUnpaid: karbonInvoices
        .filter(
          (inv: any) =>
            inv.status &&
            !["paid", "void", "cancelled"].includes(String(inv.status).toLowerCase()),
        )
        .reduce((sum: number, inv: any) => sum + (Number(inv.total_amount) || 0), 0),
      totalBillableMinutes: karbonTimesheets.reduce(
        (sum: number, t: any) => sum + (Number(t.minutes) || 0),
        0,
      ),
      totalProposals: ignitionProposals.length,
      activeProposals: ignitionProposals.filter(
        (p: any) =>
          !p.archived_at &&
          !p.revoked_at &&
          !p.lost_at &&
          (p.status || "").toLowerCase() !== "lost",
      ).length,
      acceptedProposals: ignitionProposals.filter(
        (p: any) => (p.status || "").toLowerCase() === "accepted",
      ).length,
      totalProposalValue: ignitionProposals.reduce(
        (sum: number, p: any) => sum + (Number(p.total_value) || 0),
        0,
      ),
    }

    // Last activity = max timestamp across all sources
    const lastActivity = [
      row.karbon_modified_at,
      ...workItems.map((w: any) => w.karbon_modified_at),
      ...karbonNotes.map((n: any) => n.karbon_modified_at || n.karbon_created_at),
      ...emails.map((e: any) => e.sent_at || e.received_at),
      ...karbonTasks.map((t: any) => t.due_date),
      ...meetings.map((m: any) => m.scheduled_start),
    ]
      .filter(Boolean)
      .map((d: any) => new Date(d).getTime())
      .reduce((max: number, t: number) => (t > max ? t : max), 0)

    // Unified "client" object for the UI
    const clientName = isOrg
      ? row.full_name || row.name || row.legal_name || row.trading_name || "Unknown"
      : row.full_name ||
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        row.preferred_name ||
        "Unknown"

    const primaryAddress = toAddress([
      row.address_line1,
      row.address_line2,
      row.city,
      row.state,
      row.zip_code,
      row.country,
    ])

    const mailingAddress = !isOrg
      ? toAddress([
          row.mailing_address_line1,
          row.mailing_address_line2,
          row.mailing_city,
          row.mailing_state,
          row.mailing_zip_code,
          row.mailing_country,
        ])
      : null

    const client = {
      // Identifiers
      id: entityId,
      kind, // "contact" | "organization"
      isOrganization: isOrg,
      karbonKey,
      karbonUrl: row.karbon_url || null,

      // Display
      clientName,
      avatarUrl: row.avatar_url || null,
      type: isOrg ? "Business" : "Individual",
      entityType: row.entity_type || row.contact_type || null,
      contactType: row.contact_type || null,
      clientType: getClientType(kind, row.entity_type),
      status: row.status || "Active",
      isProspect: !!row.is_prospect || row.contact_type === "Prospect",

      // Contact info
      contactInfo: {
        primaryEmail: row.primary_email || null,
        secondaryEmail: row.secondary_email || null,
        phonePrimary: row.phone_primary || row.phone || null,
        phoneMobile: row.phone_mobile || null,
        phoneWork: row.phone_work || null,
        phoneFax: row.phone_fax || null,
        address: primaryAddress,
        mailingAddress,
        addressLine1: row.address_line1 || null,
        addressLine2: row.address_line2 || null,
        city: row.city || null,
        state: row.state || null,
        zipCode: row.zip_code || null,
        country: row.country || null,
        website: row.website || null,
        linkedin: row.linkedin_url || null,
        twitter: row.twitter_handle || null,
        facebook: row.facebook_url || null,
      },

      // Identity (contact-only)
      identity: !isOrg
        ? {
            firstName: row.first_name || null,
            lastName: row.last_name || null,
            middleName: row.middle_name || null,
            preferredName: row.preferred_name || null,
            salutation: row.salutation || null,
            suffix: row.suffix || null,
            prefix: row.prefix || null,
            dateOfBirth: row.date_of_birth || null,
            occupation: row.occupation || null,
            employer: row.employer || null,
            ein: row.ein || null,
            ssnLastFour: row.ssn_last_four || null,
            driversLicense: row.drivers_license || null,
            passportNumber: row.passport_number || null,
          }
        : null,

      // Business (organization-only)
      business: isOrg
        ? {
            legalName: row.legal_name || null,
            tradingName: row.trading_name || null,
            ein: row.ein || null,
            industry: row.industry || null,
            lineOfBusiness: row.line_of_business || null,
            entityType: row.entity_type || null,
            incorporationDate: row.incorporation_date || null,
            incorporationState: row.incorporation_state || null,
            fiscalYearEnd:
              row.fiscal_year_end_month && row.fiscal_year_end_day
                ? `${row.fiscal_year_end_month}/${row.fiscal_year_end_day}`
                : null,
            numberOfEmployees: row.number_of_employees || null,
            annualRevenue: row.annual_revenue || null,
            valuation: row.valuation || null,
            taxNumber: row.tax_number || null,
            stateTaxId: row.state_tax_id || null,
            payrollTaxId: row.payroll_tax_id || null,
            unemploymentTaxId: row.unemployment_tax_id || null,
            salesTaxId: row.sales_tax_id || null,
          }
        : null,

      // Ownership / referrals
      ownership: {
        clientOwnerKey: row.client_owner_key || null,
        clientManagerKey: row.client_manager_key || null,
        clientPartnerKey: row.client_partner_key || null,
        source: row.source || null,
        referredBy: row.referred_by || null,
        taxProviderName: row.tax_provider_name || null,
        legalFirmName: row.legal_firm_name || null,
      },

      tags: row.tags || [],
      notes: row.notes || null,

      // Timestamps
      karbonCreatedAt: row.karbon_created_at || null,
      karbonModifiedAt: row.karbon_modified_at || null,
      lastSyncedAt: row.last_synced_at || null,
      lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    }

    const clientGroups = groupMembers
      .map((m: any) => ({
        membershipId: m.id,
        role: m.role,
        relationship: m.relationship,
        isPrimary: m.is_primary,
        ...m.client_group,
      }))
      .filter((g: any) => g.id)

    const relatedContacts = isOrg
      ? contactOrgs
          .map((co: any) => ({
            relationshipId: co.id,
            roleOrTitle: co.role_or_title,
            ownershipPercentage: co.ownership_percentage,
            isPrimaryContact: co.is_primary_contact,
            startDate: co.start_date,
            endDate: co.end_date,
            ...co.contact,
          }))
          .filter((c: any) => c.id)
      : []

    const relatedOrganizations = !isOrg
      ? contactOrgs
          .map((co: any) => ({
            relationshipId: co.id,
            roleOrTitle: co.role_or_title,
            ownershipPercentage: co.ownership_percentage,
            isPrimaryContact: co.is_primary_contact,
            startDate: co.start_date,
            endDate: co.end_date,
            ...co.organization,
          }))
          .filter((o: any) => o.id)
      : []

    return NextResponse.json({
      client,
      stats,
      workItems,
      karbonNotes,
      manualNotes,
      emails,
      karbonTasks,
      karbonTimesheets,
      karbonInvoices,
      ignitionInvoices,
      unifiedInvoices,
      ignitionProposals,
      ignitionClients,
      documents,
      meetings,
      debriefs,
      teamMembers,
      serviceLinesUsed,
      clientGroups,
      relatedContacts,
      relatedOrganizations,
    })
  } catch (error) {
    console.error("[v0] Error fetching client detail:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch client",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
