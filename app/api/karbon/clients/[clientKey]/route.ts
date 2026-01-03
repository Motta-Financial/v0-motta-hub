import { NextResponse } from "next/server"

function detectJointClients(workItems: any[], currentClientName: string) {
  const jointClientNames = new Set<string>()

  workItems.forEach((item: any) => {
    const title = item.Title || ""

    // Check for married filing jointly indicators
    if (
      title.toLowerCase().includes("married filing jointly") ||
      title.toLowerCase().includes("mfj") ||
      title.toLowerCase().includes("joint return")
    ) {
      // Extract names from title - look for patterns like "John & Jane Smith" or "John and Jane Smith"
      const namePatterns = [
        /([A-Z][a-z]+)\s*&\s*([A-Z][a-z]+)/g, // "John & Jane"
        /([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+)/gi, // "John and Jane"
        /([A-Z][a-z]+)\s*\/\s*([A-Z][a-z]+)/g, // "John/Jane"
      ]

      namePatterns.forEach((pattern) => {
        const matches = title.matchAll(pattern)
        for (const match of matches) {
          const name1 = match[1]
          const name2 = match[2]

          // Add both names if they're different from current client
          if (name1 && !currentClientName.includes(name1)) {
            jointClientNames.add(name1)
          }
          if (name2 && !currentClientName.includes(name2)) {
            jointClientNames.add(name2)
          }
        }
      })
    }
  })

  return Array.from(jointClientNames)
}

async function fetchOrganizationDetails(orgKey: string, accessKey: string, bearerToken: string) {
  try {
    const orgUrl = `https://api.karbonhq.com/v3/Organizations/${orgKey}`
    const response = await fetch(orgUrl, {
      headers: {
        AccessKey: accessKey,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    })

    if (response.ok) {
      const org = await response.json()
      return {
        key: orgKey,
        name: org.OrganizationName || org.FullName || "Unknown Organization",
      }
    }
  } catch (error) {
    console.log(`[v0] Error fetching organization ${orgKey}:`, error)
  }
  return null
}

async function extractBusinessRelationships(businessCards: any[], accessKey: string, bearerToken: string) {
  const businesses: Array<{ key: string; name: string }> = []

  console.log("[v0] Business cards structure:", JSON.stringify(businessCards, null, 2))

  for (const card of businessCards) {
    const orgKey = card.OrganizationKey

    if (orgKey) {
      console.log(`[v0] Found OrganizationKey in business card: ${orgKey}`)
      const orgDetails = await fetchOrganizationDetails(orgKey, accessKey, bearerToken)
      if (orgDetails) {
        console.log(`[v0] Fetched organization details:`, orgDetails)
        businesses.push(orgDetails)
      }
    }
  }

  return businesses
}

export async function GET(request: Request, { params }: { params: { clientKey: string } }) {
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearerToken = process.env.KARBON_BEARER_TOKEN

  if (!accessKey || !bearerToken) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const { clientKey } = params

    let clientDetails: any = null
    let isOrganization = false
    let organizationKey: string | null = null
    let avatarUrl: string | null = null

    // - Contacts = Individual people (uses ContactKey)
    // - Organizations = Companies/businesses (uses OrganizationKey)
    // A clientKey could be either, so we try both endpoints

    // Try fetching as Organization first (business client)
    console.log(`[v0] Attempting to fetch clientKey ${clientKey} as Organization (EntityKey)...`)
    const orgUrl = `https://api.karbonhq.com/v3/Organizations/${clientKey}?$expand=BusinessCards`

    let orgResponse: Response | null = null
    try {
      orgResponse = await fetch(orgUrl, {
        headers: {
          AccessKey: accessKey,
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
      })
      console.log(`[v0] Organization endpoint returned status: ${orgResponse.status}`)
    } catch (fetchError) {
      console.log(`[v0] Network error fetching Organization, will try Contact`)
    }

    if (orgResponse?.ok) {
      clientDetails = await orgResponse.json()
      isOrganization = true
      organizationKey = clientKey // The clientKey IS the EntityKey for Organizations
      avatarUrl = clientDetails.AvatarUrl || null
      // Organization name can be in different fields
      const orgName =
        clientDetails.Name ||
        clientDetails.OrganizationName ||
        clientDetails.LegalName ||
        clientDetails.TradingName ||
        clientDetails.FullName
      console.log("[v0] Found as Organization (Business Client):", orgName)
      console.log("[v0] Organization response keys:", Object.keys(clientDetails))
    } else {
      // Organization endpoint returned 404 - try as Contact (individual person)
      console.log(
        `[v0] Not found as Organization (status: ${orgResponse?.status || "network error"}), trying Contact...`,
      )

      const contactUrl = `https://api.karbonhq.com/v3/Contacts/${clientKey}?$expand=BusinessCards`

      let contactResponse: Response | null = null
      try {
        contactResponse = await fetch(contactUrl, {
          headers: {
            AccessKey: accessKey,
            Authorization: `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
          },
        })
        console.log(`[v0] Contact endpoint returned status: ${contactResponse.status}`)
      } catch (fetchError) {
        console.log(`[v0] Network error fetching Contact`)
      }

      if (contactResponse?.ok) {
        clientDetails = await contactResponse.json()
        isOrganization = false
        avatarUrl = clientDetails.AvatarUrl || null
        // Get the OrganizationKey from the Contact's primary business card (if they work for a company)
        const primaryCard = clientDetails.BusinessCards?.find((card: any) => card.IsPrimaryCard === true)
        organizationKey = primaryCard?.OrganizationKey || null
        const contactName =
          clientDetails.FullName ||
          clientDetails.Name ||
          `${clientDetails.FirstName || ""} ${clientDetails.LastName || ""}`.trim() ||
          "Unknown Contact"
        console.log("[v0] Found as Contact (Individual):", contactName)
      }
    }

    const baseUrl = request.url.split("/api/")[0]
    const workItemsResponse = await fetch(`${baseUrl}/api/karbon/work-items`, {
      headers: {
        "Cache-Control": "no-cache",
      },
    })

    if (!workItemsResponse.ok) {
      throw new Error("Failed to fetch work items")
    }

    const { workItems: allWorkItems } = await workItemsResponse.json()

    const clientName = isOrganization
      ? clientDetails?.Name ||
        clientDetails?.OrganizationName ||
        clientDetails?.LegalName ||
        clientDetails?.TradingName ||
        clientDetails?.FullName ||
        null
      : clientDetails?.FullName ||
        clientDetails?.Name ||
        (clientDetails?.FirstName && clientDetails?.LastName
          ? `${clientDetails.FirstName} ${clientDetails.LastName}`
          : null) ||
        null

    // Find initial work items for this client
    const directWorkItems = allWorkItems.filter(
      (item: any) => item.ClientKey === clientKey || (organizationKey && item.ClientKey === organizationKey),
    )

    console.log(`[v0] Found ${directWorkItems.length} direct work items for client`)

    // Get the client group name from the first work item
    const clientGroupName = directWorkItems[0]?.ClientGroup || null
    console.log(`[v0] Client group name: ${clientGroupName}`)

    let relatedWorkItems = directWorkItems
    if (clientGroupName) {
      relatedWorkItems = allWorkItems.filter((item: any) => item.ClientGroup === clientGroupName)
      console.log(`[v0] Found ${relatedWorkItems.length} total work items in client group: ${clientGroupName}`)
    }

    // Remove duplicates by WorkKey
    const uniqueWorkItems = Array.from(new Map(relatedWorkItems.map((item: any) => [item.WorkKey, item])).values())

    console.log(`[v0] Total unique work items: ${uniqueWorkItems.length}`)

    if (uniqueWorkItems.length === 0 && !clientDetails) {
      return NextResponse.json(
        {
          error: "Client not found",
          details: `No Contact or Organization found for key ${clientKey}, and no work items associated`,
        },
        { status: 404 },
      )
    }

    const detectedSpouses = detectJointClients(uniqueWorkItems, clientName || "")
    console.log(`[v0] Detected potential spouses from work items:`, detectedSpouses)

    const businessRelationships = clientDetails?.BusinessCards
      ? await extractBusinessRelationships(clientDetails.BusinessCards, accessKey, bearerToken)
      : []
    console.log(`[v0] Business relationships from cards:`, businessRelationships)

    let contactInfo: any = {
      email: null,
      phone: null,
      address: null,
      primaryContact: null,
    }

    if (clientDetails) {
      const businessCards = clientDetails.BusinessCards || []
      const primaryCard = businessCards.find((card: any) => card.IsPrimaryCard === true) || businessCards[0]

      if (primaryCard) {
        const email =
          primaryCard.EmailAddresses && primaryCard.EmailAddresses.length > 0 ? primaryCard.EmailAddresses[0] : null

        const phone =
          primaryCard.PhoneNumbers && primaryCard.PhoneNumbers.length > 0 ? primaryCard.PhoneNumbers[0].Number : null

        const address =
          primaryCard.Addresses && primaryCard.Addresses.length > 0
            ? `${primaryCard.Addresses[0].AddressLines || ""}, ${primaryCard.Addresses[0].City || ""}, ${primaryCard.Addresses[0].StateProvinceCounty || ""} ${primaryCard.Addresses[0].ZipCode || ""}`
                .replace(/^, |, $/g, "")
                .trim()
            : null

        contactInfo = {
          email,
          phone,
          address,
          primaryContact: isOrganization
            ? clientDetails.Contacts?.[0]?.FullName || null
            : `${clientDetails.FirstName || ""} ${clientDetails.LastName || ""}`.trim() || null,
        }
      }
    }

    // Build client info
    const firstItem = uniqueWorkItems[0]
    const clientInfo = {
      clientKey: clientKey,
      clientName: clientName || firstItem?.ClientName || "Unknown",
      clientGroup: clientGroupName,
      clientGroupKey: firstItem?.ClientGroupKey || null,
      isOrganization,
      organizationKey,
      avatarUrl,
      contactInfo,
      entityType: isOrganization ? "Organization" : "Contact",
    }

    // Calculate stats
    const stats = {
      totalWorkItems: uniqueWorkItems.length,
      activeWorkItems: uniqueWorkItems.filter(
        (item: any) =>
          item.PrimaryStatus === "In Progress" ||
          item.PrimaryStatus === "Ready To Start" ||
          item.PrimaryStatus === "Waiting",
      ).length,
      completedWorkItems: uniqueWorkItems.filter((item: any) => item.PrimaryStatus === "Completed").length,
      cancelledWorkItems: uniqueWorkItems.filter(
        (item: any) =>
          item.SecondaryStatus?.toLowerCase().includes("cancelled") ||
          item.SecondaryStatus?.toLowerCase().includes("lost"),
      ).length,
    }

    // Extract team members
    const teamMembersMap = new Map()
    uniqueWorkItems.forEach((item: any) => {
      if (item.AssignedTo && item.AssignedTo.length > 0) {
        item.AssignedTo.forEach((assignee: any) => {
          if (assignee.UserKey) {
            teamMembersMap.set(assignee.UserKey, {
              name: assignee.FullName,
              email: assignee.Email,
              userKey: assignee.UserKey,
            })
          }
        })
      }
    })

    // Extract service lines
    const serviceLinesSet = new Set()
    uniqueWorkItems.forEach((item: any) => {
      if (item.ServiceLine && item.ServiceLine !== "OTHER") {
        serviceLinesSet.add(item.ServiceLine)
      }
    })

    const relatedIndividuals: Array<{
      clientKey: string
      clientName: string
      workItemCount: number
      isSpouse?: boolean
    }> = []
    const relatedBusinesses: Array<{ clientKey: string; clientName: string; workItemCount: number }> = []

    if (clientGroupName) {
      const clientsInGroup = new Map()

      uniqueWorkItems.forEach((item: any) => {
        if (item.ClientKey && item.ClientKey !== clientKey && item.ClientKey !== organizationKey) {
          if (!clientsInGroup.has(item.ClientKey)) {
            clientsInGroup.set(item.ClientKey, {
              clientKey: item.ClientKey,
              clientName: item.ClientName,
              workItemCount: 0,
              isLikelyBusiness:
                /\b(LLC|INC|CORP|LTD|LP|TRUST|FOUNDATION)\b/i.test(item.ClientName) ||
                item.ClientName === item.ClientName.toUpperCase(),
            })
          }
          clientsInGroup.get(item.ClientKey).workItemCount++
        }
      })

      Array.from(clientsInGroup.values()).forEach((client: any) => {
        const { isLikelyBusiness, ...clientData } = client
        if (isLikelyBusiness) {
          relatedBusinesses.push(clientData)
        } else {
          // Check if this person's name matches detected spouse names
          const isSpouse = detectedSpouses.some((spouseName) => clientData.clientName.includes(spouseName))
          relatedIndividuals.push({
            ...clientData,
            isSpouse,
          })
        }
      })
    }

    businessRelationships.forEach((business) => {
      if (!relatedBusinesses.find((b) => b.clientKey === business.key)) {
        relatedBusinesses.push({
          clientKey: business.key,
          clientName: business.name,
          workItemCount: 0,
        })
      }
    })

    return NextResponse.json({
      client: clientInfo,
      stats,
      teamMembers: Array.from(teamMembersMap.values()),
      serviceLinesUsed: Array.from(serviceLinesSet),
      workItems: uniqueWorkItems,
      relatedIndividuals,
      relatedBusinesses,
      detectedSpouses,
    })
  } catch (error) {
    console.error("[v0] Error fetching client details:", error)
    return NextResponse.json({ error: "Failed to fetch client details from Karbon" }, { status: 500 })
  }
}
