/**
 * scrub-work-items-from-karbon-csv.ts
 *
 * Comprehensive reconciliation of public.work_items against a Karbon "Work
 * Export" CSV. Mirrors the contacts and organizations scrub scripts.
 *
 * What it does
 * ------------
 * • Normalizes the CSV's 58+ granular statuses into 3 fields:
 *     status            (high-level: Completed / In Progress / Ready To Start / Planned / Waiting)
 *     secondary_status  (suffix after the first " - ", e.g. "COMPLETE | Filed & Billed")
 *     workflow_status   (full original CSV text)
 * • Resolves Client ID -> contact_id / organization_id by `user_defined_identifier`
 *   (UDIs are unique on both tables, so a single lookup map is safe).
 * • INSERTS work items from the CSV that don't yet exist in Supabase.
 * • UPDATES every common row using "Karbon CSV wins on non-empty" — never
 *   nulls out enriched Supabase data.
 * • SOFT-ARCHIVES rows in DB-but-not-CSV by stamping `deleted_in_karbon_at`
 *   (existing convention already used by 115 rows). Reversible — comes back
 *   to NULL automatically if the row reappears in a future CSV.
 *
 * Usage
 * -----
 *   pnpm tsx scripts/scrub-work-items-from-karbon-csv.ts            # dry run
 *   pnpm tsx scripts/scrub-work-items-from-karbon-csv.ts --apply    # commit
 */
import { parse } from "csv-parse/sync"
import { readFileSync } from "fs"
import { Client } from "pg"

const CSV_PATH = "scripts/data/karbon-work-items-2026-05-02.csv"
const APPLY = process.argv.includes("--apply")

const KARBON_FIRM_ID = "4mTyp9lLRWTC"
const buildKarbonUrl = (key: string) => `https://app2.karbonhq.com/${KARBON_FIRM_ID}#/work/${key}`

// CSV column indexes (matches the export header row)
const COL = {
  key: 0,
  title: 1,
  client_name: 2,
  client_id: 3,
  work_type: 4,
  status: 5,
  start_date: 6,
  due_date: 7,
  deadline_date: 8,
  last_status_change: 9,
  repeat_frequency: 10,
  completed_date: 11,
  budget_minutes: 12,
  budget_usd: 13,
  actual_minutes: 14,
  actual_usd: 15,
  budget_remaining_min: 16,
  budget_remaining_usd: 17,
  fee_type: 18,
  fee_usd: 19,
  assignee: 20,
  client_owner: 21,
  client_manager: 22,
  client_group: 23,
  planned_week: 24,
  progress: 25,
} as const

// ---------- helpers --------------------------------------------------------

const clean = (v: any): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length === 0 ? null : s
}

const cleanLower = (v: any): string | null => {
  const c = clean(v)
  return c ? c.toLowerCase() : null
}

const parseInteger = (v: any): number | null => {
  const c = clean(v)
  if (!c) return null
  const n = Number.parseInt(c.replace(/,/g, ""), 10)
  return Number.isFinite(n) ? n : null
}

const parseMoney = (v: any): number | null => {
  const c = clean(v)
  if (!c) return null
  const n = Number.parseFloat(c.replace(/[$,]/g, ""))
  return Number.isFinite(n) ? n : null
}

/**
 * Parse Karbon's date strings, which come in two flavours:
 *   "May 05, 2025"          (date-only fields)
 *   "May 05, 2025 04:28"    (UTC timestamp fields)
 * Returns ISO date (YYYY-MM-DD) for date-only, or full ISO for timestamps.
 */
const parseKarbonDate = (v: any): string | null => {
  const c = clean(v)
  if (!c) return null
  const d = new Date(c)
  if (Number.isNaN(d.getTime())) return null
  // If the original had a time component, return full ISO; otherwise date-only.
  return /\d{1,2}:\d{2}/.test(c) ? d.toISOString() : d.toISOString().slice(0, 10)
}

