#!/usr/bin/env node
/**
 * Load Intuit's IVCS/FRF field catalog into proconnect_field_catalog.
 *
 *   node scripts/358-load-proconnect-catalog.mjs <csv-path> [--tax-year 2025] \
 *        [--return-type IND] [--dry-run]
 *
 * The CSV is partner-confidential and THIS REPO IS PUBLIC, so the file is
 * never committed — pass its path at runtime. Requires
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Idempotent: upserts on the primary key, so re-running with a corrected
 * extract updates in place rather than duplicating.
 *
 * Expected CSV header:
 *   agency,series,code,description,screenTitle,type,charLimit,tsj,constraints
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const CHUNK = 1000

// ── CSV parsing ──────────────────────────────────────────────────────
// Hand-rolled rather than pulling a dependency: descriptions legitimately
// contain commas and quotes (e.g. 'Driver's License/State ID #'), so we
// need real RFC-4180 quote handling, but nothing beyond it.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ""
  let inQuotes = false
  // Strip a UTF-8 BOM — Excel exports carry one and it would corrupt the
  // first header name ("﻿agency" never matches "agency").
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field); field = ""
    } else if (ch === "\n") {
      row.push(field); field = ""
      if (row.some((c) => c !== "")) rows.push(row)
      row = []
    } else if (ch !== "\r") {
      field += ch
    }
  }
  row.push(field)
  if (row.some((c) => c !== "")) rows.push(row)
  return rows
}

// ── constraint mini-language ─────────────────────────────────────────
/**
 * Split on ';' at bracket depth 0 only. `minOr=[0, -1]` contains a comma
 * inside a bracketed list; a naive split on both separators corrupts it.
 */
