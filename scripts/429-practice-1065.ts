/**
 * Practice 1065 (PAR) round trip: create one practice partnership return,
 * write a handful of fields to the screens our real 1065s use, and confirm
 * they landed by re-exporting.
 *
 * Why: Intuit opened Import to business modules (2026-10). Before any real
 * 1065 is touched (Dat: not before 2026-10-15, approved returns only), this
 * proves Create Return and Import work for PAR, and shows how the screens
 * missing from Intuit's catalog (s5400) behave.
 *
 * Fail-closed:
 *   - Everything targets SENTINEL_CLIENT_ID, the test client every earlier
 *     practice return used (scripts/376, 403).
 *   - The practice return is found by exact name + client + form type; the
 *     script refuses to run if zero or several match.
 *   - `create` refuses if a practice return already exists (Create Return is
 *     not idempotent and there is no delete).
 *   - Real writes need --commit; the default is a dry run.
 *
 * Side effect to know about: Karbon's ProConnect integration auto-creates
 * work items for every new return ("Tax: … (Form 1065) - 2025", assigned
 * to Dat), so `create` will produce one or two of those.
 *
 * Usage (repo root, .env.local from the mottahub project):
 *   npx tsx scripts/429-practice-1065.ts find
 *   npx tsx scripts/429-practice-1065.ts create --i-understand-this-creates-a-real-return
 *   npx tsx scripts/429-practice-1065.ts test              # dry run every series
 *   npx tsx scripts/429-practice-1065.ts test --commit     # write, then verify
 */
import { getServiceKey } from "@/lib/supabase/service-key"
import { existsSync, readFileSync } from "node:fs"
import type { ImportEntry, ReturnExport } from "@/lib/proconnect/data"

const SENTINEL_CLIENT_ID = "9341454959629628"
const PRACTICE_NAME = "PRACTICE 1065 — DO NOT FILE"
const TAX_YEAR = 2025

// Test values are deliberately round and obviously fake. Addresses come from
// the cells our 85 real 1065s populate (scripts/428 export, 2026-10-08).
const e = (prefixId: string, codeId: string, val: string, suffixId = "x1000"): ImportEntry =>
  ({ prefixId, codeId, suffixId, val })
const PLAN: { series: string; label: string; entries: ImportEntry[]; dryRunOnly?: boolean }[] = [
  { series: "s2", label: "Partner information", entries: [
    e("p1", "c1000200010", "1"), e("p1", "c1000200013", "1"),
    e("p2", "c1000200010", "1"),
  ] },
  { series: "s700", label: "Partner percentages", entries: [
    e("p1", "c501", "50"), e("p1", "c502", "50"), e("p1", "c503", "50"),
    e("p2", "c501", "50"), e("p2", "c502", "50"), e("p2", "c503", "50"),
  ] },
  { series: "s200", label: "Income", entries: [e("p0", "c101", "123456"), e("p0", "c102", "1000")] },
  { series: "s400", label: "Deductions", entries: [e("p0", "c121", "2500"), e("p0", "c123", "1000")] },
  { series: "s5700", label: "Schedule L balance sheet", entries: [e("p0", "c101", "10000"), e("p0", "c201", "20000")] },
  { series: "s1500", label: "M-2 capital accounts", entries: [
    e("p0", "c101", "5000"), e("p0", "c102", "1000"), e("p0", "c104", "500"),
  ] },
  // Not in Intuit's catalog but on 24/40 of our 2025 1065s. Dry run only:
  // we don't know what c6 means, so we only learn whether Import accepts it.
  { series: "s5400", label: "Uncatalogued screen (s5400)", entries: [e("p0", "c6", "1")], dryRunOnly: true },
]

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

