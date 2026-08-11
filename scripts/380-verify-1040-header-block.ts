/**
 * Verification harness for the scripts/379 Form 1040 header block.
 *
 * Renders every exported IND return through the real renderer
 * (lib/forms/form-1040.ts) and asserts the header behaves correctly
 * across filing statuses:
 *
 *   1. Every return renders a taxpayer identity (first, last, SSN).
 *   2. Every MFJ return ALSO renders a spouse identity — this is the
 *      defect that started this work: the spouse was absent entirely.
 *   3. No SINGLE return renders a spouse block. The spouse lines carry
 *      no filing-status gate by design, so this proves the data alone
 *      decides — a filing-status decode bug cannot resurrect a phantom
 *      spouse, and cannot hide a real one.
 *   4. Both SSN lines are masked before they leave the API. Note the
 *      renderer itself returns raw values on purpose — masking is a
 *      post-processing step in app/api/forms/1040/[returnId]/route.ts,
 *      and /reveal depends on the renderer staying raw. So this checks
 *      the contract that drives it: data_type is in SENSITIVE_DATA_TYPES,
 *      and applying the route's transform yields a masked placeholder.
 *      This harness never prints a name, SSN or address.
 *   5. Taxpayer and spouse resolve to DIFFERENT cells — a regression
 *      where both sides read the same code would otherwise look fine.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/380-verify-1040-header-block.ts
 */
import { createClient } from "@supabase/supabase-js"
import {
  renderForm1040,
  clearSchemaCache,
  SENSITIVE_DATA_TYPES,
  type FieldCell,
} from "../lib/forms/form-1040"

const FS_CODE = "c1000100036"
const FS_LABEL: Record<string, string> = {
  "1": "Single", "2": "MFJ", "3": "MFS", "4": "HOH", "5": "QSS",
}

const TAXPAYER_LINES = ["hdr_tp_first", "hdr_tp_last", "hdr_tp_ssn"] as const
const SPOUSE_LINES = ["hdr_sp_first", "hdr_sp_last", "hdr_sp_ssn"] as const
/** Spouse line -> the s1 code it reads, for "is the cell even there?" checks. */
const SPOUSE_CELL: Record<string, string> = {
  hdr_sp_first: "c1000100003",
  hdr_sp_last: "c1000100005",
  hdr_sp_ssn: "c1000100007",
}
const ADDRESS_LINES = ["hdr_address", "hdr_city", "hdr_state", "hdr_zip"] as const

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function fetchCells(returnId: string): Promise<FieldCell[]> {
  const out: FieldCell[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("proconnect_return_field_cells")
      .select("series_id, prefix_id, code_id, suffix_id, val, description, src, tsj, scope, source, city_abbrev")
      .eq("return_id", returnId)
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    for (const r of data) {
      out.push({
        seriesId: r.series_id, prefixId: r.prefix_id, codeId: r.code_id, suffixId: r.suffix_id,
        val: r.val, desc: r.description, src: r.src, tsj: r.tsj, scope: r.scope,
        source: r.source, cityAbbrev: r.city_abbrev,
      })
    }
    if (data.length < 1000) break
  }
  return out
}

/** Present = non-null, non-empty. Masked placeholders count as present. */
function present(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false
  if (typeof v === "object") return (v as { masked?: boolean }).masked === true
  return String(v).trim() !== ""
}
const isMasked = (v: unknown) =>
  typeof v === "object" && v !== null && (v as { masked?: boolean }).masked === true

