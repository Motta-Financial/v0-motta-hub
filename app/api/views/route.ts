import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import type { FilterView } from "@/lib/view-types"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") as "clients" | "workItems" | "teammates" | null

    let query = supabase.from("saved_views").select("*").order("created_at", { ascending: false })

    if (type) {
      query = query.eq("entity_type", type)
    }

    const { data: views, error } = await query

    if (error) throw error

    const formattedViews: FilterView[] = (views || []).map((v) => ({
      id: v.id,
      name: v.name,
      type: v.entity_type,
      filters: v.filters || {},
      isShared: v.is_shared,
      createdBy: v.team_member_id || "system",
      createdAt: v.created_at,
      lastModified: v.updated_at,
    }))

    return NextResponse.json({ views: formattedViews })
  } catch (error) {
    console.error("Error fetching views:", error)
    return NextResponse.json({ error: "Failed to fetch views" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, type, filters, isShared, createdBy } = body

    if (!name || !type || !filters) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { data: newView, error } = await supabase
      .from("saved_views")
      .insert({
        name,
        entity_type: type,
        filters,
        is_shared: isShared || false,
        team_member_id: createdBy || null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(
      {
        view: {
          id: newView.id,
          name: newView.name,
          type: newView.entity_type,
          filters: newView.filters,
          isShared: newView.is_shared,
          createdBy: newView.team_member_id,
          createdAt: newView.created_at,
          lastModified: newView.updated_at,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("Error creating view:", error)
    return NextResponse.json({ error: "Failed to create view" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { id, name, filters, isShared } = body

    if (!id) {
      return NextResponse.json({ error: "View ID is required" }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name) updates.name = name
    if (filters) updates.filters = filters
    if (isShared !== undefined) updates.is_shared = isShared

    const { data: updatedView, error } = await supabase
      .from("saved_views")
      .update(updates)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      view: {
        id: updatedView.id,
        name: updatedView.name,
        type: updatedView.entity_type,
        filters: updatedView.filters,
        isShared: updatedView.is_shared,
        createdBy: updatedView.team_member_id,
        createdAt: updatedView.created_at,
        lastModified: updatedView.updated_at,
      },
    })
  } catch (error) {
    console.error("Error updating view:", error)
    return NextResponse.json({ error: "Failed to update view" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "View ID is required" }, { status: 400 })
    }

    const { error } = await supabase.from("saved_views").delete().eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting view:", error)
    return NextResponse.json({ error: "Failed to delete view" }, { status: 500 })
  }
}
