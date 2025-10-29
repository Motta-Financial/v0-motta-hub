import { NextResponse } from "next/server"
import { categorizeServiceLine } from "@/lib/service-lines"

export async function GET() {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
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

    // Loop through all pages
    while (nextUrl) {
      const response = await fetch(nextUrl, {
        method: "GET",
        headers: {
          AccessKey: accessKey,
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[v0] Karbon API error:", response.status, errorText)
        return NextResponse.json(
          {
            error: `Karbon API error: ${response.status} ${response.statusText}`,
            details: errorText,
          },
          { status: response.status },
        )
      }

      const data = await response.json()
      const pageItems = data.value || []
      allWorkItems = allWorkItems.concat(pageItems)

      // Store total count from first page
      if (totalCount === 0) {
        totalCount = data["@odata.count"] || 0
      }

      // Get next page URL if it exists
      nextUrl = data["@odata.nextLink"] || null
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