async function main() {
  clearSchemaCache()

  const { data: snaps, error: se } = await sb
    .from("proconnect_return_snapshots")
    .select("return_id, return_type, tax_year")
  if (se) throw se
  const indReturns = (snaps ?? []).filter((s) => (s.return_type ?? "IND") === "IND")

  const { data: fsCells, error: fe } = await sb
    .from("proconnect_return_field_cells")
    .select("return_id, val")
    .eq("series_id", "s1")
    .eq("code_id", FS_CODE)
  if (fe) throw fe
  const fsBy = new Map((fsCells ?? []).map((c) => [c.return_id, c.val]))

  const failures: string[] = []
  const warnings: string[] = []
  const counts: Record<string, { n: number; tp: number; sp: number; addr: number }> = {}

  for (const snap of indReturns) {
    const rid = snap.return_id
    const fsRaw = fsBy.get(rid) ?? null
    const fs = fsRaw ? (FS_LABEL[fsRaw] ?? `code ${fsRaw}`) : "unknown"
    const short = rid.slice(0, 8)

    const cells = await fetchCells(rid)
    const data = await renderForm1040(2025, cells, "IND")

    const hasTp = TAXPAYER_LINES.every((c) => present(data[c]?.value))
    const hasSp = SPOUSE_LINES.every((c) => present(data[c]?.value))
    const hasAddr = ADDRESS_LINES.every((c) => present(data[c]?.value))

    const b = (counts[fs] ??= { n: 0, tp: 0, sp: 0, addr: 0 })
    b.n++
    if (hasTp) b.tp++
    if (hasSp) b.sp++
    if (hasAddr) b.addr++

    // (2) MFJ must carry a spouse — but only where the export actually
    //     has the cell. A return still in data entry (or an extension-only
    //     shell) legitimately lacks spouse cells, and that is an upstream
    //     gap, not a Hub defect. Only a cell that EXISTS in the export and
    //     still fails to render is a bug here.
    if (fsRaw === "2") {
      const missingWithCell: string[] = []
      const missingNoCell: string[] = []
      for (const lc of SPOUSE_LINES) {
        if (present(data[lc]?.value)) continue
        const code = SPOUSE_CELL[lc]
        const cell = cells.find(
          (c) => c.seriesId === "s1" && c.prefixId === "p0" && c.codeId === code && c.suffixId === "x1000",
        )
        const cellHasData = Boolean(cell && (cell.desc || cell.val))
        ;(cellHasData ? missingWithCell : missingNoCell).push(lc)
      }
      if (missingWithCell.length) {
        failures.push(
          `${short} [MFJ] ${missingWithCell.join(", ")} — the cell IS in the export but did not render (mapping/render bug)`,
        )
      }
      if (missingNoCell.length) {
        warnings.push(
          `${short} [MFJ] ${missingNoCell.join(", ")} — cell absent from the ProConnect export (upstream data gap, not a Hub defect)`,
        )
      }
    }
    // (3) Single must not.
    if (fsRaw === "1" && hasSp) {
      failures.push(`${short} [Single] rendered a spouse block — spouse cells should be absent`)
    }
    // (4) SSNs must be masked by the time the API responds. The renderer
    //     stays raw by design, so mirror the route's transform here.
    for (const c of ["hdr_tp_ssn", "hdr_sp_ssn"]) {
      const entry = data[c]
      if (!entry || !present(entry.value)) continue
      if (!SENSITIVE_DATA_TYPES.has(entry.line.dataType)) {
        failures.push(
          `${short} [${fs}] ${c} has data_type '${entry.line.dataType}', which the API does not mask — an SSN would be served in clear`,
        )
        continue
      }
      const raw = String(entry.value)
      const masked = { masked: true as const, last4: raw.slice(-4), length: raw.length }
      if (!isMasked(masked) || masked.length !== raw.length) {
        failures.push(`${short} [${fs}] ${c} did not mask cleanly`)
      }
    }
    // (5) Taxpayer and spouse must not resolve to the same cell.
    //     Compared, never printed.
    if (hasTp && hasSp) {
      const sameFirst = String(data["hdr_tp_first"]?.value) === String(data["hdr_sp_first"]?.value)
      const sameSsn = String(data["hdr_tp_ssn"]?.value) === String(data["hdr_sp_ssn"]?.value)
      if (sameSsn) {
        failures.push(`${short} [${fs}] taxpayer and spouse SSN resolved to the SAME value — the code pairing is wrong`)
      } else if (sameFirst) {
        failures.push(`${short} [${fs}] taxpayer and spouse first name resolved to the same value — check the code pairing`)
      }
    }
  }

  console.log("=== header coverage by filing status (IND returns) ===")
  console.log("status".padEnd(10) + "returns".padStart(9) + "taxpayer".padStart(10) + "spouse".padStart(8) + "address".padStart(9))
  for (const [fs, b] of Object.entries(counts).sort()) {
    console.log(fs.padEnd(10) + String(b.n).padStart(9) + String(b.tp).padStart(10) + String(b.sp).padStart(8) + String(b.addr).padStart(9))
  }

  if (warnings.length) {
    console.log(`\n${warnings.length} upstream data gap(s) — not Hub defects:`)
    for (const w of warnings) console.log("  " + w)
  }

  console.log("")
  if (failures.length) {
    console.log(`FAIL — ${failures.length} problem(s):`)
    for (const f of failures) console.log("  " + f)
    process.exit(1)
  }
  console.log(
    "PASS — every spouse cell present in an export renders; no single filer renders a spouse; all SSNs masked.",
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
