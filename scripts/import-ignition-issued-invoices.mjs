/**
 * Import Ignition issued invoices into `ignition_invoices`.
 * ────────────────────────────────────────────────────────────────────────
 * Source CSV: scripts/data/ignition-invoices-report-2026-05-07.csv
 *   Columns: Issued On, Invoice #, Invoice ID, Client, Client ID, Due On,
 *            Payment State, Invoice State, Paid On, Amount, Currency,
 *            Invoice Link
 *   Total rows: 660
 *   Invoice State: always "Issued"
 *   Payment State: "Paid" (643) | "Unpaid" (17)
 *
 * This is a *different* report from the AR-aging CSV that produced the
 * 234 existing `csv:%` rows — that one was scheduled / upcoming (future
 * dates through 2028, no Ignition invoice IDs). The 660 rows here are
 * real issued invoices that carry the canonical Ignition `inv_*` ID and
 * `cli_*` client ID, so we can key off those directly.
 *
 *   - Primary key:  ignition_invoice_id = `ignition:<Invoice ID>`
 *                   (e.g. `ignition:inv_nh5xmio27wmaaaiavqwa`)
 *   - Display num:  invoice_number = the CSV's `Invoice #` column
 *   - Status:       Payment State=Paid   → 'paid'
 *                   Payment State=Unpaid → 'outstanding'
 *   - Money:        amount, amount_paid, amount_outstanding, paid_at all
 *                   set from Paid On + Amount.
 *
 * Client mapping precedence (each row tries these in order):
 *   1. Bridge through `ignition_proposals.ignition_client_id` — that
 *      table already maps `cli_*` IDs to organizations/contacts via
 *      its `organization_id` / `contact_id` columns. Fastest + most
 *      reliable.
 *   2. Fall back to name matching: normalize Client → look up in a
 *      pre-built {orgs ∪ contacts} table using the same normalize()
 *      strategy as the archived AR-aging importer. Orgs win ties.
 *   3. Manual NAME_OVERRIDES for the handful of cases the matcher
 *      can't bridge (joint households, doing-business-as names, etc.).
 *
 * Idempotency: ON CONFLICT (ignition_invoice_id) DO UPDATE — re-running
 * the import safely refreshes status / amounts / mapping without
 * creating duplicates.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CSV_PATH = path.join(__dirname, "data", "ignition-invoices-report-2026-05-07.csv")
const ID_PREFIX = "ignition:"
const SOURCE_TAG = "ignition_csv_issued_2026_05_07"

// Manual overrides for invoice "Client" strings the matcher can't bridge.
// Keys are normalize()'d. Values target either a normalized lookup key
// (use existing org/contact) or a hard {kind,id}.
const NAME_OVERRIDES = new Map([
  // Add overrides here as we discover unmatched clients in the import
  // summary. Examples follow the same shape as the AR-aging importer:
  //   ["adkinsnicholas", { kind: "contact", normalized_target: "nickadkins" }],
])

// ─── CSV parsing (RFC 4180-ish) ────────────────────────────────────────
function parseCsv(text) {
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
        // skip CR; LF will close the row
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
  // CSV uses "$1,200.00" / "$0.00" etc. Strip $, comma, whitespace.
  if (!s) return 0
  const cleaned = String(s).replace(/[$,\s]/g, "")
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function parseDate(s) {
  // Source format here is YYYY-MM-DD already (ISO date). Some rows have
  // empty strings for "Paid On" when unpaid — return null in that case.
  if (!s) return null
  const trimmed = String(s).trim()
  if (!trimmed) return null
  const m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const [, yyyy, mm, dd] = m
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

// "Sherwood, Chris" → ["Sherwood, Chris", "Chris Sherwood", "Sherwood Chris"]
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
  // Strip trailing LLC/INC/CORP for org-style names so "Acme LLC" can
  // still match a CRM record stored as bare "Acme".
  const stripped = trimmed.replace(/\b(llc|inc|corp|co|ltd|pllc|pc)\.?\s*$/i, "").trim()
  if (stripped && stripped !== trimmed) variants.add(stripped)
  return variants
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found: ${CSV_PATH}`)
  }
  const csvText = fs.readFileSync(CSV_PATH, "utf8")
  const rows = parseCsv(csvText)
  const header = rows.shift().map((h) => h.trim())
  const ix = {
    issuedOn: header.indexOf("Issued On"),
    invoiceNumber: header.indexOf("Invoice #"),
    invoiceId: header.indexOf("Invoice ID"),
    client: header.indexOf("Client"),
    clientId: header.indexOf("Client ID"),
    dueOn: header.indexOf("Due On"),
    paymentState: header.indexOf("Payment State"),
    invoiceState: header.indexOf("Invoice State"),
    paidOn: header.indexOf("Paid On"),
    amount: header.indexOf("Amount"),
    currency: header.indexOf("Currency"),
    invoiceLink: header.indexOf("Invoice Link"),
  }
  if (Object.values(ix).some((v) => v < 0)) {
    throw new Error(`CSV header mismatch. Got: ${header.join(", ")}`)
  }
  console.log(`Parsed ${rows.length} CSV rows`)

  // Strip any sslmode= override from the connection string so the rejectUnauthorized:false
  // setting is what wins (matches the archived importer's idiom).
  const url = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, "")
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()

  // ── Build cli_* → {kind,id,matched_via} bridge from ignition_proposals.
  // A single cli_* often appears on multiple proposals; we only need the
  // first (kind,id) we see per cli_*. Organization wins over contact.
  const proposalRows = await c.query(
    `select ignition_client_id, organization_id, contact_id, client_name
     from ignition_proposals
     where ignition_client_id is not null`,
  )
  /** @type {Map<string, {kind:'organization'|'contact', id:string, matched_via:string}>} */
  const cliBridge = new Map()
  for (const p of proposalRows.rows) {
    const k = p.ignition_client_id
    if (!k) continue
    const existing = cliBridge.get(k)
    if (p.organization_id && (!existing || existing.kind === "contact")) {
      cliBridge.set(k, { kind: "organization", id: p.organization_id, matched_via: `proposal:${p.client_name || k}` })
    } else if (p.contact_id && !existing) {
      cliBridge.set(k, { kind: "contact", id: p.contact_id, matched_via: `proposal:${p.client_name || k}` })
    }
  }
  console.log(`Loaded cli_* bridge from proposals: ${cliBridge.size} unique Ignition client IDs`)

  // ── Build name → entity lookup (orgs + contacts) for the fallback path.
  const orgRows = await c.query(
    `select id, name, legal_name, trading_name, full_name from organizations`,
  )
  const contactRows = await c.query(
    `select id, full_name, first_name, last_name, preferred_name from contacts`,
  )
  /** @type {Map<string, {kind:'organization'|'contact', id:string, matched_via:string}>} */
  const nameLookup = new Map()
  for (const o of orgRows.rows) {
    for (const candidate of [o.name, o.legal_name, o.trading_name, o.full_name]) {
      const k = normalize(candidate)
      if (!k) continue
      const existing = nameLookup.get(k)
      if (!existing || existing.kind === "contact") {
        nameLookup.set(k, { kind: "organization", id: o.id, matched_via: candidate })
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
      if (!nameLookup.has(k)) {
        nameLookup.set(k, { kind: "contact", id: ct.id, matched_via: candidate })
      }
    }
  }
  console.log(
    `Loaded name lookup: ${orgRows.rowCount} orgs + ${contactRows.rowCount} contacts → ${nameLookup.size} normalized keys`,
  )

  // ── Pre-pass: ensure every cli_* the CSV references exists in
  // `ignition_clients`. The invoice table FKs that column, so missing
  // ignition clients would cause the insert to bomb with a 23503. We
  // auto-create stub rows for any unknown cli_* and run the same name
  // matcher on them so future joins (proposal → client → org) still
  // resolve. Existing rows are left untouched.
  const existingClients = await c.query(
    `select ignition_client_id from ignition_clients`,
  )
  const haveClient = new Set(existingClients.rows.map((r) => r.ignition_client_id))
  /** @type {Map<string, string>} cli_id -> sample client name */
  const newCliFromCsv = new Map()
  for (const r of rows) {
    const cli = (r[ix.clientId] || "").trim()
    if (!cli || haveClient.has(cli)) continue
    if (!newCliFromCsv.has(cli)) {
      newCliFromCsv.set(cli, (r[ix.client] || "").trim() || cli)
    }
  }
  console.log(`Stub-creating ${newCliFromCsv.size} missing ignition_clients rows…`)
  let stubInserted = 0
  await c.query("begin")
  try {
    for (const [cli, displayName] of newCliFromCsv) {
      // Run the same matcher against the display name so the stub gets a
      // best-effort organization_id / contact_id link without us having
      // to re-do work in the invoice loop.
      let stubMatch = null
      for (const v of nameVariants(displayName)) {
        const m = nameLookup.get(normalize(v))
        if (m) {
          stubMatch = m
          break
        }
      }
      // match_status is constrained to one of:
      //   unmatched | auto_matched | manual_matched | manual_review | no_match
      // Use 'auto_matched' for the matcher hits and 'unmatched' for misses
      // (matches the existing distribution of 539 auto_matched / 2 unmatched).
      const matchStatus = stubMatch ? "auto_matched" : "unmatched"
      const matchMethod = stubMatch ? "name_lookup" : null
      await c.query(
        `insert into ignition_clients (
          ignition_client_id, name, organization_id, contact_id,
          match_status, match_method, match_notes, raw_payload
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (ignition_client_id) do nothing`,
        [
          cli,
          displayName,
          stubMatch?.kind === "organization" ? stubMatch.id : null,
          stubMatch?.kind === "contact" ? stubMatch.id : null,
          matchStatus,
          matchMethod,
          stubMatch ? `Auto-matched via "${stubMatch.matched_via}" during issued-invoice import` : "Created during issued-invoice import; no automatic match",
          { source: SOURCE_TAG, csv_client_name: displayName, csv_client_id: cli },
        ],
      )
      stubInserted++
      // Make sure the in-memory bridge has this cli too, so the invoice
      // loop's `cli_id` matching picks up these stubs immediately.
      if (stubMatch && !cliBridge.has(cli)) {
        cliBridge.set(cli, { ...stubMatch, matched_via: `client_stub:${displayName}` })
      }
    }
    await c.query("commit")
  } catch (err) {
    await c.query("rollback")
    throw err
  }
  console.log(`Stubbed ${stubInserted} new ignition_clients rows`)

  // Process CSV rows inside one transaction so a partial failure rolls back.
  let inserted = 0,
    updated = 0,
    skipped = 0
  let matchedByCli = 0,
    matchedByName = 0,
    matchedOrg = 0,
    matchedContact = 0
  /** @type {Map<string, number>} */
  const unmatched = new Map()
  const byStatus = { paid: 0, outstanding: 0 }

  await c.query("begin")
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const invoiceId = (r[ix.invoiceId] || "").trim()
      if (!invoiceId) {
        skipped++
        continue
      }
      const invoiceNumber = (r[ix.invoiceNumber] || "").trim() || null
      const clientName = (r[ix.client] || "").trim()
      const cli = (r[ix.clientId] || "").trim() || null
      const issuedOn = parseDate(r[ix.issuedOn])
      const dueOn = parseDate(r[ix.dueOn])
      const paidOn = parseDate(r[ix.paidOn])
      const amount = parseAmount(r[ix.amount])
      const paymentState = (r[ix.paymentState] || "").trim().toLowerCase()
      const isPaid = paymentState === "paid"
      const status = isPaid ? "paid" : "outstanding"
      byStatus[status]++

      // Mapping: try cli_* first, fall back to name-matching, fall back to overrides.
      let match = null
      let matchSource = null
      if (cli && cliBridge.has(cli)) {
        match = cliBridge.get(cli)
        matchSource = "cli_id"
        matchedByCli++
      }
      if (!match) {
        for (const v of nameVariants(clientName)) {
          const key = normalize(v)
          const m = nameLookup.get(key)
          if (m) {
            match = m
            matchSource = "name"
            matchedByName++
            break
          }
        }
      }
      if (!match) {
        const override = NAME_OVERRIDES.get(normalize(clientName))
        if (override?.normalized_target) {
          const target = nameLookup.get(override.normalized_target)
          if (target) {
            match = { ...target, matched_via: `override:${override.normalized_target}` }
            matchSource = "override"
            matchedByName++
          }
        }
      }
      if (match?.kind === "organization") matchedOrg++
      else if (match?.kind === "contact") matchedContact++
      else unmatched.set(`${clientName}|${cli || "no-cli"}`, (unmatched.get(`${clientName}|${cli || "no-cli"}`) || 0) + 1)

      const ignitionInvoiceId = `${ID_PREFIX}${invoiceId}`
      const amountPaid = isPaid ? amount : 0
      const amountOutstanding = isPaid ? 0 : amount

      // last_event_at: prefer paid date, else issued date, else now (handled by COALESCE in SQL).
      const lastEventAt = paidOn || issuedOn

      const rawPayload = {
        source: SOURCE_TAG,
        invoice_source: "Ignition",
        ignition_invoice_id: invoiceId,
        ignition_client_id: cli,
        ignition_invoice_number: invoiceNumber,
        ignition_client_name: clientName,
        ignition_invoice_link: r[ix.invoiceLink] || null,
        ignition_payment_state: r[ix.paymentState] || null,
        ignition_invoice_state: r[ix.invoiceState] || null,
        issued_on: issuedOn,
        due_on: dueOn,
        paid_on: paidOn,
        match: match
          ? { source: matchSource, kind: match.kind, id: match.id, matched_via: match.matched_via }
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
          $1, $2, $3, $4,
          $5, $6, $7,
          $8::date, $9::date, $10::timestamptz, $11::timestamptz, null,
          null, null, $12,
          $13, $14, coalesce($15::timestamptz, now()), $16
        )
        on conflict (ignition_invoice_id) do update set
          invoice_number      = excluded.invoice_number,
          status              = excluded.status,
          currency            = excluded.currency,
          amount              = excluded.amount,
          amount_paid         = excluded.amount_paid,
          amount_outstanding  = excluded.amount_outstanding,
          invoice_date        = excluded.invoice_date,
          due_date            = excluded.due_date,
          sent_at             = excluded.sent_at,
          paid_at             = excluded.paid_at,
          ignition_client_id  = excluded.ignition_client_id,
          organization_id     = excluded.organization_id,
          contact_id          = excluded.contact_id,
          last_event_at       = excluded.last_event_at,
          raw_payload         = excluded.raw_payload,
          updated_at          = now()
        returning (xmax = 0) as inserted
        `,
        [
          ignitionInvoiceId,                                                    // $1
          invoiceNumber,                                                        // $2
          status,                                                               // $3
          (r[ix.currency] || "USD").trim() || "USD",                            // $4
          amount,                                                               // $5
          amountPaid,                                                           // $6
          amountOutstanding,                                                    // $7
          issuedOn,                                                             // $8  invoice_date::date
          dueOn,                                                                // $9  due_date::date
          issuedOn,                                                             // $10 sent_at::timestamptz (best proxy)
          paidOn,                                                               // $11 paid_at::timestamptz
          cli,                                                                  // $12 ignition_client_id
          match?.kind === "organization" ? match.id : null,                     // $13 organization_id
          match?.kind === "contact" ? match.id : null,                          // $14 contact_id
          lastEventAt,                                                          // $15 last_event_at::timestamptz
          rawPayload,                                                           // $16 raw_payload jsonb
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
  console.log(`Total CSV rows:      ${rows.length}`)
  console.log(`Inserted:            ${inserted}`)
  console.log(`Updated:             ${updated}`)
  console.log(`Skipped (no inv id): ${skipped}`)
  console.log(`By status:           paid=${byStatus.paid}, outstanding=${byStatus.outstanding}`)
  console.log(`Mapped via cli_id:   ${matchedByCli}`)
  console.log(`Mapped via name:     ${matchedByName}`)
  console.log(`  → org:             ${matchedOrg}`)
  console.log(`  → contact:         ${matchedContact}`)
  const unmatchedTotal = [...unmatched.values()].reduce((a, b) => a + b, 0)
  console.log(`Unmapped: ${unmatchedTotal} rows across ${unmatched.size} client/cli combos`)
  if (unmatched.size > 0) {
    console.log("\nTop unmatched clients (review for overrides):")
    for (const [key, n] of [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`  ${n.toString().padStart(3)}× ${key}`)
    }
  }

  // Verification — read back what landed under the new prefix
  const totals = await c.query(`
    select status,
           count(*)::int                            as n,
           sum(amount)::numeric(12,2)               as total_amount,
           sum(amount_paid)::numeric(12,2)          as total_paid,
           sum(amount_outstanding)::numeric(12,2)   as total_outstanding
    from ignition_invoices
    where ignition_invoice_id like 'ignition:%'
    group by status order by status
  `)
  console.log("\nLanded in ignition_invoices (ignition:%):")
  console.table(totals.rows)

  await c.end()
}

main().catch((err) => {
  console.error("ERR:", err.stack || err.message)
  process.exit(1)
})
