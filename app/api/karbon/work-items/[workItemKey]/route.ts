import { type NextRequest, NextResponse } from "next/server"

export async function PUT(request: NextRequest, { params }: { params: { workItemKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { workItemKey } = params

    // Make PUT request to Karbon API
    const response = await fetch(`https://api.karbonhq.com/v3/WorkItems/${workItemKey}`, {
      method: "PUT",
      headers: {
        AccessKey: accessKey,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Karbon API PUT error:", response.status, errorText)
      return NextResponse.json(
        { error: `Failed to update work item: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error updating work item:", error)
    return NextResponse.json(
      { error: "Failed to update work item", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { workItemKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { workItemKey } = params

    // Make PATCH request to Karbon API
    const response = await fetch(`https://api.karbonhq.com/v3/WorkItems/${workItemKey}`, {
      method: "PATCH",
      headers: {
        AccessKey: accessKey,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Karbon API PATCH error:", response.status, errorText)
      return NextResponse.json(
        { error: `Failed to patch work item: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error patching work item:", error)
    return NextResponse.json(
      { error: "Failed to patch work item", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest, { params }: { params: { workItemKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { workItemKey } = params

    const response = await fetch(`https://api.karbonhq.com/v3/WorkItems/${workItemKey}`, {
      method: "GET",
      headers: {
        AccessKey: accessKey,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Karbon API GET error:", response.status, errorText)
      return NextResponse.json(
        { error: `Failed to fetch work item: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error fetching work item:", error)
    return NextResponse.json(
      { error: "Failed to fetch work item", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
