/**
 * Applies the portal backend migrations (417-421).
 *
 * Dry run by default: every file runs inside ONE transaction which is then
 * rolled back, so syntax errors, constraint violations against existing
 * rows, and missing dependencies all surface without changing anything.
 * Pass --commit to keep the work.
 *
 *   node --env-file=.env.local scripts/422-apply-portal-migrations.mjs
 *   node --env-file=.env.local scripts/422-apply-portal-migrations.mjs --commit
 *
 * One transaction for all five on purpose: they are one feature set, and a
 * half-applied set would leave routes selecting columns that don't exist.
 */
import { readFile } from "node:fs/promises"
import { Client } from "pg"

const COMMIT = process.argv.includes("--commit")

// Files may be passed positionally; otherwise the full portal + Outlook set.
const DEFAULT_FILES = [
  "scripts/417_portal_message_read_receipts.sql",
  "scripts/418_portal_change_requests.sql",
  "scripts/419_tax_input_document_client_note.sql",
  "scripts/420_debrief_client_sharing.sql",
  "scripts/421_return_approvals.sql",
  "scripts/423_outlook_oauth_tokens.sql",
]
const positional = process.argv.slice(2).filter((a) => a.endsWith(".sql"))
const FILES = positional.length > 0 ? positional : DEFAULT_FILES

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING is not set")
  process.exit(1)
}

// sslmode=require in the URL makes node-postgres verify the chain; Supabase
// terminates TLS with its own CA, so drop the param and set ssl explicitly.
const connectionString = url.replace(/[?&]sslmode=[^&]*/i, "")

console.log(`host   : ${new URL(url).host}`)
console.log(`mode   : ${COMMIT ? "COMMIT" : "DRY RUN (rolls back)"}`)

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  await client.query("begin")

  for (const file of FILES) {
    const sql = await readFile(file, "utf8")
    const started = Date.now()
    await client.query(sql)
    console.log(`  ok   ${file} (${Date.now() - started}ms)`)
  }

  // Assert the objects exist while still inside the transaction, so a
  // migration that runs without error but creates nothing is still caught.
  const { rows } = await client.query(`
    select
      (select count(*) from information_schema.columns
        where table_schema='public' and table_name='portal_messages'
          and column_name='read_at') as portal_messages_read_at,
      (select count(*) from information_schema.columns
        where table_schema='public' and table_name='tax_input_documents'
          and column_name='client_note') as tax_input_client_note,
      (select count(*) from information_schema.columns
        where table_schema='public' and table_name='debriefs'
          and column_name='shared_with_client') as debriefs_shared_flag,
      (select count(*) from information_schema.tables
        where table_schema='public' and table_name='return_approvals') as return_approvals,
      (select count(*) from pg_policies
        where tablename='portal_messages'
          and policyname='portal_messages_mark_read') as mark_read_policy,
      (select count(*) from information_schema.tables
        where table_schema='public' and table_name='outlook_oauth_tokens') as outlook_tokens
  `)
  console.log("verify :", rows[0])

  const failed = Object.entries(rows[0]).filter(([, v]) => Number(v) === 0)
  if (failed.length > 0) {
    throw new Error(`expected objects missing: ${failed.map(([k]) => k).join(", ")}`)
  }

  await client.query(COMMIT ? "commit" : "rollback")
  console.log(COMMIT ? "COMMITTED" : "ROLLED BACK — database unchanged")
} catch (error) {
  await client.query("rollback").catch(() => {})
  console.error("FAILED — rolled back, nothing applied")
  console.error(error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
