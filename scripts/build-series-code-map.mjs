/**
 * Converts data/proconnect/ind-2025-series-codes.csv into a compact JSON
 * lookup keyed by "series:code" → description.
 *
 * Run: node scripts/build-series-code-map.mjs
 * Output: lib/proconnect/series-code-map.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const csv = readFileSync(
  resolve(root, "data/proconnect/ind-2025-series-codes.csv"),
  "utf8",
)

const lines = csv.split("\n")
// header: agency,series,code,description,screenTitle,type,charLimit,tsj,constraints
const header = lines[0].split(",")
const seriesIdx = header.indexOf("series")
const codeIdx = header.indexOf("code")
const descIdx = header.indexOf("description")
const screenIdx = header.indexOf("screenTitle")

/** Minimal CSV field parser — handles one level of double-quoted fields */
function parseRow(line) {
  const fields = []
  let cur = ""
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuote = !inQuote
    } else if (ch === "," && !inQuote) {
      fields.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

/** @type {Record<string, { description: string; screenTitle: string }>} */
const map = {}

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim()
  if (!line) continue
  const f = parseRow(line)
  const series = f[seriesIdx]?.trim()
  const code = f[codeIdx]?.trim()
  const description = f[descIdx]?.trim()
  const screenTitle = f[screenIdx]?.trim()
  if (!series || !code) continue
  const key = `${series}:${code}`
  // First occurrence wins (some codes appear multiple times across agencies)
  if (!map[key]) {
    map[key] = { description: description ?? "", screenTitle: screenTitle ?? "" }
  }
}

const outDir = resolve(root, "lib/proconnect")
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, "series-code-map.json")
writeFileSync(outPath, JSON.stringify(map, null, 0), "utf8")

console.log(`Wrote ${Object.keys(map).length} entries → ${outPath}`)
