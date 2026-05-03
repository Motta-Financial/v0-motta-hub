/**
 * scrub-contacts-from-karbon-csv.ts
 *
 * Comprehensive scrub of public.contacts using a Karbon CSV export as the
 * source of truth. Run via:
 *
 *   pnpm tsx scripts/scrub-contacts-from-karbon-csv.ts                 # dry-run
 *   pnpm tsx scripts/scrub-contacts-from-karbon-csv.ts --apply          # commit changes
 *
 * Strategy (chosen by the user 2026-05-02):
 *   - Insert all CSV rows whose karbon_contact_key is NOT already in
 *     Supabase (net-new).
 *   - Soft-archive rows whose karbon_contact_key is in Supabase but NOT
 *     in the CSV (status = 'archived'). Hard-delete is unsafe — 30+
 *     tables hold FKs into contacts.
 *   - For rows in BOTH: Karbon CSV wins for any non-empty field. Blank
 *     CSV cells never overwrite enriched Supabase data.
 *   - Conservative cleanup: trim address whitespace, strip 'undefined_'
 *     prefix from user_defined_identifier, normalize 'Active' -> 'active',
 *     and delete obvious test rows (abctest, "(Sample Contact)") only when
 *     they have NO inbound FK references.
 *
 * The Karbon export has a six-row preamble before data starts, with a
 * banner row, multi-line section headers, and sub-headers. Rows after
 * the data block are empty padding. We slice from row index 6 and drop
 * rows whose first column (Karbon ID) is empty.
 */

import { parse } from "csv-parse/sync"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Client } from "pg"

// ---------- CSV column indices (validated against Karbon export 5/2/2026) ----------
const COL = {
  karbon_id: 0,
  first_name: 1,
  middle_name: 2,
  last_name: 3,
  preferred_name: 4,
  date_of_birth: 5,
  contact_type: 6,
  privacy_level: 7,
  client_identifier: 8,
  client_owner: 9,
  client_manager: 10,
  organisation: 11,
  role: 12,
  email: 13,
  // 14 = "additional emails in Karbon" Yes/No (signal only)
  phone_work: 15,
  phone_office: 16,
  phone_fax: 17,
  phone_mobile: 18,
  phone_home: 19,
  phone_other: 20,
  // 21 = "additional phones in Karbon"
  physical_lines: 22,
  physical_city: 23,
  physical_state: 24,
  physical_zip: 25,
  physical_country: 26,
  // 27 = "additional physical addresses"
  mailing_lines: 28,
  mailing_city: 29,
  mailing_state: 30,
  mailing_zip: 31,
  mailing_country: 32,
  // 33 = "additional mailing addresses"
  ssn: 34,
  filing_status: 35,
  cf_karbon_client_key: 36,
  cf_referral_client_id: 37,
  cf_taxpayer_occupation: 38,
  legal_name: 39,
  // 40 = rn (always 1)
} as const

// ---------- Helpers ----------

const blank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === ""

/** Clean a CSV cell. Treat whitespace-only as empty (Karbon pads address lines). */
function clean(v: unknown): string | null {
  if (blank(v)) return null
  const s = String(v).trim().replace(/\s+/g, " ")
  return s.length === 0 ? null : s
}

/** Normalize phone numbers. Karbon exports as "US|4127260047". */
function cleanPhone(v: unknown): string | null {
  const s = clean(v)
  if (!s) return null
  // Strip "US|" / "CA|" country prefix; keep digits + spaces + dashes + parens.
  const stripped = s.replace(/^[A-Z]{2}\|/, "").trim()
  return stripped.length === 0 ? null : stripped
}

