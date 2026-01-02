import { type NextRequest, NextResponse } from "next/server"

const AIRTABLE_BASE_ID = "app29FvStmjP1Vyb2"

export async function GET(request: NextRequest, { params }: { params: Promise<{ tableId: string }> }) {
  try {
    const apiToken = process.env.AIRTABLE_API_KEY

    if (!apiToken) {
      console.error("[v0] AIRTABLE_API_KEY environment variable is not set")
      return NextResponse.json(
        {
          error: "Airtable API key not configured",
          details: "Please add AIRTABLE_API_KEY to your environment variables",
        },
        { status: 500 },
      )
    }

    const { tableId } = await params
    const allRecords: any[] = []
    let offset: string | undefined

    // Fetch all records with pagination
    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`)
      if (offset) {
        url.searchParams.set("offset", offset)
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[v0] Airtable API error:", response.status, errorText)
        return NextResponse.json(
          { error: `Airtable API error: ${response.status}`, details: errorText },
          { status: response.status },
        )
      }

      const data = await response.json()
      if (data.records) {
        allRecords.push(...data.records)
      }
      offset = data.offset
    } while (offset)

    // Extract unique field names across all records
    const allFieldNames = new Set<string>()
    allRecords.forEach((record) => {
      Object.keys(record.fields || {}).forEach((field) => allFieldNames.add(field))
    })

    return NextResponse.json({
      success: true,
      tableId,
      totalRecords: allRecords.length,
      fieldNames: Array.from(allFieldNames),
      sampleRecord: allRecords[0] || null,
      records: allRecords,
    })
  } catch (error) {
    console.error("[v0] Error fetching from Airtable:", error)
    return NextResponse.json({ error: "Failed to fetch from Airtable", details: String(error) }, { status: 500 })
  }
}
