import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

// Tables to search and their searchable columns
const SEARCHABLE_TABLES = {
  contacts: {
    columns: ["full_name", "first_name", "last_name", "primary_email", "employer"],
    display: ["id", "full_name", "primary_email", "contact_type", "status"],
  },
  organizations: {
    columns: ["name", "legal_name", "trading_name", "industry"],
    display: ["id", "name", "entity_type", "industry", "primary_email"],
  },
  work_items: {
    columns: ["title", "description", "client_group_name", "assignee_name"],
    display: ["id", "title", "status", "client_group_name", "assignee_name", "due_date"],
  },
  team_members: {
    columns: ["full_name", "first_name", "last_name", "email"],
    display: ["id", "full_name", "email", "role", "department"],
  },
  debriefs: {
    columns: ["team_member", "organization_name", "notes"],
    display: ["id", "debrief_date", "debrief_type", "team_member", "organization_name", "status"],
  },
  karbon_notes: {
    columns: ["subject", "body", "author_name", "contact_name"],
    display: ["id", "subject", "author_name", "work_item_title", "created_at"],
  },
  meeting_notes: {
    columns: ["client_name", "notes", "agenda"],
    display: ["id", "client_name", "meeting_date", "meeting_type", "status"],
  },
  services: {
    columns: ["name", "description", "category"],
    display: ["id", "name", "category", "price"],
  },
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get("q")
  const tables = searchParams.get("tables")?.split(",") || Object.keys(SEARCHABLE_TABLES)
  const limit = Number.parseInt(searchParams.get("limit") || "10")

  if (!query || query.length < 2) {
    return NextResponse.json(
      {
        success: false,
        error: "Search query must be at least 2 characters",
      },
      { status: 400 },
    )
  }

  try {
    const supabase = await createClient()
    const results: Record<string, unknown[]> = {}

    // Search each table in parallel
    const searchPromises = tables
      .filter((table) => table in SEARCHABLE_TABLES)
      .map(async (table) => {
        const config = SEARCHABLE_TABLES[table as keyof typeof SEARCHABLE_TABLES]
        const orConditions = config.columns.map((col) => `${col}.ilike.%${query}%`).join(",")

        const { data, error } = await supabase
          .from(table)
          .select(config.display.join(","))
          .or(orConditions)
          .limit(limit)

        if (!error && data) {
          return { table, data }
        }
        return { table, data: [] }
      })

    const searchResults = await Promise.all(searchPromises)

    searchResults.forEach(({ table, data }) => {
      if (data.length > 0) {
        results[table] = data
      }
    })

    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0)

    return NextResponse.json({
      success: true,
      query,
      total_results: totalResults,
      results,
    })
  } catch (error) {
    console.error("[ALFRED Search API] Error:", error)
    return NextResponse.json({ success: false, error: "Search failed" }, { status: 500 })
  }
}
