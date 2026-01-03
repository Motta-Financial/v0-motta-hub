import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest, { params }: { params: { organizationKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { organizationKey } = params
    const searchParams = request.nextUrl.searchParams
    // Karbon Organization $expand options: BusinessCards, AccountingDetail, Contacts
    const expand = searchParams.get("expand") || "BusinessCards,AccountingDetail"

    // Karbon Organizations are companies/businesses, not individuals
    // Organizations use EntityKey (same as OrganizationKey) as their identifier
    const response = await fetch(`https://api.karbonhq.com/v3/Organizations/${organizationKey}?$expand=${expand}`, {
      headers: {
        AccessKey: accessKey,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[v0] Karbon Organization GET error for ${organizationKey}:`, response.status, errorText)
      return NextResponse.json(
        {
          error: `Organization not found: ${response.statusText}`,
          details: errorText,
          hint: "This key may be a Contact (ContactKey), not an Organization. Try /api/karbon/contacts/{key} instead.",
        },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({
      success: true,
      organization: data,
      entityType: "Organization", // Company/business
      keyType: "EntityKey", // Organizations use EntityKey per Karbon API
    })
  } catch (error) {
    console.error("[v0] Error fetching organization:", error)
    return NextResponse.json(
      { error: "Failed to fetch organization", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: { organizationKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { organizationKey } = params

    const response = await fetch(`https://api.karbonhq.com/v3/Organizations/${organizationKey}`, {
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
        { error: `Failed to update organization: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error updating organization:", error)
    return NextResponse.json(
      { error: "Failed to update organization", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { organizationKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { organizationKey } = params

    const response = await fetch(`https://api.karbonhq.com/v3/Organizations/${organizationKey}`, {
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
        { error: `Failed to patch organization: ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[v0] Error patching organization:", error)
    return NextResponse.json(
      { error: "Failed to patch organization", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
