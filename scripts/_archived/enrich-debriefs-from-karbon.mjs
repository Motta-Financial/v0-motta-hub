/**
 * Backfill debriefs.work_item_id / organization_id / contact_id by pulling
 * the Karbon work item referenced by each debrief's `karbon_work_url`.
 *
 * Strategy (cheapest path first):
 *   1. Parse the work item key out of the URL.
 *   2. Try to resolve via the local work_items mirror (3,400+ rows already
 *      synced — most debriefs hit here).
 *   3. On a miss, fetch GET /v3/WorkItems/{key} and upsert into work_items so
 *      future debriefs resolve from the cache.
 *   4. From the resolved work item, read karbon_client_key + client_type
 *      ("Organization" | "Contact"). Look up locally, and if absent, fetch
 *      from Karbon and upsert the org/contact.
 *   5. Stamp the debrief: work_item_id, organization_id OR contact_id (never
 *      both), karbon_client_key, organization_name, client_manager_name,
 *      client_owner_name.
 *
 * Idempotent: re-running only touches debriefs that still have unresolved
 * mappings, so failures from one run can be retried safely. We never clear an
 * existing mapping — only fill in nulls — so manual edits via the new edit
 * sheet are preserved.
 *
 * Run: node --env-file=/vercel/share/.env.project scripts/enrich-debriefs-from-karbon.mjs
 */

import { Client } from "pg"

const KARBON_BASE = "https://api.karbonhq.com/v3"
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

