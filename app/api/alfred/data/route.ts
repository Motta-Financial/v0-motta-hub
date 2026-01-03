import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

// All available tables ALFRED can query
const ALLOWED_TABLES = [
  "activity_log",
  "client_group_members",
  "client_groups",
  "contact_organizations",
  "contacts",
  "dashboard_widgets",
  "dashboards",
  "debriefs",
  "documents",
  "emails",
  "ignition_proposals",
  "invoice_line_items",
  "invoices",
  "karbon_notes",
  "karbon_tasks",
  "karbon_timesheets",
  "leads",
  "meeting_attendees",
  "meeting_notes",
  "meeting_notes_debriefs",
  "meetings",
  "message_comments",
  "message_reactions",
  "messages",
  "notes",
  "notifications",
  "organizations",
  "payments",
  "pipeline_stages",
  "pipelines",
  "recurring_revenue",
  "saved_views",
  "service_agreements",
  "service_lines",
  "services",
  "sync_log",
  "tags",
  "tasks",
  "tax_returns",
  "team_members",
  "time_entries",
  "tommy_award_ballots",
  "tommy_award_points",
  "tommy_award_weeks",
  "tommy_award_yearly_totals",
  "work_item_assignees",
  "work_items",
  "work_status",
  "work_types",
] as const

type AllowedTable = (typeof ALLOWED_TABLES)[number]

// Table schemas for ALFRED to understand the data structure
const TABLE_SCHEMAS: Record<string, { description: string; key_columns: string[] }> = {
  activity_log: {
    description: "Tracks all user activities and changes in the system",
    key_columns: ["id", "entity_type", "action", "team_member_id", "created_at"],
  },
  client_groups: {
    description: "Groups of related clients (families, businesses)",
    key_columns: ["id", "name", "group_type", "client_manager_id", "client_owner_id"],
  },
  contacts: {
    description: "Individual people - clients, prospects, and contacts",
    key_columns: ["id", "full_name", "primary_email", "contact_type", "status"],
  },
  debriefs: {
    description: "Meeting debriefs and client interaction summaries",
    key_columns: ["id", "debrief_date", "debrief_type", "team_member", "organization_name", "status", "notes"],
  },
  invoices: {
    description: "Client invoices and billing records",
    key_columns: ["id", "invoice_number", "total_amount", "status", "due_date", "organization_id"],
  },
  karbon_notes: {
    description: "Notes synced from Karbon practice management",
    key_columns: ["id", "subject", "body", "author_name", "work_item_title", "contact_name"],
  },
  karbon_tasks: {
    description: "Tasks synced from Karbon",
    key_columns: ["id", "title", "status", "assignee_name", "due_date", "priority"],
  },
  karbon_timesheets: {
    description: "Time entries synced from Karbon",
    key_columns: ["id", "user_name", "minutes", "work_item_title", "client_name", "date"],
  },
  meeting_notes: {
    description: "Notes from client meetings",
    key_columns: ["id", "client_name", "meeting_date", "meeting_type", "notes", "action_items"],
  },
  organizations: {
    description: "Business entities and companies",
    key_columns: ["id", "name", "entity_type", "industry", "primary_email"],
  },
  tasks: {
    description: "Internal tasks and to-dos",
    key_columns: ["id", "title", "status", "assignee_id", "due_date", "priority"],
  },
  tax_returns: {
    description: "Tax return records and filing information",
    key_columns: ["id", "tax_year", "form_type", "filing_status", "status", "contact_id"],
  },
  team_members: {
    description: "Motta Financial team members and staff",
    key_columns: ["id", "full_name", "email", "role", "department", "is_active"],
  },
  time_entries: {
    description: "Time tracking entries for billing",
    key_columns: ["id", "team_member_id", "minutes", "description", "date", "is_billable"],
  },
  tommy_award_ballots: {
    description: "Weekly Tommy Award voting ballots",
    key_columns: ["id", "voter_name", "week_date", "first_place_name", "second_place_name"],
  },
  tommy_award_points: {
    description: "Tommy Award points by team member per week",
    key_columns: ["id", "team_member_name", "week_date", "total_points"],
  },
  tommy_award_yearly_totals: {
    description: "Yearly Tommy Award totals and rankings",
    key_columns: ["id", "team_member_name", "year", "total_points", "current_rank"],
  },
  work_items: {
    description: "Work items and projects from Karbon - the main unit of client work",
    key_columns: ["id", "title", "status", "work_type", "client_group_name", "assignee_name", "due_date"],
  },
  work_status: {
    description: "Work item status definitions",
    key_columns: ["id", "name", "is_active", "is_default_filter"],
  },
  services: {
    description: "Service offerings and pricing",
    key_columns: ["id", "name", "category", "price", "description"],
  },
  recurring_revenue: {
    description: "Recurring revenue tracking for clients",
    key_columns: ["id", "service_type", "monthly_amount", "annual_amount", "is_active"],
  },
}

export async function GET(request: NextRequest) {
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

// Get searchable columns for each table
function getSearchColumns(table: AllowedTable): string[] {
  const searchColumnsMap: Record<string, string[]> = {
    contacts: ["full_name", "first_name", "last_name", "primary_email", "employer"],
    organizations: ["name", "legal_name", "trading_name", "industry"],
    work_items: ["title", "description", "client_group_name", "assignee_name", "work_type"],
    team_members: ["full_name", "first_name", "last_name", "email", "role", "department"],
    debriefs: ["team_member", "organization_name", "notes", "debrief_type"],
    tasks: ["title", "description"],
    karbon_tasks: ["title", "description", "assignee_name"],
    karbon_notes: ["subject", "body", "author_name", "contact_name"],
    meeting_notes: ["client_name", "notes", "agenda"],
    invoices: ["invoice_number", "notes"],
    services: ["name", "description", "category"],
    client_groups: ["name", "description"],
    leads: ["first_name", "last_name", "email", "company_name"],
    tommy_award_ballots: ["voter_name", "first_place_name", "second_place_name"],
    tommy_award_points: ["team_member_name"],
    tommy_award_yearly_totals: ["team_member_name"],
  }

  return searchColumnsMap[table] || []
}

// POST endpoint for complex queries
export async function POST(request: NextRequest) {
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
    let aggregateResult = null
    if (aggregate) {
      const { count: doCount, sum, avg } = aggregate
      if (doCount) {
        const { count } = await supabase.from(table).select("*", { count: "exact", head: true })
        aggregateResult = { ...aggregateResult, count }
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
