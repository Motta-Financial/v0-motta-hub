/**
 * scripts/reconcile-ignition-ids.ts
 *
 * Merge Zapier-era legacy rows into Reporting-API slug rows in the four
 * ignition_* tables that have a mixed-ID population:
 *
 *   ignition_clients     (slug: cli_*)
 *   ignition_contacts    (slug: con_*)
 *   ignition_proposals   (slug: prop_*)
 *   ignition_invoices    (slug: inv_* — discovered from the live data)
 *
 * For every legacy row that matches a slug row on its natural key, we:
 *   1. Forward non-null enrichment columns (contact_id, organization_id,
 *      match_status, match_method, match_confidence, etc.) from the legacy
 *      row onto the slug row, but ONLY where the slug row's column is null.
 *      Slug-row data is authoritative — we never overwrite it.
 *   2. Retarget every downstream FK pointing at the legacy ID to point at
 *      the slug ID instead (invoices→proposal_id, payments→invoice_id, etc).
 *   3. Delete the legacy row.
 *
 * Unmatched legacy rows are LEFT in place. They represent records the
 * Reporting API doesn't return (archived/deleted/legacy) and deleting
 * them would lose data with no replacement.
 *
 * Modes:
 *   --report   (default)  read-only, prints match rates and planned counts
 *   --apply               runs the merge inside a single transaction;
 *                         rolls back on any error
 */

import pg from "pg"

const MODE: "report" | "apply" = process.argv.includes("--apply") ? "apply" : "report"

const SLUG_PREFIX = {
  ignition_clients: "cli_",
  ignition_contacts: "con_",
  ignition_proposals: "prop_",
  ignition_invoices: "inv_", // verified by sampling the 39 slug-fed invoice IDs
} as const

const conn = process.env.POSTGRES_URL_NON_POOLING
if (!conn) {
  console.error("POSTGRES_URL_NON_POOLING not set")
  process.exit(1)
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })

type TableSummary = {
  table: string
  slugCol: string
  totalRows: number
  slugRows: number
  legacyRows: number
  matched: number
  unmatched: number
  matchKey: string
  enrichmentCols: string[]
  fkRetargets: { table: string; col: string; affectedRows: number }[]
}

const summaries: TableSummary[] = []

async function main(): Promise<void> {
  await client.connect()
  console.log(`\n=== Reconciliation ${MODE.toUpperCase()} ===\n`)

  if (MODE === "apply") {
    await client.query("BEGIN")
  }

  try {
    // Order matters because some FK retargets depend on prior ID maps —
    // e.g. once we delete legacy clients we lose the natural-key info we'd
    // need to retarget proposals.ignition_client_id. So we collect ALL
    // legacy→slug ID maps first, then do every FK retarget, then enrichment,
    // then deletes — all inside one transaction.

    const contactMap = await buildIdMap("ignition_contacts", "ignition_contact_id", "con_", `lower(trim(email))`)
    const clientMap = await buildIdMap("ignition_clients", "ignition_client_id", "cli_", `lower(trim(coalesce(business_name, name)))`)
    const proposalMap = await buildIdMap("ignition_proposals", "proposal_id", "prop_", `proposal_number`)
    const invoiceMap = await buildIdMap("ignition_invoices", "ignition_invoice_id", "inv_", `invoice_number`)

    // Report match rates BEFORE any writes
    for (const s of summaries) {
      printSummary(s)
    }

    if (MODE === "apply") {
      // 1. Forward enrichment columns from legacy → slug rows
      await forwardEnrichment("ignition_contacts", "ignition_contact_id", contactMap, [
        "contact_id",
        "match_status",
        "match_method",
        "match_confidence",
        "match_notes",
      ])
      await forwardEnrichment("ignition_clients", "ignition_client_id", clientMap, [
        "contact_id",
        "organization_id",
        "match_status",
        "match_method",
        "match_confidence",
        "match_notes",
      ])
      await forwardEnrichment("ignition_proposals", "proposal_id", proposalMap, [
        "contact_id",
        "organization_id",
        "client_partner",
        "client_manager",
        "proposal_sent_by",
      ])
      await forwardEnrichment("ignition_invoices", "ignition_invoice_id", invoiceMap, [
        "contact_id",
        "organization_id",
        "stripe_invoice_id",
        "stripe_customer_id",
      ])

      // 2. Retarget downstream FK references
      // contacts has no FKs pointing AT ignition_contact_id (uses uuid `contact_id` instead) — nothing to retarget
      await retargetFk("ignition_proposals", "ignition_client_id", clientMap)
      await retargetFk("ignition_invoices", "ignition_client_id", clientMap)
      await retargetFk("ignition_invoices", "proposal_id", proposalMap)
      await retargetFk("ignition_payments", "ignition_client_id", clientMap)
      await retargetFk("ignition_payments", "ignition_invoice_id", invoiceMap)
      await retargetFk("ignition_payments", "proposal_id", proposalMap)
      await retargetFk("ignition_proposal_services", "proposal_id", proposalMap)
      await retargetFk("tasks", "proposal_id", proposalMap)
      await retargetFk("ignition_contacts", "ignition_client_id", clientMap)

      // 3. Delete legacy rows that were merged
      await deleteLegacy("ignition_contacts", "ignition_contact_id", contactMap)
      await deleteLegacy("ignition_invoices", "ignition_invoice_id", invoiceMap)
      await deleteLegacy("ignition_proposals", "proposal_id", proposalMap)
      await deleteLegacy("ignition_clients", "ignition_client_id", clientMap)

      await client.query("COMMIT")
      console.log("\nCommitted. All matched legacy rows merged and deleted.")
    } else {
      console.log("\nDry-run only. Re-run with --apply to execute inside a transaction.")
    }
  } catch (err) {
    if (MODE === "apply") {
      await client.query("ROLLBACK")
      console.error("\nRolled back. No changes applied.")
    }
    throw err
  } finally {
    await client.end()
  }
}

