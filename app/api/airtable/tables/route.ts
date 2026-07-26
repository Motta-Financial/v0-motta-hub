import { NextResponse } from "next/server"

// SECURITY: a live Airtable PAT was previously hardcoded here (and thus
// in git history) — it must be treated as compromised and rotated in
// Airtable. Both airtable routes now read AIRTABLE_API_KEY from env.
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "app29FvStmjP1Vyb2"

export async function GET() {
  try {
    const apiToken = process.env.AIRTABLE_API_KEY
    if (!apiToken) {
      return NextResponse.json(
        { error: "Airtable is not configured", details: "Set AIRTABLE_API_KEY in environment variables" },
        { status: 500 },
      )
    }

    // Fetch base schema to get all tables
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
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
