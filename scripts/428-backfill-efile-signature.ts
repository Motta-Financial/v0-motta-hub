/**
 * 428 backfill: seed `efile_signature` and `list_efile_signature` from data
 * already in proconnect_engagements. NO ProConnect API calls.
 *
 *   efile_signature       ← hydratedEfileSignature(efile_filings), for every
 *                           row the hydrator has read (efile_synced_at set).
 *   list_efile_signature  ← listEfileSignature(raw_json.taxFilings) — the
 *                           bulk sync has stored the list's flat summary in
 *                           raw_json all along; this just fingerprints it.
 *
 * Without this, every hydrated engagement with a filing mismatches the list
 * after the first bulk sync and is re-hydrated once for nothing. See
 * scripts/428_proconnect_efile_list_signature.sql (apply that first).
 *
 * The final report's "list changed" count is the number of engagements whose
 * hydrated e-file status is behind ProConnect right now — it should be ~0
 * outside filing season. A large number means the two signatures are not
 * computed the same way: STOP and compare before relying on the queue.
 *
 * ─── USAGE ──────────────────────────────────────────────────────────
 *   npx tsx scripts/428-backfill-efile-signature.ts --dry-run
 *   npx tsx scripts/428-backfill-efile-signature.ts
 *
 * Needs SUPABASE_URL and a service key in .env.local.
 */
import { getServiceKey } from "@/lib/supabase/service-key"
import { existsSync, readFileSync } from "node:fs"

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

const PAGE = 500

async function main() {
  loadEnv()
  const dryRun = process.argv.includes("--dry-run")

  const { createClient } = await import("@supabase/supabase-js")
  const { hydratedEfileSignature, listEfileSignature } = await import(
    "../lib/proconnect/sync"
  )
  const sb = createClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    getServiceKey()!,
    { auth: { persistSession: false } }
  )

  let scanned = 0
  let written = 0
  let listed = 0
  let hydrated = 0
  let listChanged = 0
  const failures: string[] = []

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("proconnect_engagements")
      .select("engagement_id, efile_synced_at, efile_filings, raw_json")
      .not("engagement_id", "is", null)
      .order("engagement_id")
      .range(from, from + PAGE - 1)
    if (error) {
      console.error(`read failed @${from}: ${error.message}`)
      console.error("is migration 428_proconnect_efile_list_signature.sql applied?")
      process.exit(1)
    }
    const rows = data || []

    for (const r of rows) {
      scanned++
      const raw = (r.raw_json ?? {}) as { taxFilings?: unknown }
      const list = listEfileSignature(
        Array.isArray(raw.taxFilings) ? raw.taxFilings : undefined
      )
      const hyd = r.efile_synced_at ? hydratedEfileSignature(r.efile_filings) : null
      if (list !== null) listed++
      if (hyd !== null) hydrated++
      if (hyd !== null && list !== null && hyd !== list) listChanged++

      if (dryRun) continue
      const { error: upErr } = await sb
        .from("proconnect_engagements")
        .update({ list_efile_signature: list, efile_signature: hyd })
        .eq("engagement_id", r.engagement_id)
      if (upErr) failures.push(`${r.engagement_id}: ${upErr.message}`)
      else written++
    }
    if (rows.length < PAGE) break
  }

  console.log(`scanned       ${scanned}`)
  console.log(`list summary  ${listed}`)
  console.log(`hydrated      ${hydrated}`)
  console.log(`list changed  ${listChanged}  (hydrated status behind ProConnect)`)
  console.log(dryRun ? "--dry-run: nothing written" : `written       ${written}`)
  if (failures.length) {
    console.log(`${failures.length} failed:`)
    for (const f of failures.slice(0, 20)) console.log(`  ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