/** Parse "Jan 06, 1994" -> ISO date "1994-01-06". Returns null on failure. */
function parseDob(v: unknown): string | null {
  const s = clean(v)
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  // Use UTC to avoid timezone slipping the day.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

/** Pick first non-blank phone in priority order. */
function pickPrimaryPhone(row: string[]): string | null {
  return (
    cleanPhone(row[COL.phone_mobile]) ||
    cleanPhone(row[COL.phone_home]) ||
    cleanPhone(row[COL.phone_work]) ||
    cleanPhone(row[COL.phone_office]) ||
    cleanPhone(row[COL.phone_other]) ||
    null
  )
}

/** Build the canonical contacts row from a CSV record. */
function csvRowToContact(row: string[]) {
  const first = clean(row[COL.first_name])
  const middle = clean(row[COL.middle_name])
  const last = clean(row[COL.last_name])

  const ssn = clean(row[COL.ssn])
  const ssnLast4 = ssn ? ssn.replace(/\D/g, "").slice(-4) || null : null

  const contactType = clean(row[COL.contact_type])
  const isProspect = contactType ? /prospect/i.test(contactType) : false

  // Custom fields go into a structured jsonb. We don't blindly merge raw
  // CSV labels into the column namespace.
  const customFields: Record<string, string> = {}
  const filing = clean(row[COL.filing_status])
  if (filing) customFields.filing_status = filing
  const refKey = clean(row[COL.cf_karbon_client_key])
  if (refKey) customFields.karbon_client_key_referral = refKey
  const refClient = clean(row[COL.cf_referral_client_id])
  if (refClient) customFields.referral_client_id = refClient
  const occCustom = clean(row[COL.cf_taxpayer_occupation])
  if (occCustom) customFields.taxpayer_occupation = occCustom
  const legal = clean(row[COL.legal_name])
  if (legal) customFields.legal_name = legal

  return {
    karbon_contact_key: clean(row[COL.karbon_id])!,
    first_name: first,
    middle_name: middle,
    last_name: last,
    preferred_name: clean(row[COL.preferred_name]),
    // full_name is a generated column in Postgres — DO NOT write to it.
    date_of_birth: parseDob(row[COL.date_of_birth]),
    contact_type: contactType,
    is_prospect: isProspect,
    restriction_level: clean(row[COL.privacy_level]),
    user_defined_identifier: clean(row[COL.client_identifier]),
    employer: clean(row[COL.organisation]),
    occupation: clean(row[COL.role]) || occCustom,
    primary_email: clean(row[COL.email])?.toLowerCase() || null,
    phone_work: cleanPhone(row[COL.phone_work]) || cleanPhone(row[COL.phone_office]),
    phone_mobile: cleanPhone(row[COL.phone_mobile]),
    phone_fax: cleanPhone(row[COL.phone_fax]),
    phone_primary: pickPrimaryPhone(row),
    address_line1: clean(row[COL.physical_lines]),
    city: clean(row[COL.physical_city]),
    state: clean(row[COL.physical_state]),
    zip_code: clean(row[COL.physical_zip]),
    country: clean(row[COL.physical_country]) || "US",
    mailing_address_line1: clean(row[COL.mailing_lines]),
    mailing_city: clean(row[COL.mailing_city]),
    mailing_state: clean(row[COL.mailing_state]),
    mailing_zip_code: clean(row[COL.mailing_zip]),
    mailing_country: clean(row[COL.mailing_country]),
    ssn_encrypted: ssn,
    ssn_last_four: ssnLast4,
    custom_fields: customFields,
    status: "active" as const,
    last_synced_at: new Date().toISOString(),
  }
}

type Contact = ReturnType<typeof csvRowToContact>

/** Compute the diff between an existing DB row and the CSV row. */
function diffForUpdate(db: Record<string, unknown>, csv: Contact): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  // Scalar string-ish fields. Karbon CSV value wins ONLY when non-empty.
  const stringFields: Array<keyof Contact> = [
    "first_name",
    "middle_name",
    "last_name",
    "preferred_name",
    // "full_name" is a Postgres generated column; never write.
    "contact_type",
    "restriction_level",
    "user_defined_identifier",
    "employer",
    "occupation",
    "primary_email",
    "phone_work",
    "phone_mobile",
    "phone_fax",
    "phone_primary",
    "address_line1",
    "city",
    "state",
    "zip_code",
    "country",
    "mailing_address_line1",
    "mailing_city",
    "mailing_state",
    "mailing_zip_code",
    "mailing_country",
    "ssn_encrypted",
    "ssn_last_four",
    "date_of_birth",
  ]
  for (const k of stringFields) {
    const csvVal = csv[k]
    const dbVal = db[k as string]
    if (csvVal !== null && csvVal !== undefined && csvVal !== "" && String(csvVal) !== String(dbVal ?? "")) {
      update[k as string] = csvVal
    }
  }
  // Booleans: only flip if CSV says prospect=true and DB says false (don't
  // demote a prospect to non-prospect just because Karbon trimmed the label).
  if (csv.is_prospect && !db.is_prospect) update.is_prospect = true

  // custom_fields: shallow-merge — never lose existing keys, but set new ones.
  const dbCf = (db.custom_fields ?? {}) as Record<string, unknown>
  const merged = { ...dbCf, ...csv.custom_fields }
  if (JSON.stringify(merged) !== JSON.stringify(dbCf)) update.custom_fields = merged

  // Status normalization: "Active" -> "active"
  if (typeof db.status === "string" && db.status !== db.status.toLowerCase()) {
    update.status = db.status.toLowerCase()
  }

  // If the row was previously archived but came back into the CSV, reactivate it.
  if (db.status === "archived") update.status = "active"

  // Always bump last_synced_at when we touch the row.
  if (Object.keys(update).length > 0) update.last_synced_at = csv.last_synced_at

  return update
}

