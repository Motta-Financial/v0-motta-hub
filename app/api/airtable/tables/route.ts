import { NextResponse } from "next/server"

const AIRTABLE_BASE_ID = "app29FvStmjP1Vyb2"
const AIRTABLE_API_TOKEN = "patCB0rdkee77UrfY.f624f9f65c56661e6a0b39976d54c22ae3e45df87c5a6941db71cb8c358d3c25"

export async function GET() {
  try {
    // Fetch base schema to get all tables
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Airtable Metadata API error:", response.status, errorText)
      return NextResponse.json(
        { error: `Airtable Metadata API error: ${response.status}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    console.log("[v0] Airtable tables found:", data.tables?.length)

    // Map tables to a simpler format
    const tables = data.tables?.map((table: any) => ({
      id: table.id,
      name: table.name,
      primaryFieldId: table.primaryFieldId,
      fields: table.fields?.map((field: any) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options,
      })),
    }))

    return NextResponse.json({
      success: true,
      baseId: AIRTABLE_BASE_ID,
      tables,
    })
  } catch (error) {
    console.error("[v0] Error fetching Airtable tables:", error)
    return NextResponse.json({ error: "Failed to fetch Airtable tables", details: String(error) }, { status: 500 })
  }
}
