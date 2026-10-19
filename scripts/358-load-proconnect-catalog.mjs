#!/usr/bin/env node
/**
 * Load Intuit's IVCS/FRF field catalog into proconnect_field_catalog.
 *
 *   node scripts/358-load-proconnect-catalog.mjs <csv-or-xlsx-path> [--tax-year 2025] \
 *        [--return-type IND] [--sheet <name>] [--layout thin] [--as-tax-year 2024] \
 *        [--dry-run] [--diff] [--allow-unknown]
 *
 * Two layouts:
 *
 *  • Full (default): the original CSV extract or an .xlsx in Intuit's
 *    "Series Code Mappings V2" layout (Series Type, Agency, Series, Code,
 *    Description, ScreenTitle, Type, Char Limit, tsj, constraints). Header
 *    names are matched loosely.
 *
 *  • Thin (--layout thin, required explicitly): the Oct 2026 all-modules
 *    workbook — Module, Series, Code, Description, Screen Title, Validations,
 *    one sheet per module. Intuit confirmed (2026-10-17) that no full-layout
 *    business files are coming, so the missing columns are DERIVED, using
 *    conversions measured by rebuilding IND from the thin sheet and comparing
 *    it with the V2 file:
 *      agency   'Federal' (every V2 pair has a Federal row; state rows are
 *               near-identical copies)
 *      val      `amt:` rules; `desc:` rules when the field has no `amt:` (a
 *               text field — V2 puts the same maxLength on val)
 *      type     proTaxID → SSN, date / date regex → DATE, numeric rules →
 *               NUMBER, desc-only → STRING
 *      tsj      a `tsj:` rule is present
 *      repeats  the same (series, code) under several screens collapses to one
 *               row: first non-blank description, first screen title. Rows
 *               whose rules disagree stop the load.
 *    The thin layout under-declares sub-fields (V2 IND allows src/source on
 *    ~27k fields the thin sheet doesn't mention), so thin rows carry
 *    rules.subFieldsUnderDeclared and the Hub's pre-check does not block
 *    src/source on them. Intuit's dry run stays the real check.
 *
 * --as-tax-year writes the file's rows under another tax year, stamped with
 * rules.assumedFromTaxYear = --tax-year (and a source_file suffix). Intuit
 * sent 2025 only and says prior years "should be very similar"; the stamp
 * keeps that an assumption the Hub can show and warn on, not a fact. Refused
 * for IND: scripts/387 treats a loaded IND year as evidence for 1040 writes.
 *
 * --diff compares the file against what is already loaded for that tax year
 * and return type (read-only), so a reload can be reviewed before it runs.
 * Unrecognized constraint tokens block a real load unless --allow-unknown.
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
import { readFileSync, existsSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { readXlsx } from "./lib/read-xlsx.mjs"

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
function splitClauses(s, sep = ";") {
  const out = []
  let depth = 0
  let cur = ""
  for (const ch of s) {
    // Brackets, parens and braces all nest: regex rules carry groups and
    // quantifiers like {1,3}, and oneOf lists carry commas inside [].
    if ("[({".includes(ch)) depth++
    else if ("])}".includes(ch)) depth = Math.max(0, depth - 1)
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = "" }
    else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

const SUB_FIELDS = ["amt", "desc", "src", "source", "tsj", "cityAbbrev"]

/**
 * Apply one documented rule (Intuit's rule-types-reference sheet) to a rule
 * target. Returns false when the rule name isn't one we know, so the caller
 * can record it as unknown instead of dropping it.
 *
 * oneOf: an inline list `[a,b]` is split; a table reference `$ref:tN` is kept
 * as written, with the table's raw text when the workbook supplies it. Those
 * tables are comma-joined and some entries contain commas themselves
 * ("Korea, North"), so splitting them would invent values.
 */
