/**
 * Import (write-back) field data into a single series of a return.
 *
 * POST /api/proconnect/returns/[returnId]/import/[seriesId]
 *
 * Body (mirrors the upstream ImportRequest):
 * {
 *   "clientId":  "9341455559706519",         // required (path is firm-scoped)
 *   "version":   "550e8400-...",             // null when adding the series for the first time
 *   "dryRun":    false,                      // optional — runs validation without persisting
 *   "entries":   [ { prefixId, codeId, suffixId, ... } ],
 *   "actor":     "user-or-system-id",        // optional — recorded on the audit row
 *   "reason":    "free-text origin"          // optional — recorded on the audit row
 * }
 *
 * Phase 1 endpoint:
 *   POST https://api.intuit.com/v2/clients/{clientId}/returns/{returnId}/import/series/{seriesId}
 *
 * Audit policy:
 *   We record EVERY attempt — including dry runs and validation failures
 *   that never hit the network — into proconnect_import_jobs, with one
 *   row per rejected entry in proconnect_import_entry_results. After a
 *   successful non-dry-run write we trigger a fresh export so the local
 *   snapshot reflects what ProConnect now thinks the return contains.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  importSeries,
  exportReturnData,
  flattenSeriesMap,
  MAX_ENTRIES_PER_IMPORT,
  type ImportEntry,
  type ImportRequest,
} from "@/lib/proconnect/data"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

type Body = {
  clientId?: string
  version?: string | null
  dryRun?: boolean
  entries?: ImportEntry[]
  actor?: string
  reason?: string
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ returnId: string; seriesId: string }> },
) {
  const sb = admin()
  const { returnId, seriesId } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Body

  // ------------------------------------------------------------------ validate
  if (!body.clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return NextResponse.json({ error: "entries[] is required and must be non-empty" }, { status: 400 })
  }
  if (body.entries.length > MAX_ENTRIES_PER_IMPORT) {
    return NextResponse.json(
      {
        error: `entries[].length=${body.entries.length} exceeds spec max of ${MAX_ENTRIES_PER_IMPORT}; chunk client-side`,
      },
      { status: 400 },
    )
  }
  if (body.version !== undefined && body.version !== null && typeof body.version !== "string") {
    return NextResponse.json({ error: "version must be string or null" }, { status: 400 })
  }

  // ------------------------------------------------------------------ create audit row up-front
  const dryRun = Boolean(body.dryRun)
  const trigger = body.actor ? `manual:${body.actor}` : "manual"
  const triggerCtx: Record<string, unknown> = {}
  if (body.reason) triggerCtx.reason = body.reason
  const { data: jobRow, error: jobErr } = await sb
    .from("proconnect_import_jobs")
    .insert({
      return_id: returnId,
      proconnect_client_id: body.clientId,
      series_id: seriesId,
      request_version: body.version ?? null,
      dry_run: dryRun,
      entry_count_requested: body.entries.length,
      entries_payload: { entries: body.entries },
      status: "pending",
      triggered_by: trigger,
      trigger_context: Object.keys(triggerCtx).length ? triggerCtx : null,
    })
    .select("id")
    .single()
  if (jobErr || !jobRow) {
    console.error("[v0] failed to create import job row", jobErr)
    return NextResponse.json(
      { error: "Failed to record audit row", details: jobErr?.message },
      { status: 500 },
    )
  }
  const jobId = jobRow.id as string

  // ------------------------------------------------------------------ call upstream
  const payload: ImportRequest = {
    version: body.version ?? null,
    dryRun,
    entries: body.entries,
  }
  const result = await importSeries(body.clientId, returnId, seriesId, payload)

  // ------------------------------------------------------------------ persist audit
  if (!result.ok) {
    await sb
      .from("proconnect_import_jobs")
      .update({
        status: "failed",
        http_status: result.error.status ?? null,
        error_message:
          (typeof result.error.body === "string"
            ? result.error.body
            : JSON.stringify(result.error.body ?? result.error.kind)) +
          ` [${result.error.kind}]`,
        response_raw: { error: result.error },
        intuit_tid: result.intuitTid ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)

    return NextResponse.json(
      { jobId, error: result.error, intuitTid: result.intuitTid },
      { status: result.error.status || 500 },
    )
  }

  const seriesResult = result.data.results?.[0] ?? null
  await sb
    .from("proconnect_import_jobs")
    .update({
      status: result.data.summary.totalErrors > 0 ? "partial" : "succeeded",
      http_status: 200,
      imported_count: result.data.summary.totalImported,
      error_count: result.data.summary.totalErrors,
      response_version: seriesResult?.version ?? null,
      response_summary: result.data.summary,
      response_raw: result.data,
      intuit_tid: result.intuitTid ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)

  // Per-entry rejections — one row each. Lets the dashboard render a
  // cleanly searchable error table without unwrapping JSON in the UI.
  const errors = seriesResult?.errors ?? []
  if (errors.length > 0) {
    const rows = errors.map((e) => ({
      job_id: jobId,
      prefix_id: e.prefixId,
      code_id: e.codeId,
      suffix_id: e.suffixId,
      error_details: { code: e.errorCode, message: e.errorMessage },
    }))
    const { error: errInsErr } = await sb.from("proconnect_import_entry_results").insert(rows)
    if (errInsErr) console.error("[v0] failed to write entry-results rows", errInsErr)
  }

  // After a real (non-dry-run) write that changed at least one cell,
  // refresh the snapshot so the local view is consistent. We don't
  // block the response on this — a small staleness window is fine.
  if (!dryRun && result.data.summary.totalImported > 0) {
    refreshSnapshot(body.clientId, returnId).catch((err) =>
      console.error("[v0] post-import snapshot refresh failed", err),
    )
  }

  return NextResponse.json({ jobId, ...result.data, intuitTid: result.intuitTid })
}

// Background snapshot refresher — same shape as data/route.ts. Kept
// duplicated rather than imported because `data/route.ts` is a Route
// Handler and Next refuses cross-route imports of non-exported helpers.
async function refreshSnapshot(clientId: string, returnId: string) {
  const sb = admin()
  const result = await exportReturnData(clientId, returnId)
  if (!result.ok) return
  const exp = result.data
  const flatCells = flattenSeriesMap(exp.data)

  const { data: snap, error: snapErr } = await sb
    .from("proconnect_return_snapshots")
    .upsert(
      {
        return_id: returnId,
        proconnect_client_id: clientId,
        return_name: exp.name ?? null,
        client_name: exp.clientName ?? null,
        tax_year: exp.year ?? null,
        return_type: exp.type ?? null,
        version: exp.version ?? null,
        series_versions: exp.seriesVersion ?? [],
        efile_items: exp.efileItems ?? [],
        agencies: exp.agency ?? [],
        firm_id: exp.id_firm ?? null,
        proconnect_created_by: exp.createdBy ?? null,
        proconnect_created_time: exp.createdTime
          ? new Date(exp.createdTime).toISOString()
          : null,
        raw_data: exp.data ?? null,
        exported_at: new Date().toISOString(),
        deleted_at: null,
      },
      { onConflict: "proconnect_client_id,return_id" },
    )
    .select("id")
    .single()
  if (snapErr || !snap) return
  const snapshotId = snap.id as string

  await sb.from("proconnect_return_field_cells").delete().eq("return_id", returnId)
  if (flatCells.length === 0) return
  const rows = flatCells.map((c) => ({
    snapshot_id: snapshotId,
    return_id: returnId,
    series_id: c.seriesId,
    prefix_id: c.prefixId,
    code_id: c.codeId,
    suffix_id: c.suffixId,
    val: c.cell.val ?? null,
    description: c.cell.desc ?? null,
    src: c.cell.src ?? null,
    tsj: c.cell.tsj ?? null,
    scope: c.cell.scope ?? null,
    source: c.cell.source ?? null,
    city_abbrev: c.cell.cityAbbrev ?? null,
    import_source: c.cell.importSource ?? null,
    raw_cell: c.cell,
  }))
  for (let i = 0; i < rows.length; i += 1000) {
    await sb.from("proconnect_return_field_cells").insert(rows.slice(i, i + 1000))
  }
}
