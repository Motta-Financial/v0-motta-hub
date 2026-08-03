/**
 * apply-proconnect-master-mapping.ts
 *
 * Materializes `client_mapping` rows for every ProConnect client that
 * has a confirmed `hub_contact_id` / `hub_organization_id` link on
 * `proconnect_clients` but is missing from the master mapping table.
 *
 * Why this exists:
 * - `client_mapping` is the cross-system bridge table. Rows look like
 *   { internal_client_id, karbon_client_id, proconnect_client_id,
 *     ignition_client_id, client_type, source_system }. The
 *   `master_client_mapping` view rolls these up per `internal_client_id`
 *   and is what dashboards / Alfred / cross-system queries read.
 * - Our prior pass linked 198 ProConnect orgs to Hub records on the
 *   `proconnect_clients` row itself. That fixed engagement-side
 *   rollups (which join through `proconnect_client_id`) but did NOT
 *   automatically materialize the corresponding bridge rows.
 * - As a result, `client_mapping` is missing 1,548 of 1,723 confirmed
 *   ProConnect↔Hub links, and `master_client_mapping` underreports
 *   ProConnect coverage.
 *
 * Strategy (reversible, fill-only, never overwrite):
 *   1. INSERT new bridge rows for every linked ProConnect client that
 *      has no existing `client_mapping` row keyed on either
 *      `proconnect_client_id` or `(internal_client_id, ...)`.
 *   2. UPDATE existing `client_mapping` rows where:
 *        - the row matches our `proconnect_client_id`
 *        - AND it currently has NULL `internal_client_id` OR matches
 *          the same hub id we resolved
 *        - AND it is missing `client_type` or `source_system`.
 *      We never change a non-null `internal_client_id` to a different
 *      value — that's a "conflict" and surfaces in the report.
 *   3. SKIP rows where the existing `internal_client_id` disagrees
 *      with our resolved hub id. Print them at the end for human
 *      review at /tax/settings.
 *
 * The script is idempotent. Re-running it after the first apply
 * should result in 0 inserts and 0 updates.
 *
 * Tax-returns linkage: nothing extra needed — engagements join
 * `proconnect_clients` by `proconnect_client_id`, so the Hub master
 * record is reachable as soon as `hub_contact_id`/`hub_organization_id`
 * is set on the parent client (already done). This script's job is to
 * make that linkage queryable through the `client_mapping` /
 * `master_client_mapping` view.
 *
 * Usage:
 *   pnpm tsx scripts/apply-proconnect-master-mapping.ts --dry-run
 *   pnpm tsx scripts/apply-proconnect-master-mapping.ts
 */

import { Client } from "pg"

const DRY_RUN = process.argv.includes("--dry-run")

interface Candidate {
  proconnect_client_id: string
  internal_client_id: string // resolved from hub_contact_id || hub_organization_id
  client_type: "PERSON" | "ORGANIZATION"
  display_name: string | null
  // Existing client_mapping row, if any
  existing_id: string | null
  existing_internal_client_id: string | null
  existing_client_type: string | null
  existing_source_system: string | null
}

