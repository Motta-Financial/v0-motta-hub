import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const clientName = searchParams.get("client")
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")
  const limit = Number.parseInt(searchParams.get("limit") || "100")

  let query = supabase.from("meeting_notes").select("*").order("meeting_date", { ascending: false }).limit(limit)

  if (clientName) {
    query = query.ilike("client_name", `%${clientName}%`)
  }

  if (startDate) {
    query = query.gte("meeting_date", startDate)
  }

  if (endDate) {
    query = query.lte("meeting_date", endDate)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, count: data?.length || 0 })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()

  // Handle single or bulk insert
  const records = Array.isArray(body) ? body : [body]

  const { data, error } = await supabase.from("meeting_notes").upsert(records, { onConflict: "airtable_id" }).select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, count: data?.length || 0 })
}
