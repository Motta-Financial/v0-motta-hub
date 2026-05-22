/**
 * Export a tax-return's full series map and persist a snapshot.
 *
 * GET  /api/proconnect/returns/[returnId]/data?clientId=...&persist=true
 * POST /api/proconnect/returns/[returnId]/data    (force a fresh fetch)
 *
 * Phase 1 endpoint:
 *   GET https://api.intuit.com/v2/clients/{clientId}/returns/{returnId}/data
 *
 * Persistence model (see scripts/130_proconnect_return_data.sql):
 *   - proconnect_return_snapshots stores one row per (client, return)
 *     and is updated in-place on each fetch. We track `version` and
 *     `series_versions` for OCC.
 *   - proconnect_return_field_cells stores the flattened leaf cells —
 *     one row per (return, series, prefix, code, suffix). We replace
 *     the entire set on each successful export to avoid stale rows.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { exportReturnData, flattenSeriesMap } from "@/lib/proconnect/data"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

async function loadAndPersist(clientId: string, returnId: string) {
  const result = await exportReturnData(clientId, returnId)
  if (!result.ok) return result

  const sb = admin()
  const exp = result.data
  const flatCells = flattenSeriesMap(exp.data)

  // 1. Upsert the snapshot row. Column names match scripts/130 — we
  //    persist `raw_data` (the full nested response) for forensics, but
  //    every queryable field is hoisted into proconnect_return_field_cells.
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
  if (snapErr) throw snapErr
  const snapshotId = snap.id as string

  // 2. Replace flat cells. We delete-then-insert so partial replacements
  //    never leave the table in a half-state. Typical IND return runs
  //    well under 5k cells; we chunk inserts at 1000 rows.
  const { error: delErr } = await sb
    .from("proconnect_return_field_cells")
    .delete()
    .eq("return_id", returnId)
  if (delErr) throw delErr

  if (flatCells.length > 0) {
    const rows = flatCells.map((c) => ({
      snapshot_id: snapshotId,
      return_id: returnId,
      series_id: c.seriesId,
      prefix_id: c.prefixId,
      code_id: c.codeId,
      suffix_id: c.suffixId,
      val: c.cell.val ?? null,
      description: c.cell.desc ?? null,   // `desc` is a SQL reserved word
      src: c.cell.src ?? null,
      tsj: c.cell.tsj ?? null,
      scope: c.cell.scope ?? null,
      source: c.cell.source ?? null,
      city_abbrev: c.cell.cityAbbrev ?? null,
      import_source: c.cell.importSource ?? null,
      raw_cell: c.cell,
    }))
    for (let i = 0; i < rows.length; i += 1000) {
      const { error: insErr } = await sb
        .from("proconnect_return_field_cells")
        .insert(rows.slice(i, i + 1000))
      if (insErr) throw insErr
    }
  }

  return result
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    const { returnId } = await ctx.params
    const url = new URL(req.url)
    const clientId = url.searchParams.get("clientId")
    if (!clientId) {
      return NextResponse.json({ error: "clientId query param is required" }, { status: 400 })
    }

    // Fast path: return a cached snapshot if one exists and is fresh.
    // Caller can override with ?fresh=true.
    const fresh = url.searchParams.get("fresh") === "true"
    if (!fresh) {
      const sb = admin()
      const { data: cached } = await sb
        .from("proconnect_return_snapshots")
        .select("*")
        .eq("return_id", returnId)
        .maybeSingle()
      if (cached) {
        // Stale-while-revalidate: return cached, kick off a background
        // refresh if older than 5 minutes. We don't await it.
        const age = Date.now() - new Date(cached.exported_at).getTime()
        if (age > 5 * 60_000) {
          loadAndPersist(clientId, returnId).catch((err) =>
            console.error("[v0] background return-data refresh failed", err),
          )
        }
        return NextResponse.json({ source: "cache", snapshot: cached })
      }
    }

    const result = await loadAndPersist(clientId, returnId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, intuitTid: result.intuitTid },
        { status: result.error.status || 500 },
      )
    }
    return NextResponse.json({ source: "live", data: result.data, intuitTid: result.intuitTid })
  } catch (err) {
    console.error("[v0] GET /returns/[returnId]/data failed", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/** POST forces a fresh fetch + persistence. Same body as GET?fresh=true. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    const { returnId } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as { clientId?: string }
    const clientId = body.clientId
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required in body" }, { status: 400 })
    }
    const result = await loadAndPersist(clientId, returnId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, intuitTid: result.intuitTid },
        { status: result.error.status || 500 },
      )
    }
    return NextResponse.json({ source: "live", data: result.data, intuitTid: result.intuitTid })
  } catch (err) {
    console.error("[v0] POST /returns/[returnId]/data failed", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