/** Refresh the stored OAuth token server-side. Never /api/proconnect/sync — it runs a full sync. */
async function refreshToken() {
  const res = await fetch("https://hub.motta.cpa/api/proconnect/oauth/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status} ${await res.text()}`)
}

type RawEngagement = { engagementId?: string; id?: string; clientId?: string; name?: string; type?: string; deleted?: boolean }

async function findPractice(): Promise<RawEngagement[]> {
  const { fetchAllEngagementsForYear } = await import("@/lib/proconnect/client")
  // Not fetchEngagements(): it filters with `oiiClientId`, which the V4 doc
  // says is silently ignored (the parameter is `client`).
  const res = await fetchAllEngagementsForYear(TAX_YEAR)
  if (!res.ok || !res.data) throw new Error(`engagement list failed: ${res.status} ${res.error}`)
  return (res.data as RawEngagement[]).filter(
    (x) => x.clientId === SENTINEL_CLIENT_ID && x.name === PRACTICE_NAME && x.type === "1065" && !x.deleted,
  )
}

async function main() {
  loadEnv()
  const [cmd, ...rest] = process.argv.slice(2)
  const commit = rest.includes("--commit")
  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, getServiceKey()!, {
    auth: { persistSession: false },
  })
  await refreshToken()

  if (cmd === "find") {
    const found = await findPractice()
    console.log(found.length ? found.map((x) => x.engagementId ?? x.id).join("\n") : "no practice 1065 yet")
    return
  }

  if (cmd === "create") {
    if (!rest.includes("--i-understand-this-creates-a-real-return")) {
      console.error("refusing: pass --i-understand-this-creates-a-real-return")
      process.exit(1)
    }
    if ((await findPractice()).length) {
      console.error("refusing: a practice 1065 already exists (Create Return is not idempotent)")
      process.exit(1)
    }
    const { createTaxReturn } = await import("@/lib/proconnect/client")
    const payload = { name: PRACTICE_NAME, type: "PAR", year: TAX_YEAR }
    const { data: job } = await sb.from("proconnect_tax_return_creation_jobs").insert({
      proconnect_client_id: SENTINEL_CLIENT_ID,
      requested_name: PRACTICE_NAME,
      requested_type: "PAR",
      requested_year: TAX_YEAR,
      status: "pending",
      triggered_by: "script:429-practice-1065",
      trigger_context: { reason: "practice 1065 round trip", payload },
    }).select("id").single()
    const res = await createTaxReturn(SENTINEL_CLIENT_ID, payload)
    console.log(`create: HTTP ${res.status} ${res.ok ? "ok" : res.error}`)
    // 201 has an empty body; the id has to be found by listing.
    let id: string | null = null
    for (let i = 0; i < 6 && !id; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const found = await findPractice()
      if (found.length === 1) id = (found[0].engagementId ?? found[0].id) as string
    }
    if (job) {
      await sb.from("proconnect_tax_return_creation_jobs").update({
        status: res.ok ? "succeeded" : "failed",
        http_status: res.status,
        error_message: res.ok ? null : String(res.error),
        created_engagement_id: id,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id)
    }
    console.log(id ? `practice return: ${id}` : "created, but the id did not show up in the list yet — run `find`")
    return
  }

  if (cmd !== "test") {
    console.error("usage: find | create --i-understand-this-creates-a-real-return | test [--commit]")
    process.exit(1)
  }

  const found = await findPractice()
  if (found.length !== 1) {
    console.error(`refusing: expected exactly one practice 1065, found ${found.length}`)
    process.exit(1)
  }
  const returnId = (found[0].engagementId ?? found[0].id) as string
  const { exportReturnData, importSeries, getSeriesVersion, verifyEntriesLanded } = await import("@/lib/proconnect/data")
  const { persistReturnSnapshot } = await import("@/lib/proconnect/snapshots")

  const exported = await exportReturnData(SENTINEL_CLIENT_ID, returnId)
  if (!exported.ok) throw new Error(`export failed: ${JSON.stringify(exported.error)}`)
  let snapshot: ReturnExport = exported.data
  console.log(`practice return ${returnId}: type ${snapshot.type}, year ${snapshot.year}, ${Object.keys(snapshot.data ?? {}).length} series populated\n`)

  for (const step of PLAN) {
    const dryRun = !commit || !!step.dryRunOnly
    const version = getSeriesVersion(snapshot, step.series)
    const { data: job } = await sb.from("proconnect_import_jobs").insert({
      return_id: returnId,
      proconnect_client_id: SENTINEL_CLIENT_ID,
      series_id: step.series,
      request_version: version,
      dry_run: dryRun,
      entry_count_requested: step.entries.length,
      entries_payload: {
        entries: step.entries.map((x) => ({ prefixId: x.prefixId, codeId: x.codeId, suffixId: x.suffixId, has_val: true })),
        redacted: true,
      },
      status: "pending",
      triggered_by: "script:429-practice-1065",
      trigger_context: { reason: "practice 1065 round trip" },
    }).select("id").single()

    const res = await importSeries(SENTINEL_CLIENT_ID, returnId, step.series, { version, dryRun, entries: step.entries })
    let line = `${step.series.padEnd(6)} ${step.label.padEnd(30)} ${dryRun ? "dry run" : "COMMIT "}  `
    let verification = null
    if (!res.ok) {
      line += `HTTP ${res.error.status} ${res.error.kind}: ${String(res.error.body).slice(0, 160)}`
    } else {
      const r = res.data.results?.[0]
      line += `imported ${res.data.summary.totalImported}, rejected ${res.data.summary.totalErrors}`
      for (const err of r?.errors ?? []) {
        line += `\n         ✗ ${err.prefixId}/${err.codeId}/${err.suffixId}: ${err.errorDetails.map((d) => `${d.code} ${d.message}`).join("; ")}`
      }
      if (!dryRun) {
        const after = await exportReturnData(SENTINEL_CLIENT_ID, returnId)
        if (after.ok) {
          snapshot = after.data
          verification = verifyEntriesLanded(snapshot, step.series, step.entries, r?.errors ?? [])
          line += ` → verified ${verification.landed}/${verification.checked} landed`
          for (const u of verification.unlanded) line += `\n         ✗ not landed ${u.prefixId}/${u.codeId}/${u.suffixId}: ${u.reason}`
        } else {
          line += " → re-export FAILED, landing unverified"
        }
      }
    }
    console.log(line)
    if (job) {
      await sb.from("proconnect_import_jobs").update({
        status: !res.ok ? "failed"
          : res.data.summary.totalErrors > 0 || (verification?.unlanded.length ?? 0) > 0 ? "partial" : "succeeded",
        http_status: res.ok ? 200 : res.error.status ?? null,
        imported_count: res.ok ? res.data.summary.totalImported : null,
        error_count: res.ok ? res.data.summary.totalErrors : null,
        response_version: res.ok ? res.data.results?.[0]?.version ?? null : null,
        response_summary: res.ok ? { ...res.data.summary, verification } : null,
        error_message: res.ok ? null : String(res.error.body).slice(0, 2000),
        intuit_tid: res.intuitTid ?? null,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id)
    }
  }

  if (commit) {
    await persistReturnSnapshot(sb, SENTINEL_CLIENT_ID, returnId, snapshot)
    console.log("\nsnapshot refreshed in the Hub")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
