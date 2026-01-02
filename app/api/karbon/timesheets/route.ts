import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"

/**
 * GET /api/karbon/timesheets
 * Fetch timesheets from Karbon with optional filtering
 */
export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const userKey = searchParams.get("userKey")
    const workItemKey = searchParams.get("workItemKey")
    const clientKey = searchParams.get("clientKey")
    const dateFrom = searchParams.get("dateFrom")
    const dateTo = searchParams.get("dateTo")
    const top = searchParams.get("top")

    const filters: string[] = []

    if (userKey) {
      filters.push(`UserKey eq '${userKey}'`)
    }

    if (workItemKey) {
      filters.push(`WorkItemKey eq '${workItemKey}'`)
    }

    if (clientKey) {
      filters.push(`ClientKey eq '${clientKey}'`)
    }

    if (dateFrom) {
      filters.push(`Date ge ${dateFrom}`)
    }

    if (dateTo) {
      filters.push(`Date le ${dateTo}`)
    }

    const queryOptions: any = {
      count: true,
      orderby: "Date desc",
    }

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    const { data: timesheets, error, totalCount } = await karbonFetchAll<any>("/Timesheets", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    const mappedTimesheets = timesheets.map((entry: any) => ({
      TimesheetKey: entry.TimesheetKey,
      Date: entry.Date,
      Minutes: entry.Minutes,
      Hours: entry.Minutes ? (entry.Minutes / 60).toFixed(2) : 0,
      Description: entry.Description,
      IsBillable: entry.IsBillable,
      BillingStatus: entry.BillingStatus,
      HourlyRate: entry.HourlyRate,
      BilledAmount: entry.BilledAmount,
      User: entry.UserName
        ? {
            FullName: entry.UserName,
            UserKey: entry.UserKey,
          }
        : null,
      WorkItem: entry.WorkItemTitle
        ? {
            WorkItemKey: entry.WorkItemKey,
            Title: entry.WorkItemTitle,
          }
        : null,
      Client: entry.ClientName
        ? {
            ClientKey: entry.ClientKey,
            ClientName: entry.ClientName,
          }
        : null,
      TaskKey: entry.TaskKey,
      CreatedDate: entry.CreatedDate,
      ModifiedDate: entry.LastModifiedDateTime,
    }))

    // Calculate summary stats
    const totalMinutes = mappedTimesheets.reduce((sum: number, t: any) => sum + (t.Minutes || 0), 0)
    const billableMinutes = mappedTimesheets
      .filter((t: any) => t.IsBillable)
      .reduce((sum: number, t: any) => sum + (t.Minutes || 0), 0)

    return NextResponse.json({
      timesheets: mappedTimesheets,
      count: mappedTimesheets.length,
      totalCount: totalCount || mappedTimesheets.length,
      summary: {
        totalMinutes,
        totalHours: (totalMinutes / 60).toFixed(2),
        billableMinutes,
        billableHours: (billableMinutes / 60).toFixed(2),
        nonBillableMinutes: totalMinutes - billableMinutes,
        nonBillableHours: ((totalMinutes - billableMinutes) / 60).toFixed(2),
      },
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon timesheets:", error)
    return NextResponse.json(
      { error: "Failed to fetch timesheets", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/karbon/timesheets
 * Create a new timesheet entry
 */
export async function POST(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()

    const { data, error } = await karbonFetch<any>("/Timesheets", credentials, {
      method: "POST",
      body,
    })

    if (error) {
      return NextResponse.json({ error: `Failed to create timesheet: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, timesheet: data })
  } catch (error) {
    console.error("[v0] Error creating timesheet:", error)
    return NextResponse.json(
      { error: "Failed to create timesheet", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
