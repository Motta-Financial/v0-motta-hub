import { type NextRequest, NextResponse } from "next/server"

export async function PUT(request: NextRequest, { params }: { params: { contactKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { contactKey } = params

    // Make PUT request to Karbon API
    const response = await fetch(`https://api.karbonhq.com/v3/Contacts/${contactKey}`, {
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
        { error: `Failed to update contact: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error updating contact:", error)
    return NextResponse.json(
      { error: "Failed to update contact", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { contactKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { contactKey } = params

    // Make PATCH request to Karbon API
    const response = await fetch(`https://api.karbonhq.com/v3/Contacts/${contactKey}`, {
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
        { error: `Failed to patch contact: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error patching contact:", error)
    return NextResponse.json(
      { error: "Failed to patch contact", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()

    // Make POST request to Karbon API
    const response = await fetch(`https://api.karbonhq.com/v3/Contacts`, {
      method: "POST",
      headers: {
        AccessKey: accessKey,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Karbon API POST error:", response.status, errorText)
      return NextResponse.json(
        { error: `Failed to create contact: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error creating contact:", error)
    return NextResponse.json(
      { error: "Failed to create contact", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest, { params }: { params: { contactKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { contactKey } = params
    const searchParams = request.nextUrl.searchParams
    // Karbon Contact $expand options: BusinessCards, AccountingDetail
    const expand = searchParams.get("expand") || "BusinessCards,AccountingDetail"

    // Karbon Contacts are individual people, not organizations
    // Contacts use ContactKey as their identifier
    const response = await fetch(`https://api.karbonhq.com/v3/Contacts/${contactKey}?$expand=${expand}`, {
      headers: {
        AccessKey: accessKey,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[v0] Karbon Contact GET error for ${contactKey}:`, response.status, errorText)
      return NextResponse.json(
        {
          error: `Contact not found: ${response.statusText}`,
          details: errorText,
          hint: "This key may be an Organization (EntityKey), not a Contact. Try /api/karbon/organizations/{key} instead.",
        },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({
      success: true,
      contact: data,
      entityType: "Contact", // Individual person
      keyType: "ContactKey",
    })
  } catch (error) {
    console.error("[v0] Error fetching contact:", error)
    return NextResponse.json(
      { error: "Failed to fetch contact", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
