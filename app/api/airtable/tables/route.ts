import { NextResponse } from "next/server"

// Airtable was sunsetted at Motta (2026-07). The integration is kept
// intact because licensee firms may use Airtable — it stays inert until
// AIRTABLE_API_KEY is configured, and the route returns a clear
// "not configured" error rather than failing obscurely.
//
// SECURITY: a live PAT was previously hardcoded here, so it lives on in
// git history. Revoke that token before ever reactivating this base.
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
