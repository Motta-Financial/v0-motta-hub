/**
 * 371-audit-1040-map-coverage.mjs
 *
 * Completeness audit for form_1040_proconnect_map (TY2025 IND): every
 * form_1040_lines row must be MAPPED (series_id set), COMPUTED
 * (is_computed), or DOCUMENTED (a notes string explaining why it cannot
 * or should not be mapped). Anything else lands in UNACCOUNTED and the
 * script exits 1 — run it after any labeling round or seed change.
 *
 * Usage: node --env-file=.env.local scripts/371-audit-1040-map-coverage.mjs
 */
import { readFileSync } from "node:fs"
const { createClient } = await import("@supabase/supabase-js")

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const eq = line.indexOf("=")
  if (eq < 1 || line.startsWith("#")) continue
  const key = line.slice(0, eq)
  let v = line.slice(eq + 1)
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  if (!(key in process.env)) process.env[key] = v
}

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const { data: lines } = await sb
  .from("form_1040_lines")
  .select("line_code, is_computed, section, label")
  .eq("tax_year", 2025)
  .order("ordinal")
const { data: maps } = await sb
  .from("form_1040_proconnect_map")
  .select("line_code, series_id, confidence, notes")
  .eq("tax_year", 2025)
  .eq("return_type", "IND")
const mapBy = new Map((maps ?? []).map((m) => [m.line_code, m]))

const buckets = { mapped: [], computed: [], documented: [], UNACCOUNTED: [] }
for (const l of lines ?? []) {
  const m = mapBy.get(l.line_code)
  if (l.is_computed) buckets.computed.push(l.line_code)
  else if (m?.series_id) buckets.mapped.push(`${l.line_code}(${m.confidence})`)
  else if (m?.notes) buckets.documented.push(l.line_code)
  else buckets.UNACCOUNTED.push(`${l.line_code} — ${l.label.slice(0, 55)}`)
}
for (const [k, v] of Object.entries(buckets)) {
  console.log(`\n${k} (${v.length}):`)
  for (const x of v) console.log("  " + x)
}
if (buckets.UNACCOUNTED.length > 0) {
  console.error("\nAUDIT FAILED: unaccounted lines above need a mapping or a documented reason.")
  process.exit(1)
}
console.log("\nAUDIT PASSED: every line is mapped, computed, or documented.")
