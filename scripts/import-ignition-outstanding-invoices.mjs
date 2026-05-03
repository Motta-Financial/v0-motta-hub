/**
 * Import Ignition outstanding & overdue invoices into `ignition_invoices`.
 * ────────────────────────────────────────────────────────────────────────
 * The CSV in scripts/data/ignition-invoices-2026-05.csv is the partner-pulled
 * AR aging from Ignition. Every row is unpaid — either future-dated
 * ("Upcoming") or past-due ("Overdue"). Rows are synthesised into
 * `ignition_invoices` with deterministic IDs (`csv:<md5>`) so re-runs are
 * idempotent (UPSERT on the primary key).
 *
 * Client mapping: each CSV client name is normalized (lowercase, strip
 * non-alphanumerics) and matched against organizations.{name,legal_name,
 * trading_name,full_name} and contacts.{full_name, "First Last", "Last, First"}.
 * Organization match wins when both hit. Unmatched rows still get inserted
 * (so AR totals stay correct) — they just won't deep-link to a client page.
 */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CSV_PATH = path.join(__dirname, "data", "ignition-invoices-2026-05.csv")
const ID_PREFIX = "csv:"

// Manual client name overrides for cases the fuzzy matcher can't bridge:
//   • "Adkins, Nicholas" — billed under nickname "Nick Adkins"
//   • "Denver Hair Party" — CRM has the legal name "Denver Hair Party LLC"
//   • "Meredith & Cole Chapin" — joint household; map to one of the two
//     existing contacts (we pick the first name listed on the invoice).
// Keys are normalized using normalize() below.
const NAME_OVERRIDES = new Map([
  ["adkinsnicholas", { kind: "contact", normalized_target: "nickadkins" }],
  ["denverhairparty", { kind: "organization", normalized_target: "denverhairpartyllc" }],
  ["meredithcolechapin", { kind: "contact", normalized_target: "meredithchapin" }],
])

// ─── CSV parsing ───────────────────────────────────────────────────────
function parseCsv(text) {
  // Minimal RFC 4180-ish parser supporting quoted fields with embedded commas
  // (e.g. "Home Connection Group, Inc.") and double-quote escapes.
  const rows = []
  let field = ""
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        row.push(field)
        field = ""
      } else if (ch === "\n") {
        row.push(field)
        rows.push(row)
        row = []
        field = ""
      } else if (ch === "\r") {
        // skip
      } else {
        field += ch
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.length > 0))
}