function splitClauses(s) {
  const out = []
  let depth = 0
  let cur = ""
  for (const ch of s) {
    if (ch === "[") depth++
    else if (ch === "]") depth--
    if (ch === ";" && depth === 0) { out.push(cur.trim()); cur = "" }
    else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

/**
 * Numeric bound parser. Three lexical shapes occur in the wild and all
 * three must survive: plain integers (`999999999`, `-99999999999`),
 * decimals (`1.0`, `-180.0`), and Java-style scientific notation with an
 * uppercase E and no exponent sign (`9.99999999E8`, `-9.99999999E8`).
 * An int-only parser dies on the latter two.
 *
 * Bounds are NOT always positive: `max=-1` occurs (Federal/s5800/c147)
 * and `max=0` on 25 rows, so a validator must never assume max >= 0.
 * `min=-1` (5,032 rows) is ProConnect's "override to zero" sentinel and
 * correlates with "[Override]" in the description.
 */
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse `constraints` into the structured `rules` object.
 *
 * The critical output is `allowedSubFields`: the Import API rejects any
 * sub-field not declared in a code's fieldRules with SUB_FIELD_NOT_ALLOWED,
 * so knowing the permitted set lets us fail locally instead of burning a
 * call against a real return.
 *
 * Exhaustively verified against all 67,810 rows: 612 distinct constraint
 * strings, exactly 13 tokens, zero unrecognized clauses. `unknown[]`
 * captures anything a future extract adds so it surfaces loudly instead
 * of being silently dropped.
 */
export function parseConstraints(raw, valueType, charLimit, tsjColumn) {
  const rules = {
    allowedSubFields: [],
    val: {},
    desc: {},
    src: {},
    source: {},
    tsj: {},
    cityAbbrev: {},
    amt: {},
    unknown: [],
  }
  // `val` is implied by the type column: every catalogued code carries a
  // primary value. Blank-type rows (2,503) still accept one — they're
  // typically checkbox/flag fields — so we allow val and let min/max or
  // the API adjudicate.
  rules.allowedSubFields.push("val")
  if (valueType) rules.val.type = valueType
  if (charLimit != null) rules.val.charLimit = charLimit

  for (const clause of splitClauses(raw || "")) {
    const eq = clause.indexOf("=")
    const key = (eq === -1 ? clause : clause.slice(0, eq)).trim()
    const val = eq === -1 ? null : clause.slice(eq + 1).trim()
    switch (key) {
      // formattedNumber <=> max is present, and exactly one of {min, minOr}
      // accompanies it (invariant verified across all 29,538 occurrences).
      // Its ABSENCE on the other 22,133 NUMBER rows does NOT mean the field
      // is unbounded — it means this export declares no range, so a
      // validator must skip range checks rather than invent them.
      case "formattedNumber": rules.val.formattedNumber = true; break
      case "date": rules.val.isDate = true; break
      case "min": rules.val.min = num(val); break
      case "max": rules.val.max = num(val); break
      case "maxLength": rules.val.maxLength = num(val); break
      case "minOr":
        // e.g. "[0, -1]" — val must be >= one of these. The -1 sentinel is
        // ProConnect's "explicit zero / override" convention.
        rules.val.minOr = (val || "")
          .replace(/[[\]]/g, "")
          .split(",")
          .map((x) => num(x.trim()))
          .filter((x) => x !== null)
        break
      case "desc:maxLength":
        rules.desc.maxLength = num(val); rules.allowedSubFields.push("desc"); break
      case "src:STRING":
        rules.src.kind = "STRING"; rules.allowedSubFields.push("src"); break
      case "src:ENUM":
        rules.src.kind = "ENUM"; rules.allowedSubFields.push("src"); break
      case "source:maxLength":
        rules.source.maxLength = num(val); rules.allowedSubFields.push("source"); break
      case "tsj:maxLength":
        rules.tsj.maxLength = num(val); rules.allowedSubFields.push("tsj"); break
      case "cityAbbrev:STRING":
        rules.cityAbbrev.kind = "STRING"; rules.allowedSubFields.push("cityAbbrev"); break
      case "amt:NUMBER":
        rules.amt.kind = "NUMBER"; rules.allowedSubFields.push("amt"); break
      default:
        rules.unknown.push(clause)
    }
  }

  // The tsj column and the tsj:maxLength token agree on 100% of rows;
  // honour the column too so a future extract that drops one still works.
  if (tsjColumn === "Y" && !rules.allowedSubFields.includes("tsj")) {
    rules.allowedSubFields.push("tsj")
    rules.tsj.maxLength = rules.tsj.maxLength ?? 1
  }

  rules.allowedSubFields = [...new Set(rules.allowedSubFields)].sort()
  for (const k of ["val", "desc", "src", "source", "tsj", "cityAbbrev", "amt"]) {
    if (Object.keys(rules[k]).length === 0) delete rules[k]
  }
  if (rules.unknown.length === 0) delete rules.unknown
  return rules
}

/**
 * Sensitive-field detection. value_type='SSN' is definitive (963 codes).
 * The description scan additionally catches taxpayer identifiers and bank
 * details that Intuit types as STRING/NUMBER but which are plainly PII.
 * Deliberately broad: a false positive costs a masked field in the UI, a
 * false negative leaks a client identifier.
 */
const SENSITIVE_RE =
  /\b(ssn|social security|ein\b|employer identification|tin\b|taxpayer identification|itin|ptin|routing|account number|acct number|bank account|date of birth|dob\b|driver'?s? licen[cs]e)\b/i

function isSensitive(valueType, description) {
  if (valueType === "SSN") return true
  return SENSITIVE_RE.test(description || "")
}

// ── main ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const csvPath = args.find((a) => !a.startsWith("--"))
  const taxYear = Number(args[args.indexOf("--tax-year") + 1]) || 2025
  const returnType = args.includes("--return-type") ? args[args.indexOf("--return-type") + 1] : "IND"
  const dryRun = args.includes("--dry-run")

  if (!csvPath) {
    console.error("usage: node scripts/358-load-proconnect-catalog.mjs <csv-path> [--tax-year 2025] [--return-type IND] [--dry-run]")
    process.exit(1)
  }

  const rows = parseCsv(readFileSync(csvPath, "utf8"))
  const header = rows[0].map((h) => h.trim())
  const want = ["agency", "series", "code", "description", "screenTitle", "type", "charLimit", "tsj", "constraints"]
  const missing = want.filter((w) => !header.includes(w))
  if (missing.length) {
    console.error(`CSV header missing columns: ${missing.join(", ")}\n  got: ${header.join(", ")}`)
    process.exit(1)
  }
  const idx = Object.fromEntries(want.map((w) => [w, header.indexOf(w)]))

  const records = []
  const unknownTokens = new Map()
  for (const r of rows.slice(1)) {
    const valueType = (r[idx.type] || "").trim() || null
    const description = (r[idx.description] || "").trim()
    const charLimitRaw = (r[idx.charLimit] || "").trim()
    const charLimit = charLimitRaw === "" ? null : Number(charLimitRaw)
    const constraintsRaw = (r[idx.constraints] || "").trim() || null
    const tsjColumn = (r[idx.tsj] || "").trim()
    const rules = parseConstraints(constraintsRaw, valueType, charLimit, tsjColumn)
    if (rules.unknown) {
      for (const u of rules.unknown) unknownTokens.set(u, (unknownTokens.get(u) || 0) + 1)
    }
    records.push({
      tax_year: taxYear,
      return_type: returnType,
      agency: (r[idx.agency] || "").trim(),
      series_id: (r[idx.series] || "").trim(),
      code_id: (r[idx.code] || "").trim(),
      description,
      screen_title: (r[idx.screenTitle] || "").trim() || null,
      value_type: valueType,
      char_limit: Number.isFinite(charLimit) ? charLimit : null,
      tsj_allowed: tsjColumn === "Y",
      constraints_raw: constraintsRaw,
      rules,
      is_sensitive: isSensitive(valueType, description),
      source_file: csvPath.split("/").pop(),
    })
  }

  const sensitive = records.filter((r) => r.is_sensitive).length
  console.log(`parsed ${records.length} rows for ${returnType} ${taxYear}`)
  console.log(`  agencies:      ${new Set(records.map((r) => r.agency)).size}`)
  console.log(`  series:        ${new Set(records.map((r) => r.series_id)).size}`)
  console.log(`  codes:         ${new Set(records.map((r) => r.code_id)).size}`)
  console.log(`  sensitive:     ${sensitive}`)
  if (unknownTokens.size) {
    console.warn(`  ⚠ UNRECOGNIZED constraint tokens (${unknownTokens.size}) — parser needs updating:`)
    for (const [t, n] of unknownTokens) console.warn(`      ${t}  ×${n}`)
  } else {
    console.log("  constraints:   100% parsed, no unknown tokens")
  }

  // Duplicate-key guard: the PK would reject these anyway, but failing
  // here names the offenders instead of surfacing an opaque conflict.
  const seen = new Set()
  const dups = []
  for (const r of records) {
    const k = `${r.agency}|${r.series_id}|${r.code_id}`
    if (seen.has(k)) dups.push(k)
    seen.add(k)
  }
  if (dups.length) {
    console.error(`✗ ${dups.length} duplicate (agency, series, code) keys, e.g. ${dups.slice(0, 5).join(", ")}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written. Sample record:")
    console.log(JSON.stringify(records.find((r) => r.constraints_raw?.includes("minOr")) ?? records[0], null, 2))
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  let written = 0
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = records.slice(i, i + CHUNK)
    const { error } = await sb.from("proconnect_field_catalog").upsert(batch, {
      onConflict: "tax_year,return_type,agency,series_id,code_id",
    })
    if (error) {
      console.error(`✗ chunk at ${i}: ${error.message}`)
      process.exit(1)
    }
    written += batch.length
    process.stdout.write(`\r  upserted ${written}/${records.length}`)
  }
  console.log("\n✓ done")
}

// Only run when invoked directly, so `parseConstraints` can be imported
// by the SQL-batch generator and by tests without triggering a load.
import { fileURLToPath } from "node:url"
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1) })
}

export { parseCsv, splitClauses, isSensitive }
