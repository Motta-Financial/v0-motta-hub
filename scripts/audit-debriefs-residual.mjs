// Show the debriefs that the Karbon enrichment couldn't fully map and explain
// why, so the user can decide whether to clean them up manually via the Edit
// sheet or leave them as-is.
import { Client } from "pg"

const url = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, "")
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const noWorkItem = await c.query(`
  select id, karbon_work_url, organization_name
  from debriefs
  where karbon_work_url is not null and karbon_work_url <> '' and work_item_id is null
  order by debrief_date desc nulls last
`)
console.log(`\n${noWorkItem.rows.length} debrief(s) with karbon_work_url but no resolved work item:`)
for (const r of noWorkItem.rows) {
  console.log(` - ${r.id} | ${r.organization_name || "(no name)"} | ${r.karbon_work_url}`)
}

const noClient = await c.query(`
  select id, karbon_work_url, organization_name, work_item_id
  from debriefs
  where karbon_work_url is not null and karbon_work_url <> ''
    and organization_id is null and contact_id is null
  order by debrief_date desc nulls last
`)
console.log(`\n${noClient.rows.length} debrief(s) with no organization_id and no contact_id:`)
for (const r of noClient.rows.slice(0, 30)) {
  console.log(
    ` - ${r.id} | wi=${r.work_item_id ? "yes" : "NO"} | ${r.organization_name || "(no name)"} | ${r.karbon_work_url}`,
  )
}
if (noClient.rows.length > 30) console.log(`   ...and ${noClient.rows.length - 30} more`)

const noUrl = await c.query(`
  select count(*) as n from debriefs where (karbon_work_url is null or karbon_work_url = '') and work_item_id is null
`)
console.log(`\n${noUrl.rows[0].n} debrief(s) have neither a Karbon URL nor a work_item_id (cannot auto-enrich)`)

await c.end()