/** Returns legacy_id → slug_id mapping, scoped to rows where the natural key
 *  matches uniquely on both sides. Ambiguous matches (same email on multiple
 *  legacy rows, or same email on multiple slug rows) are excluded entirely
 *  to prevent silent merges of distinct entities. */
async function buildIdMap(
  table: string,
  idCol: string,
  slugPrefix: string,
  matchKeyExpr: string,
): Promise<Map<string, string>> {
  const totalQ = await client.query(`select count(*)::int as n from public.${table}`)
  const total = totalQ.rows[0].n as number

  const slugQ = await client.query(
    `select count(*)::int as n from public.${table} where ${idCol} like $1`,
    [`${slugPrefix}%`],
  )
  const slugCount = slugQ.rows[0].n as number
  const legacyCount = total - slugCount

  // Pull unique-on-both-sides natural keys
  const sql = `
    with slug as (
      select ${idCol} as id, ${matchKeyExpr} as k
      from public.${table}
      where ${idCol} like $1 and ${matchKeyExpr} is not null and ${matchKeyExpr} <> ''
    ),
    legacy as (
      select ${idCol} as id, ${matchKeyExpr} as k
      from public.${table}
      where ${idCol} not like $1 and ${matchKeyExpr} is not null and ${matchKeyExpr} <> ''
    ),
    slug_unique as (
      select k, max(id) as id from slug group by k having count(*) = 1
    ),
    legacy_unique as (
      select k, max(id) as id from legacy group by k having count(*) = 1
    )
    select l.id as legacy_id, s.id as slug_id
    from legacy_unique l
    join slug_unique s on s.k = l.k
  `
  const matches = await client.query(sql, [`${slugPrefix}%`])
  const map = new Map<string, string>()
  for (const row of matches.rows) {
    map.set(row.legacy_id as string, row.slug_id as string)
  }

  summaries.push({
    table,
    slugCol: idCol,
    totalRows: total,
    slugRows: slugCount,
    legacyRows: legacyCount,
    matched: map.size,
    unmatched: legacyCount - map.size,
    matchKey: matchKeyExpr,
    enrichmentCols: [],
    fkRetargets: [],
  })

  return map
}

async function forwardEnrichment(
  table: string,
  idCol: string,
  idMap: Map<string, string>,
  cols: string[],
): Promise<void> {
  if (idMap.size === 0) return
  // Build a VALUES table from the id map so we can join in SQL
  const pairs = Array.from(idMap.entries())
  // Process in chunks of 500 to keep VALUES list size sane
  const CHUNK = 500
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const slice = pairs.slice(i, i + CHUNK)
    const valuesSql = slice.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(",")
    const params = slice.flat()
    const setClauses = cols.map((c) => `${c} = coalesce(s.${c}, l.${c})`).join(", ")
    const sourceList = cols.map((c) => `l.${c} as ${c}`).join(", ")
    await client.query(
      `
      with map(legacy_id, slug_id) as (values ${valuesSql}),
           legacy as (
             select m.slug_id, ${sourceList}
             from map m join public.${table} l on l.${idCol} = m.legacy_id
           )
      update public.${table} s
      set ${setClauses}, updated_at = now()
      from legacy l
      where s.${idCol} = l.slug_id
        and l.slug_id is not null
      `,
      params,
    )
  }
  console.log(`  enrichment forwarded for ${table} (${idMap.size} rows × ${cols.length} cols)`)
}

async function retargetFk(
  table: string,
  fkCol: string,
  idMap: Map<string, string>,
): Promise<void> {
  if (idMap.size === 0) return
  const pairs = Array.from(idMap.entries())
  const CHUNK = 500
  let total = 0
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const slice = pairs.slice(i, i + CHUNK)
    const valuesSql = slice.map((_, j) => `($${j * 2 + 1}::text, $${j * 2 + 2}::text)`).join(",")
    const params = slice.flat()
    const res = await client.query(
      `
      with map(legacy_id, slug_id) as (values ${valuesSql})
      update public.${table} t
      set ${fkCol} = m.slug_id
      from map m
      where t.${fkCol} = m.legacy_id
      `,
      params,
    )
    total += res.rowCount ?? 0
  }
  if (total > 0) {
    console.log(`  retargeted ${total} FK refs in ${table}.${fkCol}`)
  }
}

async function deleteLegacy(
  table: string,
  idCol: string,
  idMap: Map<string, string>,
): Promise<void> {
  if (idMap.size === 0) return
  const ids = Array.from(idMap.keys())
  const CHUNK = 1000
  let total = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const placeholders = slice.map((_, j) => `$${j + 1}`).join(",")
    const res = await client.query(
      `delete from public.${table} where ${idCol} in (${placeholders})`,
      slice,
    )
    total += res.rowCount ?? 0
  }
  console.log(`  deleted ${total} legacy rows from ${table}`)
}

function printSummary(s: TableSummary): void {
  const matchPct = s.legacyRows > 0 ? Math.round((s.matched / s.legacyRows) * 100) : 0
  console.log(`${s.table}`)
  console.log(`  Total rows:    ${s.totalRows}`)
  console.log(`  Slug rows:     ${s.slugRows}`)
  console.log(`  Legacy rows:   ${s.legacyRows}`)
  console.log(`  Match key:     ${s.matchKey}`)
  console.log(`  Matched:       ${s.matched} (${matchPct}% of legacy)`)
  console.log(`  Unmatched:     ${s.unmatched}  (will be retained as-is)`)
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
