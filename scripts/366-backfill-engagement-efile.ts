/**
 * 366-backfill-engagement-efile.ts
 *
 * Hydrate `efile_status` / `efile_filings` for engagements that have never
 * been read from the single-engagement GET.
 *
 * ─── WHY A SCRIPT ───────────────────────────────────────────────────
 * E-file status is not on the engagement LIST endpoint. `taxFiling.filings[]`
 * comes back empty there on all 908 engagements regardless of
 * `include-efiles=true`; only `GET /v2/engagements/{id}` carries it. So the
 * one-time catch-up for existing rows is one API call per engagement at the
 * client's ~4 req/s throttle — ~0.7s each in practice, so around 10 minutes
 * for the current 908 rows. That doesn't belong in a request handler, and the
 * nightly cron only takes a capped bite per run (~200 engagements, bounded by
 * PROCONNECT_EFILE_HYDRATE_BUDGET_MS), so this drains the backlog in one go
 * instead of over five nights.
 *
 * Ongoing freshness is NOT this script's job: webhooks hydrate the engagement
 * that changed (app/api/proconnect/webhooks), and the nightly bulk sync
 * re-reads anything modified in ProConnect since we last looked. This is
 * bootstrap only. Safe to re-run: hydrated rows drop out of the queue.
 *
 * ─── LOCAL CREDENTIALS ──────────────────────────────────────────────
 * `.env.local` pulled from this repo's default Vercel project has ProConnect
 * client creds that fail token refresh with `invalid_client` (the live
 * integration is on the `mottahub` project). The stored access token in the
 * DB is shared, though, so the 364 script's trick works here too: refresh it
 * server-side first, then run locally against the fresh token.
 *
 *   --refresh-token   POST https://hub.motta.cpa/api/proconnect/oauth/refresh
 *                     with CRON_SECRET before starting.
 *
 * The token lives ~1 hour, comfortably longer than a full backfill.
 *
 * Use that flag, NOT `POST /api/proconnect/sync`, even though the sync route
 * also refreshes the token as a side effect. Doing it that way on 2026-07-28
 * ran the then-deployed list-path code mid-backfill and blanked 407 already-
 * hydrated `efile_status` values. Refresh a token by refreshing a token.
 *
 * ─── USAGE ──────────────────────────────────────────────────────────
 *   npx tsx scripts/366-backfill-engagement-efile.ts --refresh-token
 *   npx tsx scripts/366-backfill-engagement-efile.ts --year 2025 --limit 50
 *   npx tsx scripts/366-backfill-engagement-efile.ts --all      # re-read everything
 *   npx tsx scripts/366-backfill-engagement-efile.ts --dry-run  # queue only, no calls
 *
 * Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (and CRON_SECRET for
 * --refresh-token) in .env.local. Requires migration 366 to be applied.
 */
import { existsSync, readFileSync } from "node:fs"

interface Args {
  year?: number
  limit?: number
  all: boolean
  dryRun: boolean
  refreshToken: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const out: Args = { all: false, dryRun: false, refreshToken: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--all") out.all = true
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--refresh-token") out.refreshToken = true
    else if (a === "--year") out.year = Number.parseInt(argv[++i], 10)
    else if (a === "--limit") out.limit = Number.parseInt(argv[++i], 10)
    else {
      console.error(`unknown argument: ${a}`)
      process.exit(1)
    }
  }
  return out
}

// Must run before anything imports lib/proconnect/* — oauth.ts reads its env
// vars at module scope, so a static import would capture them as undefined.
function loadEnv() {
  const path = `${process.cwd()}/.env.local`
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=")
    if (eq < 1 || line.startsWith("#")) continue
    const key = line.slice(0, eq)
    let v = line.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = v
  }
}

