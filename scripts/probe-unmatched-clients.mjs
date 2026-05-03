import { Client } from "pg"

const url = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, "")
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const targets = ["Ana Salgado", "Meredith & Cole Chapin", "Denver Hair Party", "Adkins, Nicholas"]

for (const name of targets) {
  console.log(`\n=== ${name} ===`)
  // Take key tokens (first/last word, etc.) and pg_trgm-style ilike search
  const tokens = name
    .replace(/[,&]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  for (const tok of tokens) {
    const pattern = `%${tok}%`
    const orgs = await c.query(
      `select id, name from organizations where name ilike $1 or legal_name ilike $1 limit 5`,
      [pattern],
    )
    const cts = await c.query(
      `select id, full_name, first_name, last_name from contacts
       where full_name ilike $1 or first_name ilike $1 or last_name ilike $1 limit 5`,
      [pattern],
    )
    if (orgs.rowCount > 0 || cts.rowCount > 0) {
      console.log(`  token "${tok}":`)
      orgs.rows.forEach((r) => console.log(`    ORG  ${r.id}  ${r.name}`))
      cts.rows.forEach((r) =>
        console.log(`    CONT ${r.id}  ${r.full_name || `${r.first_name} ${r.last_name}`}`),
      )
    }
  }
}

await c.end()
