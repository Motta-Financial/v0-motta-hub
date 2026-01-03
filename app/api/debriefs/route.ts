import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientKey = searchParams.get("clientKey")
  const clientName = searchParams.get("clientName")

  const supabase = await createClient()

  let query = supabase.from("debriefs").select("*").order("debrief_date", { ascending: false })

  // Filter by client key or client name
  if (clientKey) {
    query = query.or(`karbon_client_key.eq.${clientKey},contact_name.ilike.%${clientName || ""}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ debriefs: data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const body = await request.json()

  const { data, error } = await supabase.from("debriefs").insert(body).select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ debrief: data[0] })
}
