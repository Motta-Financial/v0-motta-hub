import { type NextRequest, NextResponse } from "next/server"
import { categorizeServiceLine } from "@/lib/service-lines"
import { getKarbonCredentials, karbonFetchAll } from "@/lib/karbon-api"

export async function GET(request: NextRequest) {
  console.log("[v0] Starting work items fetch...")

  const credentials = getKarbonCredentials()

  if (!credentials) {
    console.log("[v0] Missing Karbon credentials")
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

    // Build OData filter
    const filters: string[] = []

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

    if (modifiedAfter) {
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

    console.log("[v0] Fetching work items with query:", queryOptions)

    const { data: allWorkItems, error, totalCount } = await karbonFetchAll<any>("/WorkItems", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    console.log(`[v0] Total work items fetched: ${allWorkItems.length}`)

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

      // Count by WorkType
      const workTypeBreakdown: Record<string, number> = {}
      allWorkItems.forEach((item: any) => {
        const wt = item.WorkType || "Unknown"
        workTypeBreakdown[wt] = (workTypeBreakdown[wt] || 0) + 1
      })

      // Count by PrimaryStatus
      const statusBreakdown: Record<string, number> = {}
      allWorkItems.forEach((item: any) => {
        const ps = item.PrimaryStatus || "Unknown"
        statusBreakdown[ps] = (statusBreakdown[ps] || 0) + 1
      })

      // Sample raw item for field inspection
      const sampleRawItems = allWorkItems.slice(0, 3).map((item: any) => ({
        ...item,
        _availableFields: Object.keys(item),
      }))

      console.log("[v0] === KARBON DATA ANALYSIS ===")
      console.log("[v0] Unique WorkTypes:", uniqueWorkTypes)
      console.log("[v0] WorkType Breakdown:", workTypeBreakdown)
      console.log("[v0] Unique PrimaryStatuses:", uniquePrimaryStatuses)
      console.log("[v0] Status Breakdown:", statusBreakdown)
      console.log("[v0] Unique SecondaryStatuses:", uniqueSecondaryStatuses)
      console.log("[v0] Unique WorkStatuses:", uniqueWorkStatuses)
      console.log("[v0] Unique Assignees:", uniqueAssignees)
      console.log("[v0] Total Unique Clients:", uniqueClients.length)
      console.log("[v0] Total Unique Client Groups:", uniqueClientGroups.length)
      console.log("[v0] Sample raw item fields:", sampleRawItems[0]?._availableFields)

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
          uniqueClients: uniqueClients.slice(0, 50), // Limit for response size
          totalUniqueClients: uniqueClients.length,
          uniqueClientGroups,
          totalUniqueClientGroups: uniqueClientGroups.length,
          sampleRawItems,
        },
      })
    }

    // Map all work items to our format
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

    console.log(`[v0] Successfully processed ${workItems.length} work items`)

    return NextResponse.json({
      workItems: workItems,
      count: workItems.length,
      totalCount: totalCount || workItems.length,
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
