import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"

/**
 * GET /api/karbon/client-groups/[clientGroupKey]
 * Fetch a specific client group with members
 */
export async function GET(request: NextRequest, { params }: { params: { clientGroupKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { clientGroupKey } = params

    const { data, error } = await karbonFetch<any>(`/ClientGroups/${clientGroupKey}`, credentials, {
      queryOptions: { expand: ["Members", "Contacts"] },
    })

    if (error) {
      return NextResponse.json({ error: `Failed to fetch client group: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, clientGroup: data })
  } catch (error) {
    console.error("[v0] Error fetching client group:", error)
    return NextResponse.json(
      { error: "Failed to fetch client group", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
