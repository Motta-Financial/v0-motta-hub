import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const limit = Number.parseInt(searchParams.get("limit") || "100")
    const offset = Number.parseInt(searchParams.get("offset") || "0")

    let query = supabase
      .from("ignition_disbursals")
      .select(`
        *,
        contact:contacts(id, full_name, primary_email),
        organization:organizations(id, name),
        work_item:work_items(id, title)
      `)
      .order("arrival_date", { ascending: false })
      .range(offset, offset + limit - 1)

    if (startDate) {
      query = query.gte("arrival_date", startDate)
    }
    if (endDate) {
      query = query.lte("arrival_date", endDate)
    }

    const { data, error, count } = await query

    if (error) {
      console.error("Error fetching disbursals:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get summary stats
    const { data: stats } = await supabase.from("ignition_disbursals").select("total_amount, total_fees")

    const totalRevenue = stats?.reduce((sum, d) => sum + Number.parseFloat(d.total_amount || "0"), 0) || 0
    const totalFees = stats?.reduce((sum, d) => sum + Number.parseFloat(d.total_fees || "0"), 0) || 0

    return NextResponse.json({
      disbursals: data,
      stats: {
        totalDisbursals: stats?.length || 0,
        totalRevenue,
        totalFees,
        netRevenue: totalRevenue - totalFees,
      },
    })
  } catch (error) {
    console.error("Error:", error)
    return NextResponse.json({ error: "Failed to fetch disbursals" }, { status: 500 })
  }
}

// Link a disbursal to Karbon entities
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { disbursal_id, contact_id, organization_id, work_item_id } = body

    const { data, error } = await supabase
      .from("ignition_disbursals")
      .update({
        contact_id,
        organization_id,
        work_item_id,
        updated_at: new Date().toISOString(),
      })
      .eq("disbursal_id", disbursal_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ disbursal: data })
  } catch (error) {
    console.error("Error:", error)
    return NextResponse.json({ error: "Failed to update disbursal" }, { status: 500 })
  }
}
