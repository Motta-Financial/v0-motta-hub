import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Maps a Karbon TimeEntry (from $expand=TimeEntries on /Timesheets) to Supabase.
 * 
 * Karbon Timesheets API returns WEEK-level summaries:
 *   { TimesheetKey, UserKey, StartDate, EndDate, Status, TimeEntries: [...] }
 * 
 * Each TimeEntry inside has: WorkItemKey, TaskTypeName, RoleName, Minutes, HourlyRate, etc.
 * We flatten TimeEntries into our karbon_timesheets table (one row per entry).
 */
/**
 * entryIndex is the position of this TimeEntry within the parent's TimeEntries array.
 * Used to generate collision-free synthetic keys when TimeEntryKey is absent.
 */
function mapKarbonTimesheetToSupabase(entry: any, parentTimesheet?: any, entryIndex = 0) {
  // If this is a flattened time entry from $expand, use parent's UserKey/Status
  const userKey = entry.UserKey || parentTimesheet?.UserKey || null
  const userName = entry.UserName || parentTimesheet?.UserName || null

  // Build a collision-free key:
  //   1. Prefer the real TimeEntryKey if Karbon provides one
  //   2. Otherwise build a deterministic composite key from parent + date + work-item + index
  const entryDate = entry.Date ? entry.Date.split("T")[0] : "nodate"
  const timesheetKey =
    entry.TimeEntryKey ||
    entry.TimesheetKey ||
    `${parentTimesheet?.TimesheetKey || "ts"}-${entryDate}-${entry.WorkItemKey || "nowi"}-${entryIndex}`

  return {
    karbon_timesheet_key: timesheetKey,
    date: entry.Date ? entry.Date.split("T")[0] : (parentTimesheet?.StartDate ? parentTimesheet.StartDate.split("T")[0] : null),
    minutes: entry.Minutes || 0,
    description: entry.TaskTypeName || entry.Description || null,
    is_billable: entry.IsBillable ?? true,
    billing_status: entry.BillingStatus || parentTimesheet?.Status || null,
    hourly_rate: entry.HourlyRate || null,
    billed_amount: entry.HourlyRate && entry.Minutes ? ((entry.HourlyRate * entry.Minutes) / 60) : null,
    user_key: userKey,
    user_name: userName,
    karbon_work_item_key: entry.WorkItemKey || null,
    work_item_title: entry.WorkItemTitle || null,
    client_key: entry.ClientKey || null,
    client_name: entry.ClientName || null,
    task_key: entry.TaskTypeKey || entry.TaskKey || null,
    // New columns from migration 021
    role_name: entry.RoleName || null,
    task_type_name: entry.TaskTypeName || null,
    timesheet_status: parentTimesheet?.Status || entry.Status || null,
    karbon_url: parentTimesheet?.TimesheetKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/timesheets/${parentTimesheet.TimesheetKey}` : null,
    karbon_created_at: parentTimesheet?.StartDate || entry.CreatedDate || null,
    karbon_modified_at: parentTimesheet?.EndDate || entry.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

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
    const importToSupabase = searchParams.get("import") === "true"
    const incrementalSync = searchParams.get("incremental") === "true"

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

    // Karbon /Timesheets supports: $filter by StartDate, EndDate, UserKey, WorkItemKeys, Status
    // and $expand=TimeEntries to get the individual time entries
    const queryOptions: any = {
      count: true,
      orderby: "StartDate desc",
      expand: ["TimeEntries"],
    }

    // Get last sync timestamp for incremental sync
    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("karbon_timesheets")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
          filters.push(`StartDate gt ${lastSyncTimestamp}`)
        }
      }
    }

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    const { data: weeklyTimesheets, error, totalCount } = await karbonFetchAll<any>("/Timesheets", credentials, queryOptions)

    // Flatten: each weekly timesheet has TimeEntries[] - extract individual entries
    const timesheets: any[] = []
    for (const weeklyTs of weeklyTimesheets) {
      if (weeklyTs.TimeEntries && Array.isArray(weeklyTs.TimeEntries)) {
        weeklyTs.TimeEntries.forEach((entry: any, idx: number) => {
          timesheets.push({ ...entry, _parentTimesheet: weeklyTs, _entryIndex: idx })
        })
      } else {
        // If no expanded entries, treat the timesheet itself as a single entry
        timesheets.push(weeklyTs)
      }
    }

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    let importResult = null
    if (importToSupabase) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        importResult = { error: "Supabase not configured" }
      } else {
        let synced = 0
        let errors = 0
        const errorDetails: string[] = []

        const batchSize = 50
        for (let i = 0; i < timesheets.length; i += batchSize) {
          const batch = timesheets.slice(i, i + batchSize)
          const mappedBatch = batch.map((entry: any) => ({
            ...mapKarbonTimesheetToSupabase(entry, entry._parentTimesheet, entry._entryIndex || 0),
            created_at: new Date().toISOString(),
          }))

          const { error: upsertError } = await supabase.from("karbon_timesheets").upsert(mappedBatch, {
            onConflict: "karbon_timesheet_key",
            ignoreDuplicates: false,
          })

          if (upsertError) {
            errors += batch.length
            errorDetails.push(upsertError.message)
          } else {
            synced += batch.length
          }
        }

        importResult = {
          success: errors === 0,
          synced,
          errors,
          incrementalSync,
          lastSyncTimestamp,
          errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 5) : undefined,
        }
      }
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
      importResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon timesheets:", error)
    return NextResponse.json(
      { error: "Failed to fetch timesheets", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

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
