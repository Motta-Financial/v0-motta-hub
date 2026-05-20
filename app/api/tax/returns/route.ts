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

    // Build the query on proconnect_engagements
    // Note: We don't filter by form_type in the DB query because the column
    // may not be populated. We extract form type from raw_json.type and filter
    // in JavaScript after transformation.
    let query = supabase
      .from("proconnect_engagements")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit * 2) // Fetch more to account for post-filter

    // Filter by tax year if provided
    if (taxYear) {
      query = query.eq("tax_year", Number(taxYear))
    }

    const { data: engagements, error: engError } = await query

    if (engError) {
      throw engError
    }

    // Get client names from proconnect_clients
    const { data: clients, error: clientError } = await supabase
      .from("proconnect_clients")
      .select("proconnect_client_id, display_name, business_name, first_name, last_name")

    if (clientError) {
      throw clientError
    }

    // Build client name lookup
    const clientNames = new Map<string, string>()
    for (const c of clients || []) {
      const name =
        c.display_name ||
        c.business_name ||
        [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        "Unknown"
      if (c.proconnect_client_id) {
        clientNames.set(c.proconnect_client_id, name)
      }
    }

    // Transform to unified format - extract form type from raw_json.type
    // since the form_type column may not be populated yet
    const unified: UnifiedReturn[] = (engagements || []).map((eng) => {
      const rawJson = eng.raw_json as Record<string, unknown> | null
      const assignee = rawJson?.assignee as Record<string, unknown> | null
      const modifiedBy = rawJson?.modifiedBy as Record<string, unknown> | null

      // Extract form type from raw_json.type (e.g., "1040", "1065", "1120S")
      // Fall back to form_type column, then return_type mapping
      const formFromJson = (rawJson?.type as string) || null
      const formType =
        formFromJson ||
        eng.form_type ||
        RETURN_TYPE_TO_FORM[eng.return_type || ""] ||
        eng.return_type ||
        "Unknown"

      // Try to extract preparer name from raw_json
      const preparerName =
        (rawJson?.name as string) ||
        (assignee?.profileId as string) ||
        (modifiedBy?.profileId as string) ||
        null

      return {
        id: eng.id,
        engagement_id: eng.engagement_id,
        proconnect_client_id: eng.proconnect_client_id,
        client_name: eng.proconnect_client_id
          ? clientNames.get(eng.proconnect_client_id) || null
          : null,
        tax_year: eng.tax_year,
        form: formType,
        return_type: eng.return_type,
        status: eng.status,
        efile_status: eng.efile_status,
        work_status: eng.work_status,
        preparer: preparerName,
        synced_at: eng.synced_at,
        updated_at: eng.updated_at,
        raw: rawJson || {},
      }
    })

    // Filter by form type in JavaScript (since form_type column may be null)
    let filteredUnified = unified
    if (form !== "all") {
      let formTypes: string[] = []

      if (form === "business") {
        formTypes = ["1065", "1120", "1120S"]
      } else if (form === "individual") {
        formTypes = ["1040"]
      } else if (form === "nonprofit") {
        formTypes = ["990"]
      } else {
        formTypes = [form]
      }

      filteredUnified = unified.filter((r) => formTypes.includes(r.form))
    }

    // Apply limit after filtering
    filteredUnified = filteredUnified.slice(0, limit)

    // Build stats from filtered data
    const stats = {
      totalReturns: filteredUnified.length,
      byForm: {} as Record<string, { count: number }>,
      byYear: {} as Record<string, number>,
      byEfileStatus: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      byPreparer: {} as Record<string, number>,
    }

    for (const r of filteredUnified) {
      // By form
      const fb = stats.byForm[r.form] ?? (stats.byForm[r.form] = { count: 0 })
      fb.count += 1

      // By year
      const yKey = r.tax_year ? String(r.tax_year) : "(unknown)"
      stats.byYear[yKey] = (stats.byYear[yKey] || 0) + 1

      // By efile status
      const eKey = r.efile_status ?? "(not filed)"
      stats.byEfileStatus[eKey] = (stats.byEfileStatus[eKey] || 0) + 1

      // By status
      const sKey = r.status ?? "(unknown)"
      stats.byStatus[sKey] = (stats.byStatus[sKey] || 0) + 1

      // By preparer
      const pKey = r.preparer || "(unassigned)"
      stats.byPreparer[pKey] = (stats.byPreparer[pKey] || 0) + 1
    }

    // Determine which forms were queried
    let formsQueried: string[]
    if (form === "all") {
      formsQueried = ["1040", "1065", "1120", "1120S", "990"]
    } else if (form === "business") {
      formsQueried = ["1065", "1120", "1120S"]
    } else if (form === "individual") {
      formsQueried = ["1040"]
    } else if (form === "nonprofit") {
      formsQueried = ["990"]
    } else {
      formsQueried = [form]
    }

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
