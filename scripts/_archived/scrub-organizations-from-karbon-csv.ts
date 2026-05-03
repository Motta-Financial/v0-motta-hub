/**
 * Comprehensive scrub of public.organizations against a Karbon export CSV.
 *
 * Behavior (matches contacts scrub):
 *   1. INSERT every Karbon org that doesn't yet exist in Supabase.
 *   2. UPDATE existing rows: Karbon CSV wins for non-empty fields;
 *      empty CSV cells leave the existing Supabase value alone.
 *   3. ARCHIVE (status='archived') any org in Supabase whose Karbon ID is
 *      no longer in the CSV. Does NOT delete — 23 tables FK to organizations.
 *   4. Hard-delete obvious test rows ("abctest", "testgrace", "(Sample ...)")
 *      ONLY when they have zero inbound FK references.
 *   5. Normalize whitespace-padded address columns and "Active" -> "active"
 *      legacy status values.
 *
 * Run dry-run first (default):
 *   pnpm tsx scripts/scrub-organizations-from-karbon-csv.ts
 * Apply (transactional, ROLLBACK on any error):
 *   pnpm tsx scripts/scrub-organizations-from-karbon-csv.ts --apply
 */
import { parse } from "csv-parse/sync"
import * as fs from "node:fs"
import * as path from "node:path"
import { Client } from "pg"

// ----- CSV column index mapping (37 cols, two-row header rows 0-5) -------
// Confirmed by inspecting Karbon_Organizations_5.2.2026.csv top header + sub-header:
const COL = {
  karbon_organization_key: 0,
  name: 1,
  legal_name: 2,
  entity_type: 3,
  contact_type: 4,
  privacy_level: 5, // restriction_level
  client_identifier: 6, // user_defined_identifier
  client_owner_name: 7,
  client_manager_name: 8,
  fiscal_year_end_day: 9,
  fiscal_year_end_month: 10,
  primary_email: 11,
  additional_emails_flag: 12,
  phone_work: 13,
  phone_office: 14,
  phone_fax: 15,
  phone_mobile: 16,
  phone_home: 17,
  phone_other: 18,
  additional_phones_flag: 19,
  physical_lines: 20,
  physical_city: 21,
  physical_state: 22,
  physical_zip: 23,
  physical_country: 24,
  additional_physical_flag: 25,
  mailing_lines: 26,
  mailing_city: 27,
  mailing_state: 28,
  mailing_zip: 29,
  mailing_country: 30,
  additional_mailing_flag: 31,
  ein: 32,
  ssn: 33, // present on org rows for sole-prop linkage; surfaces in a custom field
  karbon_client_key: 34,
  referral_client_id: 35,
  rn: 36,
}

const CSV_PATH = path.resolve(process.cwd(), "scripts/data/karbon-organizations-2026-05-02.csv")
const APPLY = process.argv.includes("--apply")

// Fields where empty Karbon CSV values must NOT null-out Supabase. Per the
// chosen strategy: "Karbon CSV wins for non-empty fields".
const KEEP_EMPTY_DB_FIELDS = new Set<string>([
  "primary_email",
  "phone",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "zip_code",
  "country",
  "ein",
  "legal_name",
  "entity_type",
  "contact_type",
  "user_defined_identifier",
  "fiscal_year_end_day",
  "fiscal_year_end_month",
  "restriction_level",
])

type Org = {
  karbon_organization_key: string
  name: string
  legal_name: string | null
  entity_type: string | null
  contact_type: string | null
  restriction_level: string | null
  user_defined_identifier: string | null
  fiscal_year_end_day: number | null
  fiscal_year_end_month: number | null
  primary_email: string | null
  phone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  ein: string | null
  custom_fields: Record<string, unknown>
}

function clean(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null
  const t = String(v).replace(/\s+/g, " ").trim()
  return t.length === 0 ? null : t
}

function cleanAddress(v: string | undefined | null): string | null {
  // Karbon export pads many address cells with trailing spaces; collapse them.
  if (!v) return null
  const t = String(v).trim().replace(/[\u00A0\s]+$/g, "").replace(/^\s+/, "")
  return t.length === 0 ? null : t
}

function cleanPhone(v: string | undefined | null): string | null {
  // Strip the "US|" prefix Karbon exports add.
  const t = clean(v)
  if (!t) return null
  return t.replace(/^US\|/, "").trim() || null
}

function pickFirstPhone(row: string[]): string | null {
  for (const idx of [
    COL.phone_work,
    COL.phone_office,
    COL.phone_mobile,
    COL.phone_other,
    COL.phone_home,
    COL.phone_fax,
  ]) {
    const p = cleanPhone(row[idx])
    if (p) return p
  }
  return null
}

