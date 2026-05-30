import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import {
  ALLOWED_TABLES,
  TABLE_SCHEMAS,
  type AllowedTable,
} from "@/lib/alfred/allowed-tables"
import { requireAlfredAuth } from "@/lib/alfred/auth-guard"

export async function GET(request: NextRequest) {
  const authError = await requireAlfredAuth(request)
  if (authError) return authError

  const searchParams = request.nextUrl.searchParams
  const table = searchParams.get("table") as AllowedTable | null
  const query = searchParams.get("query") // For search queries
  const columns = searchParams.get("columns") // Specific columns to select
  const filters = searchParams.get("filters") // JSON encoded filters
  const limit = Number.parseInt(searchParams.get("limit") || "100")
  const offset = Number.parseInt(searchParams.get("offset") || "0")
  const orderBy = searchParams.get("orderBy")
  const orderDirection = searchParams.get("orderDirection") || "desc"

  // If no table specified, return available tables and schemas
  if (!table) {
    return NextResponse.json({
      success: true,
      available_tables: ALLOWED_TABLES,
      table_schemas: TABLE_SCHEMAS,
      usage: {
        description: "ALFRED Data API - Query any Supabase table",
        examples: [
          "/api/alfred/data?table=team_members",
          "/api/alfred/data?table=work_items&limit=50&orderBy=due_date",
          "/api/alfred/data?table=contacts&query=john&columns=id,full_name,email",
          '/api/alfred/data?table=debriefs&filters={"status":"completed"}',
        ],
      },
    })
  }

  // Validate table name
  if (!ALLOWED_TABLES.includes(table)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid table: ${table}. Allowed tables: ${ALLOWED_TABLES.join(", ")}`,
      },
      { status: 400 },
    )
  }

  try {
    const supabase = await createClient()

    // Build the query
    let dbQuery = supabase.from(table).select(columns || "*")

    // Apply search query if provided
    if (query) {
      // Search across text columns based on table
      const searchColumns = getSearchColumns(table)
      if (searchColumns.length > 0) {
        const orConditions = searchColumns.map((col) => `${col}.ilike.%${query}%`).join(",")
        dbQuery = dbQuery.or(orConditions)
      }
    }

    // Apply filters if provided
    if (filters) {
      try {
        const parsedFilters = JSON.parse(filters)
        Object.entries(parsedFilters).forEach(([key, value]) => {
          if (value !== null && value !== undefined && value !== "") {
            dbQuery = dbQuery.eq(key, value)
          }
        })
      } catch {
        // Invalid JSON, ignore filters
      }
    }

    // Apply ordering
    if (orderBy) {
      dbQuery = dbQuery.order(orderBy, { ascending: orderDirection === "asc" })
    } else {
      // Default ordering by created_at if available
      dbQuery = dbQuery.order("created_at", { ascending: false })
    }

    // Apply pagination
    dbQuery = dbQuery.range(offset, offset + limit - 1)

    const { data, error, count } = await dbQuery

    if (error) {
      console.error(`[ALFRED API] Error querying ${table}:`, error)
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      table,
      data,
      count: data?.length || 0,
      limit,
      offset,
      schema: TABLE_SCHEMAS[table] || null,
    })
  } catch (error) {
    console.error("[ALFRED API] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to query database",
      },
      { status: 500 },
    )
  }
}

// Get searchable columns for each table.
//
// IMPORTANT: every column listed here MUST exist in the live Supabase
// schema. PostgREST builds the search filter as
// `col1.ilike.%X%,col2.ilike.%X%,...` and a single bad column name
// causes the entire query to fail with `column "X" does not exist`,
// not just the bad clause. The previous version of this map shipped
// `debriefs.team_member` (no such column) and broke debrief search
// outright.
function getSearchColumns(table: AllowedTable): string[] {
  const searchColumnsMap: Record<string, string[]> = {
    contacts: ["full_name", "first_name", "last_name", "primary_email", "employer"],
    organizations: ["name", "legal_name", "trading_name", "industry"],
    work_items: [
      "title",
      "description",
      "client_name",
      "client_group_name",
      "assignee_name",
      "work_type",
    ],
    work_items_enriched: [
      "title",
      "client_name",
      "assignee_full_name",
      "owner_full_name",
      "manager_full_name",
      "contact_full_name",
      "org_name",
    ],
    team_members: ["full_name", "first_name", "last_name", "email", "role", "department"],
    debriefs: [
      "notes",
      "debrief_type",
      "organization_name",
      "client_manager_name",
      "client_owner_name",
    ],
    debriefs_full: [
      "notes",
      "debrief_type",
      "organization_display_name",
      "contact_full_name",
      "team_member_full_name",
      "work_item_title",
    ],
    tasks: ["title", "description", "notes"],
    karbon_tasks: ["title", "description", "assignee_name"],
    karbon_notes: ["subject", "body", "author_name", "contact_name", "work_item_title"],
    karbon_timesheets: ["description", "user_name", "work_item_title", "client_name"],
    invoices: ["invoice_number", "notes", "internal_notes"],
    services: ["name", "description", "category"],
    service_lines: ["name", "code", "description", "category"],
    service_agreements: ["name", "notes"],
    client_groups: ["name", "description", "primary_contact_name"],
    clients_unified: ["name", "primary_email"],
    master_client_mapping: ["display_name", "primary_email"],
    leads: ["first_name", "last_name", "email", "company_name", "notes"],
    messages: ["content", "author_name"],
    message_comments: ["content", "author_name"],
    emails: ["subject", "from_email", "from_name", "body_text"],
    notes: ["title", "content"],
    documents: ["name", "description"],
    motta_recurring_revenue: ["client_name", "normalized_name", "service_type", "department"],
    motta_recurring_revenue_by_client: [
      "client_name",
      "normalized_name",
      "department",
      "service_types",
    ],
    ignition_proposals: ["client_name", "client_email", "title", "proposal_sent_by"],
    tommy_award_ballots: [
      "voter_name",
      "first_place_name",
      "second_place_name",
      "third_place_name",
      "honorable_mention_name",
      "partner_vote_name",
    ],
    tommy_award_points: ["team_member_name"],
    tommy_award_yearly_totals: ["team_member_name"],
    deals: ["title", "notes", "source"],
    deals_enriched: ["title", "contact_name", "contact_email", "organization_name", "owner_name", "source"],
    projects: ["name", "description"],
    projects_enriched: ["name", "project_type_name", "project_template_title"],
    prospect_submissions: [
      "submitter_full_name",
      "submitter_email",
      "business_name",
      "services_requested",
      "internal_notes",
    ],
    referrals: ["referee_name", "referred_by_raw", "referred_by_name", "notes"],
    calendly_events: ["name", "event_type_name", "calendly_user_name", "calendly_user_email"],
    zoom_meetings: ["topic", "host_email"],
  }

  return searchColumnsMap[table] || []
}

// POST endpoint for complex queries
export async function POST(request: NextRequest) {
  const authError = await requireAlfredAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const {
      table,
      select,
      filters,
      search,
      joins,
      aggregate,
      limit = 100,
      offset = 0,
      orderBy,
      orderDirection = "desc",
    } = body

    if (!table || !ALLOWED_TABLES.includes(table)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid or missing table. Allowed tables: ${ALLOWED_TABLES.join(", ")}`,
        },
        { status: 400 },
      )
    }

    const supabase = await createClient()

    // Build select statement with joins
    let selectStatement = select || "*"
    if (joins && Array.isArray(joins)) {
      const joinStatements = joins
        .map((join: { table: string; columns: string }) => {
          if (ALLOWED_TABLES.includes(join.table as AllowedTable)) {
            return `${join.table}(${join.columns || "*"})`
          }
          return null
        })
        .filter(Boolean)

      if (joinStatements.length > 0) {
        selectStatement = `${selectStatement}, ${joinStatements.join(", ")}`
      }
    }

    let dbQuery = supabase.from(table).select(selectStatement)

    // Apply filters
    if (filters && typeof filters === "object") {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          if (typeof value === "object" && value !== null) {
            const filterObj = value as Record<string, unknown>
            // Handle complex filters like { gte: date, lte: date }
            if ("gte" in filterObj) dbQuery = dbQuery.gte(key, filterObj.gte)
            if ("lte" in filterObj) dbQuery = dbQuery.lte(key, filterObj.lte)
            if ("gt" in filterObj) dbQuery = dbQuery.gt(key, filterObj.gt)
            if ("lt" in filterObj) dbQuery = dbQuery.lt(key, filterObj.lt)
            if ("neq" in filterObj) dbQuery = dbQuery.neq(key, filterObj.neq)
            if ("in" in filterObj && Array.isArray(filterObj.in)) dbQuery = dbQuery.in(key, filterObj.in)
            if ("ilike" in filterObj) dbQuery = dbQuery.ilike(key, `%${filterObj.ilike}%`)
          } else {
            dbQuery = dbQuery.eq(key, value)
          }
        }
      })
    }

    // Apply text search
    if (search && typeof search === "string") {
      const searchColumns = getSearchColumns(table as AllowedTable)
      if (searchColumns.length > 0) {
        const orConditions = searchColumns.map((col) => `${col}.ilike.%${search}%`).join(",")
        dbQuery = dbQuery.or(orConditions)
      }
    }

    // Apply ordering
    if (orderBy) {
      dbQuery = dbQuery.order(orderBy, { ascending: orderDirection === "asc" })
    }

    // Apply pagination
    dbQuery = dbQuery.range(offset, offset + limit - 1)

    const { data, error } = await dbQuery

    if (error) {
      console.error(`[ALFRED API] Error:`, error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Handle aggregations
    let aggregateResult: Record<string, unknown> | null = null
    if (aggregate) {
      const { count: doCount, sum, avg } = aggregate
      if (doCount) {
        const { count } = await supabase.from(table).select("*", { count: "exact", head: true })
        aggregateResult = { ...(aggregateResult || {}), count }
      }
      // Note: sum and avg would require raw SQL which we'll skip for security
    }

    return NextResponse.json({
      success: true,
      table,
      data,
      count: data?.length || 0,
      aggregate: aggregateResult,
      limit,
      offset,
    })
  } catch (error) {
    console.error("[ALFRED API] Error:", error)
    return NextResponse.json({ success: false, error: "Failed to process request" }, { status: 500 })
  }
}
