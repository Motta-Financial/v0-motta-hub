import { NextResponse } from "next/server"
import type { FilterView } from "@/lib/view-types"

// In-memory storage for views (replace with database in production)
const views: FilterView[] = [
  {
    id: "default-active-clients",
    name: "Active Clients",
    type: "clients",
    filters: {
      clientType: "active",
      serviceLines: ["all"],
    },
    isShared: true,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  },
  {
    id: "default-active-work",
    name: "Active Work Items",
    type: "workItems",
    filters: {
      status: "active",
      serviceLines: ["all"],
    },
    isShared: true,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  },
]

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") as "clients" | "workItems" | null

    let filteredViews = views
    if (type) {
      filteredViews = views.filter((view) => view.type === type)
    }

    return NextResponse.json({ views: filteredViews })
  } catch (error) {
    console.error("[v0] Error fetching views:", error)
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

    const newView: FilterView = {
      id: `view-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      type,
      filters,
      isShared: isShared || false,
      createdBy: createdBy || "current-user",
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    }

    views.push(newView)

    return NextResponse.json({ view: newView }, { status: 201 })
  } catch (error) {
    console.error("[v0] Error creating view:", error)
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

    const viewIndex = views.findIndex((v) => v.id === id)
    if (viewIndex === -1) {
      return NextResponse.json({ error: "View not found" }, { status: 404 })
    }

    views[viewIndex] = {
      ...views[viewIndex],
      name: name || views[viewIndex].name,
      filters: filters || views[viewIndex].filters,
      isShared: isShared !== undefined ? isShared : views[viewIndex].isShared,
      lastModified: new Date().toISOString(),
    }

    return NextResponse.json({ view: views[viewIndex] })
  } catch (error) {
    console.error("[v0] Error updating view:", error)
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

    const viewIndex = views.findIndex((v) => v.id === id)
    if (viewIndex === -1) {
      return NextResponse.json({ error: "View not found" }, { status: 404 })
    }

    views.splice(viewIndex, 1)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error deleting view:", error)
    return NextResponse.json({ error: "Failed to delete view" }, { status: 500 })
  }
}
