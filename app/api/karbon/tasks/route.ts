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
 * Maps Karbon IntegrationTask to Supabase karbon_tasks table.
 * 
 * Karbon API: /v3/IntegrationTasks (NOT /v3/Tasks which doesn't exist)
 * Fields: IntegrationTaskKey, TaskDefinitionKey, WorkItemKey, WorkItemClientKey,
 *         Status, CreatedAt, UpdatedAt, Data (JSON object with custom fields)
 */
function mapKarbonTaskToSupabase(task: any) {
  // IntegrationTasks have a different shape than the fictional /Tasks endpoint
  const taskKey = task.IntegrationTaskKey || task.TaskKey
  return {
    karbon_task_key: taskKey,
    task_definition_key: task.TaskDefinitionKey || null,
    title: task.Data?.Title || task.Title || null,
    description: task.Data?.Description || task.Description || null,
    status: task.Status || null,
    priority: task.Data?.Priority || task.Priority || "Normal",
    due_date: task.Data?.DueDate ? task.Data.DueDate.split("T")[0] : (task.DueDate ? task.DueDate.split("T")[0] : null),
    completed_date: task.Data?.CompletedDate ? task.Data.CompletedDate.split("T")[0] : (task.CompletedDate ? task.CompletedDate.split("T")[0] : null),
    assignee_key: task.Data?.AssigneeKey || task.AssigneeKey || null,
    assignee_name: task.Data?.AssigneeName || task.AssigneeName || null,
    assignee_email: task.Data?.AssigneeEmailAddress || task.AssigneeEmailAddress || null,
    karbon_work_item_key: task.WorkItemKey || null,
    karbon_contact_key: task.WorkItemClientKey || task.ContactKey || null,
    is_blocking: task.Data?.IsBlocking || false,
    estimated_minutes: task.Data?.EstimatedMinutes || null,
    actual_minutes: task.Data?.ActualMinutes || null,
    task_data: task.Data || null,
    karbon_url: taskKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/tasks/${taskKey}` : null,
    karbon_created_at: task.CreatedAt || task.CreatedDate || null,
    karbon_modified_at: task.UpdatedAt || task.LastModifiedDateTime || null,
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

    // IntegrationTasks supports: CreatedAt, TaskDefinitionKey, WorkItemKey, WorkItemClientKey
    if (assigneeKey) {
      // IntegrationTasks doesn't support direct AssigneeKey filter
      // We filter client-side after fetch, or use WorkItemClientKey
      filters.push(`WorkItemClientKey eq '${assigneeKey}'`)
    }

    if (status) {
      filters.push(`Status eq '${status}'`)
    }

    if (dueBefore) {
      filters.push(`CreatedAt lt ${dueBefore}`)
    }

    if (dueAfter) {
      filters.push(`CreatedAt ge ${dueAfter}`)
    }

    const queryOptions: any = {
      count: true,
      orderby: "CreatedAt desc",
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
          filters.push(`CreatedAt gt ${lastSyncTimestamp}`)
        }
      }
    }

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    // Correct Karbon endpoint: /IntegrationTasks (not /Tasks)
    const { data: tasks, error, totalCount } = await karbonFetchAll<any>("/IntegrationTasks", credentials, queryOptions)

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
      TaskKey: task.IntegrationTaskKey || task.TaskKey,
      TaskDefinitionKey: task.TaskDefinitionKey,
      Title: task.Data?.Title || task.Title,
      Description: task.Data?.Description || task.Description,
      Status: task.Status,
      DueDate: task.Data?.DueDate || task.DueDate,
      CompletedDate: task.Data?.CompletedDate || task.CompletedDate,
      AssignedTo: (task.Data?.AssigneeName || task.AssigneeName)
        ? {
            FullName: task.Data?.AssigneeName || task.AssigneeName,
            Email: task.Data?.AssigneeEmailAddress || task.AssigneeEmailAddress,
            UserKey: task.Data?.AssigneeKey || task.AssigneeKey,
          }
        : null,
      Priority: task.Data?.Priority || task.Priority,
      WorkItemKey: task.WorkItemKey,
      WorkItemClientKey: task.WorkItemClientKey,
      CreatedDate: task.CreatedAt || task.CreatedDate,
      ModifiedDate: task.UpdatedAt || task.LastModifiedDateTime,
      Data: task.Data,
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

    const { data, error } = await karbonFetch<any>("/IntegrationTasks", credentials, {
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