async function refreshTokenViaProduction() {
  if (!process.env.CRON_SECRET) {
    console.error("--refresh-token needs CRON_SECRET in .env.local")
    process.exit(1)
  }
  console.log("refreshing the stored ProConnect token via production...")
  const res = await fetch("https://hub.motta.cpa/api/proconnect/oauth/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  console.log(`  refresh: ${res.status} ${body.ok ? `ok, expires ${body.expiresAt}` : "FAILED"}`)
  if (!res.ok || !body.ok) {
    console.error("  token refresh failed — aborting rather than burning calls on a stale token")
    console.error(`  response: ${JSON.stringify(body).slice(0, 400)}`)
    process.exit(1)
  }
}

async function main() {
  loadEnv()
  const args = parseArgs()

  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // `--all` re-reads every engagement; the default reads the stale view
  // (never hydrated, or modified in ProConnect since we last looked).
  const source = args.all
    ? "proconnect_engagements"
    : "proconnect_engagements_efile_stale"
  let query = sb
    .from(source)
    .select("engagement_id, tax_year")
    .not("engagement_id", "is", null)
    .order("tax_year", { ascending: false })
  if (args.year) query = query.eq("tax_year", args.year)
  if (args.limit) query = query.limit(args.limit)

  const { data: queue, error } = await query
  if (error) {
    console.error(`queue query failed: ${error.message}`)
    if (source === "proconnect_engagements_efile_stale") {
      console.error("is migration 366_proconnect_engagement_efile.sql applied?")
    }
    process.exit(1)
  }

  const ids = (queue || []).map((r) => r.engagement_id as string)
  const byYear = new Map<number, number>()
  for (const r of queue || []) {
    const y = r.tax_year as number
    byYear.set(y, (byYear.get(y) || 0) + 1)
  }
  console.log(
    `${ids.length} engagement(s) to hydrate from ${source}` +
      (args.year ? ` (tax year ${args.year})` : "")
  )
  for (const y of [...byYear.keys()].sort((a, b) => b - a)) {
    console.log(`  ${y}: ${byYear.get(y)}`)
  }
  // Measured ~0.7s per engagement end to end: the 250ms rate-limit slot plus
  // a stored-token lookup, the API call, and the row update.
  console.log(`  estimated runtime: ~${Math.ceil((ids.length * 0.7) / 60)} min`)

  if (args.dryRun) {
    console.log("--dry-run: no API calls made")
    return
  }
  if (ids.length === 0) return

  if (args.refreshToken) await refreshTokenViaProduction()

  const { hydrateEngagementEfile } = await import("../lib/proconnect/sync")

  const statusCounts = new Map<string, number>()
  // "has a filing record" and "has a filing STATUS" are different: a
  // pristine REGULAR filing can exist with an empty status history while its
  // extension child carries all the activity.
  let withStatus = 0
  let filingsNoStatus = 0
  let noFilings = 0
  let missingRow = 0
  let gone = 0
  const failures: string[] = []
  const startedAt = Date.now()

  for (let i = 0; i < ids.length; i++) {
    const result = await hydrateEngagementEfile(ids[i], sb)
    if (result.ok) {
      if (result.status) {
        withStatus++
        const qualifier =
          result.latest && result.latest.filingType !== "REGULAR"
            ? ` (${result.latest.filingType})`
            : ""
        const key = `${result.status}${qualifier}`
        statusCounts.set(key, (statusCounts.get(key) || 0) + 1)
      } else if (result.hasFilings) {
        // A filing record exists but has produced no status yet — e.g. a
        // REGULAR return set up in PTO but not transmitted.
        filingsNoStatus++
      } else {
        noFilings++
      }
    } else if (result.notFound) {
      // Deleted in ProConnect, still in our table. Stamped so it drops out of
      // the stale queue; not a failure worth aborting over.
      gone++
    } else if (result.missingRow) {
      missingRow++
    } else {
      failures.push(`${ids[i]}: ${result.error}`)
      // A failing token or a revoked scope fails identically for every
      // engagement. Stop rather than spend 900 calls proving it.
      if (failures.length >= 10) {
        console.error("\n10 consecutive-ish failures — stopping early:")
        for (const f of failures.slice(-10)) console.error(`  ${f}`)
        break
      }
    }

    if ((i + 1) % 25 === 0 || i === ids.length - 1) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      console.log(
        `  ${i + 1}/${ids.length} — ${withStatus} with status, ` +
          `${filingsNoStatus + noFilings} none, ` +
          `${missingRow} row-missing, ${failures.length} failed (${elapsed}s)`
      )
    }
  }

  const attempted =
    withStatus + filingsNoStatus + noFilings + missingRow + gone + failures.length
  console.log("\n─── e-file backfill summary ───")
  console.log(`attempted:       ${attempted}`)
  console.log(`with status:     ${withStatus}`)
  console.log(`filings, no status: ${filingsNoStatus}`)
  console.log(`no filings:      ${noFilings}`)
  if (gone > 0) {
    console.log(`gone from PTO:   ${gone} (404 — deleted in ProConnect, still in our table)`)
  }
  if (missingRow > 0) {
    console.log(`row missing:     ${missingRow} (engagement not in proconnect_engagements yet)`)
  }
  if (failures.length > 0) {
    console.log(`failed:          ${failures.length}`)
    for (const f of failures.slice(0, 10)) console.log(`  ${f}`)
  }
  if (statusCounts.size > 0) {
    console.log("\nfiling statuses:")
    for (const [status, n] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(4)}  ${status}`)
    }
  }

  const { count: total } = await sb
    .from("proconnect_engagements")
    .select("*", { count: "exact", head: true })
  const { count: hydrated } = await sb
    .from("proconnect_engagements")
    .select("*", { count: "exact", head: true })
    .not("efile_synced_at", "is", null)
  console.log(`\ncoverage: ${hydrated}/${total} engagements hydrated`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
