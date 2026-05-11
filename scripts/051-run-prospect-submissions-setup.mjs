#!/usr/bin/env node
/**
 * Applies scripts/051_prospect_submissions_setup.sql to the
 * connected Postgres database. Run with:
 *
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/051-run-prospect-submissions-setup.mjs
 *
 * Pattern mirrors scripts/050-run-jotform-intake-karbon-work-item.mjs
 * so the migration tooling stays consistent.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SQL_PATH = path.join(__dirname, "051_prospect_submissions_setup.sql")

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) {
    throw new Error("POSTGRES_URL_NON_POOLING (or POSTGRES_URL) is not set")
  }

  const sql = readFileSync(SQL_PATH, "utf-8")
  const client = new pg.Client({
    connectionString,
    // Supabase pooled connections fail TLS verification with the
    // default Node CA bundle; project standard is to disable strict
    // verification for migrations only.
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query(sql)
    console.log("[migration] 051 prospect_submissions setup: applied")
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error("[migration] 051 failed:", err.message)
  process.exit(1)
})
