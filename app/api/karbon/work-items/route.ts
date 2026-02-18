import { type NextRequest, NextResponse } from "next/server"
import { categorizeServiceLine } from "@/lib/service-lines"
import { getKarbonCredentials, karbonFetchAll } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey)
}

function parseTaxYear(item: any): number | null {
  // First try the explicit TaxYear field
  if (item.TaxYear) return item.TaxYear
  // Parse from YearEnd (e.g. "2024-12-31T00:00:00")
  if (item.YearEnd) {
    const year = new Date(item.YearEnd).getFullYear()
    if (year > 2000 && year < 2100) return year
  }
  // Parse from title (e.g. "TAX | Individual (1040) - Smith, John - 2024")
  if (item.Title) {
    const match = item.Title.match(/\b(20\d{2})\b/)
    if (match) return parseInt(match[1], 10)
  }
  return null
}

function mapKarbonToSupabase(item: any) {
  // Extract fee settings
  const feeSettings = item.FeeSettings || {}

  return {
    // Core identifiers
    karbon_work_item_key: item.WorkItemKey,
    karbon_client_key: item.ClientKey || null,

    // Client information
    client_type: item.ClientType || null,
    client_name: item.ClientName || null,

    // Client owner information
    client_owner_key: item.ClientOwnerKey || null,
    client_owner_name: item.ClientOwnerName || null,

    // Client group information (use correct column names)
    client_group_key: item.RelatedClientGroupKey || item.ClientGroupKey || null,
    client_group_name: item.RelatedClientGroupName || null,

    // Assignee information (no email column exists)
    assignee_key: item.AssigneeKey || null,
    assignee_name: item.AssigneeName || null,

    // Client manager information
    client_manager_key: item.ClientManagerKey || null,
    client_manager_name: item.ClientManagerName || null,

    // Client partner information
    client_partner_key: item.ClientPartnerKey || null,
    client_partner_name: item.ClientPartnerName || null,

    // Work item details
    title: item.Title || null,
    description: item.Description || null,
    work_type: item.WorkType || null,

    // Status fields
    workflow_status: item.WorkStatus || null,
    status: item.PrimaryStatus || null,
    status_code: item.SecondaryStatus || null,
    primary_status: item.PrimaryStatus || null,
    secondary_status: item.SecondaryStatus || null,
    work_status_key: item.WorkStatusKey || null,

    // User-defined identifier
    user_defined_identifier: item.UserDefinedIdentifier || null,

    // Date fields (only columns that exist)
    start_date: item.StartDate ? item.StartDate.split("T")[0] : null,
    due_date: item.DueDate ? item.DueDate.split("T")[0] : null,
    completed_date: item.CompletedDate ? item.CompletedDate.split("T")[0] : null,
    year_end: item.YearEnd ? item.YearEnd.split("T")[0] : null,
    tax_year: parseTaxYear(item),
    period_start: item.PeriodStart ? item.PeriodStart.split("T")[0] : null,
    period_end: item.PeriodEnd ? item.PeriodEnd.split("T")[0] : null,
    internal_due_date: item.InternalDueDate ? item.InternalDueDate.split("T")[0] : null,
    regulatory_deadline: item.RegulatoryDeadline ? item.RegulatoryDeadline.split("T")[0] : null,
    client_deadline: item.ClientDeadline ? item.ClientDeadline.split("T")[0] : null,
    extension_date: item.ExtensionDate ? item.ExtensionDate.split("T")[0] : null,

    // Template information
    work_template_key: item.WorkTemplateKey || null,
    work_template_name: item.WorkTemplateTitle || item.WorkTemplateTile || null,

    // Fee settings
    fee_type: feeSettings.FeeType || null,
    estimated_fee: feeSettings.FeeValue || null,
    fixed_fee_amount: feeSettings.FeeType === "Fixed" ? feeSettings.FeeValue : null,
    hourly_rate: feeSettings.FeeType === "Hourly" ? feeSettings.FeeValue : null,

    // Time/budget tracking
    estimated_minutes: item.EstimatedBudgetMinutes || null,
    actual_minutes: item.ActualBudget || null,
    billable_minutes: item.BillableTime || null,
    budget_minutes: item.Budget?.BudgetedHours ? Math.round(item.Budget.BudgetedHours * 60) : null,
    budget_hours: item.Budget?.BudgetedHours || null,
    budget_amount: item.Budget?.BudgetedAmount || null,
    actual_hours: item.ActualHours || null,
    actual_amount: item.ActualAmount || null,
    actual_fee: item.ActualFee || null,

    // Todo tracking
    todo_count: item.TodoCount || 0,
    completed_todo_count: item.CompletedTodoCount || 0,
    has_blocking_todos: item.HasBlockingTodos || false,

    // Other fields
    priority: item.Priority || "Normal",
    tags: item.Tags || [],
    is_recurring: item.IsRecurring ?? false,
    is_billable: item.IsBillable ?? true,
    is_internal: item.IsInternal ?? false,
    notes: item.Notes || null,
    custom_fields: item.CustomFields || {},
    related_work_keys: item.RelatedWorkKeys || [],

    // Karbon URL and sync timestamps
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/work/${item.WorkItemKey}`,
    karbon_created_at: item.CreatedDate || item.CreatedDateTime || null,
    karbon_modified_at: item.LastModifiedDateTime || item.ModifiedDate || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

async function linkWorkItemsToClients(supabase: any) {
  const results = { linked: 0, errors: 0 }

  // Link work items where client_type is 'Contact'
  const { data: workItemsWithContacts } = await supabase
    .from("work_items")
    .select("id, karbon_client_key")
    .eq("client_type", "Contact")
    .is("contact_id", null)
    .not("karbon_client_key", "is", null)

  if (workItemsWithContacts && workItemsWithContacts.length > 0) {
    for (const workItem of workItemsWithContacts) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id")
        .eq("karbon_contact_key", workItem.karbon_client_key)
        .maybeSingle()

      if (contact) {
        const { error } = await supabase.from("work_items").update({ contact_id: contact.id }).eq("id", workItem.id)

        if (!error) results.linked++
        else results.errors++
      }
    }
  }

  // Link work items where client_type is 'Organization'
  const { data: workItemsWithOrgs } = await supabase
    .from("work_items")
    .select("id, karbon_client_key")
    .eq("client_type", "Organization")
    .is("organization_id", null)
    .not("karbon_client_key", "is", null)

  if (workItemsWithOrgs && workItemsWithOrgs.length > 0) {
    for (const workItem of workItemsWithOrgs) {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("karbon_organization_key", workItem.karbon_client_key)
        .maybeSingle()

      if (org) {
        const { error } = await supabase.from("work_items").update({ organization_id: org.id }).eq("id", workItem.id)

        if (!error) results.linked++
        else results.errors++
      }
    }
  }

  return results
}

export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json(
      {
        error:
          "Karbon API credentials not configured. Please add KARBON_ACCESS_KEY and KARBON_BEARER_TOKEN to your environment variables.",
        missingVars: {
          accessKey: true,
          bearerToken: true,
        },
      },
      { status: 401 },
    )
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const workType = searchParams.get("workType")
    const status = searchParams.get("status")
    const clientKey = searchParams.get("clientKey")
    const assigneeKey = searchParams.get("assigneeKey")
    const dueBefore = searchParams.get("dueBefore")
    const dueAfter = searchParams.get("dueAfter")
    const modifiedAfter = searchParams.get("modifiedAfter")
    const top = searchParams.get("top")
    const skip = searchParams.get("skip")
    const orderby = searchParams.get("orderby")
    const expand = searchParams.get("expand")
    const debug = searchParams.get("debug")
    const importToSupabase = searchParams.get("import") === "true"
    const linkRecords = searchParams.get("link") === "true"
    const incrementalSync = searchParams.get("incremental") === "true"

    const filters: string[] = []

    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("work_items")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
        }
      }
    }

    if (workType) {
      const types = workType.split(",").map((t) => t.trim())
      if (types.length === 1) {
        filters.push(`WorkType eq '${types[0]}'`)
      } else {
        const typeFilters = types.map((t) => `WorkType eq '${t}'`).join(" or ")
        filters.push(`(${typeFilters})`)
      }
    }

    if (status) {
      const statuses = status.split(",").map((s) => s.trim())
      if (statuses.length === 1) {
        filters.push(`PrimaryStatus eq '${statuses[0]}'`)
      } else {
        const statusFilters = statuses.map((s) => `PrimaryStatus eq '${s}'`).join(" or ")
        filters.push(`(${statusFilters})`)
      }
    }

    if (clientKey) {
      filters.push(`ClientKey eq '${clientKey}'`)
    }

    if (assigneeKey) {
      filters.push(`AssigneeKey eq '${assigneeKey}'`)
    }

    if (dueBefore) {
      filters.push(`DueDate lt ${dueBefore}`)
    }

    if (dueAfter) {
      filters.push(`DueDate ge ${dueAfter}`)
    }

    if (lastSyncTimestamp) {
      filters.push(`LastModifiedDateTime gt ${lastSyncTimestamp}`)
    } else if (modifiedAfter) {
      filters.push(`LastModifiedDateTime ge ${modifiedAfter}`)
    }

    const queryOptions: any = {}

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    if (skip) {
      queryOptions.skip = Number.parseInt(skip, 10)
    }

    if (orderby) {
      queryOptions.orderby = orderby
    }

    if (expand) {
      queryOptions.expand = expand.split(",")
    }

    const { data: allWorkItems, error, totalCount } = await karbonFetchAll<any>("/WorkItems", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    let importResult = null
    let linkResult = null

    if (importToSupabase) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        importResult = { error: "Supabase not configured" }
      } else {
        let synced = 0
        let errors = 0
        const skipped = 0
        const errorDetails: string[] = []

        const batchSize = 50
        for (let i = 0; i < allWorkItems.length; i += batchSize) {
          const batch = allWorkItems.slice(i, i + batchSize)
          const mappedBatch = batch.map((item: any) => ({
            ...mapKarbonToSupabase(item),
            created_at: new Date().toISOString(),
          }))

          const { error: upsertError } = await supabase.from("work_items").upsert(mappedBatch, {
            onConflict: "karbon_work_item_key",
            ignoreDuplicates: false,
          })

          if (upsertError) {
            console.error("[v0] Batch upsert error:", upsertError)
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
          skipped,
          incrementalSync,
          lastSyncTimestamp,
          errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 5) : undefined,
        }

        if (errors === 0) {
          linkResult = await linkWorkItemsToClients(supabase)
        }
      }
    }

    if (debug === "true") {
      const uniqueWorkTypes = [...new Set(allWorkItems.map((item: any) => item.WorkType).filter(Boolean))]
      const uniquePrimaryStatuses = [...new Set(allWorkItems.map((item: any) => item.PrimaryStatus).filter(Boolean))]
      const uniqueSecondaryStatuses = [
        ...new Set(allWorkItems.map((item: any) => item.SecondaryStatus).filter(Boolean)),
      ]
      const uniqueWorkStatuses = [...new Set(allWorkItems.map((item: any) => item.WorkStatus).filter(Boolean))]
      const uniqueAssignees = [...new Set(allWorkItems.map((item: any) => item.AssigneeName).filter(Boolean))]
      const uniqueClients = [...new Set(allWorkItems.map((item: any) => item.ClientName).filter(Boolean))]
      const uniqueClientGroups = [
        ...new Set(allWorkItems.map((item: any) => item.RelatedClientGroupName).filter(Boolean)),
      ]

      const workTypeBreakdown: Record<string, number> = {}
      allWorkItems.forEach((item: any) => {
        const wt = item.WorkType || "Unknown"
        workTypeBreakdown[wt] = (workTypeBreakdown[wt] || 0) + 1
      })

      const statusBreakdown: Record<string, number> = {}
      allWorkItems.forEach((item: any) => {
        const ps = item.PrimaryStatus || "Unknown"
        statusBreakdown[ps] = (statusBreakdown[ps] || 0) + 1
      })

      const sampleRawItems = allWorkItems.slice(0, 3).map((item: any) => ({
        ...item,
        _availableFields: Object.keys(item),
      }))

      return NextResponse.json({
        analysis: {
          totalWorkItems: allWorkItems.length,
          uniqueWorkTypes,
          workTypeBreakdown,
          uniquePrimaryStatuses,
          statusBreakdown,
          uniqueSecondaryStatuses,
          uniqueWorkStatuses,
          uniqueAssignees,
          uniqueClients: uniqueClients.slice(0, 50),
          totalUniqueClients: uniqueClients.length,
          uniqueClientGroups,
          totalUniqueClientGroups: uniqueClientGroups.length,
          sampleRawItems,
        },
        importResult,
        linkResult,
        syncInfo: {
          incrementalSync,
          lastSyncTimestamp,
          itemsFetched: allWorkItems.length,
        },
      })
    }

    const workItems = allWorkItems.map((item: any) => ({
      WorkKey: item.WorkItemKey,
      Title: item.Title,
      ServiceLine: categorizeServiceLine(item.Title, item.ClientName),
      WorkStatus: item.WorkStatus || "Unknown",
      PrimaryStatus: item.PrimaryStatus || "Unknown",
      SecondaryStatus: item.SecondaryStatus,
      WorkType: item.WorkType || "Unknown",
      ClientName: item.ClientName,
      ClientKey: item.ClientKey,
      ClientGroup: item.RelatedClientGroupName,
      ClientGroupKey: item.ClientGroupKey,
      DueDate: item.DueDate,
      DeadlineDate: item.DeadlineDate,
      StartDate: item.StartDate,
      CompletedDate: item.CompletedDate,
      ModifiedDate: item.ModifiedDate || item.LastModifiedDateTime,
      AssignedTo: item.AssigneeName
        ? {
            FullName: item.AssigneeName,
            Email: item.AssigneeEmailAddress,
            UserKey: item.AssigneeKey,
          }
        : null,
      Priority: item.Priority || "Normal",
      Description: item.Description || "",
      UserRoleAssignments: item.UserRoleAssignments || [],
      FeeSettings: item.FeeSettings
        ? {
            FeeType: item.FeeSettings.FeeType,
            FeeValue: item.FeeSettings.FeeValue,
          }
        : undefined,
      Budget: item.Budget
        ? {
            BudgetedHours: item.Budget.BudgetedHours,
            BudgetedAmount: item.Budget.BudgetedAmount,
          }
        : undefined,
      Tags: item.Tags || [],
      CustomFields: item.CustomFields || {},
      WorkItemTypeKey: item.WorkItemTypeKey,
      PermaKey: item.PermaKey,
      CreatedDate: item.CreatedDate,
      EstimatedBudgetMinutes: item.EstimatedBudgetMinutes,
      EstimatedCompletionDate: item.EstimatedCompletionDate,
    }))

    return NextResponse.json({
      workItems: workItems,
      count: workItems.length,
      totalCount: totalCount || workItems.length,
      importResult,
      linkResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon work items:", error)

    return NextResponse.json(
      {
        error: "Failed to fetch work items from Karbon",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
