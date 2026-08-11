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
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fetchAllPaged } from "@/lib/supabase/fetch-all"

export const dynamic = "force-dynamic"

const SUPABASE_URL = (process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL)!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let value = ""
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"'
        i += 1
      } else quoted = !quoted
    } else if (char === "," && !quoted) {
      values.push(value)
      value = ""
    } else value += char
  }
  values.push(value)
  return values
}

async function loadFieldMappings() {
  const csv = await readFile(
    path.join(process.cwd(), "data/ind-2025-all-series-code-mappings.csv"),
    "utf8",
  )
  const lines = csv.split(/\\r?\\n/).filter(Boolean)
  const headers = parseCsvLine(lines[0] ?? "")
  const mappings = new Map<string, { description: string; screenTitle: string }>()
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line)
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
    if (row.series && row.code) {
      mappings.set(`${row.series.toLowerCase()}/${row.code.toLowerCase()}`, {
        description: row.description,
        screenTitle: row.screenTitle,
      })
    }
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

    const fieldMappings =
      Number(snapshot?.tax_year) === 2025 && (snapshot?.return_type ?? "IND").toUpperCase() === "IND"
        ? await loadFieldMappings()
        : new Map<string, { description: string; screenTitle: string }>()

    const enrichedCells = cells.map((c) => {
      const mapping = c.series_id && c.code_id
        ? fieldMappings.get(`${c.series_id.toLowerCase()}/${c.code_id.toLowerCase()}`)
        : undefined
      return {
        ...c,
        // The supplied Intuit CSV describes fields by series/code; prefix and suffix identify instances.
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
