import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { fetchAllPaged } from "@/lib/supabase/fetch-all"

// GET - Fetch all busy season work items from Supabase
export async function GET() {
  try {
    const supabase = await createClient()

    // Paged in 1,000-row windows — PostgREST caps every response at
    // 1,000 rows, and the busy-season board exceeds that in season.
    const workItems = await fetchAllPaged<Record<string, unknown>>(() =>
      supabase
        .from("busy_season_work_items")
        .select("*")
        .order("updated_at", { ascending: false }),
    )

    return NextResponse.json({ workItems, count: workItems.length })
  } catch (err) {
    console.error("[v0] API error:", err)
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Unknown error occurred",
      workItems: [],
      count: 0
    }, { status: 500 })
  }
}

// POST - Sync work items from Karbon to Supabase (upsert)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { workItems } = await request.json()
  
    if (!workItems || !Array.isArray(workItems)) {
      return NextResponse.json({ error: "workItems array is required" }, { status: 400 })
    }
  
    // Upsert work items - insert new ones, update existing based on karbon_work_key
    const { data, error } = await supabase
      .from("busy_season_work_items")
      .upsert(
        workItems.map((item: any) => ({
          karbon_work_key: item.karbon_work_key,
          client_name: item.client_name,
          entity_type: item.entity_type,
          tax_year: item.tax_year,
          primary_status: item.primary_status,
          preparer: item.preparer,
          reviewer: item.reviewer,
          assigned_to: item.assigned_to,
          in_queue: item.in_queue || false,
          due_date: item.due_date,
          progress: item.progress || 0,
          documents_received: item.documents_received || false,
          notes: item.notes,
          is_priority: item.is_priority || false,
          last_updated_by: item.last_updated_by,
          karbon_url: item.karbon_url,
        })),
        { onConflict: "karbon_work_key", ignoreDuplicates: false }
      )
      .select()
  
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  
    return NextResponse.json({ 
      success: true, 
      synced: data?.length || 0,
      message: `Synced ${data?.length || 0} work items`
    })
  } catch (err) {
    console.error("[v0] API error:", err)
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Unknown error occurred",
      synced: 0,
      message: "Failed to sync work items"
    }, { status: 500 })
  }
}
