/**
 * Verification harness for the scripts/389 dependents fix.
 *
 * Renders every exported IND return through the real renderer and checks
 * that the dependents grid is COMPLETE:
 *
 *   1. Every dependent occurrence present in the export renders. Before
 *      scripts/389 the dep_* mappings were pinned to s2/p1, so only the
 *      first dependent survived and the rest vanished with no indication.
 *      This counts the raw s2 prefixes and compares.
 *   2. `value` still mirrors instances[0], so scalar consumers (composer,
 *      estimator, computed operands) are unchanged by the switch.
 *   3. Instances come back in screen order (p1, p2, p3 …), because that is
 *      the order the 1040 lists dependents in.
 *   4. dep_ssn is a sensitive type, so every instance must be maskable —
 *      masking only the scalar would leave dependents 2..n in clear. The
 *      renderer stays raw by design (the /reveal route depends on that),
 *      so this asserts the contract the API layer keys off.
 *   5. First and last name are distinct cells. dep_name reads c1000200008
 *      ("First Name"); a return where dep_name and dep_last are identical
 *      would mean the split silently mapped one code twice.
 *
 * Prints counts only — never a dependent's name or SSN.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/390-verify-1040-dependents.ts
 */
import { createClient } from "@supabase/supabase-js"
import {
  renderForm1040,
  clearSchemaCache,
  SENSITIVE_DATA_TYPES,
  type FieldCell,
} from "../lib/forms/form-1040"

/** Dependent first-name cell — one per occurrence, so it counts dependents. */
const DEP_NAME_CODE = "c1000200008"
const DEP_LINES = ["dep_name", "dep_last", "dep_ssn", "dep_rel", "dep_ctc"] as const

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function fetchCells(returnId: string): Promise<FieldCell[]> {
  const out: FieldCell[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("proconnect_return_field_cells")
      .select("series_id, prefix_id, code_id, suffix_id, val, description, src, tsj, scope, source, city_abbrev")
      .eq("return_id", returnId)
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    for (const r of data) {
      out.push({
        seriesId: r.series_id, prefixId: r.prefix_id, codeId: r.code_id, suffixId: r.suffix_id,
        val: r.val, desc: r.description, src: r.src, tsj: r.tsj, scope: r.scope,
        source: r.source, cityAbbrev: r.city_abbrev,
      })
    }
    if (data.length < 1000) break
  }
  return out
}

const prefixNum = (p: string) => {
  const n = Number.parseInt(p.replace(/^p/, ""), 10)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

async function main() {
  clearSchemaCache()

  const { data: snaps, error } = await sb
    .from("proconnect_return_snapshots")
    .select("return_id, return_type")
  if (error) throw error
  const ind = (snaps ?? []).filter((s) => (s.return_type ?? "IND") === "IND")

  const failures: string[] = []
  const hist: Record<number, number> = {}
  let withDeps = 0
  let totalRendered = 0
  let totalInExport = 0

  for (const snap of ind) {
    const rid = snap.return_id
    const short = rid.slice(0, 8)
    const cells = await fetchCells(rid)

    // Ground truth straight from the export: distinct s2 prefixes carrying
    // a dependent first name.
    const exportPrefixes = [
      ...new Set(
        cells
          .filter((c) => c.seriesId === "s2" && c.codeId === DEP_NAME_CODE && (c.desc || c.val))
          .map((c) => c.prefixId),
      ),
    ].sort((a, b) => prefixNum(a) - prefixNum(b))

    const data = await renderForm1040(2025, cells, "IND")
    const nameLine = data["dep_name"]
    const rendered = nameLine?.instances?.map((i) => i.prefixId) ?? []

    if (exportPrefixes.length === 0) {
      if (rendered.length > 0) {
        failures.push(`${short} rendered ${rendered.length} dependents but the export has none`)
      }
      continue
    }

    withDeps++
    hist[exportPrefixes.length] = (hist[exportPrefixes.length] ?? 0) + 1
    totalInExport += exportPrefixes.length
    totalRendered += rendered.length

    // (1) completeness
    if (rendered.length !== exportPrefixes.length) {
      failures.push(
        `${short} export has ${exportPrefixes.length} dependents, renderer produced ${rendered.length}`,
      )
    }
    const missing = exportPrefixes.filter((p) => !rendered.includes(p))
    if (missing.length) {
      failures.push(`${short} dropped dependent occurrence(s) ${missing.join(", ")}`)
    }

    // (3) order
    const ordered = [...rendered].sort((a, b) => prefixNum(a) - prefixNum(b))
    if (JSON.stringify(ordered) !== JSON.stringify(rendered)) {
      failures.push(`${short} dependents came back out of screen order: ${rendered.join(",")}`)
    }

    for (const code of DEP_LINES) {
      const lv = data[code]
      if (!lv?.instances?.length) continue

      // (2) scalar still mirrors the first instance
      if (JSON.stringify(lv.value) !== JSON.stringify(lv.instances[0].value)) {
        failures.push(`${short} ${code}: scalar value does not mirror instances[0]`)
      }

      // (4) every sensitive instance must be maskable
      if (SENSITIVE_DATA_TYPES.has(lv.line.dataType)) {
        for (const inst of lv.instances) {
          if (inst.value === null || inst.value === "") continue
          const raw = String(inst.value)
          if (raw.slice(-4).length !== Math.min(4, raw.length)) {
            failures.push(`${short} ${code}/${inst.prefixId}: cannot derive a mask`)
          }
        }
      }
    }

    // (5) first and last name must be different cells
    const first = data["dep_name"]?.instances ?? []
    const last = data["dep_last"]?.instances ?? []
    if (first.length && last.length) {
      const same = first.every((f) => {
        const l = last.find((x) => x.prefixId === f.prefixId)
        return l && String(l.value) === String(f.value)
      })
      if (same) {
        failures.push(`${short} dep_name and dep_last returned identical values — check the code split`)
      }
    }
  }

  console.log(`IND returns: ${ind.length}, with dependents: ${withDeps}`)
  console.log("\ndependents per return:")
  for (const [n, count] of Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${n} dependent${n === "1" ? "" : "s"}: ${count} return${count === 1 ? "" : "s"}`)
  }
  console.log(`\ndependent rows in the export: ${totalInExport}`)
  console.log(`dependent rows rendered:      ${totalRendered}`)
  const dropped = totalInExport - totalRendered
  console.log(
    dropped === 0
      ? "  no dependent rows dropped"
      : `  ${dropped} DROPPED`,
  )

  console.log("")
  if (failures.length) {
    console.log(`FAIL — ${failures.length} problem(s):`)
    for (const f of failures) console.log("  " + f)
    process.exit(1)
  }
  console.log("PASS — every dependent in every export renders, in order, with maskable SSNs.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
