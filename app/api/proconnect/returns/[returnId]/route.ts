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
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
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

type CatalogEntry = { description: string | null; screenTitle: string | null }

/**
 * Field labels come from two live tables, never a bundled file — a
 * static CSV in the repo drifts from proconnect_field_catalog (67,810
 * rows, loaded from Intuit's full export) the moment either one is
 * updated independently.
 *
 * Priority order:
 *   1. form_1040_proconnect_map — hand-verified via the sentinel-diff
 *      procedure (see the in-repo-proconnect-1040-mapping skill). This is
 *      the ONLY source that covers M-series codes (s19M, s200M, ...),
 *      since Intuit's own catalog export has zero M-series rows.
 *   2. proconnect_field_catalog — Intuit's bulk export. Covers the vast
 *      majority of Federal codes but is missing some series/codes
 *      entirely (a data gap, not a lookup bug).
 * Cells matching neither show only the raw series/prefix/code/suffix
 * path — never a guessed or hallucinated label.
 */
type CatalogRow = { series_id: string | null; code_id: string | null; description: string | null; screen_title: string | null }
type MapRow = {
  series_id: string | null
  code_id: string | null
  confidence: string | null
  form_1040_lines: { label: string | null; short_label: string | null } | { label: string | null; short_label: string | null }[] | null
}

async function loadFieldMappings(sb: SupabaseClient, taxYear: number, returnType: string) {
  const mappings = new Map<string, CatalogEntry>()

  // proconnect_field_catalog holds 60k+ rows even filtered to one
  // tax_year/return_type — PostgREST silently caps a single response at
  // 1,000 rows, so this MUST page through fetchAllPaged or the vast
  // majority of the catalog is dropped without any error.
  const catalogRows = await fetchAllPaged<CatalogRow>(() =>
    sb
      .from("proconnect_field_catalog")
      .select("series_id, code_id, description, screen_title")
      .eq("tax_year", taxYear)
      .eq("return_type", returnType),
  )
  for (const row of catalogRows) {
    if (!row.series_id || !row.code_id) continue
    mappings.set(`${row.series_id.toLowerCase()}/${row.code_id.toLowerCase()}`, {
      description: row.description,
      screenTitle: row.screen_title,
    })
  }

  // Hand-verified overrides take precedence — applied after the bulk
  // catalog so they win on any series/code collision. Small table (under
  // 1,000 rows today) but paged defensively for the same reason.
  const confirmedRows = await fetchAllPaged<MapRow>(() =>
    sb
      .from("form_1040_proconnect_map")
      .select("series_id, code_id, confidence, form_1040_lines(label, short_label)")
      .eq("tax_year", taxYear)
      .eq("return_type", returnType)
      .not("series_id", "is", null)
      .not("code_id", "is", null)
      .in("confidence", ["confirmed", "inferred"]),
  )
  for (const row of confirmedRows) {
    if (!row.series_id || !row.code_id) continue
    const line = Array.isArray(row.form_1040_lines) ? row.form_1040_lines[0] : row.form_1040_lines
    const label = line?.label ?? line?.short_label
    if (!label) continue
    mappings.set(`${row.series_id.toLowerCase()}/${row.code_id.toLowerCase()}`, {
      description: label,
      screenTitle: null,
    })
  }

  return mappings
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

    const fieldMappings = snapshot?.tax_year
      ? await loadFieldMappings(sb, Number(snapshot.tax_year), (snapshot.return_type ?? "IND").toUpperCase())
      : new Map<string, CatalogEntry>()

    const enrichedCells = cells.map((c) => {
      let mapping: CatalogEntry | undefined
      if (c.series_id && c.code_id) {
        const series = c.series_id.toLowerCase()
        const code = c.code_id.toLowerCase()
        // Direct match first. Some series are recorded on the return as the
        // bare number (e.g. "s95") but cataloged by Intuit with a trailing
        // "00" (e.g. "s9500") — same screen, different series id convention.
        // Only fall back to the padded form when the direct lookup misses,
        // so it can never shadow a real direct match.
        mapping = fieldMappings.get(`${series}/${code}`) ?? fieldMappings.get(`${series}00/${code}`)
      }
      return {
        ...c,
        // Field labels come from proconnect_field_catalog / form_1040_proconnect_map
        // (see loadFieldMappings); prefix and suffix identify the specific instance.
        field_title: mapping?.description || mapping?.screenTitle || null,
      }
    })

    const bySeries: Record<string, typeof enrichedCells> = {}
    for (const c of enrichedCells) {
      ;(bySeries[c.series_id] ??= []).push(c)
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
