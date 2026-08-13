/**
 * 398: verify how line 8 ("other income") should read the s200M detail grid.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/398-verify-line8-detail-grid.ts
 *   npx tsx --env-file=.env.local scripts/398-verify-line8-detail-grid.ts <returnId>
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────
 * Line 8 maps to a SINGLE cell, s200M/p0/c11/x1000. But s200M is the
 * expansion grid behind s200/c11 "Other income (Click on button to
 * expand)", and its rows are enumerated by SUFFIX — x1000, x1001, … —
 * each row carrying an amount in `val` and a payer label in `desc`. So
 * the mapping reads row one and ignores the rest.
 *
 * The obvious fixes are BOTH wrong, which is why this is a harness and
 * not a patch. Measured across every stored return carrying s200M/c11:
 *
 *   sum every suffix   → OVERCOUNTS. On return f69d8483 x1000 and x1001
 *                        both hold 7024 with the identical desc
 *                        ("SUN LIFE ASSUR CO OF CANADA - other income").
 *                        A straight sum doubles a single payment.
 *
 *   read x1000 only    → UNDERCOUNTS. On return 8e8225d5 the grid holds
 *   (today's behaviour)  two DISTINCT rows, 14048 "Lincoln Natl Life"
 *                        and 1500 "Advantage Holdings", matching the two
 *                        base-series payers. Only the first is read.
 *
 * A dedupe-on-(desc,val) rule happens to produce the right answer on both
 * returns — but it is fitted to two data points, and it would wrongly
 * collapse two genuinely identical payments from the same payer. That is
 * not a rule to ship into a tax-return viewer on inference.
 *
 * There is a second, independent unknown in the same place: 1099-NEC
 * nonemployee compensation (s200/c409) normally flows to Schedule C, not
 * line 8. `s200/c446` ("Schedule C name or number") records that link. On
 * f69d8483 the diverted payer HAS c446 and is correctly absent from the
 * grid; on 8e8225d5 the 1500 payer has NO c446 and IS in the grid. So the
 * grid appears to list exactly what reaches line 8 — but "appears to" on
 * n=2 is not a mapping.
 *
 * ─── WHAT SETTLES IT ────────────────────────────────────────────────
 * The filed PDF. Per Intuit (Steve, 2026-07-27) calculated values are not
 * exported, so the filed return is the sanctioned answer key. Open the
 * filed 1040 for a return below, read Schedule 1 line 8 / the 1040 line 8
 * total, and compare against the three candidates this prints. One
 * comparison per return decides the rule.
 *
 * Record the answer in form_1040_proconnect_map (cell_role='detail' rows
 * for the grid, per scripts/387) and re-run scripts/387 to refresh
 * `editable`. Until then line 8 keeps today's behaviour: x1000 plus the
 * verified rollup components in lib/forms/form-1040-estimates.ts
 * (unemployment s15/c2, alimony s200M/c5 x1, gambling s19/c3), taking
 * max(mapped, rollup) — defensible, and never silently summing the grid.
 */

import { createClient } from "@supabase/supabase-js"

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const TAX_YEAR = 2025
const GRID = { seriesId: "s200M", codeId: "c11" }

async function pageAll<T>(
  table: string,
  select: string,
  tweak: (q: any) => any = (q) => q,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tweak(sb.from(table).select(select).range(from, from + 999))
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as T[]))
    if ((data as T[]).length < 1000) break
  }
  return out
}

const toNum = (v: string | null) =>
  v === null ? 0 : Number.parseFloat(String(v).replace(/[,$\s]/g, "")) || 0

type Cell = {
  return_id: string
  series_id: string
  prefix_id: string
  code_id: string
  suffix_id: string
  val: string | null
  description: string | null
}