function parseInt0(v: string | undefined | null): number | null {
  const t = clean(v)
  if (!t) return null
  const n = Number.parseInt(t, 10)
  return Number.isFinite(n) ? n : null
}

function isJunkName(name: string | null): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  return n === "abctest" || n === "testgrace" || n.includes("(sample contact)") || n.includes("(sample organization)")
}

function csvRowToOrg(row: string[]): Org | null {
  const key = clean(row[COL.karbon_organization_key])
  const name = clean(row[COL.name])
  if (!key || !name) return null

  // Build address line from the (multi-segment) "Lines" cell, normalizing
  // commas and whitespace. Karbon's export collapses everything to one cell.
  const physicalLines = cleanAddress(row[COL.physical_lines])
  const mailingLines = cleanAddress(row[COL.mailing_lines])

  // Custom fields bag. We surface SSN (rare on orgs), referral linkage,
  // contact owner / manager names, and Karbon Client Key from the CSV.
  const customFields: Record<string, unknown> = {}
  const ssn = clean(row[COL.ssn])
  if (ssn) customFields.ssn = ssn
  const ownerName = clean(row[COL.client_owner_name])
  if (ownerName) customFields.client_owner_name = ownerName
  const managerName = clean(row[COL.client_manager_name])
  if (managerName) customFields.client_manager_name = managerName
  const karbonClientKey = clean(row[COL.karbon_client_key])
  if (karbonClientKey) customFields.karbon_client_key = karbonClientKey
  const referral = clean(row[COL.referral_client_id])
  if (referral) customFields.referral_client_id = referral

  return {
    karbon_organization_key: key,
    name,
    legal_name: clean(row[COL.legal_name]),
    entity_type: clean(row[COL.entity_type]),
    contact_type: clean(row[COL.contact_type]),
    restriction_level: clean(row[COL.privacy_level]),
    user_defined_identifier: clean(row[COL.client_identifier]),
    fiscal_year_end_day: parseInt0(row[COL.fiscal_year_end_day]),
    fiscal_year_end_month: parseInt0(row[COL.fiscal_year_end_month]),
    primary_email: clean(row[COL.primary_email])?.toLowerCase() ?? null,
    phone: pickFirstPhone(row),
    address_line1: physicalLines || mailingLines,
    city: cleanAddress(row[COL.physical_city]) || cleanAddress(row[COL.mailing_city]),
    state: cleanAddress(row[COL.physical_state]) || cleanAddress(row[COL.mailing_state]),
    zip_code: cleanAddress(row[COL.physical_zip]) || cleanAddress(row[COL.mailing_zip]),
    country: cleanAddress(row[COL.physical_country]) || cleanAddress(row[COL.mailing_country]),
    ein: clean(row[COL.ein]),
    custom_fields: customFields,
  }
}