function applyRule(target, clause, oneOfTables) {
  const eq = clause.indexOf("=")
  const name = (eq === -1 ? clause : clause.slice(0, eq)).trim()
  const v = eq === -1 ? null : clause.slice(eq + 1).trim()
  switch (name) {
    case "formattedNumber": target.formattedNumber = true; return true
    case "integer": target.integer = true; return true
    case "date": target.isDate = true; return true
    case "phone": target.phone = true; return true
    case "proTaxID": target.proTaxID = true; return true
    case "min": target.min = num(v); return true
    case "max": target.max = num(v); return true
    case "maxLength": target.maxLength = num(v); return true
    case "onOrAfter": target.onOrAfter = v; return true
    case "onOrBefore": target.onOrBefore = v; return true
    case "regex": target.regex = v; return true
    case "minOr":
      target.minOr = (v || "").replace(/[[\]]/g, "").split(",").map((x) => num(x.trim())).filter((x) => x !== null)
      return true
    case "oneOf":
      if (v?.startsWith("$ref:")) {
        const ref = v.slice(5)
        target.oneOf = { ref, ...(oneOfTables?.has(ref) ? { raw: oneOfTables.get(ref) } : {}) }
      } else {
        target.oneOf = (v || "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean)
      }
      return true
    default:
      return false
  }
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
export function parseConstraints(raw, valueType, charLimit, tsjColumn, oneOfTables) {
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
      default: {
        // Later extracts use rule types the 2025 IND CSV never had, written
        // either bare (`integer`, `oneOf=$ref:t0`, `maxLength=2,oneOf=…`) or
        // prefixed with a sub-field (`desc:proTaxID`, `amt:date,onOrAfter=…`).
        // A bare rule applies to `val`. `amt:` stays the separate `amt`
        // sub-field, as in the original CSV: the Oct 2026 workbook appears to
        // use it for the main value, but nothing documents that, so we don't
        // guess.
        const m = clause.match(/^([A-Za-z]+):(.*)$/s)
        const sub = m && SUB_FIELDS.includes(m[1]) ? m[1] : null
        const target = sub ? (rules[sub] ??= {}) : rules.val
        const parts = splitClauses(sub ? m[2] : clause, ",")
        for (const part of parts) {
          if (!applyRule(target, part, oneOfTables)) rules.unknown.push(sub ? `${sub}:${part}` : part)
        }
        if (sub) rules.allowedSubFields.push(sub)
      }
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
 * Parse one thin-layout Validations string (see the header) into the same
 * `rules` shape parseConstraints produces, plus the derived value type.
 *
 * Every clause is `<subField>:<rule>,<rule>…` or a bare rule list. `amt:` is
 * the main value; `desc:` is too when the field has no `amt:`, and otherwise
 * the separate description sub-field (270 IND fields carry both).
 */
export function parseThinConstraints(raw, oneOfTables) {
  const rules = { allowedSubFields: ["val"], val: {}, unknown: [], subFieldsUnderDeclared: true }
  const clauses = splitClauses(raw || "").map((clause) => {
    const m = clause.match(/^([A-Za-z]+):(.*)$/s)
    return m && SUB_FIELDS.includes(m[1]) ? { sub: m[1], body: m[2] } : { sub: null, body: clause }
  })
  const hasAmt = clauses.some((c) => c.sub === "amt")
  let valueSource = null
  for (const { sub, body } of clauses) {
    const toVal = sub === null || sub === "amt" || (sub === "desc" && !hasAmt)
    if (toVal && sub) valueSource ??= sub
    const target = toVal ? rules.val : (rules[sub] ??= {})
    if (!toVal) rules.allowedSubFields.push(sub)
    for (const part of splitClauses(body, ",")) {
      // `src:STRING`-style kinds from the original CSV still appear.
      if (/^(STRING|ENUM|NUMBER)$/.test(part)) { target.kind = part; continue }
      if (!applyRule(target, part, oneOfTables)) rules.unknown.push(sub ? `${sub}:${part}` : part)
    }
  }

  const v = rules.val
  // A date regex is an MM/DD/YYYY pattern: it always spells out months 01–12.
  const dateRegex = typeof v.regex === "string" && v.regex.includes("0[1-9]|1[0-2]")
  let valueType = null
  if (v.proTaxID) valueType = "SSN"
  else if (v.isDate || dateRegex) valueType = "DATE"
  else if (valueSource === "amt" && (v.formattedNumber || v.integer || v.min != null || v.max != null || v.oneOf)) valueType = "NUMBER"
  else if (valueSource === "desc") valueType = "STRING"
  if (valueType) v.type = valueType
  if (valueType === "DATE") v.isDate = true

  rules.allowedSubFields = [...new Set(rules.allowedSubFields)].sort()
  for (const k of [...SUB_FIELDS, "val"]) {
    if (rules[k] && Object.keys(rules[k]).length === 0) delete rules[k]
  }
  if (rules.unknown.length === 0) delete rules.unknown
  return { rules, valueType, tsjAllowed: rules.allowedSubFields.includes("tsj") }
}

/**
 * Collapse a thin sheet's repeated (series, code) rows. Returns the merged
 * rows and any keys whose Validations disagree, which the caller refuses.
 */
function collapseThinRows(rows, idx) {
  const byKey = new Map()
  const conflicts = []
  for (const r of rows) {
    const series = (r[idx.series] || "").trim()
    const code = (r[idx.code] || "").trim()
    if (!series || !code) continue
    const key = `${series}|${code}`
    const constraints = (r[idx.constraints] || "").trim()
    const description = (r[idx.description] || "").trim()
    const screen = (r[idx.screenTitle] || "").trim()
    const prev = byKey.get(key)
    if (!prev) { byKey.set(key, { series, code, constraints, description, screen, repeats: 1 }); continue }
    prev.repeats++
    if (prev.constraints !== constraints) conflicts.push(key)
    if (!prev.description && description) prev.description = description
    if (!prev.screen && screen) prev.screen = screen
  }
  return { merged: [...byKey.values()], conflicts }
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
/**
 * Read-only comparison of a parsed file against the rows already loaded for
 * (tax_year, return_type). Upserts never delete, so rows only in the
 * database would survive a reload as stale entries — they're listed here.
 */
async function printDiff(sb, records, taxYear, returnType) {
  const loaded = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("proconnect_field_catalog")
      .select("agency, series_id, code_id, description, screen_title, value_type, char_limit, tsj_allowed, constraints_raw")
      .eq("tax_year", taxYear)
      .eq("return_type", returnType)
      .order("agency").order("series_id").order("code_id")
      .range(from, from + 999)
    if (error) { console.error(`✗ ${error.message}`); process.exit(1) }
    for (const r of data) loaded.set(`${r.agency}|${r.series_id}|${r.code_id}`, r)
    if (data.length < 1000) break
  }
  const fields = ["description", "screen_title", "value_type", "char_limit", "tsj_allowed", "constraints_raw"]
  const added = []
  const changed = new Map(fields.map((f) => [f, 0]))
  const samples = []
  let whitespaceOnly = 0
  const ws = (x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : x)
  const fileKeys = new Set()
  for (const r of records) {
    const k = `${r.agency}|${r.series_id}|${r.code_id}`
    fileKeys.add(k)
    const old = loaded.get(k)
    if (!old) { added.push(k); continue }
    for (const f of fields) {
      if ((old[f] ?? null) !== (r[f] ?? null)) {
        changed.set(f, changed.get(f) + 1)
        if (ws(old[f] ?? null) === ws(r[f] ?? null)) { whitespaceOnly++; continue }
        if (samples.length < 8) samples.push(`${k} ${f}: ${JSON.stringify(old[f])} → ${JSON.stringify(r[f])}`)
      }
    }
  }
  const removed = [...loaded.keys()].filter((k) => !fileKeys.has(k))
  const seriesOf = (keys) => new Set(keys.map((k) => k.split("|")[1])).size
  console.log(`\ndiff vs loaded ${returnType} ${taxYear} (${loaded.size} rows loaded, ${records.length} in file):`)
  console.log(`  new rows:           ${added.length} across ${seriesOf(added)} series (M-series: ${added.filter((k) => /M\|/.test(k)).length})`)
  console.log(`  only in database:   ${removed.length} across ${seriesOf(removed)} series — would remain as stale rows`)
  for (const [f, n] of changed) if (n) console.log(`  changed ${f.padEnd(15)} ${n}`)
  if (whitespaceOnly) console.log(`    (${whitespaceOnly} of those changes are whitespace only)`)
  for (const s of samples) console.log(`    e.g. ${s}`)
  if (removed.length) console.log(`  stale e.g. ${removed.slice(0, 5).join(", ")}`)
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

// Header names differ between Intuit's extracts ("screenTitle" in the CSV,
// "ScreenTitle" in V2, "Char Limit" vs "charLimit"); compare them with case,
// spaces and punctuation stripped.
const squash = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
const HEADER_ALIASES = {
  agency: ["agency"],
  series: ["series"],
  code: ["code"],
  description: ["description"],
  screenTitle: ["screentitle"],
  type: ["type"],
  charLimit: ["charlimit"],
  tsj: ["tsj"],
  constraints: ["constraints", "validation"],
}
// Exact match only, so "Series Type" never stands in for "Series". The one
// exception is the validations column, whose header in the Oct 2026 workbook
// runs on ("Validations ( include subfields as desc, amt, src, tsj etc. )").
const headerMatches = (col, h) =>
  HEADER_ALIASES[col].some((a) => h === a || (col === "constraints" && h.startsWith(a)))

/** Read rows from a CSV or an .xlsx; for .xlsx also return its oneOf tables. */
function readInput(path, sheetName, returnType) {
  if (!/\.xlsx$/i.test(path)) return { rows: parseCsv(readFileSync(path, "utf8")), oneOfTables: null, sheet: null }
  const sheets = readXlsx(path)
  const looksLikeCatalog = (rows) => rows[0]?.some((h) => squash(h) === "series") && rows[0]?.some((h) => squash(h) === "code")
  // The all-modules workbook has one catalog sheet per module, named
  // "<mod>-2025-all-series-…" in either case; pick the one for this module.
  const name =
    sheetName ??
    [...sheets.keys()].find((n) => n.toLowerCase().startsWith(`${returnType.toLowerCase()}-`) && /all-series/i.test(n) && looksLikeCatalog(sheets.get(n))) ??
    [...sheets.keys()].find((n) => looksLikeCatalog(sheets.get(n)) && !/^[a-z]{3}-\d{4}-all-series/i.test(n))
  if (!name || !sheets.has(name)) {
    console.error(`no catalog sheet${sheetName ? ` named "${sheetName}"` : ""} in ${path}; sheets: ${[...sheets.keys()].join(", ")}`)
    process.exit(1)
  }
  // The all-modules workbook pairs each "<MOD>-2025-all-series-…" sheet with
  // a "<MOD>-2025-oneof-tables" sheet; values may overflow into extra columns.
  const prefix = name.split("-")[0].toLowerCase()
  const tableSheet = [...sheets.keys()].find((n) => /oneof/i.test(n) && n.split("-")[0].toLowerCase() === prefix)
  let oneOfTables = null
  if (tableSheet) {
    oneOfTables = new Map()
    for (const r of sheets.get(tableSheet).slice(1)) {
      const ref = String(r[0] ?? "").replace(/^\$ref:/, "")
      if (ref) oneOfTables.set(ref, r.slice(1).filter((x) => x != null).join(", "))
    }
  }
  const rows = sheets.get(name).map((r) => r.map((c) => (c == null ? "" : String(c))))
  return { rows, oneOfTables, sheet: name }
}

async function main() {
  loadEnv()
  const args = process.argv.slice(2)
  const flag = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
  const valueFlags = new Set(["--tax-year", "--return-type", "--sheet", "--layout", "--as-tax-year"])
  const inputPath = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]))
  const taxYear = Number(flag("--tax-year")) || 2025
  const returnType = flag("--return-type") ?? "IND"
  const dryRun = args.includes("--dry-run")
  const diffOnly = args.includes("--diff")
  const allowUnknown = args.includes("--allow-unknown")
  const layout = flag("--layout") ?? "full"
  if (!["full", "thin"].includes(layout)) {
    console.error(`--layout must be "full" or "thin", got "${layout}"`)
    process.exit(1)
  }
  // Rows land under --as-tax-year, stamped as assumed from the file's year.
  const asTaxYear = flag("--as-tax-year") ? Number(flag("--as-tax-year")) : null
  if (asTaxYear !== null && (!Number.isInteger(asTaxYear) || asTaxYear === taxYear)) {
    console.error("--as-tax-year must be a different tax year than --tax-year")
    process.exit(1)
  }
  if (asTaxYear !== null && returnType === "IND") {
    // scripts/387 treats a loaded catalog year as evidence for 1040 writes;
    // an assumed IND year would quietly make inherited 1040 cells editable.
    console.error("--as-tax-year is refused for IND: scripts/387 gates 1040 writes on the catalog year")
    process.exit(1)
  }
  const targetYear = asTaxYear ?? taxYear

  if (!inputPath) {
    console.error("usage: node scripts/358-load-proconnect-catalog.mjs <csv-or-xlsx-path> [--tax-year 2025] [--return-type IND] [--sheet <name>] [--layout thin] [--as-tax-year 2024] [--dry-run] [--diff] [--allow-unknown]")
    process.exit(1)
  }

  const { rows, oneOfTables, sheet } = readInput(inputPath, flag("--sheet"), returnType)
  if (sheet) console.log(`reading sheet "${sheet}"${oneOfTables ? ` (+ ${oneOfTables.size} oneOf tables)` : ""}`)
  const header = rows[0].map(squash)
  // The thin layout has no agency/type/charLimit/tsj columns; they're derived.
  const want = layout === "thin"
    ? ["series", "code", "description", "screenTitle", "constraints"]
    : Object.keys(HEADER_ALIASES)
  const idx = {}
  for (const w of want) {
    idx[w] = header.findIndex((h) => headerMatches(w, h))
  }
  const missing = want.filter((w) => idx[w] === -1)
  if (missing.length) {
    console.error(`header missing columns: ${missing.join(", ")}\n  got: ${rows[0].join(", ")}`)
    if (layout === "full" && (missing.includes("agency") || missing.includes("type"))) {
      console.error("  This looks like the thin all-modules layout. Pass --layout thin to derive\n" +
        "  agency/type/tsj from the Validations column (see the header of this script).")
    }
    process.exit(1)
  }
  // A Module column, when present, must agree with --return-type.
  if (layout === "thin" && header.indexOf("module") === -1) {
    console.error("--layout thin expects a Module column; this sheet has none")
    process.exit(1)
  }
  const moduleIdx = header.indexOf("module")
  if (moduleIdx !== -1) {
    const mods = new Set(rows.slice(1).map((r) => String(r[moduleIdx] ?? "").toUpperCase()).filter(Boolean))
    if (mods.size && !(mods.size === 1 && mods.has(returnType))) {
      console.error(`Module column says ${[...mods].join(", ")} but --return-type is ${returnType}`)
      process.exit(1)
    }
  }

  const records = []
  const unknownTokens = new Map()
  const sourceFile = inputPath.split("/").pop() + (asTaxYear !== null ? ` (assumed from ${taxYear})` : "")
  const stamp = (rules) => (asTaxYear !== null ? { ...rules, assumedFromTaxYear: taxYear } : rules)
  if (layout === "thin") {
    const { merged, conflicts } = collapseThinRows(rows.slice(1), idx)
    const repeated = merged.filter((m) => m.repeats > 1).length
    console.log(`  thin layout: ${rows.length - 1} rows → ${merged.length} fields (${repeated} repeated across screens)`)
    if (conflicts.length) {
      console.error(`✗ ${conflicts.length} repeated (series, code) rows disagree on Validations, e.g. ${conflicts.slice(0, 5).join(", ")}`)
      process.exit(1)
    }
    for (const m of merged) {
      const { rules, valueType, tsjAllowed } = parseThinConstraints(m.constraints, oneOfTables)
      if (rules.unknown) for (const u of rules.unknown) unknownTokens.set(u, (unknownTokens.get(u) || 0) + 1)
      records.push({
        tax_year: targetYear,
        return_type: returnType,
        agency: "Federal",
        series_id: m.series,
        code_id: m.code,
        // NOT NULL in the table; ~4% of thin fields have no label (the Hub
        // falls back to the screen title, then the raw path).
        description: m.description,
        screen_title: m.screen || null,
        value_type: valueType,
        char_limit: valueType === "STRING" && rules.val?.maxLength != null ? rules.val.maxLength : null,
        tsj_allowed: tsjAllowed,
        constraints_raw: m.constraints || null,
        rules: stamp(rules),
        is_sensitive: isSensitive(valueType, m.description),
        source_file: sourceFile,
      })
    }
  }
  for (const r of layout === "thin" ? [] : rows.slice(1)) {
    if (!r.some((c) => c !== "")) continue
    const valueType = (r[idx.type] || "").trim() || null
    const description = (r[idx.description] || "").trim()
    const charLimitRaw = (r[idx.charLimit] || "").trim()
    const charLimit = charLimitRaw === "" ? null : Number(charLimitRaw)
    const constraintsRaw = (r[idx.constraints] || "").trim() || null
    const tsjColumn = (r[idx.tsj] || "").trim()
    const rules = parseConstraints(constraintsRaw, valueType, charLimit, tsjColumn, oneOfTables)
    if (rules.unknown) {
      for (const u of rules.unknown) unknownTokens.set(u, (unknownTokens.get(u) || 0) + 1)
    }
    records.push({
      tax_year: targetYear,
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
      rules: stamp(rules),
      is_sensitive: isSensitive(valueType, description),
      source_file: sourceFile,
    })
  }

  const sensitive = records.filter((r) => r.is_sensitive).length
  // U+FFFD means the extract itself lost characters (Intuit's V2 IND file has
  // "facility���s" for "facility’s"). Report it so a reload doesn't quietly
  // replace a good description with a damaged one.
  const damaged = records.filter((r) => /\uFFFD/.test(`${r.description}${r.screen_title ?? ""}`))
  console.log(`parsed ${records.length} rows for ${returnType} ${targetYear}${asTaxYear !== null ? ` (assumed from ${taxYear})` : ""}`)
  console.log(`  agencies:      ${new Set(records.map((r) => r.agency)).size}`)
  console.log(`  series:        ${new Set(records.map((r) => r.series_id)).size}`)
  console.log(`  codes:         ${new Set(records.map((r) => r.code_id)).size}`)
  console.log(`  sensitive:     ${sensitive}`)
  if (damaged.length) {
    console.warn(`  ⚠ ${damaged.length} rows have damaged text (U+FFFD) in the file, e.g. ${damaged.slice(0, 3).map((r) => `${r.agency}|${r.series_id}|${r.code_id}`).join(", ")}`)
  }
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  // Legacy service_role keys are disabled; prefer the current secret key.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  const connect = () => {
    if (!url || !key) {
      console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (pull .env.local from the mottahub project)")
      process.exit(1)
    }
    return createClient(url, key, { auth: { persistSession: false } })
  }

  if (diffOnly) {
    await printDiff(connect(), records, targetYear, returnType)
    return
  }

  if (unknownTokens.size && !dryRun && !allowUnknown) {
    console.error("✗ refusing to load with unrecognized constraint tokens (pass --allow-unknown to override)")
    process.exit(1)
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written. Sample record:")
    console.log(JSON.stringify(records.find((r) => r.constraints_raw?.includes("minOr")) ?? records[0], null, 2))
    return
  }

  const sb = connect()

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

export { parseCsv, splitClauses, isSensitive, collapseThinRows }
