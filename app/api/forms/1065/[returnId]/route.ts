/**
 * GET /api/forms/1065/[returnId]
 *
 * A partnership return's exported ProConnect cells laid out as Form 1065
 * sections (lib/forms/form-1065.ts), labelled from the PAR field catalog for
 * the return's own tax year. Read-only and session-gated by middleware, like
 * the 1040 route.
 *
 * Taxpayer identifiers (the partnership's EIN, each partner's SSN/EIN) are
 * masked here, before the response leaves the server.
 */

import { getServiceKey } from "@/lib/supabase/service-key"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { fetchAllPaged } from "@/lib/supabase/fetch-all"
import { buildForm1065View, type CatalogLabels, type Form1065Cell } from "@/lib/forms/form-1065"

export const dynamic = "force-dynamic"

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!

function admin() {
  return createClient(SUPABASE_URL, getServiceKey()!, { auth: { persistSession: false } })
}

/** Series the view reads values from. Others are only counted. */
const VALUE_SERIES = ["s1", "s2", "s700", "s200", "s400", "s5700", "s1500", "s6100"]

/** Identifier fields, masked whatever the catalog says. */
const ID_CODES = new Set(["s1/c1000100009", "s2/c1000200009"])

function mask(v: string | null): string | null {
  if (v == null) return null
  const digits = v.replace(/\D/g, "")
  return digits.length >= 4 ? `•••••${digits.slice(-4)}` : "•••••"
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    const { returnId } = await ctx.params
    const sb = admin()

    const { data: snapshot, error: snapErr } = await sb
      .from("proconnect_return_snapshots")
      .select("id, return_name, client_name, tax_year, return_type, exported_at, deleted_at")
      .eq("return_id", returnId)
      .maybeSingle()
    if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })
    if (!snapshot) {
      return NextResponse.json(
        { error: "Return not found. Export it from ProConnect first." },
        { status: 404 },
      )
    }
    if ((snapshot.return_type ?? "").toUpperCase() !== "PAR") {
      return NextResponse.json(
        { error: `This is a ${snapshot.return_type} return, not a 1065.`, returnType: snapshot.return_type },
        { status: 400 },
      )
    }
    const taxYear = Number(snapshot.tax_year)

    const cells = await fetchAllPaged<Form1065Cell>(() =>
      sb
        .from("proconnect_return_field_cells")
        .select("series_id, prefix_id, code_id, suffix_id, val, description")
        .eq("return_id", returnId)
        .order("series_id")
        .order("prefix_id")
        .order("code_id"),
    )

    // Catalog labels for the series the view lays out, plus screen titles for
    // every series on the return (for the "not laid out yet" list).
    type CatRow = { series_id: string; code_id: string; description: string; screen_title: string | null; is_sensitive: boolean }
    const presentSeries = [...new Set(cells.map((c) => c.series_id))]
    const catRows = await fetchAllPaged<CatRow>(() =>
      sb
        .from("proconnect_field_catalog")
        .select("series_id, code_id, description, screen_title, is_sensitive")
        .eq("tax_year", taxYear)
        .eq("return_type", "PAR")
        .eq("agency", "Federal")
        .in("series_id", [...new Set([...VALUE_SERIES, ...presentSeries])]),
    )
    const labels: CatalogLabels = new Map()
    const titleCounts = new Map<string, Map<string, number>>()
    for (const r of catRows) {
      labels.set(`${r.series_id}/${r.code_id}`, { description: r.description, screenTitle: r.screen_title, isSensitive: r.is_sensitive })
      if (r.screen_title) {
        const m = titleCounts.get(r.series_id) ?? new Map<string, number>()
        m.set(r.screen_title, (m.get(r.screen_title) ?? 0) + 1)
        titleCounts.set(r.series_id, m)
      }
    }
    const seriesTitles = new Map(
      [...titleCounts].map(([s, m]) => [s, [...m].sort((a, b) => b[1] - a[1])[0][0]] as const),
    )

    const { data: stampRow } = await sb
      .from("proconnect_field_catalog")
      .select("rules")
      .eq("tax_year", taxYear)
      .eq("return_type", "PAR")
      .limit(1)
      .maybeSingle()
    const assumedFromTaxYear =
      (stampRow?.rules as { assumedFromTaxYear?: number } | null)?.assumedFromTaxYear ?? null

    const safeCells = cells.map((c) => {
      const key = `${c.series_id}/${c.code_id}`
      if (!ID_CODES.has(key) && !labels.get(key)?.isSensitive) return c
      return { ...c, val: mask(c.val), description: mask(c.description) }
    })

    const view = buildForm1065View(safeCells, labels, seriesTitles)

    return NextResponse.json({
      returnId,
      returnName: snapshot.return_name,
      clientName: snapshot.client_name,
      taxYear,
      exportedAt: snapshot.exported_at,
      deletedAt: snapshot.deleted_at,
      catalog: { loaded: catRows.length > 0, assumedFromTaxYear },
      view,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 })
  }
}
