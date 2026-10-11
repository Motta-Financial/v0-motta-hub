/**
 * 1065 mapping self-check — READ-ONLY.
 *
 * The Export API returns only what was typed into a return, never the
 * totals ProConnect calculates. But each new year's return carries the
 * prior year's totals on s6100 ("Federal Prior Year Summary"). So for any
 * partnership with consecutive returns, our rules applied to year N's
 * inputs must reproduce year N+1's s6100 totals. That checks the 1065
 * mapping against ProConnect's own math without touching a return.
 *
 * Reads proconnect_return_field_cells for PAR snapshots (populate them
 * with scripts/428-export-1065-returns.ts). Pairs years by ProConnect client
 * id; a client with several returns in one year counts as matched if any
 * pairing matches. Prints counts and return ids only, never values.
 *
 *   npx tsx scripts/430-1065-selfcheck.ts
 *
 * Rules (2026-10-11), with the s6100 code each one is checked against:
 *   - Gross receipts less returns (s6100/c1) = s200 c101 − c102
 *   - Total deductions (c21) = s400 c101–c199 (federal amounts; c201–c299
 *     are state-specific copies and c1000+ are prior-year mirrors), with
 *     meals c123 at 50%, DOT meals c146 at 80%, employment credits c152
 *     subtracted, entertainment c169 and the 163(j) fields c179/c180
 *     excluded, plus depreciation (s6100/c16, computed from s61) unless
 *     c111 overrides it
 *   - Beginning total assets (c70) = s5700 c101–c118, "Less …" lines
 *     (c103, c111, c113, c116) subtracted
 *   - Ending total assets (c72) = s5700 c201–c218, same "Less …" lines.
 *     Expected to miss often: the lines marked * (depreciable assets,
 *     accumulated depreciation, land, intangibles) are computed from the
 *     depreciation module, not typed in.
 */
import { getServiceKey } from "@/lib/supabase/service-key"
import { existsSync, readFileSync } from "node:fs"

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

type Cell = { series_id: string; code_id: string; val: string | null }
type Ret = { returnId: string; clientId: string; year: number; cells: Cell[]; amended: boolean }

const num = (v: string | null): number | null => {
  if (v == null) return null
  const s = v.replace(/,/g, "").trim()
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}
const codeNo = (c: string) => Number(c.slice(1))
const sumOf = (r: Ret, series: string, pick: (code: string) => number) =>
  r.cells.reduce((t, c) => {
    if (c.series_id !== series) return t
    const v = num(c.val)
    return v == null ? t : t + v * pick(c.code_id)
  }, 0)
const priorYear = (r: Ret, code: string): number | null => {
  const c = r.cells.find((x) => x.series_id === "s6100" && x.code_id === code && num(x.val) != null)
  return c ? num(c.val) : null
}

const LESS_BEGIN = new Set(["c103", "c111", "c113", "c116"])
const LESS_END = new Set(["c203", "c211", "c213", "c216"])

const RULES: { name: string; target: string; compute: (r: Ret, next: Ret) => number }[] = [
  {
    name: "Gross receipts less returns",
    target: "c1",
    compute: (r) => sumOf(r, "s200", (c) => (c === "c101" ? 1 : c === "c102" ? -1 : 0)),
  },
  {
    name: "Total deductions",
    target: "c21",
    compute: (r, next) => {
      const overridesDepr = r.cells.some((c) => c.series_id === "s400" && c.code_id === "c111" && num(c.val) != null)
      const lines = sumOf(r, "s400", (c) => {
        const n = codeNo(c)
        if (n < 101 || n > 199 || c === "c169" || c === "c179" || c === "c180") return 0
        if (c === "c123") return 0.5
        if (c === "c146") return 0.8
        if (c === "c152") return -1
        return 1
      })
      return lines + (overridesDepr ? 0 : priorYear(next, "c16") ?? 0)
    },
  },
  {
    name: "Beginning total assets",
    target: "c70",
    compute: (r) => sumOf(r, "s5700", (c) => (codeNo(c) >= 101 && codeNo(c) <= 118 ? (LESS_BEGIN.has(c) ? -1 : 1) : 0)),
  },
  {
    name: "Ending total assets",
    target: "c72",
    compute: (r) => sumOf(r, "s5700", (c) => (codeNo(c) >= 201 && codeNo(c) <= 218 ? (LESS_END.has(c) ? -1 : 1) : 0)),
  },
]

async function main() {
  loadEnv()
  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, getServiceKey()!, {
    auth: { persistSession: false },
  })

  const { data: snaps, error } = await sb
    .from("proconnect_return_snapshots")
    .select("id, return_id, proconnect_client_id, tax_year")
    .eq("return_type", "PAR")
    .is("deleted_at", null)
  if (error) throw new Error(error.message)

  const returns: Ret[] = []
  for (const s of snaps ?? []) {
    const { data: cells, error: cErr } = await sb
      .from("proconnect_return_field_cells")
      .select("series_id, code_id, val")
      .eq("snapshot_id", s.id)
      .in("series_id", ["s200", "s400", "s5700", "s6100", "s5800"])
      .limit(10000)
    if (cErr) throw new Error(cErr.message)
    returns.push({
      returnId: s.return_id,
      clientId: s.proconnect_client_id,
      year: s.tax_year,
      cells: cells ?? [],
      amended: (cells ?? []).some((c) => c.series_id === "s5800"),
    })
  }

  const byClientYear = new Map<string, Ret[]>()
  for (const r of returns) {
    const k = `${r.clientId}|${r.year}`
    byClientYear.set(k, [...(byClientYear.get(k) ?? []), r])
  }

  console.log(`${returns.length} 1065 snapshots loaded\n`)
  for (const rule of RULES) {
    let checked = 0
    let matched = 0
    const misses: string[] = []
    for (const [k, rs] of byClientYear) {
      const [clientId, year] = k.split("|")
      const next = byClientYear.get(`${clientId}|${Number(year) + 1}`)
      if (!next) continue
      const pairs = rs.flatMap((r) => next.filter((n) => priorYear(n, rule.target) != null).map((n) => [r, n] as const))
      if (!pairs.length) continue
      checked++
      if (pairs.some(([r, n]) => Math.abs(rule.compute(r, n) - (priorYear(n, rule.target) as number)) <= 1)) matched++
      else {
        const notes = [rs.length > 1 ? `${rs.length} returns that year` : "", rs.some((r) => r.amended) ? "amended" : ""].filter(Boolean)
        misses.push(`TY${year} ${rs.map((r) => r.returnId).join(",")}${notes.length ? ` (${notes.join(", ")})` : ""}`)
      }
    }
    console.log(`${rule.name.padEnd(28)} ${matched}/${checked} match`)
    for (const m of misses.slice(0, 20)) console.log(`    miss ${m}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
