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

    // Flat cells, grouped by series for the viewer. Typical IND returns
    // are well under 5k cells so a single fetch is fine.
    const { data: cells } = await sb
      .from("proconnect_return_field_cells")
      .select("series_id, prefix_id, code_id, suffix_id, val, description, src, tsj, scope")
      .eq("return_id", returnId)
      .order("series_id")
      .order("prefix_id")
      .order("code_id")

    const bySeries: Record<string, typeof cells> = {}
    for (const c of cells ?? []) {
      ;(bySeries[c.series_id] ??= [] as NonNullable<typeof cells>).push(c)
    }

    return NextResponse.json({
      returnId,
      engagement: detail ?? null,
      snapshot: snapshot ?? null,
      cellCount: cells?.length ?? 0,
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