const ACCESS_KEY = process.env.KARBON_ACCESS_KEY
const BEARER = process.env.KARBON_BEARER_TOKEN
if (!ACCESS_KEY || !BEARER) {
  console.error("KARBON_ACCESS_KEY and KARBON_BEARER_TOKEN are required")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// URL → work item key
// ---------------------------------------------------------------------------

/**
 * Extract a key + kind from a Karbon URL. Karbon URLs we see in our import:
 *   #/work/<KEY>           → kind="work", a WorkItem
 *   #/work/<KEY>/tasks     → kind="work"
 *   #/contacts/<KEY>       → kind="contact", a Contact OR Organization
 *                            (Karbon uses the same UI route for both)
 * Returns null for unrelated URLs (Airtable, /triage, etc.).
 */
function parseKarbonUrl(url) {
  if (!url) return null
  const work = url.match(/#\/work\/([A-Za-z0-9]+)/)
  if (work) return { kind: "work", key: work[1] }
  const contact = url.match(/#\/contacts\/([A-Za-z0-9]+)/)
  if (contact) return { kind: "contact", key: contact[1] }
  return null
}

// ---------------------------------------------------------------------------
// Karbon fetchers
// ---------------------------------------------------------------------------

async function karbonGet(path) {
  const res = await fetch(`${KARBON_BASE}${path}`, {
    headers: {
      AccessKey: ACCESS_KEY,
      Authorization: `Bearer ${BEARER}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text().catch(() => "") }
  }
  return { ok: true, data: await res.json() }
}

// ---------------------------------------------------------------------------
// Mappers (subset — we only need fields the debrief join uses)
// ---------------------------------------------------------------------------

function mapWorkItem(item) {
  return {
    karbon_work_item_key: item.WorkItemKey,
    karbon_client_key: item.ClientKey || null,
    client_type: item.ClientType || null,
    client_name: item.ClientName || null,
    client_owner_key: item.ClientOwnerKey || null,
    client_owner_name: item.ClientOwnerName || null,
    client_manager_key: item.ClientManagerKey || null,
    client_manager_name: item.ClientManagerName || null,
    title: item.Title || null,
    work_type: item.WorkType || null,
    workflow_status: item.WorkStatus || null,
    primary_status: item.PrimaryStatus || null,
    secondary_status: item.SecondaryStatus || null,
    user_defined_identifier: item.UserDefinedIdentifier || null,
    karbon_url: `${KARBON_TENANT_PREFIX}/work/${item.WorkItemKey}`,
    karbon_created_at: item.CreatedDate || item.CreatedDateTime || null,
    karbon_modified_at: item.LastModifiedDateTime || item.ModifiedDate || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapOrganization(o) {
  return {
    karbon_organization_key: o.OrganizationKey,
    name: o.Name || o.LegalName || o.TradingName || null,
    legal_name: o.LegalName || null,
    primary_email: o.PrimaryEmailAddress || null,
    phone: o.PrimaryPhoneNumber || null,
    karbon_url: `${KARBON_TENANT_PREFIX}/contact/${o.OrganizationKey}`,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapContact(c) {
  const fullName =
    c.FullName ||
    [c.FirstName, c.MiddleName, c.LastName].filter(Boolean).join(" ").trim() ||
    null
  return {
    karbon_contact_key: c.ContactKey,
    full_name: fullName,
    first_name: c.FirstName || null,
    last_name: c.LastName || null,
    middle_name: c.MiddleName || null,
    primary_email: c.PrimaryEmailAddress || null,
    karbon_url: `${KARBON_TENANT_PREFIX}/contact/${c.ContactKey}`,
    karbon_contact_url: `${KARBON_TENANT_PREFIX}/contact/${c.ContactKey}`,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const url = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, "")
const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

console.log("Loading debriefs that need enrichment...")
const { rows: debriefs } = await db.query(`
  select id, karbon_work_url, work_item_id, organization_id, contact_id
  from debriefs
  where karbon_work_url is not null
    and karbon_work_url <> ''
    and (
      work_item_id is null
      or (organization_id is null and contact_id is null)
    )
  order by created_at desc
`)
console.log(`  ${debriefs.length} debrief(s) to enrich`)

// In-process caches so we don't hit Karbon twice for the same key in one run.
const wiCache = new Map() // karbon_work_item_key -> { id, karbon_client_key, client_type, client_name, client_owner_name, client_manager_name }
const orgCache = new Map() // karbon_organization_key -> { id, name }
const contactCache = new Map() // karbon_contact_key -> { id, full_name }

let enriched = 0
let stillUnmapped = 0
let karbonWorkItemFetches = 0
let karbonOrgFetches = 0
let karbonContactFetches = 0
const errors = []

async function ensureWorkItem(key) {
  if (wiCache.has(key)) return wiCache.get(key)

  // Look up locally first.
  const { rows } = await db.query(
    `select id, karbon_client_key, client_type, client_name, client_owner_name, client_manager_name
     from work_items where karbon_work_item_key = $1`,
    [key],
  )
  if (rows.length > 0) {
    wiCache.set(key, rows[0])
    return rows[0]
  }

  // Fetch from Karbon and upsert.
  karbonWorkItemFetches++
  const res = await karbonGet(`/WorkItems/${key}`)
  if (!res.ok) {
    errors.push({ kind: "work_item_fetch", key, status: res.status, error: res.error })
    wiCache.set(key, null)
    return null
  }
  const row = mapWorkItem(res.data)
  // Upsert minimal columns; on conflict, refresh the join-relevant fields.
  const upsert = await db.query(
    `insert into work_items (
       karbon_work_item_key, karbon_client_key, client_type, client_name,
       client_owner_key, client_owner_name, client_manager_key, client_manager_name,
       title, work_type, workflow_status, primary_status, secondary_status,
       user_defined_identifier, karbon_url, karbon_created_at, karbon_modified_at,
       last_synced_at, updated_at, created_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now()
     )
     on conflict (karbon_work_item_key) do update set
       karbon_client_key = excluded.karbon_client_key,
       client_type = excluded.client_type,
       client_name = excluded.client_name,
       client_owner_key = excluded.client_owner_key,
       client_owner_name = excluded.client_owner_name,
       client_manager_key = excluded.client_manager_key,
       client_manager_name = excluded.client_manager_name,
       title = excluded.title,
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at
     returning id, karbon_client_key, client_type, client_name, client_owner_name, client_manager_name`,
    [
      row.karbon_work_item_key,
      row.karbon_client_key,
      row.client_type,
      row.client_name,
      row.client_owner_key,
      row.client_owner_name,
      row.client_manager_key,
      row.client_manager_name,
      row.title,
      row.work_type,
      row.workflow_status,
      row.primary_status,
      row.secondary_status,
      row.user_defined_identifier,
      row.karbon_url,
      row.karbon_created_at,
      row.karbon_modified_at,
      row.last_synced_at,
      row.updated_at,
    ],
  )
  const stored = upsert.rows[0]
  wiCache.set(key, stored)
  return stored
}

async function ensureOrganization(karbonKey) {
  if (orgCache.has(karbonKey)) return orgCache.get(karbonKey)
  const { rows } = await db.query(
    `select id, name from organizations where karbon_organization_key = $1`,
    [karbonKey],
  )
  if (rows.length > 0) {
    orgCache.set(karbonKey, rows[0])
    return rows[0]
  }

  karbonOrgFetches++
  const res = await karbonGet(`/Organizations/${karbonKey}`)
  if (!res.ok) {
    errors.push({ kind: "org_fetch", key: karbonKey, status: res.status, error: res.error })
    orgCache.set(karbonKey, null)
    return null
  }
  const row = mapOrganization(res.data)
  const ins = await db.query(
    `insert into organizations (
       karbon_organization_key, name, legal_name, primary_email, phone,
       karbon_url, last_synced_at, updated_at, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (karbon_organization_key) do update set
       name = coalesce(excluded.name, organizations.name),
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at
     returning id, name`,
    [
      row.karbon_organization_key,
      row.name,
      row.legal_name,
      row.primary_email,
      row.phone,
      row.karbon_url,
      row.last_synced_at,
      row.updated_at,
    ],
  )
  const stored = ins.rows[0]
  orgCache.set(karbonKey, stored)
  return stored
}

async function ensureContact(karbonKey) {
  if (contactCache.has(karbonKey)) return contactCache.get(karbonKey)
  const { rows } = await db.query(
    `select id, full_name from contacts where karbon_contact_key = $1`,
    [karbonKey],
  )
  if (rows.length > 0) {
    contactCache.set(karbonKey, rows[0])
    return rows[0]
  }

  karbonContactFetches++
  const res = await karbonGet(`/Contacts/${karbonKey}`)
  if (!res.ok) {
    errors.push({ kind: "contact_fetch", key: karbonKey, status: res.status, error: res.error })
    contactCache.set(karbonKey, null)
    return null
  }
  const row = mapContact(res.data)
  const ins = await db.query(
    `insert into contacts (
       karbon_contact_key, full_name, first_name, last_name, middle_name,
       primary_email, karbon_url, karbon_contact_url, last_synced_at,
       updated_at, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     on conflict (karbon_contact_key) do update set
       full_name = coalesce(excluded.full_name, contacts.full_name),
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at
     returning id, full_name`,
    [
      row.karbon_contact_key,
      row.full_name,
      row.first_name,
      row.last_name,
      row.middle_name,
      row.primary_email,
      row.karbon_url,
      row.karbon_contact_url,
      row.last_synced_at,
      row.updated_at,
    ],
  )
  const stored = ins.rows[0]
  contactCache.set(karbonKey, stored)
  return stored
}

// ---------------------------------------------------------------------------

let i = 0
for (const debrief of debriefs) {
  i++
  if (i % 25 === 0) {
    console.log(
      `  ...${i}/${debriefs.length} processed, enriched=${enriched}, unmapped=${stillUnmapped}, ` +
        `karbon fetches: wi=${karbonWorkItemFetches} org=${karbonOrgFetches} contact=${karbonContactFetches}`,
    )
  }

  const parsed = parseKarbonUrl(debrief.karbon_work_url)
  if (!parsed) {
    stillUnmapped++
    continue
  }

  let workItemRowId = debrief.work_item_id
  let orgId = debrief.organization_id
  let contactId = debrief.contact_id
  let karbonClientKey = null
  let clientType = null
  let orgName = null
  let clientOwnerName = null
  let clientManagerName = null

  if (parsed.kind === "work") {
    const wi = await ensureWorkItem(parsed.key)
    if (!wi) {
      stillUnmapped++
      continue
    }
    workItemRowId = workItemRowId || wi.id
    karbonClientKey = wi.karbon_client_key
    clientType = wi.client_type
    clientOwnerName = wi.client_owner_name
    clientManagerName = wi.client_manager_name

    if (wi.client_type === "Organization" && wi.karbon_client_key && !orgId) {
      const org = await ensureOrganization(wi.karbon_client_key)
      if (org) {
        orgId = org.id
        orgName = org.name
      }
    } else if (wi.client_type === "Contact" && wi.karbon_client_key && !contactId) {
      const contact = await ensureContact(wi.karbon_client_key)
      if (contact) contactId = contact.id
      if (contact && !orgName) orgName = contact.full_name
    }
    if (!orgName) orgName = wi.client_name
  } else if (parsed.kind === "contact") {
    // Karbon's #/contacts/<KEY> route serves both Contacts and Organizations.
    // Try Contact first; on a 404 in Karbon we fall back to Organization.
    if (!contactId) {
      const contact = await ensureContact(parsed.key)
      if (contact) {
        contactId = contact.id
        karbonClientKey = parsed.key
        clientType = "Contact"
        orgName = contact.full_name
      }
    }
    if (!contactId && !orgId) {
      const org = await ensureOrganization(parsed.key)
      if (org) {
        orgId = org.id
        karbonClientKey = parsed.key
        clientType = "Organization"
        orgName = org.name
      }
    }
    if (!contactId && !orgId) {
      stillUnmapped++
      continue
    }
  }

  // Update the debrief — only fill nulls, never overwrite existing mappings.
  const result = await db.query(
    `update debriefs set
       work_item_id = coalesce(work_item_id, $1),
       organization_id = coalesce(organization_id, $2),
       contact_id = coalesce(contact_id, $3),
       karbon_client_key = coalesce(karbon_client_key, $4),
       client_type = coalesce(client_type, $5),
       organization_name = coalesce(organization_name, $6),
       client_owner_name = coalesce(client_owner_name, $7),
       client_manager_name = coalesce(client_manager_name, $8),
       updated_at = now()
     where id = $9
     returning id`,
    [
      workItemRowId,
      orgId,
      contactId,
      karbonClientKey,
      clientType,
      orgName,
      clientOwnerName,
      clientManagerName,
      debrief.id,
    ],
  )
  if (result.rowCount > 0) {
    enriched++
  } else {
    stillUnmapped++
  }
}

console.log("\n=== Summary ===")
console.log(`  Debriefs processed:        ${debriefs.length}`)
console.log(`  Enriched:                  ${enriched}`)
console.log(`  Still unmapped:            ${stillUnmapped}`)
console.log(`  Karbon work-item fetches:  ${karbonWorkItemFetches}`)
console.log(`  Karbon org fetches:        ${karbonOrgFetches}`)
console.log(`  Karbon contact fetches:    ${karbonContactFetches}`)
if (errors.length > 0) {
  console.log(`\n  ${errors.length} error(s):`)
  for (const e of errors.slice(0, 20)) console.log("   ", JSON.stringify(e))
  if (errors.length > 20) console.log(`    ...and ${errors.length - 20} more`)
}

// Final after-state check, identical to the audit script so the deltas line up.
const after = await db.query(`
  select
    count(*) as total,
    count(*) filter (where karbon_work_url is not null and karbon_work_url <> '') as have_url,
    count(*) filter (where (karbon_work_url is not null and karbon_work_url <> '') and work_item_id is null) as need_work_item,
    count(*) filter (where (karbon_work_url is not null and karbon_work_url <> '') and organization_id is null and contact_id is null) as need_org_or_contact
  from debriefs
`)
console.log("\nAfter-state:", after.rows[0])

await db.end()
