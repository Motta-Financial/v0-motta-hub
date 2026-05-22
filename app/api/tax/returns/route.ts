import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── Return type mapping ───────────────────────────────────────────────
// ProConnect uses codes like IND, COR, PAR, etc. We map them to form
// numbers for display.
const RETURN_TYPE_TO_FORM: Record<string, string> = {
  IND: "1040",
  COR: "1120",
  PAR: "1065",
  SCO: "1120S",
  FID: "1041",
  EXM: "990",
}

// Unified row shape for the Returns pages
type UnifiedReturn = {
  id: string
  engagement_id: string | null
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
  form: string
  return_type: string | null
  status: string | null
  efile_status: string | null
  work_status: string | null
  preparer: string | null
  preparer_profile_id: string | null
  user_defined_status_name: string | null
  user_defined_status_color: string | null
  proconnect_modified_at: string | null
  synced_at: string | null
  updated_at: string | null
  raw: Record<string, unknown>
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const form = url.searchParams.get("form") || "all"
    const taxYear = url.searchParams.get("taxYear")
    const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000)

    const supabase = createAdminClient()

    // Pull from the enriched view — it already joins client display_name,
    // proconnect_profiles + team_members (preparer_name), and the
    // custom-status name/color. One query, zero secondary lookups.
    let query = supabase
      .from("proconnect_engagements_enriched")
      .select("*")
      .order("proconnect_modified_at", { ascending: false, nullsFirst: false })
      .limit(limit * 2)

    if (taxYear) {
      query = query.eq("tax_year", Number(taxYear))
    }

    const { data: engagements, error: engError } = await query
    if (engError) throw engError

    // Transform to unified shape. The view already gives us
    // client_display_name + preparer_name, so no second lookup needed.
    // The view does not include `id` or `raw_json` (kept on the base
    // table for forensics) — engagement_id is the canonical identifier
    // for downstream UI links.
    const unified: UnifiedReturn[] = (engagements || []).map((eng) => {
      const formType =
        eng.form_type ||
        RETURN_TYPE_TO_FORM[eng.return_type || ""] ||
        eng.return_type ||
        "Unknown"

      return {
        id: eng.engagement_id,
        engagement_id: eng.engagement_id,
        proconnect_client_id: eng.proconnect_client_id,
        client_name: eng.client_display_name || null,
        tax_year: eng.tax_year,
        form: formType,
        return_type: eng.return_type,
        status: eng.status,
        efile_status: eng.efile_status,
        work_status: eng.work_status,
        preparer: eng.preparer_name || null,
        preparer_profile_id: eng.assignee_profile_id,
        user_defined_status_name: eng.user_defined_status_name,
        user_defined_status_color: eng.user_defined_status_color,
        proconnect_modified_at: eng.proconnect_modified_at,
        synced_at: eng.synced_at,
        updated_at: eng.updated_at,
        raw: {},
      }
    })

    // Form filter (kept in JS because the source `type` is in raw_json
    // for legacy rows — the form_type column isn't always populated).
    let filteredUnified = unified
    if (form !== "all") {
      let formTypes: string[] = []
      if (form === "business") formTypes = ["1065", "1120", "1120S"]
      else if (form === "individual") formTypes = ["1040"]
      else if (form === "nonprofit") formTypes = ["990"]
      else formTypes = [form]
      filteredUnified = unified.filter((r) => formTypes.includes(r.form))
    }

    filteredUnified = filteredUnified.slice(0, limit)

    const stats = {
      totalReturns: filteredUnified.length,
      byForm: {} as Record<string, { count: number }>,
      byYear: {} as Record<string, number>,
      byEfileStatus: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      byPreparer: {} as Record<string, number>,
    }

    for (const r of filteredUnified) {
      const fb = stats.byForm[r.form] ?? (stats.byForm[r.form] = { count: 0 })
      fb.count += 1
      const yKey = r.tax_year ? String(r.tax_year) : "(unknown)"
      stats.byYear[yKey] = (stats.byYear[yKey] || 0) + 1
      const eKey = r.efile_status ?? "(not filed)"
      stats.byEfileStatus[eKey] = (stats.byEfileStatus[eKey] || 0) + 1
      const sKey = r.user_defined_status_name ?? r.status ?? "(unknown)"
      stats.byStatus[sKey] = (stats.byStatus[sKey] || 0) + 1
      const pKey = r.preparer || "(unassigned)"
      stats.byPreparer[pKey] = (stats.byPreparer[pKey] || 0) + 1
    }

    let formsQueried: string[]
    if (form === "all") formsQueried = ["1040", "1065", "1120", "1120S", "990"]
    else if (form === "business") formsQueried = ["1065", "1120", "1120S"]
    else if (form === "individual") formsQueried = ["1040"]
    else if (form === "nonprofit") formsQueried = ["990"]
    else formsQueried = [form]

    return NextResponse.json({
      returns: filteredUnified,
      stats,
      forms: formsQueried,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] Tax returns API error:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
