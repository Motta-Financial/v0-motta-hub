import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

const KARBON_API_BASE = "https://api.karbonhq.com/v3"

interface KarbonContact {
  ContactKey: string
  FullName?: string
  FirstName?: string
  LastName?: string
  MiddleName?: string
  PreferredName?: string
  BusinessCards?: Array<{
    FullName?: string
    FirstName?: string
    LastName?: string
    EmailAddress?: string
    PhoneNumber?: string
  }>
}

interface KarbonOrganization {
  OrganizationKey: string
  Name?: string
  FullName?: string
  BusinessCards?: Array<{
    FullName?: string
    FirstName?: string
    LastName?: string
    EmailAddress?: string
    PhoneNumber?: string
  }>
}

async function fetchKarbonContacts(): Promise<KarbonContact[]> {
  const contacts: KarbonContact[] = []
  let nextUrl = `${KARBON_API_BASE}/Contacts?$expand=BusinessCards&$top=100`

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
        AccessKey: process.env.KARBON_ACCESS_KEY!,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      console.error(`[v0] Karbon API error: ${response.status}`)
      break
    }

    const data = await response.json()
    contacts.push(...(data.value || []))
    nextUrl = data["@odata.nextLink"] || null
  }

  return contacts
}

async function fetchKarbonOrganizations(): Promise<KarbonOrganization[]> {
  const organizations: KarbonOrganization[] = []
  let nextUrl = `${KARBON_API_BASE}/Organizations?$expand=BusinessCards&$top=100`

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
        AccessKey: process.env.KARBON_ACCESS_KEY!,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      console.error(`[v0] Karbon API error: ${response.status}`)
      break
    }

    const data = await response.json()
    organizations.push(...(data.value || []))
    nextUrl = data["@odata.nextLink"] || null
  }

  return organizations
}

function getFullNameFromContact(contact: KarbonContact): string {
  // Priority 1: Direct FullName field from contact
  if (contact.FullName && contact.FullName.trim()) {
    return contact.FullName.trim()
  }

  // Priority 2: FullName from primary business card
  if (contact.BusinessCards && contact.BusinessCards.length > 0) {
    const primaryCard = contact.BusinessCards[0]
    if (primaryCard.FullName && primaryCard.FullName.trim()) {
      return primaryCard.FullName.trim()
    }
    // Try to construct from business card name parts
    const cardParts = [primaryCard.FirstName, primaryCard.LastName].filter(Boolean)
    if (cardParts.length > 0) {
      return cardParts.join(" ").trim()
    }
  }

  // Priority 3: Construct from contact name parts
  const nameParts = [contact.FirstName, contact.MiddleName, contact.LastName].filter(Boolean)

  if (nameParts.length > 0) {
    return nameParts.join(" ").trim()
  }

  // Priority 4: Use PreferredName
  if (contact.PreferredName && contact.PreferredName.trim()) {
    return contact.PreferredName.trim()
  }

  return ""
}

function getFullNameFromOrganization(org: KarbonOrganization): string {
  // Priority 1: Direct FullName or Name field
  if (org.FullName && org.FullName.trim()) {
    return org.FullName.trim()
  }
  if (org.Name && org.Name.trim()) {
    return org.Name.trim()
  }

  // Priority 2: FullName from primary business card
  if (org.BusinessCards && org.BusinessCards.length > 0) {
    const primaryCard = org.BusinessCards[0]
    if (primaryCard.FullName && primaryCard.FullName.trim()) {
      return primaryCard.FullName.trim()
    }
  }

  return ""
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()

    // Fetch all contacts and organizations from Karbon
    console.log("[v0] Fetching contacts from Karbon...")
    const karbonContacts = await fetchKarbonContacts()
    console.log(`[v0] Fetched ${karbonContacts.length} contacts from Karbon`)

    console.log("[v0] Fetching organizations from Karbon...")
    const karbonOrganizations = await fetchKarbonOrganizations()
    console.log(`[v0] Fetched ${karbonOrganizations.length} organizations from Karbon`)

    let contactsUpdated = 0
    let organizationsUpdated = 0
    const errors: string[] = []

    // Update contacts in Supabase
    for (const contact of karbonContacts) {
      const fullName = getFullNameFromContact(contact)

      if (fullName && contact.ContactKey) {
        const { error } = await supabase
          .from("contacts")
          .update({
            full_name: fullName,
            updated_at: new Date().toISOString(),
          })
          .eq("karbon_contact_key", contact.ContactKey)

        if (error) {
          errors.push(`Contact ${contact.ContactKey}: ${error.message}`)
        } else {
          contactsUpdated++
        }
      }
    }

    // Update organizations in Supabase
    for (const org of karbonOrganizations) {
      const fullName = getFullNameFromOrganization(org)

      if (fullName && org.OrganizationKey) {
        const { error } = await supabase
          .from("organizations")
          .update({
            full_name: fullName,
            name: org.Name || fullName,
            updated_at: new Date().toISOString(),
          })
          .eq("karbon_organization_key", org.OrganizationKey)

        if (error) {
          errors.push(`Organization ${org.OrganizationKey}: ${error.message}`)
        } else {
          organizationsUpdated++
        }
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        karbonContactsFetched: karbonContacts.length,
        karbonOrganizationsFetched: karbonOrganizations.length,
        contactsUpdated,
        organizationsUpdated,
        errors: errors.length,
      },
      errors: errors.slice(0, 20), // Return first 20 errors
    })
  } catch (error) {
    console.error("[v0] Error syncing fullnames:", error)
    return NextResponse.json({ error: "Failed to sync fullnames", details: String(error) }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    message: "POST to this endpoint to sync FullName from Karbon to Supabase",
    description:
      "This will fetch all contacts and organizations from Karbon API with BusinessCard details and update the full_name field in Supabase.",
  })
}
