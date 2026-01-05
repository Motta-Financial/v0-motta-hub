import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get("status")
    const search = searchParams.get("search")
    const limit = Number.parseInt(searchParams.get("limit") || "100")
    const offset = Number.parseInt(searchParams.get("offset") || "0")

    let query = supabase
      .from("ignition_proposals")
      .select("*")
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

    // Get stats
    const { data: statsData } = await supabase.from("ignition_proposals").select("status, amount")

    const stats = {
      total: statsData?.length || 0,
      accepted: statsData?.filter((p) => p.status === "Accepted").length || 0,
      pending: statsData?.filter((p) => p.status === "Awaiting acceptance").length || 0,
      draft: statsData?.filter((p) => p.status === "Draft").length || 0,
      lost: statsData?.filter((p) => p.status === "Lost").length || 0,
      totalValue: statsData?.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0,
      acceptedValue:
        statsData?.filter((p) => p.status === "Accepted").reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0,
      pendingValue:
        statsData
          ?.filter((p) => p.status === "Awaiting acceptance")
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0,
    }

    return NextResponse.json({ proposals: data, stats })
  } catch (error) {
    console.error("Error fetching proposals:", error)
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 })
  }
}
