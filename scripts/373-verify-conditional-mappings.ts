/**
 * Verification harness for the scripts/373 conditional-mapping mechanism.
 * Renders returns from proconnect_return_field_cells through the real
 * renderer and checks the expected values. Also exercises the composer to
 * prove no wildcard / condition artifacts leak into import entries.
 *
 * Expected values were hand-verified on the sentinel return (scripts/364
 * workflow): p1 = IRA 1099-R (gross 111010 / taxable 111009, c2 checkbox
 * set), p2 = pension (gross 111012 / taxable 111011, no c2 cell), filing
 * status cell = 4 (HOH). The real return checks reuse the scripts/367
 * multi-W-2 totals.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/373-verify-conditional-mappings.ts
 */
import { createClient } from "@supabase/supabase-js"
import {
  renderForm1040,
  composeImportEntries,
  clearSchemaCache,
  type FieldCell,
} from "../lib/forms/form-1040"

const SENTINEL = "de74b2b2-ab40-4867-8a2a-d52f1518c58d"
const REAL = "2475868e-adc2-4b9c-875c-ef4a3143a179"

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
    for (const r of data ?? []) {
      out.push({
        seriesId: r.series_id, prefixId: r.prefix_id, codeId: r.code_id, suffixId: r.suffix_id,
        val: r.val, desc: r.description, src: r.src, tsj: r.tsj, scope: r.scope,
        source: r.source, cityAbbrev: r.city_abbrev,
      })
    }
    if (!data || data.length < 1000) break
  }
  return out
}

let failures = 0
function expect(label: string, actual: unknown, want: unknown) {
  const ok = actual === want
  if (!ok) failures++
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`)
}

async function main() {
clearSchemaCache()

// ── Sentinel return ─────────────────────────────────────────────────────
const sc = await fetchCells(SENTINEL)
console.log(`sentinel ${SENTINEL}: ${sc.length} cells`)
const fsCell = sc.find((c) => c.seriesId === "s1" && c.prefixId === "p0" && c.codeId === "c1000100036" && c.suffixId === "x1000")
console.log(`  filing-status cell val = ${JSON.stringify(fsCell?.val)}`)
const s = await renderForm1040(2025, sc)
expect("4a", s["4a"]?.value, 111010)
expect("4b", s["4b"]?.value, 111009)
expect("5a", s["5a"]?.value, 111012)
expect("5b", s["5b"]?.value, 111011)
expect("fs_single", s["fs_single"]?.value, false)
expect("fs_mfj", s["fs_mfj"]?.value, false)
expect("fs_mfs", s["fs_mfs"]?.value, false)
expect("fs_hoh", s["fs_hoh"]?.value, true)
expect("fs_qss", s["fs_qss"]?.value, false)

// ── Composer: no wildcard / condition artifacts ─────────────────────────
const composed = await composeImportEntries(2025, s)
let bad = 0
for (const series of composed) {
  for (const e of series.entries) {
    if (e.prefixId === "*" || series.seriesId === "s14") {
      bad++
      console.log(`  COMPOSER LEAK: ${series.seriesId}/${e.prefixId}/${e.codeId} = ${JSON.stringify(e)}`)
    }
  }
}
expect("composer emits no '*' prefixes or gated s14 entries", bad, 0)
const fsEntries = composed.flatMap((sr) =>
  sr.seriesId === "s1" ? sr.entries.filter((e) => e.codeId === "c1000100036") : [],
)
console.log(`  filing-status import entries: ${JSON.stringify(fsEntries)}`)
expect("fs predicate resolves to exactly one coded entry", fsEntries.length, 1)
expect("fs entry writes the coded value", fsEntries[0]?.val, "4")

// ── Real snapshotted return — regression sanity ─────────────────────────
const rc = await fetchCells(REAL)
console.log(`\nreal ${REAL}: ${rc.length} cells`)
const r = await renderForm1040(2025, rc)
const show = ["1a", "25a", "2b", "3b", "4a", "4b", "5a", "5b", "9", "11", "fs_single", "fs_mfj", "fs_mfs", "fs_hoh", "fs_qss"]
for (const lc of show) console.log(`  ${lc} = ${JSON.stringify(r[lc]?.value)}`)
// Migration-367-verified totals must be unchanged:
expect("1a (multi-W-2 sum, unchanged)", r["1a"]?.value, 99332)
expect("25a (multi-W-2 sum, unchanged)", r["25a"]?.value, 15969)
const fsCount = ["fs_single", "fs_mfj", "fs_mfs", "fs_hoh", "fs_qss"].filter((k) => r[k]?.value === true).length
expect("at most one filing status true", fsCount <= 1, true)

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
}
main()
