// Audit which imported debriefs need Karbon enrichment.
//
// Buckets we care about:
//   • have_url         — debriefs with a karbon_work_url
//   • need_work_item   — have URL but no work_item_id (missed our fuzzy join)
//   • need_org_or_ct   — have URL but no organization_id and no contact_id
//   • have_no_url      — debriefs with neither URL nor work_item_id (will be
//     skipped by enrichment; surface them so we know the count)
//
// Also dump 5 sample karbon_work_urls so we can confirm the URL shape and
// pick the right key extractor.
import { Client } from "pg"

const url = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, "")
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const r = await c.query(`
  select
    count(*) as total,
    count(*) filter (where karbon_work_url is not null and karbon_work_url <> '') as have_url,
    count(*) filter (where (karbon_work_url is not null and karbon_work_url <> '') and work_item_id is null) as need_work_item,
    count(*) filter (where (karbon_work_url is not null and karbon_work_url <> '') and organization_id is null and contact_id is null) as need_org_or_contact,
    count(*) filter (where (karbon_work_url is null or karbon_work_url = '') and work_item_id is null) as have_no_url_no_workitem
  from debriefs
`)
console.log("Counts:", r.rows[0])

const samples = await c.query(`
  select id, karbon_work_url, work_item_id is not null as has_workitem, organization_id is not null as has_org, contact_id is not null as has_contact
  from debriefs
  where karbon_work_url is not null and karbon_work_url <> ''
  order by created_at desc
  limit 5
`)
console.log("Samples:")
for (const row of samples.rows) console.log(" ", JSON.stringify(row))

// Show how many work items already exist locally (so we know if we can resolve
// most via the local cache vs hitting Karbon for every one).
const wi = await c.query(`
  select count(*) as n from work_items where karbon_work_item_key is not null
`)
console.log("Local work_items with karbon_work_item_key:", wi.rows[0].n)

await c.end()
