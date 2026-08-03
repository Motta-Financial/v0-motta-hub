import { createClient } from "@/lib/supabase/server"
import { fetchAllPaged } from "@/lib/supabase/fetch-all"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get("status")
    const search = searchParams.get("search")
    const limit = Number.parseInt(searchParams.get("limit") || "100")
    const offset = Number.parseInt(searchParams.get("offset") || "0")

    // Only the columns the payments dashboard actually renders — the row
    // also carries a `raw_payload` jsonb mirror of `payload` (multi-KB per
    // row) that nothing here reads, so select("*") doubled the response.
    let query = supabase
      .from("ignition_proposals")
      .select("proposal_id, title, status, client_name, amount, currency, created_at, payload")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && status !== "all") {
      query = query.eq("status", status)
    }

    if (search) {
      query = query.or(`client_name.ilike.%${search}%,title.ilike.%${search}%,proposal_id.ilike.%${search}%`)
    }

    const { data, error } = await query

    if (error) throw error

    // Get stats — page through every row (PostgREST caps a single response
    // at 1,000 rows and the table is nearly there), selecting only the two
    // columns the aggregation reads. Best-effort: a stats failure degrades
    // to zeros instead of failing the proposal list, matching the old
    // error-ignoring destructure.
    let statsData: Array<{ status: string | null; amount: number | null }> = []
    try {
      statsData = await fetchAllPaged<{ status: string | null; amount: number | null }>(() =>
        supabase.from("ignition_proposals").select("status, amount"),
      )
    } catch (statsError) {
      console.error("Error fetching proposal stats:", statsError)
    }

    // Status values are the lowercase Ignition Reporting-API states the
    // sync stores (lib/ignition/sync.ts writes `state` verbatim) — the old
    // capitalized labels ("Accepted", "Awaiting acceptance") matched zero
    // synced rows.
    const stats = {
      total: statsData.length,
      accepted: statsData.filter((p) => p.status === "accepted").length,
      pending: statsData.filter((p) => p.status === "awaiting_acceptance").length,
      draft: statsData.filter((p) => p.status === "draft").length,
      lost: statsData.filter((p) => p.status === "lost").length,
      totalValue: statsData.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      acceptedValue: statsData
        .filter((p) => p.status === "accepted")
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      pendingValue: statsData
        .filter((p) => p.status === "awaiting_acceptance")
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    }

    return NextResponse.json({ proposals: data, stats })
  } catch (error) {
    console.error("Error fetching proposals:", error)
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 })
  }
}
