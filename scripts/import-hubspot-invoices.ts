/**
 * Import historical HubSpot invoices into ignition_invoices
 * ============================================================
 *
 * Translates the HubSpot CRM invoice export into the canonical
 * `ignition_invoices` schema so that pre-Ignition billing data lives in the
 * same table the new Ignition sync writes to. This unifies the per-client
 * Invoices tab without forcing a separate UI/API surface for legacy data.
 *
 * Field mapping
 * -------------
 *   HubSpot column           → ignition_invoices column
 *   ─────────────────────────────────────────────────────────
 *   Record ID                → ignition_invoice_id (prefix `hubspot:`)
 *   Number                   → invoice_number
 *   Invoice status           → status (lowercase normalized)
 *   Amount billed            → amount
 *   Balance due              → amount_outstanding (derives amount_paid)
 *   Associated Contact       → contact_id (resolved via primary_email)
 *   Associated Company       → organization_id (resolved via name match)
 *   Due date                 → due_date + sent_at
 *   Paid (derived)           → paid_at = due_date when status='paid'
 *   Voided (derived)         → voided_at = due_date when status='voided'
 *   Owner / Deal / HS IDs    → raw_payload (JSONB)
 *
 * `proposal_id` and `ignition_client_id` are intentionally NULL — the FK
 * targets only contain Ignition records. The full HubSpot row is kept in
 * raw_payload so the deal name can be re-matched later if we ever
 * reconcile against Ignition proposals retroactively.
 *
 * Linkage strategy (in priority order)
 * -------------------------------------
 *   1. Contact email exact match (primary_email)
 *   2. Organization name exact match (case-insensitive)
 *   3. Both can be set independently — orgs without contacts and contacts
 *      without orgs are both valid.
 *   4. Falls back to unlinked rows (still inserted, surfaced in firm-wide
 *      reports but not on individual client profiles).
 *
 * Usage
 * -----
 *   pnpm tsx scripts/import-hubspot-invoices.ts          # dry-run (default)
 *   pnpm tsx scripts/import-hubspot-invoices.ts --apply  # commit
 */

import { Client } from "pg"
import { readFileSync } from "node:fs"
import { parse } from "csv-parse/sync"

const APPLY = process.argv.includes("--apply")
const CSV_PATH = "scripts/data/hubspot-invoices-2025-11-26.csv"

interface Row {
  hubspotRecordId: string
  number: string
  status: string
  amount: number
  balanceDue: number
  associatedCompany: string
  associatedContact: string
  dueDate: string
  owner: string
  associatedDeal: string
  invoiceSource: string
  associatedCompanyIds: string
  associatedContactIds: string
  associatedDealIds: string
}

const clean = (v: any): string => (v == null ? "" : String(v).trim())

/** Parse "Name (email@domain.com)" or "Name1 (e1);Name2 (e2)" — returns first email. */
function extractFirstEmail(s: string): string | null {
  if (!s) return null
  const first = s.split(";")[0]
  const m = first.match(/<?([\w.+-]+@[\w.-]+\.\w+)>?/i)
  return m ? m[1].toLowerCase() : null
}

/** Normalize status string → DB value. Unknown statuses fall through as-is. */
function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase().trim()
  if (s === "paid") return "paid"
  if (s === "open") return "open"
  if (s === "voided") return "voided"
  if (s === "draft") return "draft"
  return s || "draft"
}

/** Normalize org name for match lookups (lowercase, collapse whitespace). */
function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim()
}

