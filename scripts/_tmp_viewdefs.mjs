import pg from "pg"
const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL
const url = new URL(raw); url.searchParams.delete("sslmode")
const c = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
await c.connect()
for (const v of process.argv.slice(2)) {
  const { rows } = await c.query("select pg_get_viewdef($1::regclass, true) as def", [v])
  console.log(`\n=== ${v} ===\n${rows[0].def}`)
}
await c.end()
