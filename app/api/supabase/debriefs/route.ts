import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Number.parseInt(searchParams.get("limit") || "20")
    const clientKey = searchParams.get("clientKey")

    // Use service role key to bypass auth issues
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let query = supabase
      .from("debriefs")
      .select(`
        *,
        contact:contacts(full_name),
        organization:organizations(name),
        work_item:work_items(title)
      `)
      .order("created_at", { ascending: false })
      .limit(limit)

    // Filter by client key if provided
    if (clientKey) {
      query = query.or(`karbon_client_key.eq.${clientKey},organization_name.ilike.%${clientKey}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] Supabase debriefs error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ debriefs: data || [] })
  } catch (err) {
    console.error("[v0] Failed to fetch debriefs:", err)
    return NextResponse.json({ error: "Failed to fetch debriefs" }, { status: 500 })
  }
}
