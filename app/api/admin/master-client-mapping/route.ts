/**
 * GET /api/admin/master-client-mapping
 *
 * Reads the `public.master_client_mapping` view (one row per Motta
 * Hub uuid, with every external-system identifier we know about).
 * Supports search, system filter, link-count filter, sort, and
 * pagination. Also returns an aggregate `stats` block computed
 * across the full unfiltered dataset so the KPI strip stays stable
 * regardless of the current filter.
 *
 * Query params:
 *   q            — substring match against name / email / any external ID
 *   systems      — comma-separated subset of KARBON | IGNITION | PROCONNECT.
 *                  A row passes if it is linked to ALL listed systems.
 *   linkFilter   — 'all' (default) | 'linked' (>=1) | 'multi' (>=2) | 'unlinked' (=0)
 *   clientType   — 'all' | 'PERSON' | 'ORGANIZATION'
 *   sortBy       — display_name (default) | link_count | client_type | created_at | updated_at
 *   sortDir      — asc | desc
 *   page         — 1-indexed, default 1
 *   pageSize     — default 50, capped at 200
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const VALID_SYSTEMS = new Set(["KARBON", "IGNITION", "PROCONNECT"])
const VALID_SORTS = new Set([
  "display_name",
  "link_count",
  "client_type",
  "created_at",
  "updated_at",
])

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = (url.searchParams.get("q") || "").trim()
    const systems = (url.searchParams.get("systems") || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => VALID_SYSTEMS.has(s))
    const linkFilter = url.searchParams.get("linkFilter") || "all"
    const clientType = (url.searchParams.get("clientType") || "all").toUpperCase()
    const sortBy = VALID_SORTS.has(url.searchParams.get("sortBy") || "")
      ? (url.searchParams.get("sortBy") as string)
      : "display_name"
    const sortDir = url.searchParams.get("sortDir") === "desc" ? "desc" : "asc"
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
    const pageSize = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("pageSize")) || 50),
    )

    const supabase = createAdminClient()

    // Stats reflect the *unfiltered* universe so the KPI strip
    // remains a stable "what's in the hub" reading. The table below
    // narrates a filtered slice; the stats above narrate the whole.
    // With ~2k clients, fetching all rows once and aggregating in JS
    // is cheaper and simpler than a stored procedure — and keeps the
    // stats definition co-located with the rest of this route.
    const { data: all, error: allErr } = await supabase
      .from("master_client_mapping")
      .select("link_count, linked_systems, client_type")
      .limit(10000)
    if (allErr) throw allErr
    const rows = all || []
    const stats = {
      total_clients: rows.length,
      unlinked: rows.filter((r) => r.link_count === 0).length,
      one_system: rows.filter((r) => r.link_count === 1).length,
      two_systems: rows.filter((r) => r.link_count === 2).length,
      three_systems: rows.filter((r) => r.link_count === 3).length,
      has_karbon: rows.filter((r) =>
        (r.linked_systems as string[] | null)?.includes("KARBON"),
      ).length,
      has_ignition: rows.filter((r) =>
        (r.linked_systems as string[] | null)?.includes("IGNITION"),
      ).length,
      has_proconnect: rows.filter((r) =>
        (r.linked_systems as string[] | null)?.includes("PROCONNECT"),
      ).length,
      persons: rows.filter((r) => r.client_type === "PERSON").length,
      organizations: rows.filter((r) => r.client_type === "ORGANIZATION")
        .length,
    }

    // Build the filtered query. We deliberately use postgrest filters
    // here (not a stored procedure) so the filter logic is visible at
    // the API layer and changes don't require a DB migration.
    let query = supabase
      .from("master_client_mapping")
      .select(
        "internal_client_id,client_type,display_name,primary_email,karbon_client_id,ignition_client_id,proconnect_client_id,karbon_url,linked_systems,link_count,created_at,updated_at",
        { count: "exact" },
      )

    if (q) {
      // Substring search across the human-readable + every external
      // ID. Note: ilike on the *array* column linked_systems would
      // also be useful but postgrest doesn't support that pattern
      // cleanly, so we leave system filtering to the dedicated chip.
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`
      query = query.or(
        [
          `display_name.ilike.${like}`,
          `primary_email.ilike.${like}`,
          `karbon_client_id.ilike.${like}`,
          `ignition_client_id.ilike.${like}`,
          `proconnect_client_id.ilike.${like}`,
        ].join(","),
      )
    }

    if (clientType === "PERSON" || clientType === "ORGANIZATION") {
      query = query.eq("client_type", clientType)
    }

    if (linkFilter === "linked") query = query.gte("link_count", 1)
    else if (linkFilter === "multi") query = query.gte("link_count", 2)
    else if (linkFilter === "unlinked") query = query.eq("link_count", 0)

    if (systems.length > 0) {
      // contains() on an array does an "all of these are in the
      // array" check — exactly the AND semantic we want.
      query = query.contains("linked_systems", systems)
    }

    query = query.order(sortBy, { ascending: sortDir === "asc" })
    // Secondary sort on display_name keeps row order stable across
    // ties (e.g. when sorting by link_count).
    if (sortBy !== "display_name") {
      query = query.order("display_name", { ascending: true })
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      clients: data || [],
      page,
      pageSize,
      total: count ?? 0,
      stats,
    })
  } catch (err) {
    console.error("[master-client-mapping] error:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