async function main() {
  const c = new Client({
    connectionString: process.env.POSTGRES_URL_NON_POOLING,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  console.log(`[v0] mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`)

  // Pull every linked ProConnect client and any matching client_mapping
  // row. Left-join on proconnect_client_id is the natural key.
  const { rows } = await c.query<Candidate>(`
    select
      pc.proconnect_client_id,
      coalesce(pc.hub_contact_id, pc.hub_organization_id)::text as internal_client_id,
      case
        when pc.hub_contact_id is not null then 'PERSON'
        else 'ORGANIZATION'
      end as client_type,
      coalesce(pc.business_name, pc.display_name) as display_name,
      cm.id::text as existing_id,
      cm.internal_client_id::text as existing_internal_client_id,
      cm.client_type as existing_client_type,
      cm.source_system as existing_source_system
    from proconnect_clients pc
    left join client_mapping cm
      on cm.proconnect_client_id = pc.proconnect_client_id
    where pc.hub_contact_id is not null
       or pc.hub_organization_id is not null
  `)

  const inserts: Candidate[] = []
  const updates: Candidate[] = []
  const conflicts: Candidate[] = []
  const noops: Candidate[] = []

  for (const row of rows) {
    if (!row.existing_id) {
      // No bridge row yet — create one.
      inserts.push(row)
      continue
    }
    if (
      row.existing_internal_client_id &&
      row.existing_internal_client_id !== row.internal_client_id
    ) {
      // Existing row points at a different Hub record. NEVER auto-fix.
      conflicts.push(row)
      continue
    }
    const needsInternal = row.existing_internal_client_id == null
    const needsType = row.existing_client_type == null
    const needsSource = row.existing_source_system == null
    if (needsInternal || needsType || needsSource) {
      updates.push(row)
    } else {
      noops.push(row)
    }
  }

  console.log(
    `[v0] candidates: total=${rows.length} inserts=${inserts.length} updates=${updates.length} conflicts=${conflicts.length} noops=${noops.length}`,
  )

  if (DRY_RUN) {
    console.log("\n--- sample inserts (first 5) ---")
    for (const r of inserts.slice(0, 5)) {
      console.log(`  ${r.client_type} ${r.proconnect_client_id} → ${r.internal_client_id} (${r.display_name})`)
    }
    console.log("\n--- conflicts (need operator review) ---")
    for (const r of conflicts) {
      console.log(
        `  ${r.proconnect_client_id} (${r.display_name}): existing internal=${r.existing_internal_client_id} vs resolved=${r.internal_client_id}`,
      )
    }
    await c.end()
    return
  }

  // Apply in a single transaction so a partial failure rolls back.
  await c.query("begin")
  try {
    let insOk = 0
    let updOk = 0
    for (const r of inserts) {
      // ON CONFLICT belt-and-suspenders against the unique
      // (internal_client_id, proconnect_client_id) index — if we race
      // with the SQL trigger, take whichever landed first and move on.
      const res = await c.query(
        `insert into client_mapping
           (internal_client_id, proconnect_client_id, client_type, source_system)
         values ($1, $2, $3, 'PROCONNECT')
         on conflict (internal_client_id, proconnect_client_id) do nothing`,
        [r.internal_client_id, r.proconnect_client_id, r.client_type],
      )
      if (res.rowCount && res.rowCount > 0) insOk++
    }
    for (const r of updates) {
      // Only fill in NULL columns. Never widen scope of an existing row.
      const res = await c.query(
        `update client_mapping set
           internal_client_id = coalesce(internal_client_id, $1::uuid),
           client_type        = coalesce(client_type, $2),
           source_system      = coalesce(source_system, 'PROCONNECT'),
           updated_at         = now()
         where id = $3::uuid`,
        [r.internal_client_id, r.client_type, r.existing_id],
      )
      if (res.rowCount && res.rowCount > 0) updOk++
    }
    await c.query("commit")
    console.log(`[v0] applied: inserts=${insOk}/${inserts.length} updates=${updOk}/${updates.length}`)
  } catch (err) {
    await c.query("rollback")
    console.error("[v0] rolled back:", err)
    throw err
  }

  if (conflicts.length > 0) {
    console.log("\n--- conflicts (NOT auto-fixed; review at /tax/settings) ---")
    for (const r of conflicts) {
      console.log(
        `  ${r.proconnect_client_id} (${r.display_name}): existing internal=${r.existing_internal_client_id} vs resolved=${r.internal_client_id}`,
      )
    }
  }

  // Post-apply verification
  const { rows: post } = await c.query(`
    select
      count(*) filter (where pc.hub_contact_id is not null or pc.hub_organization_id is not null) as linked_pc,
      count(*) filter (where exists (select 1 from client_mapping cm where cm.proconnect_client_id = pc.proconnect_client_id and cm.internal_client_id is not null)) as in_mapping
    from proconnect_clients pc
  `)
  console.log("[v0] post-apply coverage:", post[0])

  await c.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
