/**
 * GET  /api/forms/1040/[returnId]?taxYear=2025
 * POST /api/forms/1040/[returnId]
 *
 * GET:  Renders the return's ProConnect field cells into a structured
 *       Form1040Data object with computed lines evaluated.
 * POST: Accepts user-supplied line values, merges with existing cells,
 *       composes a ProConnect import-series payload (dry-run by default).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  loadSchema,
  renderForm1040,
  composeImportEntries,
  evaluateComputedLines,
  type Form1040Data,
  type FieldCell,
} from "@/lib/forms/form-1040"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

// ---------------------------------------------------------------------------
// GET — render current return as Form 1040
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ returnId: string }> },
) {
  const { returnId } = await params
  const { searchParams } = new URL(request.url)
  const taxYear = parseInt(searchParams.get("taxYear") ?? "2025", 10)

  const sb = admin()

  // 1. Get the snapshot + client context
  const { data: snapshot, error: snapErr } = await sb
    .from("proconnect_return_snapshots")
    .select("id, proconnect_client_id, client_name, tax_year, return_type, version, exported_at")
    .eq("return_id", returnId)
    .maybeSingle()

  if (snapErr) {
    return NextResponse.json({ error: snapErr.message }, { status: 500 })
  }
  if (!snapshot) {
    return NextResponse.json(
      { error: "Return not found. Export the return first via /api/proconnect/returns/[returnId]/data" },
      { status: 404 },
    )
  }

  // 2. Fetch the flat field cells. We read every leaf field (not just
  //    `val`) so the renderer can resolve mappings whose cell_field points
  //    at desc / src / tsj / scope (e.g. text or T/S/J-keyed lines).
  const { data: cellRows, error: cellErr } = await sb
    .from("proconnect_return_field_cells")
    .select("series_id, prefix_id, code_id, suffix_id, val, description, src, tsj, scope, source, city_abbrev")
    .eq("return_id", returnId)

  if (cellErr) {
    return NextResponse.json({ error: cellErr.message }, { status: 500 })
  }

  const cells: FieldCell[] = (cellRows ?? []).map((r) => ({
    seriesId: r.series_id,
    prefixId: r.prefix_id,
    codeId: r.code_id,
    suffixId: r.suffix_id,
    val: r.val,
    desc: r.description,
    src: r.src,
    tsj: r.tsj,
    scope: r.scope,
    source: r.source,
    cityAbbrev: r.city_abbrev,
  }))

  // 3. Render into Form 1040 structure, scoped to this return's type.
  const returnType = snapshot.return_type ?? "IND"
  const form1040 = await renderForm1040(taxYear, cells, returnType)

  // 4. Load schema for metadata
  const schema = await loadSchema(taxYear, returnType)

  return NextResponse.json({
    returnId,
    taxYear,
    clientName: snapshot.client_name,
    returnType: snapshot.return_type,
    version: snapshot.version,
    exportedAt: snapshot.exported_at,
    lineCount: schema.lines.length,
    mappedLineCount: schema.mappings.length,
    lines: form1040,
  })
}

// ---------------------------------------------------------------------------
// POST — compose import payload from user-supplied values
// ---------------------------------------------------------------------------

interface PostBody {
  taxYear?: number
  returnType?: string
  clientId: string
  lines: Record<string, string | number | boolean>
  dryRun?: boolean
  actor?: string
  reason?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ returnId: string }> },
) {
  const { returnId } = await params
  let body: PostBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const taxYear = body.taxYear ?? 2025
  const returnType = body.returnType ?? "IND"

  // 1. Load schema (lines + constants + discovered ProConnect mappings)
  const schema = await loadSchema(taxYear, returnType)
  const { lines, constants, mappings } = schema

  if (mappings.length === 0) {
    return NextResponse.json(
      {
        error:
          "No ProConnect mappings configured for TY" +
          taxYear +
          " (" +
          returnType +
          "). Export a return first to discover the series/code structure, then populate form_1040_proconnect_map.",
      },
      { status: 422 },
    )
  }

  // 2. Build Form1040Data from user input (keyed by IRS line_code)
  const data: Form1040Data = {}
  for (const line of lines) {
    const userVal = body.lines[line.lineCode]
    data[line.lineCode] =
      userVal !== undefined && userVal !== null && userVal !== ""
        ? { value: userVal, line, source: "input" }
        : { value: null, line, source: "input" }
  }

  // 3. Evaluate computed lines
  const evaluated = evaluateComputedLines(data, lines, constants)

  // 4. Compose import entries (routed to the correct cell_field per mapping)
  const importPayloads = await composeImportEntries(taxYear, evaluated, returnType)

  // 5. Return the composed payload (caller can POST to /api/proconnect/returns/[returnId]/import/[seriesId])
  return NextResponse.json({
    returnId,
    taxYear,
    clientId: body.clientId,
    dryRun: body.dryRun ?? true,
    actor: body.actor ?? null,
    reason: body.reason ?? null,
    evaluatedLines: evaluated,
    importPayloads,
    hint:
      "POST each entry in importPayloads to /api/proconnect/returns/" +
      returnId +
      "/import/{seriesId} with { clientId, version, dryRun, entries, actor, reason }",
  })
}
