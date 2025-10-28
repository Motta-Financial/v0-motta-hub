import { NextResponse } from "next/server"
import { categorizeServiceLine } from "@/lib/service-lines"

export async function GET() {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    // Fetch all work items
    let allWorkItems: any[] = []
    let nextLink = "https://api.karbonhq.com/v3/WorkItems"

    while (nextLink) {
      const response = await fetch(nextLink, {
        headers: {
          AccessKey: accessKey,
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Karbon API error: ${response.status}`)
      }

      const data = await response.json()
      allWorkItems = allWorkItems.concat(data.value || [])
      nextLink = data["@odata.nextLink"]
    }

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

    return NextResponse.json({ clients, totalCount: clients.length })
  } catch (error) {
    console.error("Error fetching clients:", error)
    return NextResponse.json({ error: "Failed to fetch clients from Karbon" }, { status: 500 })
  }
}
