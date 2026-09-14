/**
 * 413: verify line 26 sums all four quarters, through the REAL render path.
 *
 *   npx tsx --env-file=.env.local scripts/413-verify-line26-quarters.ts
 *
 * Run this AFTER applying 412 + 413. The migration runner
 * (scripts/412-run-addend-role.mjs) asserts the mapping SHAPE in SQL; this
 * asserts the rendered VALUE in TypeScript, which is the thing a preparer
 * actually sees. Same split as scripts/390 and scripts/398.
 *
 * Why both are needed: the mapping can be perfectly shaped and the renderer
 * still wrong, because summing addends is new code (the `addend` branch in
 * lib/forms/form-1040.ts). The SQL cannot test it.
 *
 * Passes when, for every return with estimated payments:
 *   rendered line 26  ==  sum of the four quarterly cells
 * and, for a return with NO estimated payments, line 26 renders null rather
 * than 0 — a fabricated zero on a payments line is its own bug.
 */
import { getServiceKey } from "@/lib/supabase/service-key"
import { createClient } from "@supabase/supabase-js"
import { renderForm1040, type FieldCell } from "@/lib/forms/form-1040"

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  getServiceKey()!,
  { auth: { persistSession: false } },
)

const QUARTER_CODES = ["c2", "c4", "c6", "c8"] as const
const money = (n: unknown) =>
  typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(n)

async function cellsFor(snapshotId: string): Promise<FieldCell[]> {
  const out: FieldCell[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("proconnect_return_field_cells")
      .select("series_id, prefix_id, code_id, suffix_id, val, description, src, tsj")
      .eq("snapshot_id", snapshotId)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    for (const r of data) {
      out.push({
        seriesId: r.series_id,
        prefixId: r.prefix_id,
        codeId: r.code_id,
        suffixId: r.suffix_id,
        val: r.val,
        desc: r.description,
        src: r.src,
        tsj: r.tsj,
      })
    }
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  const { data: snaps, error } = await sb
    .from("proconnect_return_snapshots")
    .select("id, return_id, client_name, tax_year, return_type")
    .eq("return_type", "IND")
    .is("deleted_at", null)
    .order("tax_year", { ascending: false })
  if (error) throw new Error(error.message)

  console.log(`Checking line 26 across ${snaps!.length} IND return(s)\n`)

  const failures: string[] = []
  let withPayments = 0
  let withoutPayments = 0
  let totalRecovered = 0

  for (const s of snaps!) {
    const cells = await cellsFor(s.id)

    // Independent expectation, read straight from the cells — never from the
    // mapping the renderer is being tested against.
    const quarters = cells.filter(
      (c) => c.seriesId === "s5400" && (QUARTER_CODES as readonly string[]).includes(c.codeId),
    )
    const present = quarters.filter((c) => c.val !== null && String(c.val).trim() !== "")
    const expected = present.reduce(
      (a, c) => a + Number.parseFloat(String(c.val).replace(/[,$\s]/g, "")),
      0,
    )
    const q1Only = present
      .filter((c) => c.codeId === "c2")
      .reduce((a, c) => a + Number.parseFloat(String(c.val).replace(/[,$\s]/g, "")), 0)

    const rendered = await renderForm1040(s.tax_year, cells, "IND")
    const got = rendered["26"]?.value ?? null

    if (present.length === 0) {
      withoutPayments++
      // A payments line with no payments must be blank, not zero.
      if (got !== null) {
        failures.push(`${s.client_name} (TY${s.tax_year}): no estimated payments but line 26 rendered ${got}`)
      }
      continue
    }

    withPayments++
    if (typeof got !== "number" || Math.abs(got - expected) > 0.01) {
      failures.push(
        `${s.client_name} (TY${s.tax_year}): line 26 rendered ${money(got)}, expected ${money(expected)} ` +
          `from ${present.length} quarter(s)`,
      )
      continue
    }

    if (present.length > 1) {
      totalRecovered += expected - q1Only
      console.log(
        `  ${String(s.client_name).slice(0, 28).padEnd(30)} TY${s.tax_year}  ` +
          `${present.length} quarters  ${money(expected).padStart(10)}  ` +
          `(Q1-only would read ${money(q1Only)})`,
      )
    }
  }

  console.log(
    `\n${withPayments} return(s) with estimated payments, ${withoutPayments} without.`,
  )
  console.log(`${money(totalRecovered)} in payments that the Q1-only reading missed.`)

  if (failures.length) {
    console.error(`\nFAILED — ${failures.length} return(s):`)
    for (const f of failures) console.error("  - " + f)
    process.exit(1)
  }
  console.log("\nAll returns render line 26 as the full sum of their quarters.")
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