function parseAmount(s) {
  if (!s) return 0
  const cleaned = String(s).replace(/[$,\s]/g, "")
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function parseDate(s) {
  // Source format: MM/DD/YYYY → ISO date string
  if (!s) return null
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`
}

// ─── Name normalization ────────────────────────────────────────────────
function normalize(name) {
  if (!name) return ""
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim()
}

// "Sharabi, Dean" → ["Dean Sharabi", "Sharabi Dean"]
function nameVariants(raw) {
  const variants = new Set()
  if (!raw) return variants
  const trimmed = raw.trim()
  variants.add(trimmed)
  if (trimmed.includes(",")) {
    const [last, first] = trimmed.split(",").map((s) => s.trim())
    if (last && first) {
      variants.add(`${first} ${last}`)
      variants.add(`${last} ${first}`)
    }
  }
  return variants
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf8")
  const rows = parseCsv(csvText)
  const header = rows.shift().map((h) => h.trim())
  const colIdx = (name) => header.indexOf(name)
  const ix = {
    service: colIdx("Service"),
    client: colIdx("Client"),
    status: colIdx("Status"),
    billDate: colIdx("Bill Date"),
    priceType: colIdx("Price Type"),
    amount: colIdx("Amount"),
    daysOutstanding: colIdx("Days Outstanding"),
    statusCategory: colIdx("Status Category"),
  }
  if (Object.values(ix).some((v) => v < 0)) {
    throw new Error(`CSV header mismatch. Got: ${header.join(", ")}`)
  }

  const url = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, "")
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()

  // Build name → entity lookup tables once. We pull every potentially-useful
  // name column for orgs and contacts, normalize each, and merge into a Map
  // keyed by normalized form. The Map values prefer organizations over
  // contacts when both share a normalized name.
  const orgRows = await c.query(
    `select id, name, legal_name, trading_name, full_name from organizations`,
  )
  const contactRows = await c.query(
    `select id, full_name, first_name, last_name, preferred_name from contacts`,
  )

  /** @type {Map<string, { kind: 'organization' | 'contact'; id: string; matched_via: string }>} */
  const lookup = new Map()
  for (const o of orgRows.rows) {
    for (const candidate of [o.name, o.legal_name, o.trading_name, o.full_name]) {
      const k = normalize(candidate)
      if (!k) continue
      // Organizations take priority — only set if not already set, OR existing
      // entry is a contact (orgs win ties).
      const existing = lookup.get(k)
      if (!existing || existing.kind === "contact") {
        lookup.set(k, { kind: "organization", id: o.id, matched_via: candidate })
      }
    }
  }
  for (const ct of contactRows.rows) {
    const fullName = ct.full_name || [ct.first_name, ct.last_name].filter(Boolean).join(" ")
    const candidates = [
      ct.full_name,
      fullName,
      [ct.first_name, ct.last_name].filter(Boolean).join(" "),
      [ct.last_name, ct.first_name].filter(Boolean).join(" "),
      [ct.preferred_name, ct.last_name].filter(Boolean).join(" "),
    ]
    for (const candidate of candidates) {
      const k = normalize(candidate)
      if (!k) continue
      if (!lookup.has(k)) {
        lookup.set(k, { kind: "contact", id: ct.id, matched_via: candidate })
      }
    }
  }

  console.log(
    `Loaded lookup: ${orgRows.rowCount} orgs + ${contactRows.rowCount} contacts → ${lookup.size} normalized keys`,
  )

  // Process CSV rows
  let inserted = 0
  let updated = 0
  let matchedOrg = 0
  let matchedContact = 0
  /** @type {Map<string, number>} unmatched client name → row count */
  const unmatched = new Map()
  const byStatus = { overdue: 0, outstanding: 0 }

  // We do everything inside a single transaction so a partial failure rolls back.
  await c.query("begin")
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const service = (r[ix.service] || "").trim()
      const clientName = (r[ix.client] || "").trim()
      const statusCategory = (r[ix.statusCategory] || "").trim()
      const billDate = parseDate(r[ix.billDate])
      const amount = parseAmount(r[ix.amount])
      if (!clientName || !billDate || !amount) {
        // Skip rows missing essential data; these would just create orphan AR.
        continue
      }

      // Map status category → ignition_invoices.status. The CSV doesn't carry
      // any sent/paid timestamps so we set those to null and treat the bill
      // date as both invoice_date AND due_date (Ignition bills due on the
      // bill date for fixed-fee work).
      const status = statusCategory.toLowerCase() === "overdue" ? "overdue" : "outstanding"
      byStatus[status]++

      // Try every name variant against the lookup
      let match = null
      for (const v of nameVariants(clientName)) {
        const key = normalize(v)
        const m = lookup.get(key)
        if (m) {
          match = m
          break
        }
      }
      // Apply manual override if the auto-matcher missed it.
      if (!match) {
        const override = NAME_OVERRIDES.get(normalize(clientName))
        if (override) {
          const target = lookup.get(override.normalized_target)
          if (target) match = { ...target, matched_via: `override:${override.normalized_target}` }
        }
      }
      if (match?.kind === "organization") matchedOrg++
      else if (match?.kind === "contact") matchedContact++
      else unmatched.set(clientName, (unmatched.get(clientName) || 0) + 1)

      // Deterministic ID — same row produces same hash on re-run so UPSERT
      // updates rather than duplicates.
      const hash = crypto
        .createHash("md5")
        .update([service, clientName, billDate, amount].join("|"))
        .digest("hex")
      const ignitionInvoiceId = `${ID_PREFIX}${hash}`

      const rawPayload = {
        source: "ignition_csv_2026_05",
        service,
        client_name: clientName,
        bill_date: billDate,
        price_type: r[ix.priceType] || null,
        amount,
        days_outstanding: Number(r[ix.daysOutstanding]) || 0,
        ignition_status_text: r[ix.status] || null,
        status_category: statusCategory,
        match: match
          ? { kind: match.kind, id: match.id, matched_via: match.matched_via }
          : null,
      }

      const result = await c.query(
        `
        insert into ignition_invoices (
          ignition_invoice_id, invoice_number, status, currency,
          amount, amount_paid, amount_outstanding,
          invoice_date, due_date, sent_at, paid_at, voided_at,
          stripe_invoice_id, proposal_id, ignition_client_id,
          organization_id, contact_id, last_event_at, raw_payload
        ) values (
          $1, null, $2, 'USD',
          $3, 0, $3,
          $4, $4, null, null, null,
          null, null, null,
          $5, $6, now(), $7
        )
        on conflict (ignition_invoice_id) do update set
          status = excluded.status,
          amount = excluded.amount,
          amount_outstanding = excluded.amount_outstanding,
          invoice_date = excluded.invoice_date,
          due_date = excluded.due_date,
          organization_id = excluded.organization_id,
          contact_id = excluded.contact_id,
          last_event_at = excluded.last_event_at,
          raw_payload = excluded.raw_payload,
          updated_at = now()
        returning (xmax = 0) as inserted
      `,
        [
          ignitionInvoiceId,
          status,
          amount,
          billDate,
          match?.kind === "organization" ? match.id : null,
          match?.kind === "contact" ? match.id : null,
          rawPayload,
        ],
      )

      if (result.rows[0]?.inserted) inserted++
      else updated++
    }
    await c.query("commit")
  } catch (err) {
    await c.query("rollback")
    throw err
  }

  console.log("\n--- IMPORT SUMMARY ---")
  console.log(`Total rows processed: ${inserted + updated}`)
  console.log(`Inserted: ${inserted}`)
  console.log(`Updated:  ${updated}`)
  console.log(`By status: overdue=${byStatus.overdue}, outstanding=${byStatus.outstanding}`)
  console.log(`Mapped to organization: ${matchedOrg}`)
  console.log(`Mapped to contact:      ${matchedContact}`)
  console.log(`Unmapped: ${[...unmatched.values()].reduce((a, b) => a + b, 0)} rows across ${unmatched.size} client names`)
  if (unmatched.size > 0) {
    console.log("\nUnmatched clients (review manually):")
    for (const [name, n] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(3)}× ${name}`)
    }
  }

  // Sanity: re-read totals
  const totals = await c.query(`
    select status, count(*)::int as n,
           sum(amount)::numeric(12,2) as total_amount,
           sum(amount_outstanding)::numeric(12,2) as total_outstanding
    from ignition_invoices
    where ignition_invoice_id like 'csv:%'
    group by status order by status
  `)
  console.log("\nLanded in ignition_invoices (csv:%):")
  console.table(totals.rows)

  await c.end()
}

main().catch((err) => {
  console.error("ERR:", err.message)
  process.exit(1)
})
