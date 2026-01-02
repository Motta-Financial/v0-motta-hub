import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"

/**
 * GET /api/karbon/tasks
 * Fetch tasks from Karbon with optional filtering
 */
export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const assigneeKey = searchParams.get("assigneeKey")
    const status = searchParams.get("status")
    const dueBefore = searchParams.get("dueBefore")
    const dueAfter = searchParams.get("dueAfter")
    const top = searchParams.get("top")

    const filters: string[] = []

    if (assigneeKey) {
      filters.push(`AssigneeKey eq '${assigneeKey}'`)
    }

    if (status) {
      filters.push(`Status eq '${status}'`)
    }

    if (dueBefore) {
      filters.push(`DueDate lt ${dueBefore}`)
    }

    if (dueAfter) {
      filters.push(`DueDate ge ${dueAfter}`)
    }

    const queryOptions: any = {
      count: true,
      orderby: "DueDate asc",
    }

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    const { data: tasks, error, totalCount } = await karbonFetchAll<any>("/Tasks", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    const mappedTasks = tasks.map((task: any) => ({
      TaskKey: task.TaskKey,
      Title: task.Title,
      Description: task.Description,
      Status: task.Status,
      DueDate: task.DueDate,
      CompletedDate: task.CompletedDate,
      AssignedTo: task.AssigneeName
        ? {
            FullName: task.AssigneeName,
            Email: task.AssigneeEmailAddress,
            UserKey: task.AssigneeKey,
          }
        : null,
      Priority: task.Priority,
      WorkItemKey: task.WorkItemKey,
      ContactKey: task.ContactKey,
      CreatedDate: task.CreatedDate,
      ModifiedDate: task.LastModifiedDateTime,
    }))

    return NextResponse.json({
      tasks: mappedTasks,
      count: mappedTasks.length,
      totalCount: totalCount || mappedTasks.length,
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon tasks:", error)
    return NextResponse.json(
      { error: "Failed to fetch tasks", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/karbon/tasks
 * Create a new task in Karbon
 */
export async function POST(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const body = await request.json()

    const { data, error } = await karbonFetch<any>("/Tasks", credentials, {
      method: "POST",
      body,
    })

    if (error) {
      return NextResponse.json({ error: `Failed to create task: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error("[v0] Error creating task:", error)
    return NextResponse.json(
      { error: "Failed to create task", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
