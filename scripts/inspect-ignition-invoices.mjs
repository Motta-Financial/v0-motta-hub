import { Client } from "pg"

const url = process.env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, "")
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const a = await c.query("select count(*)::int as n from ignition_invoices")
console.log("Existing rows in ignition_invoices:", a.rows[0].n)

const b = await c.query(
  "select coalesce(status,'(null)') as status, count(*)::int as n from ignition_invoices group by 1 order by 2 desc",
)
console.log("By status:", b.rows)

const d = await c.query(
  "select ignition_invoice_id, status, invoice_date, amount, currency from ignition_invoices order by invoice_date desc nulls last limit 5",
)
console.log("Sample rows:", d.rows)

const k = await c.query(`
  select conname, contype, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'public.ignition_invoices'::regclass
`)
console.log("Constraints:", k.rows)

const idx = await c.query(`
  select indexname, indexdef
  from pg_indexes
  where schemaname='public' and tablename='ignition_invoices'
`)
console.log("Indexes:", idx.rows)

await c.end()
