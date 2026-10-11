/**
 * Export every 1065 (PAR) return into proconnect_return_snapshots /
 * proconnect_return_field_cells — READ-ONLY against ProConnect.
 *
 * Why: Intuit opened Import to business modules (2026-10). Before mapping
 * the 1065 we need to see which series our partnerships actually populate;
 * only 8 of ~85 PAR returns had ever been exported. This only calls the
 * Export API (GET) and writes to our own tables via the shared
 * persistReturnSnapshot(), so nothing in ProConnect changes.
 *
 * Usage (repo root, .env.local pulled from the mottahub project):
 *   npx tsx scripts/428-export-1065-returns.ts            # dry run: list targets
 *   npx tsx scripts/428-export-1065-returns.ts --run      # export + persist
 *   npx tsx scripts/428-export-1065-returns.ts --run --years 2024,2025
 *
 * Token: refreshed via POST /api/proconnect/oauth/refresh (never
 * /api/proconnect/sync — that runs a full sync as a side effect).
 */
import { getServiceKey } from "@/lib/supabase/service-key"
import { readFileSync, existsSync } from "node:fs"

function loadEnv() {
  const path = `${process.cwd()}/.env.local`
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=")
    if (eq < 1 || line.startsWith("#")) continue
    const key = line.slice(0, eq)
    let v = line.slice(eq + 1)
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    if (!(key in process.env)) process.env[key] = v
  }
}

async function main() {
  loadEnv()
  const args = process.argv.slice(2)
  const run = args.includes("--run")
  const yearsArg = args[args.indexOf("--years") + 1]
  const years = args.includes("--years") && yearsArg ? yearsArg.split(",").map(Number) : null

  const { createClient } = await import("@supabase/supabase-js")
  const { exportReturnData } = await import("@/lib/proconnect/data")
  const { persistReturnSnapshot } = await import("@/lib/proconnect/snapshots")
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    getServiceKey()!,
    { auth: { persistSession: false } },
  )

  let q = sb
    .from("proconnect_engagements")
    .select("engagement_id, proconnect_client_id, tax_year, raw_json")
    .or("form_type.eq.1065,return_type.eq.1065")
    .order("tax_year", { ascending: false })
  if (years) q = q.in("tax_year", years)
  const { data: engs, error } = await q
  if (error) throw new Error(error.message)

  const targets = (engs ?? []).filter((e) => (e.raw_json as { deleted?: boolean } | null)?.deleted !== true)
  const byYear: Record<string, number> = {}
  for (const e of targets) byYear[e.tax_year] = (byYear[e.tax_year] ?? 0) + 1
  console.log(`1065 engagements: ${targets.length} (skipped ${(engs?.length ?? 0) - targets.length} deleted)`, byYear)
  if (!run) {
    console.log("dry run — pass --run to export")
    return
  }

  console.log("refreshing token via /api/proconnect/oauth/refresh ...")
  const res = await fetch("https://hub.motta.cpa/api/proconnect/oauth/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status} ${await res.text()}`)

  let ok = 0
  const failures: { returnId: string; year: number; error: string }[] = []
  for (const e of targets) {
    const result = await exportReturnData(e.proconnect_client_id, e.engagement_id)
    if (!result.ok) {
      failures.push({ returnId: e.engagement_id, year: e.tax_year, error: JSON.stringify(result.error) })
      continue
    }
    try {
      const { cellCount } = await persistReturnSnapshot(sb, e.proconnect_client_id, e.engagement_id, result.data)
      ok++
      console.log(`  ok  ${e.tax_year} ${e.engagement_id}  ${cellCount} cells`)
    } catch (err) {
      failures.push({ returnId: e.engagement_id, year: e.tax_year, error: String(err) })
    }
  }
  console.log(`\nexported ${ok}/${targets.length}; ${failures.length} failed`)
  for (const f of failures) console.log(`  FAIL ${f.year} ${f.returnId}: ${f.error.slice(0, 200)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
