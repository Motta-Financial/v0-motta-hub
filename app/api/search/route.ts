/**
 * Global search — `/api/search?q=foo&limit=8`
 *
 * Fans out a single user query across the five primary entities the global
 * Cmd+K palette can navigate to:
 *
 *   - work_items   (Karbon work item title / key / client / work_type)
 *   - clients      (organizations.name + contacts.full_name)
 *   - debriefs     (notes/work_item title via `debriefs_full` view)
 *   - invoices     (Ignition invoice number, Stripe id, linked client name)
 *   - proposals    (Ignition proposal title / number / linked client)
 *
 * Returns five typed arrays — the palette renders each as its own group so
 * users can tell at a glance what kind of record matched.
 *
 * Auth is enforced by the global middleware (`middleware.ts`), so this route
 * is reachable only by signed-in team members. We use the admin client to
 * bypass RLS because every authenticated team member is allowed to read
 * everything for search purposes.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

// We cap each category at this many rows to keep the palette snappy. Users
// who want a fuller list click through to the dedicated list pages
// (Work Items / Clients / Debriefs / Sales > Invoices / Sales > Proposals).
const PER_CATEGORY_DEFAULT = 6
const PER_CATEGORY_MAX = 25
const MIN_QUERY_LEN = 2

// PostgREST `ilike` filter values cannot contain raw `%` or `,` (the comma
// separates `or()` clauses, the percent is a wildcard). Escape both so the
// user's literal text matches and can't accidentally inject more clauses.
function safe(input: string): string {
  return input.replace(/[%,]/g, "")
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = (url.searchParams.get("q") || "").trim()
    const limit = Math.min(
      PER_CATEGORY_MAX,
      Math.max(1, Number.parseInt(url.searchParams.get("limit") || String(PER_CATEGORY_DEFAULT), 10)),
    )

    if (q.length < MIN_QUERY_LEN) {
      return NextResponse.json({
        query: q,
        workItems: [],
        clients: [],
        debriefs: [],
        invoices: [],
        proposals: [],
        totals: { workItems: 0, clients: 0, debriefs: 0, invoices: 0, proposals: 0 },
      })
    }

    const supabase = createAdminClient()
  const safeQ = safe(q)
  const ilike = `%${safeQ}%`

  // ─── WORK ITEMS ─────────────────────────────────────────────────────────
  // Same fields the existing /api/supabase/work-items search uses — title,
  // karbon key, client name, work_type. We keep this in-line (rather than
  // self-fetching) so we don't pay a round-trip for nothing.
  const workItemsP = supabase
    .from("work_items")
    .select(
      "id, karbon_work_item_key, title, work_type, primary_status, status, due_date, completed_date, assignee_name, karbon_url, organization_id, contact_id, client_group_id, organizations(name), contacts(full_name), client_groups(name)",
    )
    .or(
      `title.ilike.${ilike},karbon_work_item_key.ilike.${ilike},work_type.ilike.${ilike},assignee_name.ilike.${ilike}`,
    )
    .limit(limit)

  // ─── CLIENTS (orgs + contacts merged) ───────────────────────────────────
  // Two parallel queries — Supabase's PostgREST doesn't support cross-table
  // unions, so we run them separately and merge in JS.
  const orgsP = supabase
    .from("organizations")
    .select(
      "id, karbon_organization_key, name, full_name, primary_email, city, state, entity_type",
    )
    .or(
      `name.ilike.${ilike},full_name.ilike.${ilike},legal_name.ilike.${ilike},trading_name.ilike.${ilike},primary_email.ilike.${ilike}`,
    )
    .limit(limit)

  const contactsP = supabase
    .from("contacts")
    .select(
      "id, karbon_contact_key, full_name, first_name, last_name, primary_email, phone_primary, city, state, entity_type, is_prospect",
    )
    .or(
      `full_name.ilike.${ilike},first_name.ilike.${ilike},last_name.ilike.${ilike},preferred_name.ilike.${ilike},primary_email.ilike.${ilike}`,
    )
    .limit(limit)

  // ─── DEBRIEFS ────────────────────────────────────────────────────────────
  // The pre-joined `debriefs_full` view exposes the linked work item title,
  // team member name, and client name on each debrief row — much richer
  // matching than the raw `debriefs` table.
  const debriefsP = supabase
    .from("debriefs_full")
    .select(
      "id, debrief_date, debrief_type, status, notes, organization_name, contact_full_name, work_item_title, work_item_karbon_url, team_member_full_name, organization_id, contact_id, work_item_id",
    )
    .or(
      `notes.ilike.${ilike},organization_name.ilike.${ilike},contact_full_name.ilike.${ilike},work_item_title.ilike.${ilike},team_member_full_name.ilike.${ilike}`,
    )
    .order("debrief_date", { ascending: false, nullsFirst: false })
    .limit(limit)

  // ─── INVOICES (Ignition) ────────────────────────────────────────────────
  // Ignition invoice numbers and Stripe ids are short alphanumeric strings;
  // we also search the linked organization's name through the FK join so
  // typing "Acme" surfaces invoices billed to Acme.
  const invoicesP = supabase
    .from("ignition_invoices")
    .select(
      "ignition_invoice_id, invoice_number, status, amount, amount_outstanding, currency, invoice_date, due_date, stripe_invoice_id, organization_id, contact_id, organizations(name), contacts(full_name)",
    )
    .or(
      `invoice_number.ilike.${ilike},stripe_invoice_id.ilike.${ilike},proposal_id.ilike.${ilike}`,
    )
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(limit)

  // ─── PROPOSALS (Ignition) ───────────────────────────────────────────────
  const proposalsP = supabase
    .from("ignition_proposals")
    .select(
      "proposal_id, proposal_number, title, status, total_value, currency, client_name, organization_id, accepted_at, sent_at, created_at, organizations(name)",
    )
    .or(
      `title.ilike.${ilike},proposal_number.ilike.${ilike},client_name.ilike.${ilike},client_email.ilike.${ilike}`,
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit)

  // Run everything in parallel. We use `Promise.allSettled` so a single
  // category failing (e.g. a missing view in some env) doesn't blank the
  // whole palette — the user still sees results from the other four.
  const [workItemsR, orgsR, contactsR, debriefsR, invoicesR, proposalsR] =
    await Promise.allSettled([workItemsP, orgsP, contactsP, debriefsP, invoicesP, proposalsP])

  const workItems = (workItemsR.status === "fulfilled" ? workItemsR.value.data || [] : []).map(
    (w: any) => {
      const clientName =
        w.organizations?.name || w.contacts?.full_name || w.client_groups?.name || null
      return {
        id: w.id,
        karbonKey: w.karbon_work_item_key,
        title: w.title || "(untitled work item)",
        clientName,
        workType: w.work_type,
        status: w.primary_status || w.status,
        dueDate: w.due_date,
        completedDate: w.completed_date,
        assigneeName: w.assignee_name,
        karbonUrl: w.karbon_url,
        href: `/work-items?q=${encodeURIComponent(w.karbon_work_item_key || "")}`,
      }
    },
  )

  const orgsRows = orgsR.status === "fulfilled" ? orgsR.value.data || [] : []
  const contactsRows = contactsR.status === "fulfilled" ? contactsR.value.data || [] : []
  const clients = [
    ...orgsRows.map((o: any) => ({
      id: o.id,
      kind: "organization" as const,
      // The /clients/[id] page accepts EITHER karbon key OR UUID — we prefer
      // the karbon key (stable & meaningful) but fall back to UUID when the
      // org hasn't been (or can't be) keyed against Karbon.
      href: `/clients/${o.karbon_organization_key || o.id}`,
      name: o.full_name || o.name || "Unknown organization",
      subtitle: [o.entity_type, o.primary_email].filter(Boolean).join(" • ") || null,
      city: o.city,
      state: o.state,
    })),
    ...contactsRows.map((c: any) => ({
      id: c.id,
      kind: "contact" as const,
      href: `/clients/${c.karbon_contact_key || c.id}`,
      name:
        c.full_name?.trim() ||
        [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
        c.primary_email ||
        "Unnamed contact",
      subtitle:
        [c.entity_type, c.primary_email, c.phone_primary].filter(Boolean).join(" • ") || null,
      city: c.city,
      state: c.state,
      isProspect: !!c.is_prospect,
    })),
  ]
    // Cap the merged list at `limit` so we don't double the result count.
    .slice(0, limit)

  const debriefs = (debriefsR.status === "fulfilled" ? debriefsR.value.data || [] : []).map(
    (d: any) => {
      const clientName = d.organization_name || d.contact_full_name || null
      // The clients/[id] page is the most useful target — debriefs live as a
      // tab there grouped by work item. Pick the contact_id when present
      // (since a contact-led debrief has no organization_id), else the org.
      const clientHref =
        d.organization_id || d.contact_id
          ? `/clients/${d.organization_id || d.contact_id}`
          : `/debriefs`
      return {
        id: d.id,
        date: d.debrief_date,
        debriefType: d.debrief_type,
        status: d.status,
        // Strip any HTML tags from notes for the preview snippet — debrief
        // notes are stored as either plain text or a fragment of HTML.
        snippet: d.notes
          ? String(d.notes)
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 140)
          : null,
        clientName,
        workItemTitle: d.work_item_title,
        teamMemberName: d.team_member_full_name,
        href: clientHref,
      }
    },
  )

  const invoices = (invoicesR.status === "fulfilled" ? invoicesR.value.data || [] : []).map(
    (inv: any) => ({
      id: inv.ignition_invoice_id,
      invoiceNumber: inv.invoice_number,
      status: inv.status,
      amount: inv.amount,
      amountOutstanding: inv.amount_outstanding,
      currency: inv.currency,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      stripeInvoiceId: inv.stripe_invoice_id,
      clientName: inv.organizations?.name || inv.contacts?.full_name || null,
      // Send users to the invoices list pre-filtered by the invoice number
      // (its own search is server-side `ilike` on `invoice_number`).
      href: `/sales/invoices?search=${encodeURIComponent(inv.invoice_number || "")}`,
    }),
  )

  const proposals = (proposalsR.status === "fulfilled" ? proposalsR.value.data || [] : []).map(
    (p: any) => ({
      id: p.proposal_id,
      proposalNumber: p.proposal_number,
      title: p.title,
      status: p.status,
      totalValue: p.total_value,
      currency: p.currency,
      clientName: p.organizations?.name || p.client_name || null,
      acceptedAt: p.accepted_at,
      sentAt: p.sent_at,
      createdAt: p.created_at,
      href: `/sales/proposals?search=${encodeURIComponent(
        p.proposal_number || p.title || "",
      )}`,
    }),
  )

    return NextResponse.json({
      query: q,
      workItems,
      clients,
      debriefs,
      invoices,
      proposals,
      totals: {
        workItems: workItems.length,
        clients: clients.length,
        debriefs: debriefs.length,
        invoices: invoices.length,
        proposals: proposals.length,
      },
    })
  } catch (error) {
    console.error("[search] Error:", error)
    return NextResponse.json(
      { error: "Search failed", query: "", workItems: [], clients: [], debriefs: [], invoices: [], proposals: [], totals: { workItems: 0, clients: 0, debriefs: 0, invoices: 0, proposals: 0 } },
      { status: 500 },
    )
  }
}