/** Convert HubSpot date format "2025-01-01 03:25" → ISO date YYYY-MM-DD. */
function toDate(s: string): string | null {
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function toTimestamp(s: string): string | null {
  if (!s) return null
  // HubSpot exports "2025-01-01 03:25" (UTC). Just add :00 for seconds.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s + ":00+00"
  return null
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`)
  console.log(`Source: ${CSV_PATH}`)

  // ───── Load CSV ─────
  const raw = parse(readFileSync(CSV_PATH, "utf8"), {
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    columns: true,
  }) as Record<string, string>[]

  const rows: Row[] = raw.map((r) => ({
    hubspotRecordId: clean(r["Record ID"]),
    number: clean(r["Number"]),
    status: clean(r["Invoice status"]),
    amount: Number(clean(r["Amount billed"])) || 0,
    balanceDue: Number(clean(r["Balance due"])) || 0,
    associatedCompany: clean(r["Associated Company"]),
    associatedContact: clean(r["Associated Contact"]),
    dueDate: clean(r["Due date"]),
    owner: clean(r["Owner"]),
    associatedDeal: clean(r["Associated Deal"]),
    invoiceSource: clean(r["Invoice source"]),
    associatedCompanyIds: clean(r["Associated Company IDs"]),
    associatedContactIds: clean(r["Associated Contact IDs"]),
    associatedDealIds: clean(r["Associated Deal IDs"]),
  }))

  console.log(`Parsed ${rows.length} HubSpot invoices`)
  // Status histogram
  const statusHist: Record<string, number> = {}
  for (const r of rows) statusHist[r.status] = (statusHist[r.status] || 0) + 1
  console.log("Status distribution:", statusHist)

  // ───── DB ─────
  const pgUrl = (
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  )?.replace(/sslmode=require/, "sslmode=no-verify")
  if (!pgUrl) throw new Error("POSTGRES_URL not set")
  const c = new Client({ connectionString: pgUrl })
  await c.connect()

  try {
    // Build email → contact_id map
    const emailMap = new Map<string, string>()
    for (const r of (
      await c.query(
        `SELECT id, lower(primary_email) AS email FROM contacts WHERE primary_email IS NOT NULL`,
      )
    ).rows) {
      if (r.email && !emailMap.has(r.email)) emailMap.set(r.email, r.id)
    }
    console.log(`Loaded ${emailMap.size} contact email mappings`)

    // Build name → organization_id and email → organization_id maps. We need
    // both because some HubSpot invoices reference a contact whose email is
    // actually attached to an organization (e.g. Cognify LLC's primary_email
    // is anthony.tran@cognify.dev — there's no separate Anthony Tran contact).
    const orgMap = new Map<string, string>()
    const orgEmailMap = new Map<string, string>()
    for (const r of (
      await c.query(
        `SELECT id, name, lower(primary_email) AS email FROM organizations WHERE status = 'active'`,
      )
    ).rows) {
      const k = normName(r.name || "")
      if (k && !orgMap.has(k)) orgMap.set(k, r.id)
      if (r.email && !orgEmailMap.has(r.email)) orgEmailMap.set(r.email, r.id)
    }
    console.log(
      `Loaded ${orgMap.size} organization name mappings, ${orgEmailMap.size} email mappings`,
    )

    // ───── Resolve & build inserts ─────
    let matched = { contact: 0, org: 0, both: 0, neither: 0 }
    const inserts: any[] = []

    for (const r of rows) {
      // Manual email overrides for known HubSpot data-quality issues. Each
      // entry maps a HubSpot-side email to the canonical email of an existing
      // contact in our DB. Add new entries when we find legitimate typos
      // during import audits — the logic stays the same; nothing is hard-coded.
      const EMAIL_OVERRIDES: Record<string, string> = {
        // INV-1062: HubSpot recorded "drjeremynielson@gmail.com" but every
        // other invoice for the same person uses jnielson@symmetrycpt.com.
        "drjeremynielson@gmail.com": "jnielson@symmetrycpt.com",
      }

      const rawEmail = extractFirstEmail(r.associatedContact)
      const email = rawEmail ? EMAIL_OVERRIDES[rawEmail] || rawEmail : null
      const contactId = email ? emailMap.get(email) || null : null

      // Org resolution priority: company-name match first (most reliable when
      // Associated Company is set), then fall back to contact-email matching
      // an org's primary_email (covers solo founders where the org IS the
      // contact, e.g. Cognify LLC).
      let orgId: string | null = null
      if (r.associatedCompany) {
        orgId = orgMap.get(normName(r.associatedCompany)) || null
      }
      if (!orgId && !contactId && email) {
        orgId = orgEmailMap.get(email) || null
      }

      if (contactId && orgId) matched.both++
      else if (contactId) matched.contact++
      else if (orgId) matched.org++
      else matched.neither++

      const status = normalizeStatus(r.status)
      const dueDateOnly = toDate(r.dueDate)
      const dueTs = toTimestamp(r.dueDate)
      const amountPaid = Math.max(0, r.amount - r.balanceDue)
      const paidAt = status === "paid" ? dueTs : null
      const voidedAt = status === "voided" ? dueTs : null

      inserts.push({
        ignition_invoice_id: `hubspot:${r.hubspotRecordId}`,
        proposal_id: null,
        ignition_client_id: null,
        invoice_number: r.number || null,
        status,
        amount: r.amount,
        amount_paid: amountPaid,
        amount_outstanding: r.balanceDue,
        currency: "USD",
        invoice_date: dueDateOnly, // HubSpot only exports due date — use as invoice_date too
        due_date: dueDateOnly,
        sent_at: dueTs,
        paid_at: paidAt,
        voided_at: voidedAt,
        contact_id: contactId,
        organization_id: orgId,
        raw_payload: {
          source: "hubspot_export_2025-11-26",
          hubspot_record_id: r.hubspotRecordId,
          owner: r.owner || null,
          associated_company: r.associatedCompany || null,
          associated_contact_raw: r.associatedContact || null,
          associated_contact_email: email,
          associated_deal: r.associatedDeal || null,
          associated_company_ids: r.associatedCompanyIds || null,
          associated_contact_ids: r.associatedContactIds || null,
          associated_deal_ids: r.associatedDealIds || null,
          invoice_source: r.invoiceSource || null,
        },
        last_event_at: dueTs,
      })
    }

    console.log(`\nLinkage breakdown for ${rows.length} invoices:`)
    console.log(`  contact + org : ${matched.both}`)
    console.log(`  contact only  : ${matched.contact}`)
    console.log(`  org only      : ${matched.org}`)
    console.log(`  unlinked      : ${matched.neither}`)

    // Show unlinked details
    const unlinked = inserts.filter((x) => !x.contact_id && !x.organization_id)
    if (unlinked.length > 0) {
      console.log("\nUnlinked invoices (sample):")
      for (const u of unlinked.slice(0, 15)) {
        const p = u.raw_payload
        console.log(
          `  ${u.invoice_number} | $${u.amount} | ${p.associated_company || "(no company)"} | ${p.associated_contact_raw || "(no contact)"}`,
        )
      }
    }

    // Aggregate totals
    const total = inserts.reduce((s, i) => s + Number(i.amount), 0)
    const paid = inserts.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0)
    const open = inserts
      .filter((i) => i.status === "open")
      .reduce((s, i) => s + Number(i.amount_outstanding), 0)
    console.log(`\nTotals across import:`)
    console.log(`  invoices total billed:    $${total.toLocaleString()}`)
    console.log(`  paid invoices total:      $${paid.toLocaleString()}`)
    console.log(`  open invoices outstanding:$${open.toLocaleString()}`)

    if (!APPLY) {
      console.log("\n[DRY-RUN] Pass --apply to execute the transaction.")
      await c.end()
      return
    }

    // ───── APPLY ─────
    await c.query("BEGIN")
    try {
      // Wipe any prior import (idempotent re-run support)
      const del = await c.query(
        `DELETE FROM ignition_invoices WHERE ignition_invoice_id LIKE 'hubspot:%'`,
      )
      console.log(`Cleared ${del.rowCount} prior hubspot:* rows for clean re-insert`)

      let inserted = 0
      for (const i of inserts) {
        await c.query(
          `INSERT INTO ignition_invoices (
            ignition_invoice_id, proposal_id, ignition_client_id, invoice_number, status,
            amount, amount_paid, amount_outstanding, currency,
            invoice_date, due_date, sent_at, paid_at, voided_at,
            contact_id, organization_id, raw_payload, last_event_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            i.ignition_invoice_id,
            i.proposal_id,
            i.ignition_client_id,
            i.invoice_number,
            i.status,
            i.amount,
            i.amount_paid,
            i.amount_outstanding,
            i.currency,
            i.invoice_date,
            i.due_date,
            i.sent_at,
            i.paid_at,
            i.voided_at,
            i.contact_id,
            i.organization_id,
            i.raw_payload,
            i.last_event_at,
          ],
        )
        inserted++
      }

      await c.query("COMMIT")
      console.log(`\nCOMMIT: inserted ${inserted} HubSpot invoices into ignition_invoices`)
    } catch (e) {
      await c.query("ROLLBACK")
      throw e
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
