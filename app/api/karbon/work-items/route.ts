import { NextResponse } from "next/server"
import { categorizeServiceLine } from "@/lib/service-lines"

export async function GET() {
  console.log("[v0] Starting work items fetch...")

  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    console.log("[v0] Missing Karbon credentials")
    return NextResponse.json(
      {
        error:
          "Karbon API credentials not configured. Please add KARBON_ACCESS_KEY and KARBON_BEARER_TOKEN to your environment variables.",
        missingVars: {
          accessKey: !accessKey,
          bearerToken: !bearerToken,
        },
      },
      { status: 401 },
    )
  }

  try {
    let allWorkItems: any[] = []
    let nextUrl: string | null = "https://api.karbonhq.com/v3/WorkItems"
    let totalCount = 0
    let pageCount = 0
    const MAX_PAGES = 50 // Limit to 50 pages to prevent infinite loops

    console.log("[v0] Fetching work items from Karbon API...")

    while (nextUrl && pageCount < MAX_PAGES) {
      pageCount++
      console.log(`[v0] Fetching page ${pageCount}...`)

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)

        const response = await fetch(nextUrl, {
          method: "GET",
          headers: {
            AccessKey: accessKey,
            Authorization: `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          console.error("[v0] Karbon API error:", response.status, errorText)

          if (allWorkItems.length > 0) {
            console.log(`[v0] Returning ${allWorkItems.length} work items despite error on page ${pageCount}`)
            break
          }

          return NextResponse.json(
            {
              error: `Karbon API error: ${response.status} ${response.statusText}`,
              details: errorText,
            },
            { status: response.status },
          )
        }

        const data = await response.json()
        console.log(`[v0] Page ${pageCount} received, items: ${data.value?.length || 0}`)

        const pageItems = data.value || []
        allWorkItems = allWorkItems.concat(pageItems)

        // Store total count from first page
        if (totalCount === 0) {
          totalCount = data["@odata.count"] || 0
          console.log(`[v0] Total work items in Karbon: ${totalCount}`)
        }

        // Get next page URL if it exists
        nextUrl = data["@odata.nextLink"] || null

        if (nextUrl) {
          console.log(`[v0] Next page URL exists, continuing...`)
        } else {
          console.log(`[v0] No more pages, finished fetching`)
        }
      } catch (fetchError) {
        console.error(`[v0] Error fetching page ${pageCount}:`, fetchError)

        if (allWorkItems.length > 0) {
          console.log(`[v0] Returning ${allWorkItems.length} work items despite fetch error`)
          break
        }

        throw fetchError
      }
    }

    if (pageCount >= MAX_PAGES) {
      console.log(`[v0] Reached maximum page limit (${MAX_PAGES}), returning ${allWorkItems.length} work items`)
    }

    console.log(`[v0] Total work items fetched: ${allWorkItems.length}`)

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
      ModifiedDate: item.ModifiedDate || item.LastModifiedDate,
      AssignedTo: item.AssigneeName
        ? [
            {
              FullName: item.AssigneeName,
              Email: item.AssigneeEmailAddress,
              UserKey: item.AssigneeKey,
            },
          ]
        : [],
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
    }))

    console.log(`[v0] Successfully processed ${workItems.length} work items`)

    return NextResponse.json({
      workItems: workItems,
      count: workItems.length,
      totalCount: totalCount,
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