const parseKarbonDateOnly = (v: any): string | null => {
  const c = clean(v)
  if (!c) return null
  const d = new Date(c)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * Split CSV's granular "Status" into (status, secondary_status, workflow_status).
 * Examples:
 *   "Completed"                              -> {status:"Completed", secondary:null, workflow:"Completed"}
 *   "Completed - Lost - Ghosted"             -> {status:"Completed", secondary:"Lost - Ghosted", workflow:"Completed - Lost - Ghosted"}
 *   "In Progress - COMPLETE | Filed & Billed"-> {status:"In Progress", secondary:"COMPLETE | Filed & Billed", workflow:"In Progress - COMPLETE | Filed & Billed"}
 *   "Ready To Start - Prospect"              -> {status:"Ready To Start", secondary:"Prospect", workflow:"Ready To Start - Prospect"}
 */
function splitStatus(raw: string | null): {
  status: string | null
  secondary_status: string | null
  workflow_status: string | null
} {
  if (!raw) return { status: null, secondary_status: null, workflow_status: null }
  const HIGH_LEVEL = ["Completed", "In Progress", "Ready To Start", "Planned", "Waiting"] as const
  for (const top of HIGH_LEVEL) {
    if (raw === top) return { status: top, secondary_status: null, workflow_status: raw }
    if (raw.startsWith(`${top} - `)) {
      return { status: top, secondary_status: raw.slice(top.length + 3).trim() || null, workflow_status: raw }
    }
  }
  // Fallback: keep the raw value in all three fields if we don't recognise it.
  return { status: raw, secondary_status: null, workflow_status: raw }
}

type WorkItem = {
  karbon_work_item_key: string
  title: string
  work_type: string | null
  status: string | null
  secondary_status: string | null
  workflow_status: string | null
  start_date: string | null
  due_date: string | null
  completed_date: string | null
  karbon_modified_at: string | null
  fee_type: string | null
  fixed_fee_amount: number | null
  budget_minutes: number | null
  budget_amount: number | null
  actual_minutes: number | null
  actual_amount: number | null
  is_recurring: boolean
  assignee_name: string | null
  client_owner_name: string | null
  client_manager_name: string | null
  client_group_name: string | null
  client_name: string | null
  user_defined_identifier: string | null
  contact_id: string | null
  organization_id: string | null
  karbon_url: string
  custom_fields: Record<string, any>
  deleted_in_karbon_at: null
}

function csvRowToWorkItem(
  row: string[],
  orgByUdi: Map<string, string>,
  contactByUdi: Map<string, string>,
): WorkItem | null {
  const key = clean(row[COL.key])
  if (!key) return null

  const title = clean(row[COL.title]) || `Work Item ${key}`
  const clientId = clean(row[COL.client_id])
  const repeatFreq = clean(row[COL.repeat_frequency])
  const feeType = clean(row[COL.fee_type])
  const fee = parseMoney(row[COL.fee_usd])
  const status = splitStatus(clean(row[COL.status]))

  // Org takes precedence; fall back to contact only if no org match (Karbon
  // exports use the same UDI namespace for both, but most prefixes are orgs).
  const udi = clientId || null
  const organizationId = udi ? orgByUdi.get(udi) || null : null
  const contactId = !organizationId && udi ? contactByUdi.get(udi) || null : null

  // Capture export-only values that don't have a dedicated column.
  const customFields: Record<string, any> = {}
  const plannedWeek = clean(row[COL.planned_week])
  const progress = parseInteger(row[COL.progress])
  const deadline = parseKarbonDateOnly(row[COL.deadline_date])
  const budgetRemainingMin = parseInteger(row[COL.budget_remaining_min])
  const budgetRemainingUsd = parseMoney(row[COL.budget_remaining_usd])
  if (plannedWeek) customFields.planned_week = plannedWeek
  if (progress !== null) customFields.progress_pct = progress
  if (repeatFreq) customFields.repeat_frequency = repeatFreq
  if (deadline) customFields.deadline_date = deadline
  if (budgetRemainingMin !== null) customFields.budget_remaining_minutes = budgetRemainingMin
  if (budgetRemainingUsd !== null) customFields.budget_remaining_usd = budgetRemainingUsd

  return {
    karbon_work_item_key: key,
    title,
    work_type: clean(row[COL.work_type]),
    status: status.status,
    secondary_status: status.secondary_status,
    workflow_status: status.workflow_status,
    start_date: parseKarbonDateOnly(row[COL.start_date]),
    due_date: parseKarbonDateOnly(row[COL.due_date]),
    completed_date: parseKarbonDate(row[COL.completed_date]),
    karbon_modified_at: parseKarbonDate(row[COL.last_status_change]),
    fee_type: feeType,
    // Only set fixed_fee_amount when fee type is Fixed Fee — T&M rows have
    // a placeholder "0" fee that would otherwise pollute the column.
    fixed_fee_amount: feeType === "Fixed Fee" && fee && fee > 0 ? fee : null,
    budget_minutes: parseInteger(row[COL.budget_minutes]),
    budget_amount: parseMoney(row[COL.budget_usd]),
    actual_minutes: parseInteger(row[COL.actual_minutes]),
    actual_amount: parseMoney(row[COL.actual_usd]),
    is_recurring: Boolean(repeatFreq),
    assignee_name: clean(row[COL.assignee]),
    client_owner_name: clean(row[COL.client_owner]),
    client_manager_name: clean(row[COL.client_manager]),
    client_group_name: clean(row[COL.client_group]),
    client_name: clean(row[COL.client_name]),
    user_defined_identifier: udi,
    contact_id: contactId,
    organization_id: organizationId,
    karbon_url: buildKarbonUrl(key),
    custom_fields: customFields,
    // If the work item is in the CSV, it is NOT deleted in Karbon. We always
    // un-archive on update so a previously archived row reappears cleanly.
    deleted_in_karbon_at: null,
  }
}

// ---------- diff -----------------------------------------------------------

type ExistingRow = Record<string, any> & { id: string }

const SCALAR_FIELDS = [
  "title",
  "work_type",
  "status",
  "secondary_status",
  "workflow_status",
  "start_date",
  "due_date",
  "completed_date",
  "karbon_modified_at",
  "fee_type",
  "fixed_fee_amount",
  "budget_minutes",
  "budget_amount",
  "actual_minutes",
  "actual_amount",
  "assignee_name",
  "client_owner_name",
  "client_manager_name",
  "client_group_name",
  "client_name",
  "user_defined_identifier",
  "karbon_url",
] as const

/** Karbon-CSV-wins-on-non-empty merge logic (matches the contacts/orgs scrub). */
function diffForUpdate(existing: ExistingRow, incoming: WorkItem): Record<string, any> | null {
  const changes: Record<string, any> = {}

  for (const k of SCALAR_FIELDS) {
    const incVal = (incoming as any)[k]
    if (incVal === null || incVal === undefined || incVal === "") continue
    const cur = existing[k]
    if (cur === incVal) continue
    if (cur instanceof Date && incVal && new Date(incVal as any).toISOString() === cur.toISOString()) continue
    changes[k] = incVal
  }

  // Boolean — only set if previously NULL or different. Because is_recurring
  // is NOT NULL in the schema with default false, "different" is the only
  // signal. CSV is the source of truth here.
  if (existing.is_recurring !== incoming.is_recurring) changes.is_recurring = incoming.is_recurring

  // Foreign keys — only fill if the existing row has none (Supabase wins on
  // pre-existing FKs because we may have done manual reassignment).
  if (!existing.contact_id && incoming.contact_id) changes.contact_id = incoming.contact_id
  if (!existing.organization_id && incoming.organization_id) changes.organization_id = incoming.organization_id

  // Custom fields — merge incoming over existing without dropping keys we
  // didn't touch (notes, attachments, etc. stored elsewhere).
  if (Object.keys(incoming.custom_fields).length > 0) {
    const merged = { ...(existing.custom_fields || {}), ...incoming.custom_fields }
    if (JSON.stringify(merged) !== JSON.stringify(existing.custom_fields || {})) {
      changes.custom_fields = merged
    }
  }

  // Un-archive: if the row was archived but is now back in the CSV, clear it.
  if (existing.deleted_in_karbon_at !== null) changes.deleted_in_karbon_at = null

  return Object.keys(changes).length === 0 ? null : changes
}

// ---------- main -----------------------------------------------------------

;(async () => {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Reading ${CSV_PATH}…`)
  const raw = readFileSync(CSV_PATH, "utf8")
  const rows: string[][] = parse(raw, { skip_empty_lines: true, relax_quotes: true, relax_column_count: true })
  // Single header row for work-export CSVs.
  const dataRows = rows.slice(1).filter((r) => clean(r[COL.key]))

  const url = (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || "").replace(
    /sslmode=require/,
    "sslmode=no-verify",
  )
  if (!url) throw new Error("POSTGRES_URL is not set")
  const pg = new Client({ connectionString: url })
  await pg.connect()

  // Build one-shot UDI -> id maps for organizations and contacts so we can
  // resolve Client ID without N+1 lookups during the row loop.
  const orgRes = await pg.query<{ id: string; user_defined_identifier: string }>(
    "SELECT id, user_defined_identifier FROM organizations WHERE user_defined_identifier IS NOT NULL",
  )
  const orgByUdi = new Map(orgRes.rows.map((r) => [r.user_defined_identifier, r.id]))
  const contactRes = await pg.query<{ id: string; user_defined_identifier: string }>(
    "SELECT id, user_defined_identifier FROM contacts WHERE user_defined_identifier IS NOT NULL",
  )
  const contactByUdi = new Map(contactRes.rows.map((r) => [r.user_defined_identifier, r.id]))
  console.log(`Loaded ${orgByUdi.size} org UDIs and ${contactByUdi.size} contact UDIs`)

  // Map CSV
  const incomingByKey = new Map<string, WorkItem>()
  let unmappableRows = 0
  for (const r of dataRows) {
    const wi = csvRowToWorkItem(r, orgByUdi, contactByUdi)
    if (!wi) {
      unmappableRows++
      continue
    }
    incomingByKey.set(wi.karbon_work_item_key, wi)
  }
  console.log(`CSV: ${incomingByKey.size} unique work items (${unmappableRows} unmappable rows skipped)`)

  // Load existing
  const existingRes = await pg.query<ExistingRow>(
    `SELECT id, karbon_work_item_key, title, work_type, status, secondary_status, workflow_status,
            start_date, due_date, completed_date, karbon_modified_at, fee_type, fixed_fee_amount,
            budget_minutes, budget_amount, actual_minutes, actual_amount, is_recurring,
            assignee_name, client_owner_name, client_manager_name, client_group_name,
            client_name, user_defined_identifier, karbon_url, contact_id, organization_id,
            custom_fields, deleted_in_karbon_at
     FROM work_items
     WHERE karbon_work_item_key IS NOT NULL`,
  )
  const existingByKey = new Map(existingRes.rows.map((r) => [r.karbon_work_item_key, r]))
  console.log(`DB:  ${existingByKey.size} existing work items`)

  // Compute work
  const toInsert: WorkItem[] = []
  const toUpdate: { id: string; key: string; changes: Record<string, any> }[] = []
  const toArchive: { id: string; key: string; title: string }[] = []
  const toUnarchive: { id: string; key: string }[] = []

  for (const [key, wi] of incomingByKey) {
    const existing = existingByKey.get(key)
    if (!existing) {
      toInsert.push(wi)
      continue
    }
    const changes = diffForUpdate(existing, wi)
    if (changes) {
      toUpdate.push({ id: existing.id, key, changes })
      if (existing.deleted_in_karbon_at !== null && changes.deleted_in_karbon_at === null) {
        toUnarchive.push({ id: existing.id, key })
      }
    }
  }
  for (const [key, existing] of existingByKey) {
    if (!incomingByKey.has(key) && existing.deleted_in_karbon_at === null) {
      toArchive.push({ id: existing.id, key, title: existing.title })
    }
  }

  console.log("\nDiff plan:")
  console.log(`  INSERT:    ${toInsert.length}`)
  console.log(`  UPDATE:    ${toUpdate.length}`)
  console.log(`  UNARCHIVE: ${toUnarchive.length}  (subset of UPDATE)`)
  console.log(`  ARCHIVE:   ${toArchive.length}`)

  if (toInsert.length > 0) {
    console.log("\nSample inserts:")
    for (const wi of toInsert.slice(0, 5)) console.log(`  + ${wi.karbon_work_item_key}  ${wi.title.slice(0, 70)}`)
  }
  if (toUpdate.length > 0) {
    console.log("\nSample updates (top 5 by # of changed fields):")
    const sorted = [...toUpdate].sort((a, b) => Object.keys(b.changes).length - Object.keys(a.changes).length)
    for (const u of sorted.slice(0, 5)) {
      console.log(`  ~ ${u.key}: ${Object.keys(u.changes).length} fields -> ${Object.keys(u.changes).join(", ")}`)
    }
  }
  if (toArchive.length > 0) {
    console.log("\nSample archives:")
    for (const a of toArchive.slice(0, 5)) console.log(`  x ${a.key}  ${a.title.slice(0, 70)}`)
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to commit.")
    await pg.end()
    return
  }

  console.log("\nApplying inside a single transaction…")
  await pg.query("BEGIN")
  try {
    // INSERT
    for (const wi of toInsert) {
      await pg.query(
        `INSERT INTO work_items (
           karbon_work_item_key, title, work_type, status, secondary_status, workflow_status,
           start_date, due_date, completed_date, karbon_modified_at, fee_type, fixed_fee_amount,
           budget_minutes, budget_amount, actual_minutes, actual_amount, is_recurring,
           assignee_name, client_owner_name, client_manager_name, client_group_name,
           client_name, user_defined_identifier, karbon_url, contact_id, organization_id,
           custom_fields, last_synced_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW()
         ) ON CONFLICT (karbon_work_item_key) DO NOTHING`,
        [
          wi.karbon_work_item_key,
          wi.title,
          wi.work_type,
          wi.status,
          wi.secondary_status,
          wi.workflow_status,
          wi.start_date,
          wi.due_date,
          wi.completed_date,
          wi.karbon_modified_at,
          wi.fee_type,
          wi.fixed_fee_amount,
          wi.budget_minutes,
          wi.budget_amount,
          wi.actual_minutes,
          wi.actual_amount,
          wi.is_recurring,
          wi.assignee_name,
          wi.client_owner_name,
          wi.client_manager_name,
          wi.client_group_name,
          wi.client_name,
          wi.user_defined_identifier,
          wi.karbon_url,
          wi.contact_id,
          wi.organization_id,
          wi.custom_fields,
        ],
      )
    }

    // UPDATE — build dynamic SET clause per row to avoid touching unchanged fields.
    for (const u of toUpdate) {
      const cols = Object.keys(u.changes)
      const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(", ")
      const values = cols.map((c) => u.changes[c])
      values.push(u.id)
      await pg.query(
        `UPDATE work_items SET ${setSql}, last_synced_at = NOW(), updated_at = NOW() WHERE id = $${cols.length + 1}`,
        values,
      )
    }

    // ARCHIVE
    if (toArchive.length > 0) {
      const ids = toArchive.map((a) => a.id)
      await pg.query(
        `UPDATE work_items SET deleted_in_karbon_at = NOW(), last_synced_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [ids],
      )
    }

    await pg.query("COMMIT")
    console.log("\nCommitted.")
  } catch (err) {
    await pg.query("ROLLBACK")
    console.error("\nRolled back:", err)
    process.exitCode = 1
  } finally {
    await pg.end()
  }
})()
