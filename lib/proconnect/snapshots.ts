/**
 * Shared persistence for Phase 1 return-data snapshots.
 *
 * One exported return → one row in proconnect_return_snapshots plus a
 * full replace of its flattened leaf cells in
 * proconnect_return_field_cells. This logic previously existed as three
 * separate copies (webhook receiver, returns/[id]/data route, and the
 * import route's post-write refresh) which had already drifted; this is
 * now the single implementation all three use.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { flattenSeriesMap, type ReturnExport } from "./data"

const CELL_INSERT_CHUNK = 1000

/**
 * Upsert the snapshot row and replace its flat cells. Throws on DB
 * errors — callers decide whether that fails their request (data route)
 * or soft-fails (webhook / background refresh).
 */
export async function persistReturnSnapshot(
  sb: SupabaseClient,
  clientId: string,
  returnId: string,
  exp: ReturnExport
): Promise<{ snapshotId: string; cellCount: number }> {
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
      { onConflict: "proconnect_client_id,return_id" }
    )
    .select("id")
    .single()
  if (snapErr || !snap) {
    throw new Error(`snapshot upsert failed: ${snapErr?.message ?? "no row returned"}`)
  }
  const snapshotId = snap.id as string

  const { error: delErr } = await sb
    .from("proconnect_return_field_cells")
    .delete()
    .eq("return_id", returnId)
  if (delErr) throw new Error(`field-cell delete failed: ${delErr.message}`)

  if (flatCells.length > 0) {
    const rows = flatCells.map((c) => ({
      snapshot_id: snapshotId,
      return_id: returnId,
      series_id: c.seriesId,
      prefix_id: c.prefixId,
      code_id: c.codeId,
      suffix_id: c.suffixId,
      val: c.cell.val ?? null,
      description: c.cell.desc ?? null, // `desc` is a SQL reserved word
      src: c.cell.src ?? null,
      tsj: c.cell.tsj ?? null,
      scope: c.cell.scope ?? null,
      source: c.cell.source ?? null,
      city_abbrev: c.cell.cityAbbrev ?? null,
      import_source: c.cell.importSource ?? null,
      raw_cell: c.cell,
    }))
    for (let i = 0; i < rows.length; i += CELL_INSERT_CHUNK) {
      const { error: insErr } = await sb
        .from("proconnect_return_field_cells")
        .insert(rows.slice(i, i + CELL_INSERT_CHUNK))
      if (insErr) throw new Error(`field-cell insert failed: ${insErr.message}`)
    }
  }

  return { snapshotId, cellCount: flatCells.length }
}
