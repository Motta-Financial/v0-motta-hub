import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"

/**
 * GET /api/karbon/work-items/[workItemKey]/tasks
 * Fetch all tasks for a specific work item
 */
export async function GET(request: NextRequest, { params }: { params: { workItemKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { workItemKey } = params

    const { data: tasks, error } = await karbonFetchAll<any>(`/WorkItems/${workItemKey}/Tasks`, credentials, {
      orderby: "SortOrder asc",
    })

    // If tasks endpoint returns 404 or error, return empty array (not all work items have tasks)
    if (error) {
      const errorLower = error.toLowerCase()
      if (errorLower.includes("404") || errorLower.includes("not found") || errorLower.includes("resource")) {
        return NextResponse.json({
          tasks: [],
          count: 0,
          workItemKey,
        })
      }
      return NextResponse.json({ error: `Failed to fetch work item tasks: ${error}` }, { status: 500 })
    }
    
    // Handle case where tasks is undefined or null
    if (!tasks) {
      return NextResponse.json({
        tasks: [],
        count: 0,
        workItemKey,
      })
    }

    const mappedTasks = tasks.map((task: any) => ({
      TaskKey: task.TaskKey,
      WorkItemTaskKey: task.WorkItemTaskKey,
      Title: task.Title,
      Description: task.Description,
      Status: task.Status,
      IsComplete: task.IsComplete,
      DueDate: task.DueDate,
      CompletedDate: task.CompletedDate,
      SortOrder: task.SortOrder,
      AssignedTo: task.AssigneeName
        ? {
            FullName: task.AssigneeName,
            Email: task.AssigneeEmailAddress,
            UserKey: task.AssigneeKey,
          }
        : null,
      EstimatedMinutes: task.EstimatedMinutes,
      ActualMinutes: task.ActualMinutes,
    }))

    return NextResponse.json({
      tasks: mappedTasks,
      count: mappedTasks.length,
      workItemKey,
    })
  } catch (error) {
    // Handle 404 errors gracefully - not all work items have tasks
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorLower = errorMessage.toLowerCase()
    if (errorLower.includes("404") || errorLower.includes("not found") || errorLower.includes("resource")) {
      return NextResponse.json({
        tasks: [],
        count: 0,
        workItemKey: params.workItemKey,
      })
    }
    
    console.error("[v0] Error fetching work item tasks:", error)
    return NextResponse.json(
      { error: "Failed to fetch work item tasks", details: errorMessage },
      { status: 500 },
    )
  }
}

/**
 * POST /api/karbon/work-items/[workItemKey]/tasks
 * Add a task to a work item
 */
export async function POST(request: NextRequest, { params }: { params: { workItemKey: string } }) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { workItemKey } = params
    const body = await request.json()

    const { data, error } = await karbonFetch<any>(`/WorkItems/${workItemKey}/Tasks`, credentials, {
      method: "POST",
      body,
    })

    if (error) {
      return NextResponse.json({ error: `Failed to create work item task: ${error}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error("[v0] Error creating work item task:", error)
    return NextResponse.json(
      { error: "Failed to create work item task", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
