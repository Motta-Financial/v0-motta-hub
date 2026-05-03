/**
 * Comprehensive Ignition reconciliation from the five Ignition CSV exports.
 *
 * Source files (drop the latest exports into scripts/data/):
 *   ignition-services-2026-05-02.csv         → ignition_services (catalog)
 *   ignition-clients-2026-05-02.csv          → ignition_clients (with FK match)
 *   ignition-proposals-2026-05-02.csv        → ignition_proposals (broad history)
 *   ignition-pipeline-2026-05-02.csv         → ignition_proposals (enrichment)
 *   ignition-active-services-2026-05-02.csv  → ignition_proposal_services
 *
 * Strategy
 *   1. Catalog services first (no FK deps)
 *   2. Reconcile clients, matching to contacts/organizations via:
 *        a) External Client ID == user_defined_identifier  (highest confidence)
 *        b) Contact email == primary_email                  (high)
 *        c) Normalized name match                           (medium)
 *   3. Reconcile proposals — proposals.csv is the broader superset (878 rows)
 *      and pipeline.csv provides richer fields (services, sent counts, options
 *      etc.) for the ~787 active proposals. Both keyed on proposal_reference.
 *   4. Reconcile proposal_services from active-services.csv. Each row is a
 *      live recurring service instance on an accepted proposal.
 *
 * Run dry-run by default. Pass --apply to commit.
 *   pnpm tsx scripts/scrub-ignition-from-csvs.ts          # dry-run
 *   pnpm tsx scripts/scrub-ignition-from-csvs.ts --apply  # commit
 */

import fs from "node:fs"
import path from "node:path"
import { parse } from "csv-parse/sync"
import { Client } from "pg"

const APPLY = process.argv.includes("--apply")

const DATA_DIR = path.join(process.cwd(), "scripts", "data")
const CSV = {
  services: path.join(DATA_DIR, "ignition-services-2026-05-02.csv"),
  clients: path.join(DATA_DIR, "ignition-clients-2026-05-02.csv"),
  proposals: path.join(DATA_DIR, "ignition-proposals-2026-05-02.csv"),
  pipeline: path.join(DATA_DIR, "ignition-pipeline-2026-05-02.csv"),
  activeServices: path.join(DATA_DIR, "ignition-active-services-2026-05-02.csv"),
}

