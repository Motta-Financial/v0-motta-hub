/**
 * Runner for scripts/399_rls_lock_permissive_policies.sql.
 *
 * The migration is a one-line idea (`true` → `is_staff()`) with one real
 * risk: if is_staff() does not return true for a staff session, applying it
 * locks the whole team out of the Hub. So this does not just execute the
 * SQL — it proves the predicate on live data first, then applies and verifies
 * inside ONE transaction it controls itself, and COMMITs only if staff access
 * survived and the portal session actually lost the canary tables. Any
 * regression rolls the whole thing back, so a failed run leaves prod exactly
 * as it was.
 *
 * That is why this reads the DO block out of the .sql and drives the
 * transaction here rather than executing the file wholesale: the file carries
 * its own begin/commit so it stays usable from psql, and a self-committing
 * file cannot be un-done after a bad verify.
 *
 * Usage:  node scripts/399-run-rls-lock.mjs [--apply]
 * Without --apply it reports what would change and exits (dry run).
 */

import pg from "pg"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes("--apply")

function loadEnv() {
  const out = {}
  try {
    for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {}
  return { ...out, ...process.env }
}

const env = loadEnv()
const conn = (env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || "").split("?")[0]
if (!conn) {
  console.error("POSTGRES_URL_NON_POOLING or POSTGRES_URL required")
  process.exit(1)
}

const PORTAL_TABLES = [
  "contacts", "documents", "organizations", "portal_messages",
  "portal_task_comments", "portal_user_access", "portal_users",
  "team_members", "work_items",
]

/** Count rows a given session can see, without changing anything. */
async function visibleAs(c, uid, table) {
  await c.query("begin")
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid ? { sub: uid, role: "authenticated", aud: "authenticated" } : { role: "anon" }),
    ])
    await c.query(`set local role ${uid ? "authenticated" : "anon"}`)
    const r = await c.query(`select count(*)::int n from ${table}`)
    return r.rows[0].n
  } catch {
    return null // permission denied — also a valid "cannot see it"
  } finally {
    await c.query("rollback").catch(() => {})
  }
}

const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await c.connect()

// ── PREFLIGHT ───────────────────────────────────────────────────────────
// is_staff() must separate staff from portal before we lean on it.
const staff = await c.query(
  `select auth_user_id from team_members where auth_user_id is not null and is_active = true limit 1`,
)
const portal = await c.query(`select auth_user_id from portal_users limit 1`)
const staffUid = staff.rows[0]?.auth_user_id ?? null
const portalUid = portal.rows[0]?.auth_user_id ?? null

if (!staffUid) {
  console.error("PREFLIGHT FAILED: no active team_members row with an auth_user_id.")
  console.error("Applying would lock every staff user out. Refusing.")
  await c.end()
  process.exit(1)
}

async function isStaffFor(uid) {
  await c.query("begin")
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: uid, role: "authenticated", aud: "authenticated" }),
    ])
    await c.query("set local role authenticated")
    return (await c.query(`select is_staff() s`)).rows[0].s
  } finally {
    await c.query("rollback").catch(() => {})
  }
}

const staffOK = await isStaffFor(staffUid)
const portalOK = portalUid ? await isStaffFor(portalUid) : false
console.log(`preflight: is_staff() staff=${staffOK} portal=${portalOK}`)
if (staffOK !== true || portalOK !== false) {
  console.error("PREFLIGHT FAILED: is_staff() does not separate staff from portal. Refusing.")
  await c.end()
  process.exit(1)
}

// ── BEFORE ──────────────────────────────────────────────────────────────
const targets = await c.query(`
  select count(*)::int n, count(distinct tablename)::int t
  from pg_policies
  where schemaname='public' and (qual='true' or with_check='true')
    and roles::text not like '%service_role%'
    and not (tablename = any($1::text[]))`, [PORTAL_TABLES])
console.log(`policies to tighten: ${targets.rows[0].n} across ${targets.rows[0].t} tables`)

// Canary tables: staff must keep these, portal must lose them.
const CANARIES = ["debriefs", "zoom_transcripts", "karbon_timesheets", "internal_clients"]
const before = {}
for (const t of CANARIES) {
  before[t] = { staff: await visibleAs(c, staffUid, t), portal: await visibleAs(c, portalUid, t) }
}
console.log("before:", JSON.stringify(before))

if (!APPLY) {
  console.log("\nDRY RUN — nothing changed. Re-run with --apply to execute.")
  await c.end()
  process.exit(0)
}

// ── APPLY + VERIFY, in one transaction we control ───────────────────────
const sql = readFileSync(join(__dirname, "399_rls_lock_permissive_policies.sql"), "utf8")

// Take just the DO block. The file's own begin/commit exists so it can be run
// straight from psql; here we need the transaction boundary in our hands so a
// failed verify can roll the change back.
const doBlock = sql.match(/do \$\$[\s\S]*?end \$\$;/)
if (!doBlock) {
  console.error("could not locate the DO block in 399_rls_lock_permissive_policies.sql")
  await c.end()
  process.exit(1)
}

/** Row count for a session, evaluated inside the CURRENT transaction. */
async function visibleInTx(uid, table) {
  await c.query("savepoint probe")
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid ? { sub: uid, role: "authenticated", aud: "authenticated" } : { role: "anon" }),
    ])
    await c.query(`set local role ${uid ? "authenticated" : "anon"}`)
    const r = await c.query(`select count(*)::int n from ${table}`)
    return r.rows[0].n
  } catch {
    return null
  } finally {
    // Drop back to the migrating role before the next statement.
    await c.query("rollback to savepoint probe").catch(() => {})
    await c.query("release savepoint probe").catch(() => {})
    await c.query("reset role").catch(() => {})
  }
}

let committed = false
await c.query("begin")
try {
  await c.query(doBlock[0])

  const after = {}
  for (const t of CANARIES) {
    after[t] = { staff: await visibleInTx(staffUid, t), portal: await visibleInTx(portalUid, t) }
  }
  console.log("after: ", JSON.stringify(after))

  const staffRegressed = CANARIES.filter((t) => (before[t].staff ?? 0) > 0 && !(after[t].staff > 0))
  const portalStillOpen = CANARIES.filter((t) => (after[t].portal ?? 0) > 0)

  const leftover = await c.query(`
    select count(*)::int n from pg_policies
    where schemaname='public' and (qual='true' or with_check='true')
      and roles::text not like '%service_role%'
      and not (tablename = any($1::text[]))`, [PORTAL_TABLES])
  console.log(`remaining permissive policies outside the portal allowlist: ${leftover.rows[0].n}`)

  if (staffRegressed.length) console.error(`STAFF ACCESS REGRESSED on: ${staffRegressed.join(", ")}`)
  if (portalStillOpen.length) console.error(`PORTAL STILL READS: ${portalStillOpen.join(", ")}`)

  if (staffRegressed.length || portalStillOpen.length || leftover.rows[0].n > 0) {
    await c.query("rollback")
    console.error("\nROLLED BACK — prod is unchanged. Investigate before shipping the portal.")
  } else {
    await c.query("commit")
    committed = true
    console.log("\nCOMMITTED — staff access intact, portal and anon blocked.")
  }
} catch (err) {
  await c.query("rollback").catch(() => {})
  console.error("\nROLLED BACK on error — prod is unchanged.")
  console.error(err instanceof Error ? err.message : err)
}

await c.end()
process.exit(committed ? 0 : 1)
