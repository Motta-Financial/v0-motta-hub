/**
 * Invokes the corrected backfill against the live Ignition Reporting API and
 * the live Supabase database. Use this to verify the fix end-to-end without
 * having to spin up the Next.js dev server / click through the admin UI.
 *
 * Usage:
 *   node --env-file-if-exists=/vercel/share/.env.project scripts/run-ignition-backfill-once.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { runFullBackfill } from "../lib/ignition/sync"

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  })

  const { data: conn, error: connErr } = await supabase
    .from("ignition_connections")
    .select("*")
    .eq("singleton", true)
    .maybeSingle()

  if (connErr || !conn) {
    console.error("Could not load ignition_connections singleton:", connErr?.message)
    process.exit(1)
  }
  if (!conn.is_active) {
    console.error("Connection is_active=false. Reconnect first.")
    process.exit(1)
  }

  console.log("Starting backfill. Practice:", conn.ignition_practice_name ?? "(unknown)")
  console.log("Resources:", "all")
  const t0 = Date.now()
  const summary = await runFullBackfill(conn, supabase, { isManual: true })
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  console.log("Totals:")
  console.log("  fetched :", summary.totalFetched)
  console.log("  upserted:", summary.totalUpserted)
  console.log("  errors  :", summary.totalErrors)
  console.log("\nPer-resource:")
  for (const r of summary.results) {
    console.log(
      `  ${r.resource.padEnd(14)} fetched=${String(r.fetched).padEnd(5)} upserted=${String(r.upserted).padEnd(5)} pages=${String(r.pages).padEnd(3)} time=${(r.durationMs / 1000).toFixed(1)}s errors=${r.errors.length}${r.errors.length > 0 ? "  → " + r.errors.join(" | ") : ""}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
