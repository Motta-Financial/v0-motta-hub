import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll } from "@/lib/karbon-api"

/**
 * GET /api/karbon/client-groups
 * Fetch client groups from Karbon
 */
export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const expand = searchParams.get("expand")
    const top = searchParams.get("top")

    const queryOptions: any = {
      count: true,
      orderby: "Name asc",
    }

    if (expand) {
      queryOptions.expand = expand.split(",")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    const { data: groups, error, totalCount } = await karbonFetchAll<any>("/ClientGroups", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    const mappedGroups = groups.map((group: any) => ({
      ClientGroupKey: group.ClientGroupKey,
      Name: group.Name,
      Description: group.Description,
      GroupType: group.GroupType,
      Members: group.Members || [],
      PrimaryContact: group.PrimaryContactKey
        ? {
            ContactKey: group.PrimaryContactKey,
            Name: group.PrimaryContactName,
          }
        : null,
      CreatedDate: group.CreatedDate,
      ModifiedDate: group.LastModifiedDateTime,
    }))

    return NextResponse.json({
      clientGroups: mappedGroups,
      count: mappedGroups.length,
      totalCount: totalCount || mappedGroups.length,
    })
  } catch (error) {
    console.error("[v0] Error fetching client groups:", error)
    return NextResponse.json(
      { error: "Failed to fetch client groups", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
