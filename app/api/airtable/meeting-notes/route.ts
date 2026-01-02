import { NextResponse } from "next/server"

const AIRTABLE_BASE_ID = "app29FvStmjP1Vyb2"
const AIRTABLE_TABLE_ID = "tblkseFbhbBYamZls"
const AIRTABLE_API_TOKEN = "patCB0rdkee77UrfY.f624f9f65c56661e6a0b39976d54c22ae3e45df87c5a6941db71cb8c358d3c25"

export async function GET() {
  try {
    const allRecords: any[] = []
    let offset: string | undefined

    // Fetch all records with pagination
    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`)
      if (offset) {
        url.searchParams.set("offset", offset)
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
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
      console.log("[v0] Airtable response - records count:", data.records?.length, "offset:", data.offset)

      if (data.records) {
        allRecords.push(...data.records)
      }
      offset = data.offset
    } while (offset)

    // Log the structure of the first record to understand the schema
    if (allRecords.length > 0) {
      console.log("[v0] Sample Airtable record fields:", JSON.stringify(allRecords[0].fields, null, 2))
      console.log("[v0] All field names:", Object.keys(allRecords[0].fields))
    }

    // Extract unique field names across all records
    const allFieldNames = new Set<string>()
    allRecords.forEach((record) => {
      Object.keys(record.fields || {}).forEach((field) => allFieldNames.add(field))
    })

    return NextResponse.json({
      success: true,
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
