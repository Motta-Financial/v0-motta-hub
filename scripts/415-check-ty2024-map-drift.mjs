/**
 * 415: report where the TY2024 mapping has drifted from TY2025.
 *
 *   node --env-file=.env.local scripts/415-check-ty2024-map-drift.mjs
 *
 * Read-only. Exits non-zero when drift is found, so it can gate a workflow.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────
 * scripts/401 built the TY2024 map with INSERT ... SELECT from TY2025. That
 * is a POINT-IN-TIME COPY, not a live link. Every TY2025 mapping improvement
 * made after 401 ran silently skips TY2024 unless somebody mirrors it.
 *
 * It has already happened once. scripts/413 fixed line 26 to sum all four
 * quarterly estimated payments — for TY2025 only. TY2024 kept reading Q1, and
 * one real return rendered a BLANK line 26 while 16,400 of payments sat in
 * cells the mapping did not read. Nothing warned; the only symptom was a
 * number quietly too low.
 *
 * So: run this after any TY2025 mapping round, until TY2024 has a verified
 * map of its own. It compares the two years line by line and reports:
 *
 *   MISSING IN 2024   a cell TY2025 maps and TY2024 does not
 *   EXTRA IN 2024     a cell TY2024 maps and TY2025 does not
 *   ROLE DIFFERS      same cell, different cell_role (the line-26 case:
 *                     TY2025 'addend' vs TY2024 'primary')
 *   FIELD DIFFERS     same cell, different cell_field (val vs desc)
 *
 * NOT drift, and deliberately excluded:
 *   * confidence      TY2024 is 'inferred' by design (scripts/401) until a
 *                     filed 2024 PDF confirms it. Differing is correct.
 *   * editable        TY2024 is false by design until the 2024 catalog loads.
 *   * lines TY2025 marks not_applicable for TY2024 (13b, Schedule 1-A) —
 *     those SHOULD differ, and reporting them would train people to ignore
 *     this script.
 */
import { Client } from "pg"

let url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!url) {
  console.error("No POSTGRES_URL_NON_POOLING / POSTGRES_URL in env")
  process.exit(1)
}
url = url.replace(/([?&])sslmode=[^&]*(&?)/, (_, pre, post) => (post ? pre : ""))

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  const { rows } = await client.query(`
    with m as (
      select tax_year, line_code, cell_key, series_id, prefix_id, code_id,
             suffix_id, cell_field, cell_role
        from form_1040_proconnect_map
       where return_type = 'IND' and form = '1040'
         and tax_year in (2024, 2025)
         and series_id is not null
    ),
    y25 as (select * from m where tax_year = 2025),
    y24 as (select * from m where tax_year = 2024),
    -- Lines TY2024 marks N/A are SUPPOSED to differ.
    na24 as (
      select line_code from form_1040_lines
       where tax_year = 2024 and form = '1040' and not_applicable
    )
    select
      coalesce(y25.line_code, y24.line_code)             as line_code,
      coalesce(y25.series_id, y24.series_id) || '/' ||
      coalesce(y25.code_id,  y24.code_id)                as cell,
      case
        when y24.cell_key is null then 'MISSING IN 2024'
        when y25.cell_key is null then 'EXTRA IN 2024'
        when y25.cell_role <> y24.cell_role then 'ROLE DIFFERS'
        else 'FIELD DIFFERS'
      end                                                as kind,
      y25.cell_role  as role_2025, y24.cell_role  as role_2024,
      y25.cell_field as field_2025, y24.cell_field as field_2024
      from y25
      full outer join y24
        on y24.line_code = y25.line_code and y24.cell_key = y25.cell_key
     where (y24.cell_key is null or y25.cell_key is null
            or y25.cell_role <> y24.cell_role
            or y25.cell_field is distinct from y24.cell_field)
       and coalesce(y25.line_code, y24.line_code) not in (select line_code from na24)
     order by 3, 1, 2`)

  if (rows.length === 0) {
    console.log("No drift: the TY2024 mapping matches TY2025 cell for cell.")
    process.exit(0)
  }

  console.log(`${rows.length} drifted mapping(s) between TY2025 and TY2024:\n`)
  let kind = null
  for (const r of rows) {
    if (r.kind !== kind) {
      kind = r.kind
      console.log(`── ${kind} ──`)
    }
    const detail =
      r.kind === "ROLE DIFFERS"
        ? `  2025=${r.role_2025}  2024=${r.role_2024}`
        : r.kind === "FIELD DIFFERS"
          ? `  2025=${r.field_2025}  2024=${r.field_2024}`
          : ""
    console.log(`  line ${String(r.line_code).padEnd(16)} ${String(r.cell).padEnd(22)}${detail}`)
  }

  console.log(
    "\nTY2024's map is a point-in-time copy from scripts/401, so TY2025 fixes do\n" +
      "not propagate. Mirror each of the above into TY2024, or record why it\n" +
      "should differ. Until then TY2024 renders an older version of the form.",
  )
  process.exitCode = 1
} catch (err) {
  console.error("FAILED:", err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