function diffForUpdate(existing: any, fresh: Org): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  const fields: Array<keyof Org> = [
    "name",
    "legal_name",
    "entity_type",
    "contact_type",
    "restriction_level",
    "user_defined_identifier",
    "fiscal_year_end_day",
    "fiscal_year_end_month",
    "primary_email",
    "phone",
    "address_line1",
    "city",
    "state",
    "zip_code",
    "country",
    "ein",
  ]
  for (const f of fields) {
    const newVal = fresh[f]
    const oldVal = existing[f]
    if (newVal === null || newVal === undefined || newVal === "") {
      if (KEEP_EMPTY_DB_FIELDS.has(f as string)) continue
      if (oldVal !== null && oldVal !== undefined) updates[f as string] = null
    } else if (String(newVal).trim() !== String(oldVal ?? "").trim()) {
      updates[f as string] = newVal
    }
  }
  // Merge custom_fields: Karbon-CSV wins for keys it provides; existing
  // keys not in the CSV are preserved.
  const existingCf = (existing.custom_fields && typeof existing.custom_fields === "object")
    ? existing.custom_fields
    : {}
  const mergedCf = { ...existingCf, ...fresh.custom_fields }
  if (JSON.stringify(mergedCf) !== JSON.stringify(existingCf)) {
    updates.custom_fields = mergedCf
  }
  return updates
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`)
    process.exit(1)
  }
  const raw = fs.readFileSync(CSV_PATH, "utf8")
  const rows: string[][] = parse(raw, { skip_empty_lines: false, relax_quotes: true, relax_column_count: true })
  // Karbon exports vary in preamble row count (orgs: 3, contacts: 6) because
  // the multi-line header cells collapse differently. Auto-detect the first
  // real data row by looking for a Karbon-style alphanumeric key in col 0.
  let firstDataRow = -1
  for (let i = 0; i < rows.length; i++) {
    const c0 = (rows[i][0] || "").trim()
    if (c0 && /^[A-Za-z0-9]{6,}$/.test(c0) && !/^[A-Z\s]+$/.test(c0)) {
      firstDataRow = i
      break
    }
  }
  if (firstDataRow < 0) {
    console.error("Could not locate first data row in CSV")
    process.exit(1)
  }
  console.log(`First data row detected at index ${firstDataRow}`)
  const dataRows = rows.slice(firstDataRow).filter((r) => (r[COL.karbon_organization_key] || "").trim().length > 0)

  const csvOrgs = new Map<string, Org>()
  for (const r of dataRows) {
    const o = csvRowToOrg(r)
    if (o) csvOrgs.set(o.karbon_organization_key, o)
  }
  console.log(`CSV: ${dataRows.length} data rows, ${csvOrgs.size} unique organizations`)

  const url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || "").replace(
    /sslmode=require/,
    "sslmode=no-verify",
  )
  if (!url) {
    console.error("POSTGRES_URL_NON_POOLING is required")
    process.exit(1)
  }
  const c = new Client({ connectionString: url })
  await c.connect()

  const dbResult = await c.query(
    "SELECT id, karbon_organization_key, name, status, custom_fields, " +
      "legal_name, entity_type, contact_type, restriction_level, user_defined_identifier, " +
      "fiscal_year_end_day, fiscal_year_end_month, primary_email, phone, " +
      "address_line1, city, state, zip_code, country, ein " +
      "FROM organizations",
  )
  const dbByKey = new Map<string, any>()
  for (const row of dbResult.rows) {
    if (row.karbon_organization_key) dbByKey.set(row.karbon_organization_key, row)
  }
  console.log(`DB: ${dbResult.rows.length} organizations (with karbon key: ${dbByKey.size})`)

  // ---- diff ----
  const toInsert: Org[] = []
  const toUpdate: Array<{ id: string; key: string; updates: Record<string, unknown> }> = []
  for (const [key, fresh] of csvOrgs) {
    const existing = dbByKey.get(key)
    if (!existing) {
      toInsert.push(fresh)
    } else {
      const updates = diffForUpdate(existing, fresh)
      // Reactivate if previously archived but reappeared in CSV
      if (existing.status && existing.status !== "active") updates.status = "active"
      if (Object.keys(updates).length) toUpdate.push({ id: existing.id, key, updates })
    }
  }
  const toArchive: string[] = []
  for (const [key, row] of dbByKey) {
    if (!csvOrgs.has(key) && row.status === "active") toArchive.push(row.id)
  }

  // ---- junk cleanup candidates ----
  const junkResult = await c.query(
    "SELECT id, karbon_organization_key, name FROM organizations WHERE LOWER(name) IN ('abctest', 'testgrace') OR name ILIKE '%(Sample Contact)%' OR name ILIKE '%(Sample Organization)%'",
  )
  const fkTables = [
    "contact_organizations",
    "work_items",
    "time_entries",
    "notes",
    "meetings",
    "documents",
    "emails",
    "tax_returns",
    "leads",
    "service_agreements",
    "invoices",
    "payments",
    "recurring_revenue",
    "debriefs",
    "karbon_tasks",
    "karbon_timesheets",
    "karbon_notes",
    "ignition_disbursals",
    "ignition_payment_transactions",
    "karbon_invoices",
    "ignition_proposals",
    "ignition_clients",
    "ignition_invoices",
    "ignition_payments",
  ]
  const junkSafe: Array<{ id: string; name: string }> = []
  const junkUnsafe: Array<{ id: string; name: string; refs: string[] }> = []
  for (const j of junkResult.rows) {
    const refs: string[] = []
    for (const t of fkTables) {
      const r = await c.query(`SELECT 1 FROM ${t} WHERE organization_id = $1 LIMIT 1`, [j.id])
      if (r.rowCount) refs.push(t)
    }
    if (refs.length === 0) junkSafe.push({ id: j.id, name: j.name })
    else junkUnsafe.push({ id: j.id, name: j.name, refs })
  }

  // ---- whitespace normalization candidates ----
  const wsResult = await c.query(
    "SELECT id FROM organizations WHERE address_line1 IS NOT NULL AND address_line1 <> trim(address_line1) " +
      "OR city IS NOT NULL AND city <> trim(city) " +
      "OR state IS NOT NULL AND state <> trim(state)",
  )

  console.log("")
  console.log("=== PLAN ===")
  console.log(`  INSERT (net-new from Karbon):           ${toInsert.length}`)
  console.log(`  UPDATE (existing, CSV-wins non-empty):  ${toUpdate.length}`)
  console.log(`  ARCHIVE (in DB, missing from CSV):      ${toArchive.length}`)
  console.log(`  HARD-DELETE (junk w/ no FK refs):       ${junkSafe.length}`)
  console.log(`  KEEP   (junk WITH FK refs):             ${junkUnsafe.length}`)
  console.log(`  TRIM   (whitespace-padded fields):      ${wsResult.rowCount}`)
  console.log("")

  if (toInsert.length) {
    console.log("Sample inserts:")
    for (const o of toInsert.slice(0, 5)) {
      console.log(`  + ${o.karbon_organization_key}  ${o.name}  <${o.primary_email || "-"}>`)
    }
  }
  if (toUpdate.length) {
    console.log("Sample updates:")
    for (const u of toUpdate.slice(0, 5)) {
      console.log(`  ~ ${u.key}  fields=${Object.keys(u.updates).join(",")}`)
    }
  }
  if (toArchive.length) {
    const sample = await c.query("SELECT karbon_organization_key, name FROM organizations WHERE id = ANY($1) LIMIT 5", [
      toArchive,
    ])
    console.log("Sample archives:")
    for (const r of sample.rows) console.log(`  ! ${r.karbon_organization_key}  ${r.name}`)
  }
  if (junkSafe.length) {
    console.log("Junk to hard-delete:")
    for (const j of junkSafe) console.log(`  x ${j.id}  ${j.name}`)
  }
  if (junkUnsafe.length) {
    console.log("Junk SKIPPED (has FK refs):")
    for (const j of junkUnsafe) console.log(`  ? ${j.id}  ${j.name}  refs=[${j.refs.join(",")}]`)
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit changes.")
    await c.end()
    return
  }

  // ---- apply, transactional ----
  console.log("\nApplying changes inside a transaction…")
  await c.query("BEGIN")
  try {
    let inserted = 0
    for (const o of toInsert) {
      await c.query(
        `INSERT INTO organizations
         (karbon_organization_key, name, legal_name, entity_type, contact_type, restriction_level,
          user_defined_identifier, fiscal_year_end_day, fiscal_year_end_month, primary_email, phone,
          address_line1, city, state, zip_code, country, ein, custom_fields, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'active')
         ON CONFLICT (karbon_organization_key) DO NOTHING`,
        [
          o.karbon_organization_key,
          o.name,
          o.legal_name,
          o.entity_type,
          o.contact_type,
          o.restriction_level,
          o.user_defined_identifier,
          o.fiscal_year_end_day,
          o.fiscal_year_end_month,
          o.primary_email,
          o.phone,
          o.address_line1,
          o.city,
          o.state,
          o.zip_code,
          o.country,
          o.ein,
          o.custom_fields,
        ],
      )
      inserted++
    }
    console.log(`  INSERT: ${inserted}`)

    let updated = 0
    for (const u of toUpdate) {
      const cols = Object.keys(u.updates)
      const sets = cols.map((c, i) => `${c} = $${i + 1}`)
      const vals = cols.map((c) => (c === "custom_fields" ? u.updates[c] : (u.updates[c] as any)))
      vals.push(u.id)
      await c.query(`UPDATE organizations SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length}`, vals)
      updated++
    }
    console.log(`  UPDATE: ${updated}`)

    if (toArchive.length) {
      const r = await c.query(
        "UPDATE organizations SET status = 'archived', updated_at = NOW() WHERE id = ANY($1)",
        [toArchive],
      )
      console.log(`  ARCHIVE: ${r.rowCount}`)
    }

    if (junkSafe.length) {
      const r = await c.query("DELETE FROM organizations WHERE id = ANY($1)", [junkSafe.map((j) => j.id)])
      console.log(`  DELETE (junk no-FK): ${r.rowCount}`)
    }

    if (wsResult.rowCount) {
      const r = await c.query(
        "UPDATE organizations SET address_line1 = trim(address_line1), city = trim(city), state = trim(state), updated_at = NOW() " +
          "WHERE address_line1 IS NOT NULL AND address_line1 <> trim(address_line1) " +
          "OR city IS NOT NULL AND city <> trim(city) " +
          "OR state IS NOT NULL AND state <> trim(state)",
      )
      console.log(`  TRIM whitespace: ${r.rowCount}`)
    }

    await c.query("COMMIT")
    console.log("\nCommitted.")
  } catch (err) {
    await c.query("ROLLBACK")
    console.error("ROLLED BACK:", err instanceof Error ? err.message : err)
    process.exit(1)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