async function main() {
  const only = process.argv[2] ?? null

  const snaps = await pageAll<{ return_id: string; return_type: string | null; client_name: string | null }>(
    "proconnect_return_snapshots",
    "return_id, return_type, client_name",
  )
  const indNames = new Map(
    snaps.filter((s) => (s.return_type ?? "IND") === "IND").map((s) => [s.return_id, s.client_name]),
  )

  const cells = await pageAll<Cell>(
    "proconnect_return_field_cells",
    "return_id, series_id, prefix_id, code_id, suffix_id, val, description",
  )
  const ind = cells.filter((c) => indNames.has(c.return_id))

  const catalog = await pageAll<{ code_id: string; description: string }>(
    "proconnect_field_catalog",
    "code_id, description",
    (q: any) =>
      q.eq("tax_year", TAX_YEAR).eq("return_type", "IND").eq("agency", "Federal").eq("series_id", "s200"),
  )
  const label = new Map(catalog.map((r) => [r.code_id, r.description]))

  const targets = [
    ...new Set(
      ind
        .filter((c) => c.series_id === GRID.seriesId && c.code_id === GRID.codeId)
        .map((c) => c.return_id),
    ),
  ].filter((r) => !only || r.startsWith(only))

  if (targets.length === 0) {
    console.log(only ? `No s200M/c11 rows on a return matching "${only}".` : "No return carries s200M/c11.")
    return
  }

  console.log(`Line 8 detail-grid candidates — ${targets.length} return(s)\n`)
  console.log("For each: open the FILED PDF, read Schedule 1 line 8 / 1040 line 8,")
  console.log("and mark which candidate matches.\n")

  let disagree = 0
  for (const r of targets) {
    const rows = ind
      .filter((c) => c.return_id === r && c.series_id === GRID.seriesId && c.code_id === GRID.codeId)
      .sort((a, b) => a.suffix_id.localeCompare(b.suffix_id))

    const x1000 = toNum(rows.find((c) => c.suffix_id === "x1000")?.val ?? null)
    const sum = rows.reduce((a, c) => a + toNum(c.val), 0)
    const seen = new Set<string>()
    const deduped = rows.reduce((a, c) => {
      const k = `${c.description ?? ""}|${c.val ?? ""}`
      if (seen.has(k)) return a
      seen.add(k)
      return a + toNum(c.val)
    }, 0)

    console.log(`── ${r}  (${indNames.get(r) ?? "?"})`)
    for (const c of rows) {
      console.log(
        `     ${c.suffix_id.padEnd(7)} val=${String(c.val ?? "—").padEnd(12)} desc=${JSON.stringify(c.description)}`,
      )
    }

    // Base-series payers on the same return, with the Schedule C link.
    const base = ind.filter(
      (c) => c.return_id === r && c.series_id === "s200" && /^c4\d\d$/.test(c.code_id) && toNum(c.val) !== 0,
    )
    if (base.length) console.log(`     base s200 amounts:`)
    for (const b of base) {
      const schedC = ind.find(
        (c) =>
          c.return_id === r && c.series_id === "s200" && c.prefix_id === b.prefix_id && c.code_id === "c446",
      )
      console.log(
        `       ${b.prefix_id}/${b.code_id} = ${String(b.val).padEnd(10)} ${(label.get(b.code_id) ?? "?").slice(0, 46).padEnd(46)}` +
          (schedC ? `  → Schedule C (c446=${schedC.val})` : "  → no Sch-C link"),
      )
    }

    const candidates = [
      ["x1000 only (today)", x1000],
      ["sum of suffixes   ", sum],
      ["dedupe desc+val   ", deduped],
    ] as const
    console.log(`     candidates:`)
    for (const [name, v] of candidates) console.log(`       ${name}  ${v.toLocaleString()}`)
    if (new Set(candidates.map(([, v]) => v)).size > 1) {
      disagree++
      console.log(`     >>> CANDIDATES DISAGREE — this return decides the rule.`)
    } else {
      console.log(`     (all candidates agree — not informative)`)
    }
    console.log()
  }

  console.log(
    `${disagree} of ${targets.length} return(s) distinguish the candidates. Check those against the filed PDF first.`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
