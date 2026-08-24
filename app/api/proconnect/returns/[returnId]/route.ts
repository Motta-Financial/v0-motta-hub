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
import { isWriteAllowed } from "@/lib/proconnect/write-allowlist"

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

/**
 * Per-cell write verdict for the raw-cell browser.
 *
 * The 1040 viewer gates edits on form_1040_proconnect_map.editable
 * (scripts/387), but that only covers the ~50 cells mapped to a 1040 line.
 * This page lists EVERY cell on the return, so it needs its own verdict —
 * and it is the surface where the concern was actually raised: could
 * editing here overwrite something ProConnect computed?
 *
 * Two signals, both precise. Deliberately NOT a third:
 *
 *   1. `isCalculated` in the cell's own importSource. This is Intuit's own
 *      marker that the value was derived rather than typed — W-2 social
 *      security / Medicare wages and tax (computed from box 1), names
 *      auto-filled from the client record. Writing one is meaningless: it
 *      is recomputed. 291 of 13,879 IND cells today.
 *   2. A mapped cell whose mapping says editable = false. The data rule
 *      already decided; this page must not disagree with the 1040 viewer.
 *      11 cells today.
 *
 * NOT used: "absent from proconnect_field_catalog". It is the right gate
 * for the mapping derivation, which authorizes AUTOMATED writes to a 1040
 * line, but far too blunt here — it would block 1,464 cells including 556
 * legitimate Client Information fields, breaking the manual-entry workflow
 * this page exists to serve.
 *
 * Advisory only, exactly like `lock` above: the import route re-derives its
 * own refusal. Never treat `editable: true` from this page as permission.
 */
function cellWriteVerdict(
  cell: { series_id: string; prefix_id: string | null; code_id: string | null; suffix_id: string | null; import_source: string[] | null },
  nonEditableCells: Set<string>,
): { editable: boolean; reason: string | null } {
  if ((cell.import_source ?? []).includes("isCalculated")) {
    return {
      editable: false,
      reason:
        "ProConnect calculated this value from other entries — a write here is recomputed away. Edit the underlying entry instead.",
    }
  }
  const key = `${cell.series_id}/${cell.prefix_id ?? ""}/${cell.code_id ?? ""}/${cell.suffix_id ?? ""}`
  const mapped = nonEditableCells.has(key)
  if (mapped) {
    return {
      editable: false,
      reason:
        "This cell backs a 1040 line that is not a writable raw input (form_1040_proconnect_map.editable = false).",
    }
  }
  return { editable: true, reason: null }
}

/** Cell keys mapped to a 1040 line whose mapping is NOT editable. */
async function loadNonEditableCells(sb: SupabaseClient, taxYear: number, returnType: string) {
  const rows = await fetchAllPaged<{
    series_id: string | null
    prefix_id: string | null
    code_id: string | null
    suffix_id: string | null
  }>(() =>
    sb
      .from("form_1040_proconnect_map")
      .select("series_id, prefix_id, code_id, suffix_id")
      .eq("tax_year", taxYear)
      .eq("return_type", returnType)
      .eq("editable", false)
      .not("series_id", "is", null)
      .not("code_id", "is", null),
  )
  const set = new Set<string>()
  for (const r of rows) {
    // '*' is the aggregate prefix — it matches no literal cell, and an
    // aggregate is non-editable for every instance, so expand it to a
    // wildcard the verdict can't express. Skip: the individual W-2 cell a
    // preparer edits is genuinely editable; only the 1040 TOTAL is not.
    if (r.prefix_id === "*") continue
    set.add(`${r.series_id}/${r.prefix_id ?? ""}/${r.code_id}/${r.suffix_id ?? ""}`)
  }
  return set
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

    // Import write allowlist, for the editor's disabled state ahead of a
  // commit. Advisory only, exactly like `lock` below — the import route
  // re-derives its own verdict from the same isWriteAllowed function, and
  // that re-derivation is the actual enforcement point. This flag exists so
  // the sheet can disable Apply before a preparer spends a round-trip
  // learning the return isn't on the list; it can go stale between page
  // load and Apply if the env var changes, so the 403 the import route
  // returns in that case remains the backstop, not a bug to fix here.
  const writeAllowed = isWriteAllowed(returnId)

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
      import_source: string[] | null
    }
    const cells = await fetchAllPaged<CellRow>(() =>
      sb
        .from("proconnect_return_field_cells")
        .select("series_id, prefix_id, code_id, suffix_id, val, description, src, tsj, scope, import_source")
        .eq("return_id", returnId)
        .order("series_id")
        .order("prefix_id")
        .order("code_id"),
    )

    const fieldMappings = snapshot?.tax_year
      ? await loadFieldMappings(sb, Number(snapshot.tax_year), (snapshot.return_type ?? "IND").toUpperCase())
      : new Map<string, CatalogEntry>()

    const nonEditableCells = snapshot?.tax_year
      ? await loadNonEditableCells(sb, Number(snapshot.tax_year), (snapshot.return_type ?? "IND").toUpperCase())
      : new Set<string>()

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
      const verdict = cellWriteVerdict(c, nonEditableCells)
      return {
        ...c,
        // Field labels come from proconnect_field_catalog / form_1040_proconnect_map
        // (see loadFieldMappings); prefix and suffix identify the specific instance.
        field_title: mapping?.description || mapping?.screenTitle || null,
        // Advisory write verdict — see cellWriteVerdict.
        editable: verdict.editable,
        not_editable_reason: verdict.reason,
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
  writeAllowed,
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
