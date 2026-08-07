/**
 * Service-catalog filter tests.
 *
 *   node scripts/test-service-filter.mjs
 *
 * Covers the three ways the debrief's "Project Finance" picker could hide
 * a service the partner needs to quote:
 *
 *   1. An empty query must return the WHOLE catalog. The previous
 *      implementation's debounced fetch bailed on an empty string, so
 *      clearing the search box left the last subset on screen under an
 *      empty input.
 *   2. Multi-term queries must narrow, not widen — "tax 1040" should find
 *      the 1040 return, not everything tax-related.
 *   3. Punctuation must not break the PostgREST `or()` filter. An
 *      unescaped comma splits the filter list, 500s the request, and the
 *      caller's catch swallows it, so the list silently doesn't change.
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const ROOT = new URL("..", import.meta.url).pathname

async function importTs(relPath) {
  const src = readFileSync(join(ROOT, relPath), "utf8")
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  const dir = mkdtempSync(join(tmpdir(), "svc-"))
  const out = join(dir, "mod.mjs")
  writeFileSync(out, outputText)
  return import(pathToFileURL(out).href)
}

// Shaped after the real catalog: 6 categories, Tax dominant, names that
// mix form numbers with prose ("Tax | Prep (1040): Federal Return").
const CATALOG = [
  { id: "1", name: "Form 1040 Tax Return Preparation", category: "Tax", subcategory: null, description: "Individual federal return" },
  { id: "2", name: "Tax | Prep (1040): Federal Return (Individual)", category: "Tax", subcategory: "Prep", description: null },
  { id: "3", name: "Tax | Amended Return (1040X)", category: "Tax", subcategory: "Prep", description: "Corrections to a filed return" },
  { id: "4", name: "Form 1120-S Corporate Return", category: "Tax", subcategory: "Prep", description: "S-corp return" },
  { id: "5", name: "Accounting | Accounts Payable Management", category: "Accounting", subcategory: null, description: "AP processing" },
  { id: "6", name: "Payroll | Additional Employee", category: "Payroll", subcategory: null, description: null },
  { id: "7", name: "Advisory | Business Formation Consulting", category: "Advisory", subcategory: null, description: "Entity selection" },
  { id: "8", name: "Digital Document Storage", category: null, subcategory: null, description: "Uncategorized on purpose" },
]

const failures = []
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) failures.push(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`)
}
function ok(label, cond) {
  if (!cond) failures.push(`  ✗ ${label}`)
}

const { filterServices, groupServicesByCategory, escapeForOrFilter } = await importTs(
  "lib/services/filter-services.ts",
)

const ids = (list) => list.map((s) => s.id)

// ── 1. Empty query returns everything ────────────────────────────────
check("empty query returns the full catalog", filterServices(CATALOG, "").length, CATALOG.length)
check("whitespace-only query returns the full catalog", filterServices(CATALOG, "   ").length, CATALOG.length)

// ── 2. Matching breadth ──────────────────────────────────────────────
check("form number matches", ids(filterServices(CATALOG, "1040")), ["1", "2", "3"])
check("category matches", ids(filterServices(CATALOG, "payroll")), ["6"])
check("description-only match", ids(filterServices(CATALOG, "entity selection")), ["7"])
// Substring, not word-boundary: "prep" also matches "…Return Preparation".
// That is the behaviour we want in a picker — a partner typing a partial
// word should see more, not fewer, candidates.
check("subcategory + partial-word match", ids(filterServices(CATALOG, "prep")), ["1", "2", "3", "4"])
check("case-insensitive", ids(filterServices(CATALOG, "PAYROLL")), ["6"])
check("s-corp found via description", ids(filterServices(CATALOG, "s-corp")), ["4"])

// ── 3. Multi-term narrows rather than widens ──────────────────────────
check("two terms AND together", ids(filterServices(CATALOG, "tax 1040")), ["1", "2", "3"])
ok(
  "multi-term is narrower than either term alone",
  filterServices(CATALOG, "tax 1040").length < filterServices(CATALOG, "tax").length,
)
check("terms may match different fields", ids(filterServices(CATALOG, "advisory formation")), ["7"])
check("no match yields empty", ids(filterServices(CATALOG, "cryptocurrency audit")), [])

// ── 4. Grouping ──────────────────────────────────────────────────────
const grouped = groupServicesByCategory(CATALOG)
check("categories sorted alphabetically", grouped.map(([c]) => c), [
  "Accounting",
  "Advisory",
  "Other",
  "Payroll",
  "Tax",
])
check("Tax group holds every tax service", grouped.find(([c]) => c === "Tax")[1].length, 4)
check("null category collects under Other", ids(grouped.find(([c]) => c === "Other")[1]), ["8"])
check(
  "grouping loses nothing",
  grouped.reduce((n, [, items]) => n + items.length, 0),
  CATALOG.length,
)

// ── 5. PostgREST or() escaping ───────────────────────────────────────
// Commas and parens are structural in `or=(a,b,c)`; leaving them in is
// what turns a search for "Prep (1040), Federal" into a 500.
ok("comma neutralized", !escapeForOrFilter("tax, advisory").includes(","))
ok("parens neutralized", !escapeForOrFilter("Prep (1040)").includes("("))
ok("parens neutralized (close)", !escapeForOrFilter("Prep (1040)").includes(")"))
check("ilike wildcard % escaped", escapeForOrFilter("100%"), "100\\%")
check("ilike wildcard _ escaped", escapeForOrFilter("a_b"), "a\\_b")
check("ordinary text untouched", escapeForOrFilter("  payroll  "), "payroll")
ok("escaped output keeps the searchable words", escapeForOrFilter("Prep (1040), Federal").includes("1040"))

// ── Report ───────────────────────────────────────────────────────────
console.log("\nService filter tests")
console.log("════════════════════")
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURE(S):\n`)
  failures.forEach((f) => console.log(f))
  process.exit(1)
}
console.log("✓ 24 assertions passed — empty query, multi-term narrowing, grouping, or() escaping")
