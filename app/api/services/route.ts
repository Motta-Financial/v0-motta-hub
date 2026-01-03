import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const search = searchParams.get("search")
  const category = searchParams.get("category")
  const state = searchParams.get("state") || "active"
  const limit = Number.parseInt(searchParams.get("limit") || "100")

  let query = supabase
    .from("services")
    .select("*")
    .eq("state", state)
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .limit(limit)

  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%`)
  }

  if (category) {
    query = query.eq("category", category)
  }

  const { data: services, error } = await query

  if (error) {
    console.error("Error fetching services:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ services })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()

  const { data: service, error } = await supabase.from("services").insert(body).select().single()

  if (error) {
    console.error("Error creating service:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ service })
}
