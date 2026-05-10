// Applies scripts/048_jotform_feedback_client_link.sql via direct
// pg connection. Mirrors the runner pattern used by 045/046/047.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import pg from "pg"

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, "048_jotform_feedback_client_link.sql")
const sql = readFileSync(sqlPath, "utf8")

const c = new Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING,
  ssl: { rejectUnauthorized: false },
})

await c.connect()
console.log("[v0] Applying", sqlPath)
await c.query(sql)
console.log("[v0] Done — link_method + linked_at + indexes added to jotform_feedback_submissions")
await c.end()
