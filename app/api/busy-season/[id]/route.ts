import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

// GET - Fetch a single work item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    const { data: workItem, error } = await supabase
      .from("busy_season_work_items")
      .select("*")
      .eq("id", id)
      .single()
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ workItem })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 })
  }
}

// PATCH - Update or create a work item (upsert by karbon_work_key)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const body = await request.json()
    
    // Check if this is a karbon_work_key (starts with letters) or a UUID
    const isKarbonKey = !id.includes("-") || id.length < 30
    
    if (isKarbonKey) {
      // This is a karbon_work_key - need to upsert
      // First, check if the record exists
      const { data: existing } = await supabase
        .from("busy_season_work_items")
        .select("id")
        .eq("karbon_work_key", id)
        .single()
      
      if (existing) {
        // Update existing record
        const { data: workItem, error } = await supabase
          .from("busy_season_work_items")
          .update(body)
          .eq("karbon_work_key", id)
          .select()
          .single()
        
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        return NextResponse.json({ workItem, success: true })
      } else {
        // Create new record with karbon_work_key
        const newRecord = {
          karbon_work_key: id,
          client_name: body.client_name || "Unknown",
          entity_type: body.entity_type || "Unknown",
          tax_year: body.tax_year || new Date().getFullYear(),
          ...body
        }
        
        const { data: workItem, error } = await supabase
          .from("busy_season_work_items")
          .insert(newRecord)
          .select()
          .single()
        
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        return NextResponse.json({ workItem, success: true, created: true })
      }
    } else {
      // This is a UUID - update by id
      const { data: workItem, error } = await supabase
        .from("busy_season_work_items")
        .update(body)
        .eq("id", id)
        .select()
        .single()
      
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      
      return NextResponse.json({ workItem, success: true })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 })
  }
}

// DELETE - Remove a work item from busy season tracking
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    const { error } = await supabase
      .from("busy_season_work_items")
      .delete()
      .eq("id", id)
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 })
  }
}
