/**
 * GET /api/proconnect/returns/[returnId]
 *
 * Base return-detail endpoint — serves the `proconnect_returns_with_data`
 * view (snapshot joined to the enriched engagement) plus the flattened
 * field cells grouped by series. This is the route the view was created
 * for in scripts/130 but which never existed (only the data/ and import/
 * subroutes did). Powers the return-data viewer at /tax/returns/[returnId].
 *
 * Session-gated by middleware (read-only; the write path is the
 * leadership-gated import subroute).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { fetchAllPaged } from "@/lib/supabase/fetch-all"
import { lockFromCachedEfile } from "@/lib/proconnect/efile-lock"

export const dynamic = "force-dynamic"

const SUPABASE_URL = (process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL)!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ returnId: string }> },
) {
  try {
    const { returnId } = await ctx.params
    const sb = admin()

    // Engagement context from the enriched view — present for every
    // synced engagement even before the first export (the
    // proconnect_returns_with_data view is snapshot-rooted, so it only
    // has rows once an export has landed).
    const { data: detail, error: detailErr } = await sb
      .from("proconnect_engagements_enriched")
      .select("*")
      .eq("engagement_id", returnId)
      .maybeSingle()
    if (detailErr) {
      return NextResponse.json({ error: detailErr.message }, { status: 500 })
    }

    // Post-e-file edit lock, for the viewer's badge and disabled state.
    //
    // ADVISORY ONLY. This is derived from the cached filings so a page view
    // costs no ProConnect call; the authoritative check runs live inside the
    // import route, which is the actual write boundary. A stale or blanked
    // cache here can only mislabel a badge, never let a write through.
    //
    // Reads proconnect_engagements rather than the enriched view because
    // efile_filings is deliberately kept out of that view (it would drag a
    // jsonb blob into every dashboard query) — and the full filings array is
    // exactly what the predicate needs: the headline efile_status cannot
    // tell an accepted 4868 from an accepted return.
    const { data: efileRow } = await sb
      .from("proconnect_engagements")
      .select("efile_filings, efile_synced_at")
      .eq("engagement_id", returnId)
      .maybeSingle()
    const lock = lockFromCachedEfile(efileRow ?? {})

    // Snapshot row (authoritative export metadata, incl. tombstone).
    const { data: snapshot } = await sb
      .from("proconnect_return_snapshots")
      .select(
        "id, proconnect_client_id, return_name, client_name, tax_year, return_type, version, series_versions, efile_items, agencies, exported_at, deleted_at",
      )
      .eq("return_id", returnId)
      .maybeSingle()

    if (!detail && !snapshot) {
      return NextResponse.json({ error: "Return not found" }, { status: 404 })
    }

    // Flat cells, grouped by series for the viewer. Returns hold up to
    // ~5k cells while PostgREST caps each response at 1,000 rows, so
    // page the fetch until a short page comes back.
    type CellRow = {
      series_id: string
      prefix_id: string | null
      code_id: string | null
      suffix_id: string | null
      val: string | null
      description: string | null
      src: string | null
      tsj: string | null
      scope: string | null
    }
    const cells = await fetchAllPaged<CellRow>(() =>
      sb
        .from("proconnect_return_field_cells")
        .select("series_id, prefix_id, code_id, suffix_id, val, description, src, tsj, scope")
        .eq("return_id", returnId)
        .order("series_id")
        .order("prefix_id")
        .order("code_id"),
    )

    const bySeries: Record<string, typeof cells> = {}
    for (const c of cells) {
      ;(bySeries[c.series_id] ??= [] as NonNullable<typeof cells>).push(c)
    }

    return NextResponse.json({
      returnId,
      engagement: detail ?? null,
      lock,
      snapshot: snapshot ?? null,
      cellCount: cells.length,
      seriesCount: Object.keys(bySeries).length,
      cellsBySeries: bySeries,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
