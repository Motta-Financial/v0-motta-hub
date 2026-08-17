/**
 * Runner for scripts/400_portal_team_directory.sql.
 *
 * The risk here is not the view — it is the team_members policy. is_staff()
 * tests `auth_user_id = auth.uid()`, so a staff row that was never linked
 * fails its own check, and /api/auth/user's email fallback (which self-heals
 * the link) runs through the session client where RLS applies. Get that wrong
 * and unlinked staff are locked out of the Hub for good.
 *
 * So this verifies four identities, not one:
 *   staff (linked)     must keep full team_members access
 *   staff (UNLINKED)   must still find its OWN row by email, and must NOT be
 *                      able to write it
 *   portal             must lose team_members entirely, keep the directory
 *   anon               must have no directory access at all
 *
 * Applies and verifies inside one transaction it owns, committing only if all
 * four hold. Any regression rolls back, so a failed run leaves prod as it was.
 *
 * Usage:  node scripts/400-run-portal-team-directory.mjs [--apply]
 */

import pg from "pg"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes("--apply")

const env = {}
try {
  for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
} catch {}
Object.assign(env, process.env)

const conn = (env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || "").split("?")[0]
if (!conn) {
  console.error("POSTGRES_URL_NON_POOLING or POSTGRES_URL required")
  process.exit(1)
}

const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await c.connect()

const linked = (
  await c.query(
    `select auth_user_id, email from team_members
     where auth_user_id is not null and is_active = true limit 1`)
).rows[0]
const unlinked = (
  await c.query(
    `select email from team_members
     where auth_user_id is null and is_active = true limit 1`)
).rows[0]
const portal = (await c.query(`select auth_user_id, email from portal_users limit 1`)).rows[0]

if (!linked) {
  console.error("PREFLIGHT FAILED: no active, linked team_members row to verify staff access with.")
  await c.end()
  process.exit(1)
}
console.log(
  `preflight: linked staff ok · unlinked active staff ${unlinked ? "present (will be verified)" : "none"} · portal user ${portal ? "present" : "MISSING"}`,
)

const claimsFor = (uid, email) =>
  uid || email
    ? { sub: uid ?? "00000000-0000-4000-8000-000000000001", role: "authenticated", aud: "authenticated", email }
    : { role: "anon" }

/** Run sql under a simulated session, inside the current transaction. */
async function as(claims, sql) {
  await c.query("savepoint probe")
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await c.query(`set local role ${claims.role === "anon" ? "anon" : "authenticated"}`)
    return await c.query(sql)
  } finally {
    await c.query("rollback to savepoint probe").catch(() => {})
    await c.query("release savepoint probe").catch(() => {})
    await c.query("reset role").catch(() => {})
  }
}
const count = async (claims, sql) => {
  try {
    return (await as(claims, sql)).rows[0].n
  } catch {
    return "denied"
  }
}

const STAFF = claimsFor(linked.auth_user_id, linked.email)
const UNLINKED = unlinked ? claimsFor(null, unlinked.email) : null
const PORTAL = portal ? claimsFor(portal.auth_user_id, portal.email) : null
const ANON = { role: "anon" }

async function report(label) {
  console.log(`\n--- ${label} ---`)
  const out = {}
  out.staffAll = await count(STAFF, `select count(*)::int n from team_members`)
  console.log(`  staff    → team_members : ${out.staffAll}`)
  if (UNLINKED) {
    out.unlinkedAll = await count(UNLINKED, `select count(*)::int n from team_members`)
    console.log(`  unlinked → team_members : ${out.unlinkedAll} (own row only, after)`)
    try {
      const r = await as(UNLINKED, `update team_members set is_active = is_active where auth_user_id is null`)
      out.unlinkedWrite = r.rowCount
    } catch {
      out.unlinkedWrite = 0
    }
    console.log(`  unlinked → UPDATE       : ${out.unlinkedWrite} rows`)
  }
  if (PORTAL) {
    out.portalTm = await count(PORTAL, `select count(*)::int n from team_members`)
    out.portalDir = await count(PORTAL, `select count(*)::int n from portal_team_directory`)
    console.log(`  portal   → team_members : ${out.portalTm}`)
    console.log(`  portal   → directory    : ${out.portalDir}`)
  }
  out.anonDir = await count(ANON, `select count(*)::int n from portal_team_directory`)
  console.log(`  anon     → directory    : ${out.anonDir}`)
  return out
}

const sql = readFileSync(join(__dirname, "400_portal_team_directory.sql"), "utf8")
const body = sql.slice(sql.indexOf("begin;") + "begin;".length, sql.indexOf("commit;"))

let committed = false
await c.query("begin")
try {
  const before = await report("BEFORE")
  await c.query(body)
  const after = await report("AFTER")

  const fail = []
  if (!(after.staffAll > 0) || after.staffAll !== before.staffAll)
    fail.push(`staff team_members access changed: ${before.staffAll} → ${after.staffAll}`)
  if (UNLINKED) {
    if (!(after.unlinkedAll > 0))
      fail.push("unlinked staff can no longer find their own row — they would be locked out")
    if (after.unlinkedAll === before.unlinkedAll && before.unlinkedAll > 1)
      fail.push("unlinked staff still see every row — policy did not narrow")
    if (after.unlinkedWrite > 0)
      fail.push(`unlinked staff can still write ${after.unlinkedWrite} row(s) — escalation open`)
  }
  if (PORTAL) {
    if (after.portalTm !== 0 && after.portalTm !== "denied")
      fail.push(`portal still reads team_members (${after.portalTm})`)
    if (!(after.portalDir > 0))
      fail.push("portal cannot read portal_team_directory — the Your Team card would be empty")
  }
  if (after.anonDir !== "denied") fail.push(`anon can read the directory (${after.anonDir})`)

  if (!APPLY) {
    await c.query("rollback")
    console.log(`\nDRY RUN — rolled back, nothing changed.`)
    console.log(fail.length ? `WOULD FAIL:\n  - ${fail.join("\n  - ")}` : "checks pass; re-run with --apply")
  } else if (fail.length) {
    await c.query("rollback")
    console.error(`\nROLLED BACK — prod unchanged:\n  - ${fail.join("\n  - ")}`)
  } else {
    await c.query("commit")
    committed = true
    console.log("\nCOMMITTED — staff intact, unlinked staff can still sign in, portal and anon blocked.")
  }
} catch (err) {
  await c.query("rollback").catch(() => {})
  console.error("\nROLLED BACK on error — prod unchanged.")
  console.error(err instanceof Error ? err.message : err)
}

await c.end()
process.exit(APPLY && !committed ? 1 : 0)
