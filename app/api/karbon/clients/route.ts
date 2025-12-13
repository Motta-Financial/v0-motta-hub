import { NextResponse } from "next/server"
import { categorizeServiceLine } from "@/lib/service-lines"

export async function GET() {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  console.log("[v0] Starting clients fetch...")
  console.log("[v0] Access Key exists:", !!accessKey)
  console.log("[v0] Bearer Token exists:", !!bearerToken)

  if (!accessKey || !bearerToken) {
    console.error("[v0] Missing Karbon API credentials")
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    // Fetch all work items
    let allWorkItems: any[] = []
    let nextLink = "https://api.karbonhq.com/v3/WorkItems"
    let pageCount = 0
    const MAX_PAGES = 50 // Limit to prevent infinite loops and timeouts

    console.log("[v0] Starting to fetch work items...")

    while (nextLink && pageCount < MAX_PAGES) {
      pageCount++
      console.log(`[v0] Fetching page ${pageCount}...`)

      try {
        const response = await fetch(nextLink, {
          headers: {
            AccessKey: accessKey,
            Authorization: `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(60000), // 60 second timeout per request
        })

        console.log(`[v0] Page ${pageCount} response status:`, response.status)

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`[v0] Karbon API error on page ${pageCount}:`, response.status, errorText)
          if (allWorkItems.length > 0) {
            console.log(`[v0] Continuing with ${allWorkItems.length} items fetched so far`)
            break
          }
          throw new Error(`Karbon API error: ${response.status} - ${errorText}`)
        }

        const data = await Promise.race([
          response.json(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("JSON parsing timeout")), 30000)),
        ]).catch((jsonError) => {
          console.error(`[v0] Error parsing JSON on page ${pageCount}:`, jsonError.message)
          // If JSON parsing fails but we have data, continue with what we have
          if (allWorkItems.length > 0) {
            console.log(`[v0] JSON parsing failed, continuing with ${allWorkItems.length} items`)
            return null
          }
          throw jsonError
        })

        if (!data) {
          break
        }

        const itemsInPage = data.value?.length || 0
        console.log(`[v0] Page ${pageCount} returned ${itemsInPage} items`)

        allWorkItems = allWorkItems.concat(data.value || [])
        nextLink = data["@odata.nextLink"]

        if (nextLink) {
          console.log(`[v0] Next link exists, continuing...`)
        } else {
          console.log(`[v0] No more pages, finished fetching`)
        }
      } catch (fetchError: any) {
        console.error(`[v0] Error fetching page ${pageCount}:`, fetchError.message)
        if (allWorkItems.length >= 1000) {
          console.log(`[v0] Continuing with ${allWorkItems.length} items fetched so far`)
          break
        }
        throw fetchError
      }
    }

    if (pageCount >= MAX_PAGES) {
      console.log(`[v0] Reached max pages limit (${MAX_PAGES}), stopping pagination`)
    }

    console.log(`[v0] Successfully fetched ${allWorkItems.length} work items across ${pageCount} pages`)

    const prospectWorkItems = allWorkItems.filter((item) => item.Title && item.Title.toUpperCase().includes("PROSPECT"))
    console.log("[v0] Total work items:", allWorkItems.length)
    console.log("[v0] Prospect work items found:", prospectWorkItems.length)
    if (prospectWorkItems.length > 0) {
      console.log(
        "[v0] Sample prospect work items:",
        prospectWorkItems.slice(0, 3).map((item) => ({
          title: item.Title,
          client: item.ClientName,
          clientKey: item.ClientKey,
        })),
      )
    }

    // Create clients map from work items only
    const clientsMap = new Map()
    const clientGroupsMap = new Map()

    allWorkItems.forEach((item: any) => {
      if (item.ClientKey && item.ClientName) {
        // Get or create client entry
        if (!clientsMap.has(item.ClientKey)) {
          clientsMap.set(item.ClientKey, {
            clientKey: item.ClientKey,
            clientName: item.ClientName,
            clientGroup: item.RelatedClientGroupName || null,
            clientGroupKey: item.ClientGroupKey || null,
            workItemCount: 0,
            activeWorkItems: 0,
            completedWorkItems: 0,
            lastActivity: null,
            serviceLinesUsed: new Set(),
            relatedClients: [],
            isProspect: false,
            hasProspectWorkItems: false,
            avatarUrl: null, // Added avatarUrl field
          })
        }

        const client = clientsMap.get(item.ClientKey)
        client.workItemCount++

        // Update client group info if available
        if (item.RelatedClientGroupName) {
          client.clientGroup = item.RelatedClientGroupName
        }
        if (item.ClientGroupKey) {
          client.clientGroupKey = item.ClientGroupKey
        }

        // Count active vs completed work items
        if (item.PrimaryStatus === "Completed") {
          client.completedWorkItems++
        } else if (
          item.PrimaryStatus === "In Progress" ||
          item.PrimaryStatus === "Ready To Start" ||
          item.PrimaryStatus === "Waiting" ||
          item.PrimaryStatus === "Planned"
        ) {
          client.activeWorkItems++
        }

        if (item.ModifiedDate) {
          const modifiedDate = new Date(item.ModifiedDate)
          if (!client.lastActivity || modifiedDate > new Date(client.lastActivity)) {
            client.lastActivity = item.ModifiedDate
          }
        }

        // Categorize service line and check if it's a prospect work item
        const serviceLine = categorizeServiceLine(item.Title, item.ClientName)
        if (serviceLine) {
          if (serviceLine === "PROSPECTS") {
            client.hasProspectWorkItems = true
            client.isProspect = true
          } else if (serviceLine !== "OTHER") {
            client.serviceLinesUsed.add(serviceLine)
          }
        }

        // Track client groups for related clients
        if (item.ClientGroupKey && item.RelatedClientGroupName) {
          if (!clientGroupsMap.has(item.ClientGroupKey)) {
            clientGroupsMap.set(item.ClientGroupKey, {
              clientGroupKey: item.ClientGroupKey,
              clientGroupName: item.RelatedClientGroupName,
              members: new Set(),
            })
          }
          clientGroupsMap.get(item.ClientGroupKey).members.add(item.ClientKey)
        }
      }
    })

    // Build related clients relationships from client groups
    clientGroupsMap.forEach((group) => {
      const memberKeys = Array.from(group.members)
      memberKeys.forEach((clientKey) => {
        const client = clientsMap.get(clientKey)
        if (client) {
          client.relatedClients = memberKeys
            .filter((key) => key !== clientKey)
            .map((key) => ({
              clientKey: key,
              clientName: clientsMap.get(key)?.clientName || "Unknown",
            }))
        }
      })
    })

    // Convert to array and format
    const clients = Array.from(clientsMap.values()).map((client) => ({
      ...client,
      serviceLinesUsed: Array.from(client.serviceLinesUsed),
    }))

    const prospectClients = clients.filter((c) => c.isProspect)
    console.log("[v0] Total clients:", clients.length)
    console.log("[v0] Prospect clients:", prospectClients.length)
    if (prospectClients.length > 0) {
      console.log(
        "[v0] Sample prospect clients:",
        prospectClients.slice(0, 3).map((c) => ({
          name: c.clientName,
          workItems: c.workItemCount,
          hasProspectWorkItems: c.hasProspectWorkItems,
        })),
      )
    }

    // Sort by last activity (most recent first), then by name
    clients.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return a.clientName.localeCompare(b.clientName)
      if (!a.lastActivity) return 1
      if (!b.lastActivity) return -1
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    })

    console.log("[v0] Successfully returning", clients.length, "clients")
    return NextResponse.json({ clients, totalCount: clients.length })
  } catch (error: any) {
    console.error("[v0] Error fetching clients:", error)
    console.error("[v0] Error name:", error.name)
    console.error("[v0] Error message:", error.message)
    console.error("[v0] Error stack:", error.stack)
    return NextResponse.json(
      {
        error: "Failed to fetch clients from Karbon",
        details: error.message,
        errorType: error.name,
      },
      { status: 500 },
    )
  }
}