// ─── helpers ──────────────────────────────────────────────────────────────
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s || s === "UNKNOWN" || s === "[]" || s === "null") return null
  // Karbon CSVs sometimes have multi-line addresses pre-padded with leading
  // spaces from the next line - strip whitespace-only segments.
  return s.replace(/[\s\u00a0]+/g, " ").trim() || null
}
const num = (v: unknown): number | null => {
  const s = clean(v)
  if (!s) return null
  const n = Number(s.replace(/[$,\s]/g, ""))
  return Number.isFinite(n) ? n : null
}
const ts = (v: unknown): string | null => {
  const s = clean(v)
  if (!s) return null
  // Ignition uses "January 24, 2026 01:31 pm" or ISO. Fall back to Date parse.
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const date = (v: unknown): string | null => {
  const s = clean(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const yes = (v: unknown): boolean => {
  const s = clean(v)
  return s === "Yes" || s === "yes" || s === "true" || s === "TRUE"
}
const normalizeEmail = (v: unknown): string | null => {
  const s = clean(v)
  return s ? s.toLowerCase() : null
}
const normalizeName = (v: unknown): string => {
  const s = clean(v)
  if (!s) return ""
  return s
    .toLowerCase()
    .replace(/[,.()'"&-]/g, " ")
    .replace(/\b(llc|inc|corp|corporation|llp|lp|company|co|ltd|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

const readCsv = (file: string): string[][] => {
  if (!fs.existsSync(file)) {
    console.warn(`[skip] missing CSV: ${path.basename(file)}`)
    return []
  }
  return parse(fs.readFileSync(file, "utf8"), {
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  })
}

// Pipeline export business-structure mapping → 1040/1065/1120-S etc.
const TAG_TO_FILING_FORM: Record<string, string> = {
  "1040": "1040",
  "1065": "1065",
  "1120": "1120",
  "1120-s": "1120-S",
  "1120s": "1120-S",
  "1041": "1041",
  "990": "990",
  "schedule c": "Sched C",
}

// match_status values are constrained at the DB level to:
//   'unmatched' | 'auto_matched' | 'manual_matched' | 'manual_review' | 'no_match'
// We never produce manual_matched/manual_review/no_match here since this is
// a fully automated scrub — surface auto_matched on success, unmatched on miss.
interface MatchInfo {
  contactId: string | null
  organizationId: string | null
  status: "auto_matched" | "unmatched"
  confidence: number
  method: string
}

async function buildMatchIndex(c: Client) {
  // Load every potential identifier into Maps for O(1) lookup.
  const orgRows = await c.query(
    `SELECT id, name, primary_email, user_defined_identifier
       FROM organizations WHERE status = 'active'`,
  )
  const contactRows = await c.query(
    `SELECT id, full_name, primary_email, user_defined_identifier
       FROM contacts WHERE status = 'active'`,
  )

  const byUdi = new Map<string, { id: string; kind: "org" | "contact" }>()
  const byEmail = new Map<string, { id: string; kind: "org" | "contact" }>()
  const byName = new Map<string, { id: string; kind: "org" | "contact" }>()

  for (const row of orgRows.rows) {
    if (row.user_defined_identifier)
      byUdi.set(String(row.user_defined_identifier).toUpperCase(), {
        id: row.id,
        kind: "org",
      })
    if (row.primary_email)
      byEmail.set(String(row.primary_email).toLowerCase(), { id: row.id, kind: "org" })
    const n = normalizeName(row.name)
    if (n && !byName.has(n)) byName.set(n, { id: row.id, kind: "org" })
  }
  for (const row of contactRows.rows) {
    if (row.user_defined_identifier)
      byUdi.set(String(row.user_defined_identifier).toUpperCase(), {
        id: row.id,
        kind: "contact",
      })
    if (row.primary_email && !byEmail.has(row.primary_email.toLowerCase()))
      byEmail.set(row.primary_email.toLowerCase(), { id: row.id, kind: "contact" })
    const n = normalizeName(row.full_name)
    if (n && !byName.has(n)) byName.set(n, { id: row.id, kind: "contact" })
  }

  return function match(args: {
    externalClientId: string | null
    email: string | null
    name: string | null
    businessStructure?: string | null
  }): MatchInfo {
    // 1. UDI is the highest-confidence signal because it's a Karbon-side ID.
    if (args.externalClientId) {
      const hit = byUdi.get(args.externalClientId.toUpperCase())
      if (hit) {
        return {
          contactId: hit.kind === "contact" ? hit.id : null,
          organizationId: hit.kind === "org" ? hit.id : null,
          status: "auto_matched",
          confidence: 1.0,
          method: "external_client_id",
        }
      }
    }
    // 2. Email
    if (args.email) {
      const hit = byEmail.get(args.email.toLowerCase())
      if (hit) {
        return {
          contactId: hit.kind === "contact" ? hit.id : null,
          organizationId: hit.kind === "org" ? hit.id : null,
          status: "auto_matched",
          confidence: 0.85,
          method: "email",
        }
      }
    }
    // 3. Name fallback. Prefer org for business structures, else contact.
    if (args.name) {
      const n = normalizeName(args.name)
      if (n) {
        const hit = byName.get(n)
        if (hit) {
          return {
            contactId: hit.kind === "contact" ? hit.id : null,
            organizationId: hit.kind === "org" ? hit.id : null,
            status: "auto_matched",
            confidence: 0.7,
            method: "name",
          }
        }
      }
    }
    return {
      contactId: null,
      organizationId: null,
      status: "unmatched",
      confidence: 0,
      method: "none",
    }
  }
}

// ─── ignition_services (catalog) ──────────────────────────────────────────
async function reconcileServices(c: Client) {
  const rows = readCsv(CSV.services)
  if (!rows.length) return { inserted: 0, updated: 0 }
  const data = rows.slice(1).filter((r) => clean(r[0]))

  // Snapshot current
  const before = new Map<string, any>()
  for (const r of (await c.query(`SELECT * FROM ignition_services`)).rows) {
    before.set(r.ignition_service_id, r)
  }

  let inserted = 0
  let updated = 0
  for (const r of data) {
    const id = clean(r[0])!
    const payload = {
      ignition_service_id: id,
      name: clean(r[1]) || `Service ${id}`,
      description: clean(r[3]),
      category: null as string | null,
      billing_type: clean(r[5])?.toLowerCase() || null, // automatic|manual
      default_price: num(r[6]),
      currency: "USD",
      is_active: clean(r[2])?.toLowerCase() === "active",
      raw_payload: {
        price_type: clean(r[4]),
        tax_rate: clean(r[7]),
        xero_account: clean(r[8]),
        qb_inventory: clean(r[9]),
        unit_name: clean(r[10]),
        min_price: num(r[11]),
        max_price: num(r[12]),
        terms: clean(r[13]),
      },
      updated_at: new Date().toISOString(),
    }
    const exists = before.has(id)
    if (APPLY) {
      // pg parameterized upsert
      await c.query(
        `INSERT INTO ignition_services
           (ignition_service_id, name, description, category, billing_type,
            default_price, currency, is_active, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (ignition_service_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = COALESCE(EXCLUDED.description, ignition_services.description),
           billing_type = COALESCE(EXCLUDED.billing_type, ignition_services.billing_type),
           default_price = COALESCE(EXCLUDED.default_price, ignition_services.default_price),
           is_active = EXCLUDED.is_active,
           raw_payload = EXCLUDED.raw_payload,
           updated_at = NOW()`,
        [
          payload.ignition_service_id,
          payload.name,
          payload.description,
          payload.category,
          payload.billing_type,
          payload.default_price,
          payload.currency,
          payload.is_active,
          payload.raw_payload,
        ],
      )
    }
    if (exists) updated++
    else inserted++
  }
  return { inserted, updated }
}

// ─── ignition_clients (with FK matching) ──────────────────────────────────
async function reconcileClients(c: Client, matchFn: ReturnType<typeof buildMatchIndex> extends Promise<infer T> ? T : never) {
  const rows = readCsv(CSV.clients)
  if (!rows.length) return { inserted: 0, updated: 0, matched: 0, unmatched: 0 }

  // De-dup by Client ID (clients.csv has multiple contact rows per client)
  const byId = new Map<string, string[]>()
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const id = clean(r[0])
    if (!id) continue
    if (!byId.has(id)) byId.set(id, r) // first row = primary contact
  }

  let inserted = 0
  let updated = 0
  let matched = 0
  let unmatched = 0
  const beforeIds = new Set(
    (await c.query(`SELECT ignition_client_id FROM ignition_clients`)).rows.map(
      (r: any) => r.ignition_client_id,
    ),
  )

  for (const [id, r] of byId.entries()) {
    const externalClientId = clean(r[2])
    const clientName = clean(r[3])
    const contactName = clean(r[10])
    const contactEmail = normalizeEmail(r[11])
    const businessStructure = clean(r[18])

    const m = matchFn({
      externalClientId,
      email: contactEmail,
      name: clientName || contactName,
      businessStructure,
    })
    if (m.status !== "unmatched") matched++
    else unmatched++

    const payload = {
      ignition_client_id: id,
      name: clientName || contactName,
      email: contactEmail,
      phone: clean(r[12]) || clean(r[13]) || clean(r[22]),
      business_name: businessStructure ? clientName : null,
      client_type: clean(r[4]), // active|lead|inactive
      address_line1: clean(r[25]),
      city: clean(r[26]),
      state: clean(r[27]),
      zip_code: clean(r[28]),
      country: clean(r[29]),
      contact_id: m.contactId,
      organization_id: m.organizationId,
      match_status: m.status,
      match_confidence: m.confidence,
      match_method: m.method,
      ignition_created_at: ts(r[38]),
      raw_payload: {
        client_reference: clean(r[1]),
        external_client_id: externalClientId,
        partner_email: clean(r[5]),
        manager_email: clean(r[6]),
        contact_id_ignition: clean(r[7]),
        primary_contact_name: contactName,
        is_primary_contact: yes(r[15]),
        is_signatory: yes(r[16]),
        notes: clean(r[17]),
        business_structure: businessStructure,
        tax_number: clean(r[20]),
        company_number: clean(r[21]),
        website: clean(r[24]),
        postal_address: clean(r[30]),
        postal_city: clean(r[31]),
        postal_region: clean(r[32]),
        postal_post_code: clean(r[33]),
        postal_country: clean(r[34]),
        fiscal_period_end_day: clean(r[35]),
        fiscal_period_end_month: clean(r[36]),
        client_group_name: clean(r[37]),
        tag_list: clean(r[39]),
        proposal_list: clean(r[40]),
        xero_id: clean(r[41]),
        xpm_id: clean(r[42]),
        quickbooks_id: clean(r[43]),
        payment_portal_link: clean(r[44]),
        bank_account_saved: yes(r[47]),
        card_saved: yes(r[48]),
        create_invoices: yes(r[49]),
      },
    }

    if (APPLY) {
      await c.query(
        `INSERT INTO ignition_clients
           (ignition_client_id, name, email, phone, business_name, client_type,
            address_line1, city, state, zip_code, country,
            contact_id, organization_id,
            match_status, match_confidence, match_method,
            ignition_created_at, raw_payload, last_event_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
         ON CONFLICT (ignition_client_id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, ignition_clients.name),
           email = COALESCE(EXCLUDED.email, ignition_clients.email),
           phone = COALESCE(EXCLUDED.phone, ignition_clients.phone),
           business_name = COALESCE(EXCLUDED.business_name, ignition_clients.business_name),
           client_type = EXCLUDED.client_type,
           address_line1 = COALESCE(EXCLUDED.address_line1, ignition_clients.address_line1),
           city = COALESCE(EXCLUDED.city, ignition_clients.city),
           state = COALESCE(EXCLUDED.state, ignition_clients.state),
           zip_code = COALESCE(EXCLUDED.zip_code, ignition_clients.zip_code),
           country = COALESCE(EXCLUDED.country, ignition_clients.country),
           contact_id = COALESCE(ignition_clients.contact_id, EXCLUDED.contact_id),
           organization_id = COALESCE(ignition_clients.organization_id, EXCLUDED.organization_id),
           match_status = EXCLUDED.match_status,
           match_confidence = EXCLUDED.match_confidence,
           match_method = EXCLUDED.match_method,
           raw_payload = ignition_clients.raw_payload || EXCLUDED.raw_payload,
           last_event_at = NOW(),
           updated_at = NOW()`,
        [
          payload.ignition_client_id,
          payload.name,
          payload.email,
          payload.phone,
          payload.business_name,
          payload.client_type,
          payload.address_line1,
          payload.city,
          payload.state,
          payload.zip_code,
          payload.country,
          payload.contact_id,
          payload.organization_id,
          payload.match_status,
          payload.match_confidence,
          payload.match_method,
          payload.ignition_created_at,
          payload.raw_payload,
        ],
      )
    }
    if (beforeIds.has(id)) updated++
    else inserted++
  }
  return { inserted, updated, matched, unmatched }
}

// ─── ignition_proposals (proposals + pipeline merge) ──────────────────────
async function reconcileProposals(c: Client, matchFn: any) {
  // Load both files. Pipeline (787) is a subset of proposals (878);
  // pipeline supplies richer fields (services, options, sent count etc.).
  const props = readCsv(CSV.proposals)
  const pl = readCsv(CSV.pipeline)
  if (!props.length && !pl.length) return { inserted: 0, updated: 0, matched: 0, unmatched: 0 }

  const propMap = new Map<string, string[]>() // proposal id → row
  for (let i = 1; i < props.length; i++) {
    const id = clean(props[i][0])
    if (id) propMap.set(id, props[i])
  }
  const pipelineMap = new Map<string, string[]>()
  for (let i = 1; i < pl.length; i++) {
    const id = clean(pl[i][0])
    if (id) pipelineMap.set(id, pl[i])
  }

  // Existing rows for upsert decision
  const beforeIds = new Set(
    (await c.query(`SELECT proposal_id FROM ignition_proposals`)).rows.map(
      (r: any) => r.proposal_id,
    ),
  )

  // Lookup: ignition_client_id → primary FK (preferred over re-matching).
  // Also doubles as a "does this client exist" set so we can NULL the FK on
  // proposals that reference deleted/archived Ignition clients (otherwise the
  // FK would fail and the whole transaction would roll back).
  const clientFkMap = new Map<string, { contactId: string | null; orgId: string | null }>()
  for (const r of (
    await c.query(
      `SELECT ignition_client_id, contact_id, organization_id FROM ignition_clients`,
    )
  ).rows) {
    clientFkMap.set(r.ignition_client_id, {
      contactId: r.contact_id,
      orgId: r.organization_id,
    })
  }

  let inserted = 0
  let updated = 0
  let matched = 0
  let unmatched = 0

  for (const [id, p] of propMap.entries()) {
    const pi = pipelineMap.get(id) || []

    const state = (clean(p[2]) || "").toLowerCase()
    const status =
      state === "completed" || state === "complete"
        ? "completed"
        : state === "accepted"
        ? "accepted"
        : state === "lost"
        ? "lost"
        : state === "archived"
        ? "archived"
        : state === "awaiting acceptance"
        ? "sent"
        : state === "draft"
        ? "draft"
        : state || null

    // Pipeline column indexes (53 cols). Proposals indexes (40 cols).
    // Reuse pipeline first (richer), fall back to proposals.
    const ignitionClientId = clean(pi[3]) || clean(p[5])
    const clientReference = clean(pi[4]) || clean(p[6])
    const externalClientId = clean(pi[5]) || clean(p[4])
    const clientName = clean(pi[6]) || clean(p[3])
    const clientEmail = normalizeEmail(pi[7]) || normalizeEmail(p[7])
    const acceptedAt = ts(pi[14]) || ts(p[29])
    const lostAt = ts(pi[40]) || ts(p[27])
    const sentAt = ts(pi[13]) || ts(p[20])
    const createdAt = ts(pi[10]) || ts(p[18])
    const effectiveStartDate = date(pi[11]) || date(p[13])

    const minimumValue =
      num(pi[20]) ?? num(p[15]) ?? null /* total */
    const minimumValueAuto = num(pi[21]) ?? num(p[16])
    const minimumValueManual = num(pi[22]) ?? num(p[17])

    // Determine FK linkage from ignition_client_id first; fall back to fuzzy match.
    // If the Ignition client doesn't exist in our table (deleted/archived in
    // Ignition), NULL the FK to avoid a constraint violation. The proposal
    // can still link to a contact/organization via fuzzy match.
    let contactId: string | null = null
    let orgId: string | null = null
    let safeIgnitionClientId: string | null = null
    if (ignitionClientId && clientFkMap.has(ignitionClientId)) {
      const fk = clientFkMap.get(ignitionClientId)!
      contactId = fk.contactId
      orgId = fk.orgId
      safeIgnitionClientId = ignitionClientId
    } else {
      const m = matchFn({
        externalClientId,
        email: clientEmail,
        name: clientName,
      })
      contactId = m.contactId
      orgId = m.organizationId
    }
    if (contactId || orgId) matched++
    else unmatched++

    const recurringFreq =
      // Heuristic: pipeline has no explicit freq column, infer from minimum_term
      clean(pi[19]) || clean(p[14])
        ? "monthly"
        : null

    if (APPLY) {
      await c.query(
        `INSERT INTO ignition_proposals
           (proposal_id, proposal_number, title, status, client_name, client_email,
            ignition_client_id,
            sent_at, accepted_at, completed_at, lost_at, archived_at, revoked_at,
            effective_start_date, billing_starts_on,
            one_time_total, recurring_total, recurring_frequency, total_value,
            currency, amount,
            client_partner, client_manager, proposal_sent_by,
            signed_url, lost_reason,
            contact_id, organization_id,
            created_at, updated_at, last_event_at, raw_payload, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),NOW(),$30,$30)
         ON CONFLICT (proposal_id) DO UPDATE SET
           proposal_number = COALESCE(EXCLUDED.proposal_number, ignition_proposals.proposal_number),
           title = COALESCE(EXCLUDED.title, ignition_proposals.title),
           status = EXCLUDED.status,
           client_name = COALESCE(EXCLUDED.client_name, ignition_proposals.client_name),
           client_email = COALESCE(EXCLUDED.client_email, ignition_proposals.client_email),
           ignition_client_id = COALESCE(EXCLUDED.ignition_client_id, ignition_proposals.ignition_client_id),
           sent_at = COALESCE(EXCLUDED.sent_at, ignition_proposals.sent_at),
           accepted_at = COALESCE(EXCLUDED.accepted_at, ignition_proposals.accepted_at),
           completed_at = COALESCE(EXCLUDED.completed_at, ignition_proposals.completed_at),
           lost_at = COALESCE(EXCLUDED.lost_at, ignition_proposals.lost_at),
           archived_at = COALESCE(EXCLUDED.archived_at, ignition_proposals.archived_at),
           effective_start_date = COALESCE(EXCLUDED.effective_start_date, ignition_proposals.effective_start_date),
           one_time_total = COALESCE(EXCLUDED.one_time_total, ignition_proposals.one_time_total),
           recurring_total = COALESCE(EXCLUDED.recurring_total, ignition_proposals.recurring_total),
           recurring_frequency = COALESCE(EXCLUDED.recurring_frequency, ignition_proposals.recurring_frequency),
           total_value = COALESCE(EXCLUDED.total_value, ignition_proposals.total_value),
           amount = COALESCE(EXCLUDED.amount, ignition_proposals.amount),
           client_partner = COALESCE(EXCLUDED.client_partner, ignition_proposals.client_partner),
           client_manager = COALESCE(EXCLUDED.client_manager, ignition_proposals.client_manager),
           proposal_sent_by = COALESCE(EXCLUDED.proposal_sent_by, ignition_proposals.proposal_sent_by),
           signed_url = COALESCE(EXCLUDED.signed_url, ignition_proposals.signed_url),
           lost_reason = COALESCE(EXCLUDED.lost_reason, ignition_proposals.lost_reason),
           contact_id = COALESCE(ignition_proposals.contact_id, EXCLUDED.contact_id),
           organization_id = COALESCE(ignition_proposals.organization_id, EXCLUDED.organization_id),
           raw_payload = ignition_proposals.raw_payload || EXCLUDED.raw_payload,
           payload = COALESCE(EXCLUDED.payload, ignition_proposals.payload),
           last_event_at = NOW(),
           modified_at = NOW()`,
        [
          id,
          clean(pi[0]) || clean(p[0]) || id, // proposal_number = reference
          clean(pi[1]) || clean(p[1]),
          status,
          clientName,
          clientEmail,
          safeIgnitionClientId,
          sentAt,
          acceptedAt,
          status === "completed" ? acceptedAt : null,
          lostAt,
          null, // archived_at (only "Archived" state in proposals.csv → use that)
          null, // revoked_at
          effectiveStartDate,
          null, // billing_starts_on
          minimumValueManual,
          minimumValueAuto,
          recurringFreq,
          minimumValue,
          "USD",
          minimumValue,
          clean(pi[17]) || clean(p[9]),
          clean(pi[18]) || clean(p[10]),
          clean(pi[35]),
          clean(pi[27]) || clean(p[12]),
          null, // lost_reason — not exposed in CSV, only "Marked As Lost By"
          contactId,
          orgId,
          createdAt,
          {
            client_reference: clientReference,
            external_client_id: externalClientId,
            tags: clean(pi[31]) || clean(p[8]),
            services_summary: clean(pi[24]),
            sent_count: num(pi[36]) || num(p[21]),
            reminder_count: num(pi[37]) || num(p[22]),
            email_opened_at: ts(pi[38]) || ts(p[23]),
            viewed_at: ts(pi[39]) || ts(p[24]),
            accepted_by: clean(pi[15]) || clean(p[37]),
            acceptance_ip: clean(pi[16]) || clean(p[30]),
            num_active_services: num(pi[42]),
            payment_required: yes(pi[43]),
            payment_type: clean(pi[44]),
            options: clean(pi[48]),
            option_selected: clean(pi[49]) || clean(p[38]),
            create_invoices: yes(pi[50] || p[0]),
            client_proposal_view_link: clean(pi[27]) || clean(p[12]),
            proposal_pdf_link: clean(pi[29]) || clean(p[32]),
            email_template: clean(pi[25]) || clean(p[26]),
            terms_template: clean(pi[26]) || clean(p[25]),
            number_of_signatories: num(pi[32]),
            indefinite_billing: yes(pi[30]) || yes(p[34]),
            client_group_name: clean(pi[9]) || clean(p[39]),
            proposal_slug: clean(pi[52]),
          },
        ],
      )
    }
    if (beforeIds.has(id)) updated++
    else inserted++
  }
  return { inserted, updated, matched, unmatched }
}

// ─── ignition_proposal_services (active services) ─────────────────────────
async function reconcileProposalServices(c: Client) {
  const rows = readCsv(CSV.activeServices)
  if (!rows.length) return { inserted: 0, updated: 0, skipped_no_proposal: 0 }

  // We need the union of proposal IDs that *will exist* after the
  // transaction commits — both pre-existing DB rows AND every CSV proposal
  // we're inserting/updating in this run. Without this, dry-runs (and the
  // first apply against an empty DB) would skip every service because the
  // proposals haven't been INSERTed yet within the same tx snapshot.
  const proposalIds = new Set<string>(
    (await c.query(`SELECT proposal_id FROM ignition_proposals`)).rows.map(
      (r: any) => r.proposal_id,
    ),
  )
  for (const fp of [CSV.proposals, CSV.pipeline]) {
    const rows = readCsv(fp)
    for (let i = 1; i < rows.length; i++) {
      const id = clean(rows[i][0])
      if (id) proposalIds.add(id)
    }
  }

  let inserted = 0
  let skippedNoProposal = 0

  if (APPLY) {
    // Replace strategy: active-services.csv is a full snapshot of currently
    // active services. Wipe + insert is safer than diff-merge here because
    // the source has no stable per-row ID — only proposalRef + serviceName.
    await c.query(`DELETE FROM ignition_proposal_services`)
  }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const proposalRef = clean(r[3]) // "PROP-0063"
    const serviceName = clean(r[5])
    if (!proposalRef || !serviceName) continue
    if (!proposalIds.has(proposalRef)) {
      skippedNoProposal++
      continue
    }
    const billingScheduleType = clean(r[6])?.toLowerCase() // continuous|once_off
    const priceType = clean(r[7])?.toLowerCase() // fixed|variable
    const billingRule = clean(r[8])?.toLowerCase() // up_front|on_completion|monthly etc
    const price = num(r[9])
    const unit = num(r[10])
    const billingEvents = num(r[11])
    const priceTotal = num(r[12])
    const currency = clean(r[13]) || "USD"
    const expiresOn = date(r[14])
    const agreedServiceUrl = clean(r[4])

    if (APPLY) {
      await c.query(
        `INSERT INTO ignition_proposal_services
           (proposal_id, ignition_service_id, service_name, description,
            quantity, unit_price, total_amount, currency,
            billing_frequency, billing_type, start_date, end_date,
            status, ordinal, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          proposalRef,
          null, // we don't have a stable service_id linkage from this CSV
          serviceName,
          null,
          unit ?? 1,
          price,
          priceTotal,
          currency,
          billingRule, // up_front, monthly, etc.
          priceType, // fixed | variable
          null,
          expiresOn,
          "active",
          i,
          {
            billing_schedule_type: billingScheduleType,
            billing_events: billingEvents,
            agreed_service_url: agreedServiceUrl,
            client_id: clean(r[0]),
            client_name: clean(r[1]),
            external_client_id: clean(r[2]),
            client_group_name: clean(r[15]),
          },
        ],
      )
      inserted++
    } else {
      inserted++
    }
  }

  return { inserted, updated: 0, skipped_no_proposal: skippedNoProposal }
}

// ─── orchestrator ─────────────────────────────────────────────────────────
async function main() {
  const url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || "").replace(
    /sslmode=require/,
    "sslmode=no-verify",
  )
  if (!url) {
    console.error("Missing POSTGRES_URL_NON_POOLING / POSTGRES_URL")
    process.exit(1)
  }

  const c = new Client({ connectionString: url })
  await c.connect()
  console.log(`\n[ignition reconciliation] mode = ${APPLY ? "APPLY" : "DRY-RUN"}\n`)

  await c.query("BEGIN")
  try {
    const matchFn = await buildMatchIndex(c)

    console.log("→ ignition_services")
    const sv = await reconcileServices(c)
    console.log(`  insert ${sv.inserted} | update ${sv.updated}`)

    console.log("→ ignition_clients")
    const cl = await reconcileClients(c, matchFn)
    console.log(
      `  insert ${cl.inserted} | update ${cl.updated} | matched ${cl.matched} | unmatched ${cl.unmatched}`,
    )

    // Pre-step: NULL out any orphan ignition_client_id on existing proposals.
    // Postgres validates FK on every UPDATE that touches the column (even if
    // the value is unchanged via COALESCE), so demo proposals referencing
    // clients that aren't in the active export would fail the upsert.
    if (APPLY) {
      const orphan = await c.query(
        `UPDATE ignition_proposals p
            SET ignition_client_id = NULL
          WHERE ignition_client_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM ignition_clients ic
               WHERE ic.ignition_client_id = p.ignition_client_id
            )`,
      )
      console.log(`  cleared ${orphan.rowCount ?? 0} orphan ignition_client_id refs`)
    }

    console.log("→ ignition_proposals")
    const pp = await reconcileProposals(c, matchFn)
    console.log(
      `  insert ${pp.inserted} | update ${pp.updated} | matched ${pp.matched} | unmatched ${pp.unmatched}`,
    )

    console.log("→ ignition_proposal_services")
    const ps = await reconcileProposalServices(c)
    console.log(
      `  insert ${ps.inserted} | skipped (proposal not found) ${ps.skipped_no_proposal}`,
    )

    if (APPLY) {
      await c.query("COMMIT")
      console.log("\n[committed]")
    } else {
      await c.query("ROLLBACK")
      console.log("\n[dry-run rolled back] re-run with --apply to commit")
    }
  } catch (err) {
    await c.query("ROLLBACK")
    console.error("\n[FAILED — rolled back]", err)
    process.exit(1)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
