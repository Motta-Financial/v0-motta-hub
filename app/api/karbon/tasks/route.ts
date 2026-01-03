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

function mapKarbonTaskToSupabase(task: any) {
  return {
    karbon_task_key: task.TaskKey,
    title: task.Title || null,
    description: task.Description || null,
    status: task.Status || null,
    priority: task.Priority || "Normal",
    due_date: task.DueDate ? task.DueDate.split("T")[0] : null,
    completed_date: task.CompletedDate ? task.CompletedDate.split("T")[0] : null,
    assignee_key: task.AssigneeKey || null,
    assignee_name: task.AssigneeName || null,
    assignee_email: task.AssigneeEmailAddress || null,
    karbon_work_item_key: task.WorkItemKey || null,
    karbon_contact_key: task.ContactKey || null,
    is_blocking: task.IsBlocking || false,
    estimated_minutes: task.EstimatedMinutes || null,
    actual_minutes: task.ActualMinutes || null,
    karbon_url: task.TaskKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/tasks/${task.TaskKey}` : null,
    karbon_created_at: task.CreatedDate || null,
    karbon_modified_at: task.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

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
    const importToSupabase = searchParams.get("import") === "true"
    const incrementalSync = searchParams.get("incremental") === "true"

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

    // Get last sync timestamp for incremental sync
    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("karbon_tasks")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
          filters.push(`LastModifiedDateTime gt ${lastSyncTimestamp}`)
        }
      }
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
        for (let i = 0; i < tasks.length; i += batchSize) {
          const batch = tasks.slice(i, i + batchSize)
          const mappedBatch = batch.map((task: any) => ({
            ...mapKarbonTaskToSupabase(task),
            created_at: new Date().toISOString(),
          }))

          const { error: upsertError } = await supabase.from("karbon_tasks").upsert(mappedBatch, {
            onConflict: "karbon_task_key",
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
      importResult,
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
