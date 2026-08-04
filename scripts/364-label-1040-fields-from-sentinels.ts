/**
 * 364-label-1040-fields-from-sentinels.ts
 *
 * Discover ProConnect series/code -> 1040 line mappings by sentinel diffing,
 * per Intuit's sanctioned path (no field catalog yet; enter data in PTO and
 * observe where it lands).
 *
 * Workflow:
 *   1. baseline  — save the return's current cells (from the DB snapshot) to
 *                  a local JSON file BEFORE editing anything in PTO.
 *   2. (human)   — in ProConnect, enter distinct sentinel values into known
 *                  1040 fields on the TEST return. Use a sentinel manifest
 *                  (JSON: {"111001": "1a", "111002": "2b", ...}) mapping each
 *                  sentinel value to the form_1040_lines.line_code you typed
 *                  it into.
 *   3. diff      — re-export the return live, diff cells against the baseline,
 *                  and match changed cells to the manifest. Prints proposed
 *                  mapping rows. Nothing is written without --apply.
 *   4. --apply   — upsert confirmed mappings into form_1040_proconnect_map
 *                  (confidence "confirmed", notes record method + date).
 *                  Lines whose existing map row carries a condition
 *                  (scripts/373 instance gates / value predicates) or the
 *                  '*' aggregate prefix (scripts/367) are SKIPPED with a
 *                  warning: sentinel diffing observes a single cell and
 *                  cannot express either, so the upsert would clobber
 *                  prefix_id and strand a stale condition. Fix those rows
 *                  by hand if the sentinel disagrees with them.
 *
 * Brand-new dummy return (no snapshot in the DB yet): the first `baseline`
 * saves 0 cells, so run `diff` once with no --manifest right after — it
 * exports live and persists the return's pre-sentinel snapshot — then run
 * `baseline` again to capture it. Only then enter sentinels in PTO.
 *
 * Only sentinel INPUT lines. PTO-computed lines (6b, 12a, 13, 16, 17, 19,
 * 23, 27, totals) never appear in the export as input cells (Steve, Intuit
 * 2026-07-27: no calculated values via the API) — a sentinel forced into one
 * via a synthetic input would map the line to the wrong cell on real returns.
 *
 * Usage (from repo root; needs .env.local pulled from the mottahub project —
 * `vercel env pull .env.local` — for SUPABASE_URL/SERVICE_ROLE_KEY/CRON_SECRET):
 *   npx tsx scripts/364-label-1040-fields-from-sentinels.ts baseline --return <returnId>
 *   npx tsx scripts/364-label-1040-fields-from-sentinels.ts diff --return <returnId> \
 *       --manifest sentinels.json [--tax-year 2025] [--apply]
 *
 * Token note: ProConnect client creds pull as "[SENSITIVE]" locally, so this
 * script cannot refresh the OAuth token itself. It first POSTs the production
 * /api/proconnect/sync with CRON_SECRET, which refreshes + stores the token
 * server-side; the local export then rides the fresh DB-stored access token.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"

type CellKey = string // `${series}/${prefix}/${code}/${suffix}`
type CellVal = { val: string | null; description: string | null }

function parseArgs() {
  const [, , cmd, ...rest] = process.argv
  const opts: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2)
      const next = rest[i + 1]
      if (!next || next.startsWith("--")) opts[key] = true
      else { opts[key] = next; i++ }
    }
  }
  return { cmd, opts }
}

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

const baselinePath = (returnId: string) => `scripts/.sentinel-baseline-${returnId}.json`
const keyOf = (c: { series_id: string; prefix_id: string | null; code_id: string; suffix_id: string | null }): CellKey =>
  `${c.series_id}/${c.prefix_id ?? "p0"}/${c.code_id}/${c.suffix_id ?? "x1000"}`

async function main() {
  loadEnv()
  const { cmd, opts } = parseArgs()
  const returnId = opts["return"] as string
  if (!returnId || !["baseline", "diff"].includes(cmd)) {
    console.error("usage: baseline|diff --return <returnId> [--manifest sentinels.json] [--tax-year 2025] [--apply]")
    process.exit(1)
  }

  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: eng, error: engErr } = await sb
    .from("proconnect_engagements")
    .select("proconnect_client_id, tax_year")
    .eq("engagement_id", returnId)
    .maybeSingle()
  if (engErr || !eng) { console.error("engagement lookup failed:", engErr?.message ?? "not found"); process.exit(1) }
  const clientId = eng.proconnect_client_id as string

  if (cmd === "baseline") {
    const { data: cells, error } = await sb
      .from("proconnect_return_field_cells")
      .select("series_id, prefix_id, code_id, suffix_id, val, description")
      .eq("return_id", returnId)
      .limit(10000)
    if (error) { console.error(error.message); process.exit(1) }
    const map: Record<CellKey, CellVal> = {}
    for (const c of cells ?? []) map[keyOf(c)] = { val: c.val, description: c.description }
    writeFileSync(baselinePath(returnId), JSON.stringify(map, null, 1))
    console.log(`baseline saved: ${Object.keys(map).length} cells -> ${baselinePath(returnId)}`)
    console.log("Now enter your sentinel values in ProConnect, then run the diff step.")
    return
  }

  // ── diff ──
  if (!existsSync(baselinePath(returnId))) { console.error(`no baseline at ${baselinePath(returnId)} — run baseline first`); process.exit(1) }
  const baseline: Record<CellKey, CellVal> = JSON.parse(readFileSync(baselinePath(returnId), "utf8"))

  // Manifest: sentinel value -> form_1040_lines.line_code
  const manifestFile = opts["manifest"] as string | undefined
  const manifest: Record<string, string> = manifestFile ? JSON.parse(readFileSync(manifestFile, "utf8")) : {}

  // Refresh the OAuth token server-side (local env has no ProConnect creds).
  if (process.env.CRON_SECRET) {
    console.log("refreshing token via production manual sync...")
    const res = await fetch("https://hub.motta.cpa/api/proconnect/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    console.log("sync:", res.status, (await res.json()).ok ? "ok" : "FAILED")
  } else {
    console.warn("CRON_SECRET not set — assuming the DB token is already fresh")
  }

  const { exportReturnData } = await import("../lib/proconnect/data")
  const { persistReturnSnapshot } = await import("../lib/proconnect/snapshots")
  const result = await exportReturnData(clientId, returnId)
  if (!result.ok) { console.error(`export failed: ${result.error.kind} ${result.error.status}`); process.exit(1) }
  await persistReturnSnapshot(sb, clientId, returnId, result.data)

  const { data: fresh } = await sb
    .from("proconnect_return_field_cells")
    .select("series_id, prefix_id, code_id, suffix_id, val, description")
    .eq("return_id", returnId)
    .limit(10000)

  const changed: Array<{ key: CellKey; before: CellVal | undefined; after: CellVal }> = []
  for (const c of fresh ?? []) {
    const k = keyOf(c)
    const b = baseline[k]
    if (!b || b.val !== c.val || b.description !== c.description) {
      changed.push({ key: k, before: b, after: { val: c.val, description: c.description } })
    }
  }
  console.log(`\n${changed.length} cell(s) changed vs baseline:`)
  const proposals: Array<{ line_code: string; series_id: string; prefix_id: string; code_id: string; suffix_id: string }> = []
  for (const ch of changed) {
    const [series_id, prefix_id, code_id, suffix_id] = ch.key.split("/")
    const normalized = ch.after.val != null ? String(ch.after.val).replace(/,/g, "").replace(/\.0*$/, "") : null
    const sentinelHit = normalized != null ? manifest[normalized] : undefined
    console.log(`  ${ch.key}: ${ch.before?.val ?? "(absent)"} -> ${ch.after.val}${sentinelHit ? `   ==> line ${sentinelHit}` : ""}`)
    if (sentinelHit) proposals.push({ line_code: sentinelHit, series_id, prefix_id, code_id, suffix_id })
  }

  if (!proposals.length) { console.log("\nno sentinel matches — check the manifest values"); return }

  // A sentinel that landed in more than one cell (e.g. a state-wage mirror of
  // a federal amount) is ambiguous: which cell is the 1040 line? Exclude those
  // line codes from --apply; resolve by hand against the series skill notes.
  const byLine = new Map<string, typeof proposals>()
  for (const p of proposals) byLine.set(p.line_code, [...(byLine.get(p.line_code) ?? []), p])
  const unambiguous = [...byLine.values()].filter((a) => a.length === 1).map((a) => a[0])
  const ambiguous = [...byLine.entries()].filter(([, a]) => a.length > 1)

  console.log(`\n${unambiguous.length} proposed mapping(s):`)
  for (const p of unambiguous) console.log(`  ${p.line_code} <- ${p.series_id}/${p.prefix_id}/${p.code_id}/${p.suffix_id}`)
  if (ambiguous.length) {
    console.warn(`\n${ambiguous.length} line(s) matched MULTIPLE cells — excluded from --apply, pick the right cell manually:`)
    for (const [line, arr] of ambiguous)
      console.warn(`  ${line}: ${arr.map((p) => `${p.series_id}/${p.prefix_id}/${p.code_id}/${p.suffix_id}`).join("  vs  ")}`)
  }

  if (!opts["apply"]) { console.log("\ndry run — re-run with --apply to upsert into form_1040_proconnect_map"); return }

  const taxYear = Number(opts["tax-year"] ?? eng.tax_year ?? 2025)

  // discovered_from is a UUID FK to proconnect_return_snapshots(id).
  const { data: snap } = await sb
    .from("proconnect_return_snapshots")
    .select("id")
    .eq("return_id", returnId)
    .maybeSingle()

  // line_code has an FK to form_1040_lines — validate before upserting.
  const { data: knownLines } = await sb
    .from("form_1040_lines")
    .select("line_code")
    .eq("tax_year", taxYear)
  const known = new Set((knownLines ?? []).map((l) => l.line_code))
  const bad = unambiguous.filter((p) => !known.has(p.line_code))
  if (bad.length) {
    console.error(`\nmanifest line codes not in form_1040_lines (ty${taxYear}): ${bad.map((b) => b.line_code).join(", ")}`)
    console.error("fix the manifest — these would violate the FK. Aborting before any writes.")
    process.exit(1)
  }

  // Conditional (scripts/373) and '*'-aggregate (scripts/367) rows encode
  // semantics a single observed cell can't: the upsert would rewrite
  // prefix_id (e.g. '*' -> 'p1') while the old condition rides along on the
  // new tuple, silently misrouting real returns. Skip them.
  const { data: existing, error: exErr } = await sb
    .from("form_1040_proconnect_map")
    .select("line_code, prefix_id, condition")
    .eq("tax_year", taxYear)
    .eq("return_type", "IND")
    .in("line_code", unambiguous.map((p) => p.line_code))
  if (exErr) {
    console.error(`\nexisting-map lookup failed: ${exErr.message}`)
    console.error("cannot tell which lines carry conditions — aborting before any writes.")
    process.exit(1)
  }
  const protectedRows = new Map(
    (existing ?? [])
      .filter((r) => r.condition != null || r.prefix_id === "*")
      .map((r) => [r.line_code as string, r]),
  )
  const writable = unambiguous.filter((p) => !protectedRows.has(p.line_code))
  if (protectedRows.size) {
    console.warn(`\n${protectedRows.size} line(s) SKIPPED — existing map row is conditional/aggregate (scripts/373/367); edit by hand if the sentinel disagrees:`)
    for (const [line, r] of protectedRows)
      console.warn(`  ${line}: prefix_id=${r.prefix_id}${r.condition != null ? ` condition=${JSON.stringify(r.condition)}` : ""}`)
  }

  for (const p of writable) {
    const { error } = await sb.from("form_1040_proconnect_map").upsert(
      {
        tax_year: taxYear,
        return_type: "IND",
        line_code: p.line_code,
        series_id: p.series_id,
        prefix_id: p.prefix_id,
        code_id: p.code_id,
        suffix_id: p.suffix_id,
        cell_field: "val",
        confidence: "confirmed",
        discovered_at: new Date().toISOString(),
        discovered_from: snap?.id ?? null,
        notes: `Labeled via PTO manual entry + export diff on return ${returnId} (Intuit-sanctioned path, no field catalog yet).`,
      },
      { onConflict: "tax_year,return_type,line_code" },
    )
    if (error) console.error(`  upsert ${p.line_code} FAILED: ${error.message}`)
    else console.log(`  upsert ${p.line_code} ok`)
  }
  console.log("\nDone. Note: the 1040 viewer caches the schema per lambda instance; new mappings appear on a fresh instance (or after the next deploy).")
}

main().catch((e) => { console.error(e); process.exit(1) })
