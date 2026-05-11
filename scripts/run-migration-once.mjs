// One-shot runner for a single SQL migration. Reads the file path from argv[2]
// and executes it against POSTGRES_URL_NON_POOLING (which bypasses the pgBouncer
// pooler — required for DDL because the pooler is transaction-pooled).
//
// Usage:
//   node --env-file-if-exists=/vercel/share/.env.project \
//        scripts/run-migration-once.mjs scripts/050-create-ignition-connections.sql
//
// Safe to delete after the migration succeeds; we keep the .sql file as the
// canonical record.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import pg from "pg"

const { Client } = pg

const file = process.argv[2]
if (!file) {
  console.error("Usage: run-migration-once.mjs <path-to-sql>")
  process.exit(1)
}

const sql = readFileSync(resolve(file), "utf8")
const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL
if (!connectionString) {
  console.error("POSTGRES_URL_NON_POOLING / POSTGRES_URL not set")
  process.exit(1)
}

// Supabase's pooler/db hosts present a self-signed cert from inside this
// sandbox. We disable strict verification *only* for this admin one-shot
// migration — application code goes through Supabase's SSR client, which
// handles trust correctly on its own.
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})
try {
  await client.connect()
  console.log(`[migration] Running ${file}`)
  await client.query(sql)
  console.log(`[migration] OK`)
} catch (err) {
  console.error(`[migration] FAILED:`, err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
