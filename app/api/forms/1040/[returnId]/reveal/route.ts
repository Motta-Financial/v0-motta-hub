/**
 * POST /api/forms/1040/[returnId]/reveal
 *
 * Audited reveal of a single masked sensitive Form 1040 value (SSN /
 * EIN / routing / account). The GET renderer never sends these raw —
 * this is the only endpoint that does, and every reveal is logged to
 * sensitive_field_access_log with the requesting user.
 *
 * Body: { lineCode: string, taxYear?: number, prefixId?: string }
 * Response: { lineCode, prefixId, value } — Cache-Control: no-store, always.
 *
 * `prefixId` selects one occurrence of a repeating line (dep_ssn carries
 * one value per dependent, scripts/389). Omit it for scalar lines. The
 * occurrence is recorded in the audit log alongside the line code.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import {
  loadSchema,
  renderForm1040,
  SENSITIVE_DATA_TYPES,
  isMaskedValue,
  type FieldCell,
} from "@/lib/forms/form-1040"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

const NO_STORE = { "Cache-Control": "no-store" }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ returnId: string }> },
) {
  const { returnId } = await params

  let body: { lineCode?: string; taxYear?: number; prefixId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE },
    )
  }

  const lineCode = body.lineCode
  if (!lineCode || typeof lineCode !== "string") {
    return NextResponse.json(
      { error: "lineCode is required" },
      { status: 400, headers: NO_STORE },
    )
  }
  const taxYear = body.taxYear ?? 2025

  const sb = admin()

  // 1. Snapshot → return type (and existence check).
  const { data: snapshot, error: snapErr } = await sb
    .from("proconnect_return_snapshots")
    .select("id, return_type")
    .eq("return_id", returnId)
    .maybeSingle()

  if (snapErr) {
    return NextResponse.json(
      { error: snapErr.message },
      { status: 500, headers: NO_STORE },
    )
  }
  if (!snapshot) {
    return NextResponse.json(
      { error: "Return not found" },
      { status: 404, headers: NO_STORE },
    )
  }
  const returnType = snapshot.return_type ?? "IND"

  // 2. Only sensitive-typed lines are revealable — everything else is
  //    already visible on the GET endpoint and needs no audit trail.
  const schema = await loadSchema(taxYear, returnType)
  const line = schema.lines.find((l) => l.lineCode === lineCode)
  if (!line) {
    return NextResponse.json(
      { error: `Unknown line code: ${lineCode}` },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!SENSITIVE_DATA_TYPES.has(line.dataType)) {
    return NextResponse.json(
      { error: `Line ${lineCode} is not a sensitive field` },
      { status: 400, headers: NO_STORE },
    )
  }

  // 3. Re-render this return's cells server-side and pick the one line.
  const { data: cellRows, error: cellErr } = await sb
    .from("proconnect_return_field_cells")
    .select(
      "series_id, prefix_id, code_id, suffix_id, val, description, src, tsj, scope, source, city_abbrev",
    )
    .eq("return_id", returnId)

  if (cellErr) {
    return NextResponse.json(
      { error: cellErr.message },
      { status: 500, headers: NO_STORE },
    )
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

  const form1040 = await renderForm1040(taxYear, cells, returnType)
  const entry = form1040[lineCode]

  // Repeating lines (dep_ssn — one value per dependent) carry `instances`.
  // `prefixId` selects one; without it the caller gets the scalar, which is
  // instances[0]. An unknown prefix reveals NOTHING rather than falling back
  // to the first dependent, which would disclose the wrong person's SSN.
  const prefixId = typeof body.prefixId === "string" ? body.prefixId : null
  let raw: typeof entry.value | null
  if (prefixId !== null) {
    const match = entry?.instances?.find((i) => i.prefixId === prefixId)
    if (!match) {
      return NextResponse.json(
        { error: `Line ${lineCode} has no instance ${prefixId}` },
        { status: 400, headers: NO_STORE },
      )
    }
    raw = match.value
  } else {
    raw = entry?.value ?? null
  }
  const value = raw !== null && !isMaskedValue(raw) ? raw : null

  // 4. Resolve the requesting user the same way other authenticated
  //    routes do (local JWT verification, no GoTrue round-trip).
  let accessedBy = "unknown"
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await getAuthenticatedUser(supabase)
    if (user) accessedBy = user.email ?? user.id
  } catch {
    // No user context (e.g. server-to-server call) — still log below.
  }

  // 5. Audit the reveal BEFORE returning the value. If logging fails,
  //    do not return the raw value — the audit trail is the contract.
  const { error: logErr } = await sb.from("sensitive_field_access_log").insert({
    return_id: returnId,
    line_code: lineCode,
    // Which occurrence, so the log can answer "whose SSN was shown" on a
    // repeating line (scripts/389). NULL for scalar lines.
    instance_prefix: prefixId,
    accessed_by: accessedBy,
    context: "1040-viewer",
  })

  if (logErr) {
    return NextResponse.json(
      { error: `Failed to record access log: ${logErr.message}` },
      { status: 500, headers: NO_STORE },
    )
  }

  return NextResponse.json({ lineCode, prefixId, value }, { headers: NO_STORE })
}
