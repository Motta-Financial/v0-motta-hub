import { NextResponse } from "next/server"
import { categorizeServiceLine } from "@/lib/service-lines"
import { logger } from "@/lib/logger"

const CONTEXT = "karbon/clients"

export async function GET() {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    logger.error(CONTEXT, "Missing Karbon API credentials")
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    // Fetch all work items
    let allWorkItems: any[] = []
    let nextLink = "https://api.karbonhq.com/v3/WorkItems"
    let pageCount = 0
    const MAX_PAGES = 50 // Limit to prevent infinite loops and timeouts

    logger.info(CONTEXT, "Starting work items fetch")

    while (nextLink && pageCount < MAX_PAGES) {
      pageCount++

      try {
        const response = await fetch(nextLink, {
          headers: {
            AccessKey: accessKey,
            Authorization: `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(60000), // 60 second timeout per request
        })

        if (!response.ok) {
          const errorText = await response.text()
          logger.error(CONTEXT, "Karbon API error", { page: pageCount, status: response.status, error: errorText })
          if (allWorkItems.length > 0) {
            logger.warn(CONTEXT, "Continuing with partial data", { itemsFetched: allWorkItems.length })
            break
          }
          throw new Error(`Karbon API error: ${response.status} - ${errorText}`)
        }

        const data = await Promise.race([
          response.json(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("JSON parsing timeout")), 30000)),
        ]).catch((jsonError) => {
          logger.error(CONTEXT, "JSON parsing failed", { page: pageCount, error: jsonError.message })
          if (allWorkItems.length > 0) {
            return null
          }
          throw jsonError
        })

        if (!data) {
          break
        }

        const itemsInPage = data.value?.length || 0
        allWorkItems = allWorkItems.concat(data.value || [])
        nextLink = data["@odata.nextLink"]

        if (pageCount % 10 === 0) {
          logger.debug(CONTEXT, "Pagination progress", { page: pageCount, totalItems: allWorkItems.length })
        }
      } catch (fetchError: any) {
        logger.error(CONTEXT, "Fetch error", { page: pageCount, error: fetchError.message })
        if (allWorkItems.length >= 1000) {
          logger.warn(CONTEXT, "Continuing with partial data", { itemsFetched: allWorkItems.length })
          break
        }
        throw fetchError
      }
    }

    logger.info(CONTEXT, "Work items fetched", { total: allWorkItems.length, pages: pageCount })

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
            avatarUrl: null,
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

    // Sort by last activity (most recent first), then by name
    clients.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return a.clientName.localeCompare(b.clientName)
      if (!a.lastActivity) return 1
      if (!b.lastActivity) return -1
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    })

    const prospectCount = clients.filter((c) => c.isProspect).length
    logger.info(CONTEXT, "Clients processed", { total: clients.length, prospects: prospectCount })

    return NextResponse.json({ clients, totalCount: clients.length })
  } catch (error: any) {
    logger.error(CONTEXT, "Failed to fetch clients", { error: error.message, errorType: error.name })
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