// ---------- Main ----------

async function main() {
  const apply = process.argv.includes("--apply")
  const csvPath = resolve(__dirname, "data/karbon-contacts-2026-05-02.csv")

  const dbUrl = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || "").replace(
    /sslmode=require/,
    "sslmode=no-verify",
  )
  if (!dbUrl) throw new Error("POSTGRES_URL_NON_POOLING or POSTGRES_URL must be set")

  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  // ---- Parse CSV ----
  const raw = readFileSync(csvPath, "utf8")
  const allRows = parse(raw, { skip_empty_lines: false, relax_quotes: true, relax_column_count: true }) as string[][]
  // Skip 6-row preamble, drop empty-ID rows.
  const dataRows = allRows.slice(6).filter((r) => clean(r?.[COL.karbon_id]))
  const csvByKey = new Map<string, Contact>()
  for (const row of dataRows) {
    const c = csvRowToContact(row)
    if (csvByKey.has(c.karbon_contact_key)) {
      console.warn(`[v0] WARNING: duplicate Karbon ID in CSV: ${c.karbon_contact_key}`)
    }
    csvByKey.set(c.karbon_contact_key, c)
  }
  console.log(`Parsed ${csvByKey.size} unique contacts from CSV`)

  // ---- Fetch existing Supabase rows ----
  const existing = await client.query("SELECT * FROM contacts")
  const dbByKey = new Map<string, any>()
  const dbNoKey: any[] = []
  for (const r of existing.rows) {
    if (r.karbon_contact_key) dbByKey.set(r.karbon_contact_key, r)
    else dbNoKey.push(r)
  }
  console.log(`DB has ${existing.rows.length} contacts (${dbByKey.size} keyed, ${dbNoKey.length} unkeyed)`)

  // ---- Plan ----
  const toInsert: Contact[] = []
  const toUpdate: Array<{ id: string; key: string; diff: Record<string, unknown> }> = []
  const toArchive: any[] = []
  const toCleanupIdent: any[] = [] // strip "undefined_" prefix
  const toTrimAddress: any[] = [] // trim whitespace-padded addresses
  const toDeleteTest: any[] = [] // junk rows safe to hard-delete

  for (const [key, csv] of csvByKey) {
    const ex = dbByKey.get(key)
    if (!ex) {
      toInsert.push(csv)
    } else {
      const diff = diffForUpdate(ex, csv)
      if (Object.keys(diff).length > 0) toUpdate.push({ id: ex.id, key, diff })
    }
  }

  for (const [key, ex] of dbByKey) {
    if (!csvByKey.has(key) && ex.status !== "archived") toArchive.push(ex)
  }

  // Conservative cleanup pass over the entire DB (not just CSV-overlapping rows).
  for (const ex of existing.rows) {
    if (ex.user_defined_identifier && /^undefined_/i.test(ex.user_defined_identifier)) {
      toCleanupIdent.push(ex)
    }
    for (const f of ["address_line1", "mailing_address_line1"] as const) {
      const v = ex[f]
      if (typeof v === "string" && v !== v.trim()) {
        toTrimAddress.push({ id: ex.id, field: f, before: v, after: v.trim() })
      }
    }
    const fname = (ex.full_name || "").toLowerCase()
    const ident = (ex.user_defined_identifier || "").toLowerCase()
    if (
      /abctest/.test(fname) ||
      /abctest/.test(ident) ||
      fname.includes("(sample contact)") ||
      ident.includes("sample contact")
    ) {
      toDeleteTest.push(ex)
    }
  }

  // ---- Pre-flight: which test rows have inbound FK references? ----
  const fkTables = [
    "client_groups.primary_contact_id",
    "client_group_members.contact_id",
    "contact_organizations.contact_id",
    "work_items.contact_id",
    "time_entries.contact_id",
    "notes.contact_id",
    "meetings.contact_id",
    "meeting_attendees.contact_id",
    "documents.contact_id",
    "emails.contact_id",
    "tax_returns.contact_id",
    "leads.contact_id",
    "leads.referral_contact_id",
    "service_agreements.contact_id",
    "invoices.contact_id",
    "payments.contact_id",
    "recurring_revenue.contact_id",
    "debriefs.contact_id",
    "karbon_tasks.contact_id",
    "karbon_timesheets.contact_id",
    "karbon_notes.contact_id",
    "ignition_disbursals.contact_id",
    "ignition_payment_transactions.contact_id",
    "calendly_invitees.contact_id",
    "karbon_invoices.contact_id",
    "ignition_proposals.contact_id",
    "ignition_clients.contact_id",
    "ignition_invoices.contact_id",
    "ignition_payments.contact_id",
  ]
  const safeToDelete: any[] = []
  const archiveOnlyTest: any[] = []
  for (const ex of toDeleteTest) {
    let hasRefs = false
    for (const tc of fkTables) {
      const [t, c] = tc.split(".")
      const r = await client.query(`SELECT 1 FROM ${t} WHERE ${c} = $1 LIMIT 1`, [ex.id])
      if (r.rowCount && r.rowCount > 0) {
        hasRefs = true
        break
      }
    }
    if (hasRefs) archiveOnlyTest.push(ex)
    else safeToDelete.push(ex)
  }

  // ---- Report ----
  console.log("\n========== SCRUB PLAN ==========")
  console.log(`INSERT  net-new contacts:       ${toInsert.length}`)
  console.log(`UPDATE  existing contacts:      ${toUpdate.length}`)
  console.log(`ARCHIVE missing-from-CSV:       ${toArchive.length}`)
  console.log(`CLEAN   undefined_ identifiers: ${toCleanupIdent.length}`)
  console.log(`TRIM    padded address fields:  ${toTrimAddress.length}`)
  console.log(`DELETE  test rows (safe):       ${safeToDelete.length}`)
  console.log(`ARCHIVE test rows (FK-bound):   ${archiveOnlyTest.length}`)

  if (toInsert.length > 0) {
    console.log("\nSample inserts:")
    for (const c of toInsert.slice(0, 5)) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)"
      console.log(`  + ${c.karbon_contact_key}  ${name}  <${c.primary_email || "-"}>`)
    }
  }
  if (toArchive.length > 0) {
    console.log("\nSample archives:")
    for (const ex of toArchive.slice(0, 10))
      console.log(`  ! ${ex.karbon_contact_key}  ${ex.full_name}  <${ex.primary_email || "-"}>`)
  }
  if (toUpdate.length > 0) {
    console.log("\nSample updates (first 3):")
    for (const u of toUpdate.slice(0, 3)) console.log(`  ~ ${u.key}: ${Object.keys(u.diff).join(", ")}`)
  }
  if (toDeleteTest.length > 0) {
    console.log("\nTest rows:")
    for (const ex of toDeleteTest)
      console.log(`  ? ${ex.id}  ${ex.full_name}  ${ex.user_defined_identifier || ""}`)
  }

  if (!apply) {
    console.log("\n[dry-run] No writes performed. Re-run with --apply to commit.")
    await client.end()
    return
  }

  // ---- APPLY ----
  console.log("\n========== APPLYING ==========")
  await client.query("BEGIN")
  try {
    // 1. Inserts
    for (const c of toInsert) {
      const cols = Object.keys(c).filter((k) => c[k as keyof Contact] !== null && c[k as keyof Contact] !== undefined)
      const vals = cols.map((k) => {
        const v = c[k as keyof Contact]
        return k === "custom_fields" ? JSON.stringify(v) : v
      })
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ")
      await client.query(
        `INSERT INTO contacts (${cols.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (karbon_contact_key) DO NOTHING`,
        vals,
      )
    }
    console.log(`  inserted: ${toInsert.length}`)

    // 2. Updates
    let updated = 0
    for (const u of toUpdate) {
      const cols = Object.keys(u.diff)
      const vals = cols.map((k) => (k === "custom_fields" ? JSON.stringify(u.diff[k]) : u.diff[k]))
      const set = cols.map((k, i) => `${k} = $${i + 1}`).join(", ")
      await client.query(`UPDATE contacts SET ${set}, updated_at = NOW() WHERE id = $${cols.length + 1}`, [...vals, u.id])
      updated++
    }
    console.log(`  updated: ${updated}`)

    // 3. Archives
    if (toArchive.length > 0) {
      await client.query(
        `UPDATE contacts SET status = 'archived', updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [toArchive.map((r) => r.id)],
      )
      console.log(`  archived: ${toArchive.length}`)
    }

    // 4. Strip undefined_ prefix
    for (const ex of toCleanupIdent) {
      const cleaned = ex.user_defined_identifier.replace(/^undefined_/i, "") || null
      await client.query("UPDATE contacts SET user_defined_identifier = $1, updated_at = NOW() WHERE id = $2", [
        cleaned,
        ex.id,
      ])
    }
    console.log(`  cleaned undefined_ identifiers: ${toCleanupIdent.length}`)

    // 5. Trim padded addresses
    for (const t of toTrimAddress) {
      await client.query(`UPDATE contacts SET ${t.field} = $1, updated_at = NOW() WHERE id = $2`, [t.after, t.id])
    }
    console.log(`  trimmed addresses: ${toTrimAddress.length}`)

    // 6. Hard-delete test rows that have no FK refs
    if (safeToDelete.length > 0) {
      await client.query(`DELETE FROM contacts WHERE id = ANY($1::uuid[])`, [safeToDelete.map((r) => r.id)])
      console.log(`  deleted test rows: ${safeToDelete.length}`)
    }
    // 7. FK-bound test rows -> archived with marker
    if (archiveOnlyTest.length > 0) {
      await client.query(
        `UPDATE contacts SET status = 'archived',
                              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || '{"archived_reason":"test_row"}'::jsonb,
                              updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [archiveOnlyTest.map((r) => r.id)],
      )
      console.log(`  archived FK-bound test rows: ${archiveOnlyTest.length}`)
    }

    // 8. Normalize legacy 'Active' -> 'active' across the table
    const norm = await client.query(`UPDATE contacts SET status = 'active' WHERE status = 'Active'`)
    console.log(`  normalized 'Active' -> 'active': ${norm.rowCount}`)

    await client.query("COMMIT")
    console.log("\nCOMMIT successful.")
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("ROLLBACK due to error:", err)
    throw err
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
