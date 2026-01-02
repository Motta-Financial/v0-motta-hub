import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"

/**
 * GET /api/karbon/tasks/[taskKey]
 * Fetch a specific task
 */
export async function GET(request: NextRequest, { params }: { params: { taskKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { taskKey } = params

    const { data, error } = await karbonFetch<any>(`/Tasks/${taskKey}`, credentials)

    if (error) {
      return NextResponse.json({ error: `Failed to fetch task: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error("[v0] Error fetching task:", error)
    return NextResponse.json(
      { error: "Failed to fetch task", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * PUT /api/karbon/tasks/[taskKey]
 * Update a task
 */
export async function PUT(request: NextRequest, { params }: { params: { taskKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { taskKey } = params
    const body = await request.json()

    const { data, error } = await karbonFetch<any>(`/Tasks/${taskKey}`, credentials, {
      method: "PUT",
      body,
    })

    if (error) {
      return NextResponse.json({ error: `Failed to update task: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error("[v0] Error updating task:", error)
    return NextResponse.json(
      { error: "Failed to update task", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * PATCH /api/karbon/tasks/[taskKey]
 * Partially update a task
 */
export async function PATCH(request: NextRequest, { params }: { params: { taskKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { taskKey } = params
    const body = await request.json()

    const { data, error } = await karbonFetch<any>(`/Tasks/${taskKey}`, credentials, {
      method: "PATCH",
      body,
    })

    if (error) {
      return NextResponse.json({ error: `Failed to patch task: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error("[v0] Error patching task:", error)
    return NextResponse.json(
      { error: "Failed to patch task", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/karbon/tasks/[taskKey]
 * Delete a task
 */
export async function DELETE(request: NextRequest, { params }: { params: { taskKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { taskKey } = params

    const { error } = await karbonFetch<any>(`/Tasks/${taskKey}`, credentials, {
      method: "DELETE",
    })

    if (error) {
      return NextResponse.json({ error: `Failed to delete task: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error deleting task:", error)
    return NextResponse.json(
      { error: "Failed to delete task", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
