/**
 * Create / refresh the `public.master_client_mapping` view.
 *
 * One row per Motta Hub client (uuid), surfacing every external
 * system identifier we know about: Karbon (read natively off
 * contacts.karbon_contact_key / organizations.karbon_organization_key),
 * Ignition and ProConnect (pivoted from the per-source rows in
 * client_mapping). A view is the right primitive here — it stays in
 * sync automatically as upstream Karbon syncs land and as the
 * Ignition/ProConnect matchers fill in client_mapping rows, with no
 * extra cron or refresh step.
 *
 * The view is anchored on the Supabase UUID (contacts.id /
 * organizations.id) — that uuid IS the Motta Hub master ID. It is
 * intentionally NOT filtered to "only linked clients" so this view
 * is also the answer to "what does the hub know about?"; consumers
 * filter on link_count > 0 when they want only cross-system rows.
 *
 * Idempotent — safe to re-run. Uses `create or replace view` so the
 * dependent grants are preserved.
 *
 * Run: pnpm exec tsx scripts/create-master-client-mapping-view.ts
 */
import { Client } from "pg"

const DDL = `
create or replace view public.master_client_mapping as
with
  -- Collapse client_mapping (one row per (uuid, source_system)) down
  -- to one row per uuid. max() over a column that is guaranteed to
  -- have at most one non-null value per group is just an "any
  -- non-null" picker, not a real aggregate — this works because the
  -- existing data shape stores each external ID on a separate row.
  mapping_agg as (
    select
      internal_client_id,
      max(ignition_client_id)   as ignition_client_id,
      max(proconnect_client_id) as proconnect_client_id,
      max(karbon_client_id)     as karbon_client_id_from_mapping,
      bool_or(ignition_client_id   is not null) as has_ignition_row,
      bool_or(proconnect_client_id is not null) as has_proconnect_row
    from public.client_mapping
    where internal_client_id is not null
    group by internal_client_id
  )
-- People (contacts)
select
  ct.id                                     as internal_client_id,
  'PERSON'::text                            as client_type,
  coalesce(
    nullif(trim(ct.full_name), ''),
    nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
    '(unnamed)'
  )                                         as display_name,
  ct.primary_email                          as primary_email,
  -- Karbon: native column is the source of truth. We fall back to
  -- client_mapping.karbon_client_id in case some future workflow
  -- writes there directly without updating contacts.
  coalesce(ct.karbon_contact_key, ma.karbon_client_id_from_mapping)
                                            as karbon_client_id,
  ma.ignition_client_id                     as ignition_client_id,
  ma.proconnect_client_id                   as proconnect_client_id,
  ct.karbon_url                             as karbon_url,
  -- linked_systems is an ordered text[] of every external system this
  -- uuid is linked to. Convenient for UI badges and for SQL filters
  -- like:  where 'KARBON' = any(linked_systems)
  array_remove(array[
    case when ct.karbon_contact_key is not null then 'KARBON'     end,
    case when ma.ignition_client_id  is not null then 'IGNITION'   end,
    case when ma.proconnect_client_id is not null then 'PROCONNECT' end
  ], null)                                  as linked_systems,
  (
    (case when ct.karbon_contact_key  is not null then 1 else 0 end) +
    (case when ma.ignition_client_id  is not null then 1 else 0 end) +
    (case when ma.proconnect_client_id is not null then 1 else 0 end)
  )                                         as link_count,
  ct.created_at                             as created_at,
  ct.updated_at                             as updated_at
from public.contacts ct
left join mapping_agg ma on ma.internal_client_id = ct.id

union all

-- Organizations
select
  o.id                                      as internal_client_id,
  'ORGANIZATION'::text                      as client_type,
  coalesce(nullif(trim(o.name), ''), '(unnamed)')
                                            as display_name,
  o.primary_email                           as primary_email,
  coalesce(o.karbon_organization_key, ma.karbon_client_id_from_mapping)
                                            as karbon_client_id,
  ma.ignition_client_id                     as ignition_client_id,
  ma.proconnect_client_id                   as proconnect_client_id,
  o.karbon_url                              as karbon_url,
  array_remove(array[
    case when o.karbon_organization_key is not null then 'KARBON'     end,
    case when ma.ignition_client_id     is not null then 'IGNITION'   end,
    case when ma.proconnect_client_id   is not null then 'PROCONNECT' end
  ], null)                                  as linked_systems,
  (
    (case when o.karbon_organization_key is not null then 1 else 0 end) +
    (case when ma.ignition_client_id     is not null then 1 else 0 end) +
    (case when ma.proconnect_client_id   is not null then 1 else 0 end)
  )                                         as link_count,
  o.created_at                              as created_at,
  o.updated_at                              as updated_at
from public.organizations o
left join mapping_agg ma on ma.internal_client_id = o.id;

comment on view public.master_client_mapping is
  'One row per Motta Hub client (contacts + organizations, anchored on the uuid). '
  'Surfaces every external-system identifier: Karbon (native column), '
  'Ignition + ProConnect (pivoted from client_mapping). '
  'See scripts/create-master-client-mapping-view.ts.';
`

async function main() {
  const url = process.env.POSTGRES_URL_NON_POOLING
  if (!url) throw new Error("POSTGRES_URL_NON_POOLING not set")

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query(DDL)

    // Smoke test — pull a few rows and the totals so we can confirm
    // the view compiled and is returning the expected shape.
    const totals = await client.query(
      `select
        count(*)::int                                        as total_clients,
        count(*) filter (where link_count = 0)::int          as unlinked,
        count(*) filter (where link_count = 1)::int          as one_system,
        count(*) filter (where link_count = 2)::int          as two_systems,
        count(*) filter (where link_count = 3)::int          as three_systems,
        count(*) filter (where 'KARBON'     = any(linked_systems))::int as has_karbon,
        count(*) filter (where 'IGNITION'   = any(linked_systems))::int as has_ignition,
        count(*) filter (where 'PROCONNECT' = any(linked_systems))::int as has_proconnect
      from public.master_client_mapping`,
    )
    console.log("✓ View created. Coverage:")
    console.log(totals.rows[0])

    const sample = await client.query(
      `select internal_client_id, client_type, display_name, primary_email,
        karbon_client_id, ignition_client_id, proconnect_client_id, linked_systems, link_count
       from public.master_client_mapping
       where link_count >= 2
       order by link_count desc, display_name
       limit 5`,
    )
    console.log("\nSample (link_count >= 2):")
    sample.rows.forEach((r) =>
      console.log(" ", JSON.stringify(r, null, 0)),
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("ERR:", e.message)
  process.exit(1)
})
