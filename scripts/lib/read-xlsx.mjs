/**
 * Minimal .xlsx reader — just enough to read Intuit's catalog workbooks
 * without adding a dependency (the app has no zip/xlsx library, and the
 * maintained SheetJS build isn't on npm).
 *
 * An .xlsx is a zip of XML parts. We read the zip's central directory,
 * inflate the parts we need with node:zlib, and pull cell values out of
 * the sheet XML. Supports shared strings, inline strings, plain values and
 * stored/deflated entries — not formulas' cached results beyond <v>, not
 * zip64. Returns every sheet as an array of rows (arrays of strings, with
 * null for empty cells).
 */
import { readFileSync } from "node:fs"
import { inflateRawSync } from "node:zlib"

function readZip(buf) {
  // End of central directory: signature 0x06054b50, within the last 64 KiB.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)")
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory")
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen)
    entries.set(name, { method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return (name) => {
    const e = entries.get(name)
    if (!e) return null
    const lp = e.localOffset
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28)
    const data = buf.subarray(start, start + e.compSize)
    if (e.method === 0) return data.toString("utf8")
    if (e.method === 8) return inflateRawSync(data).toString("utf8")
    throw new Error(`unsupported zip compression method ${e.method} for ${name}`)
  }
}

const decode = (s) =>
  s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (m, e) => {
    const k = e.toLowerCase()
    if (k === "lt") return "<"
    if (k === "gt") return ">"
    if (k === "quot") return '"'
    if (k === "apos") return "'"
    if (k === "amp") return "&"
    return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10))
  })

/** Concatenate every <t> run inside a fragment (handles rich-text <r> runs). */
const textOf = (xml) => {
  let out = ""
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1]
  return decode(out)
}

// Excel stores dates as serial day numbers and shows them through a number
// format. Intuit's sheets contain a few descriptions Excel auto-converted to
// dates (e.g. "31-Mar"), so render those the way Excel displays them rather
// than as a bare serial like 46112.
const BUILTIN_DATE_FMTS = { 14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 22: "m/d/yyyy" }
const BUILTIN_PERCENT_FMTS = { 9: "0%", 10: "0.00%" }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function readDateStyles(stylesXml) {
  const custom = new Map()
  for (const m of (stylesXml ?? "").matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1])
    const code = decode(m[0].match(/formatCode="([^"]*)"/)?.[1] ?? "")
    custom.set(id, code)
  }
  const cellXfs = (stylesXml ?? "").match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? ""
  return [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? 0)
    const code = custom.get(id) ?? BUILTIN_DATE_FMTS[id] ?? BUILTIN_PERCENT_FMTS[id]
    const bare = code?.replace(/"[^"]*"|\[[^\]]*\]/g, "") ?? ""
    // "2%" is stored as 0.02 with a percent format; show it the way Excel does.
    if (bare.includes("%")) return { percent: (bare.split(";")[0].split(".")[1] ?? "").replace(/[^0#]/g, "").length }
    // A date format has d/m/y tokens outside quoted literals and isn't a time-only format.
    return /[dy]/i.test(bare) ? { date: code } : null
  })
}

function renderDate(serial, code) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serial) * 86400000))
  const parts = { yyyy: String(d.getUTCFullYear()), yy: String(d.getUTCFullYear()).slice(-2),
    mmmm: d.toLocaleString("en-US", { month: "long", timeZone: "UTC" }), mmm: MONTHS[d.getUTCMonth()],
    mm: String(d.getUTCMonth() + 1).padStart(2, "0"), m: String(d.getUTCMonth() + 1),
    dd: String(d.getUTCDate()).padStart(2, "0"), d: String(d.getUTCDate()) }
  return code.replace(/\[[^\]]*\]|;.*$/g, "").replace(/\\(.)/g, "$1")
    .replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, (t) => parts[t.toLowerCase()])
}

const colIndex = (ref) => {
  let n = 0
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** @returns {Map<string, (string|null)[][]>} sheet name → rows */
export function readXlsx(path) {
  const get = readZip(readFileSync(path))
  const workbook = get("xl/workbook.xml")
  const rels = get("xl/_rels/workbook.xml.rels")
  if (!workbook || !rels) throw new Error(`${path} is not an .xlsx workbook`)

  const shared = []
  const sst = get("xl/sharedStrings.xml")
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]))

  const dateFmts = readDateStyles(get("xl/styles.xml"))

  const targets = new Map()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1]
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"))
  }

  const sheets = new Map()
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(m[0].match(/\bname="([^"]*)"/)?.[1] ?? "")
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1]
    const xml = rid && get(targets.get(rid))
    if (!xml) continue
    const rows = []
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const row = []
      for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1]
        const body = cm[2] ?? ""
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
        const type = attrs.match(/\bt="([^"]+)"/)?.[1]
        const style = attrs.match(/\bs="(\d+)"/)?.[1]
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        let value = null
        if (type === "s") value = v == null ? null : shared[Number(v)]
        else if (type === "inlineStr") value = textOf(body)
        else if (v != null && !type && style && dateFmts[Number(style)]?.date) value = renderDate(v, dateFmts[Number(style)].date)
        else if (v != null && !type && style && dateFmts[Number(style)]) value = `${(Number(v) * 100).toFixed(dateFmts[Number(style)].percent)}%`
        else if (v != null && (!type || type === "n") && Number.isFinite(Number(v))) value = String(Number(v)) // "2024.0" → "2024", as Excel shows it
        else if (v != null) value = decode(v)
        const i = ref ? colIndex(ref) : row.length
        while (row.length < i) row.push(null)
        row[i] = value === "" ? null : value
      }
      rows.push(row)
    }
    sheets.set(name, rows)
  }
  return sheets
}
