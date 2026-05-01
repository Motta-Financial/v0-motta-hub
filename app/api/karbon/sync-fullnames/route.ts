import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

const KARBON_API_BASE = "https://api.karbonhq.com/v3"

interface KarbonListContact {
  ContactKey: string
  FullName?: string | null
  PreferredName?: string | null
  Salutation?: string | null
  EmailAddress?: string | null
  PhoneNumber?: string | null
  ContactType?: string | null
  UserDefinedIdentifier?: string | null
  LastModifiedDateTime?: string | null
}

interface KarbonListOrganization {
  OrganizationKey: string
  FullName?: string | null
  Name?: string | null
  EmailAddress?: string | null
  PhoneNumber?: string | null
  Website?: string | null
  ContactType?: string | null
  LastModifiedDateTime?: string | null
}

/**
 * Karbon's /Contacts list endpoint returns FullName formatted as
 * "LastName, FirstName" (or just an org/business name with no comma).
 * Parse it back into structured first_name / last_name.
 *
 * Examples we've observed:
 *   "Vincent, Hank"        -> { first: "Hank", last: "Vincent" }
 *   "A. Bass, Michael"     -> { first: "Michael", last: "A. Bass" }
 *   "- Business, Citizens" -> { first: "Citizens", last: "- Business" }
 *   "365, Microsoft"       -> { first: "Microsoft", last: "365" }
 *   "Doe Jr., John"        -> { first: "John", last: "Doe Jr." }
 */
function parseContactFullName(
  fullName: string | null | undefined,
  preferredName?: string | null,
): { first: string | null; last: string | null } {
  if (!fullName || !fullName.trim()) {
    // No FullName from Karbon — at least preserve the preferred name as last_name
    // so the row at least shows *something* instead of "Unknown Contact".
    return { first: null, last: preferredName?.trim() || null }
  }

  const trimmed = fullName.trim()
  const commaIdx = trimmed.indexOf(",")

  if (commaIdx === -1) {
    // No comma — treat the entire string as the display name (last_name).
    return { first: null, last: trimmed }
  }

  const last = trimmed.slice(0, commaIdx).trim()
  const first = trimmed.slice(commaIdx + 1).trim()

  return {
    first: first || null,
    last: last || null,
  }
}

/**
 * Karbon's list endpoints DO NOT return @odata.nextLink. They cap $top at 100
 * and expose @odata.count for the total. Use offset-based pagination via $skip
 * until we have all rows.
 */
async function fetchAllPages<T>(baseUrl: string, pageSize = 100): Promise<T[]> {
  const all: T[] = []
  let skip = 0

  while (true) {
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}$top=${pageSize}&$skip=${skip}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
        AccessKey: process.env.KARBON_ACCESS_KEY!,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Karbon API ${response.status}: ${body.slice(0, 300)}`)
    }

    const data = (await response.json()) as {
      value?: T[]
      "@odata.count"?: number
    }
    const batch = Array.isArray(data.value) ? data.value : []
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
    // Defensive cap so we never spin forever if Karbon misbehaves.
    if (skip > 50_000) break
  }

  return all
}

export async function POST(_request: NextRequest) {
  try {
    const supabase = createAdminClient()

    console.log("[v0] sync-fullnames: fetching contacts list from Karbon...")
    const karbonContacts = await fetchAllPages<KarbonListContact>(
      `${KARBON_API_BASE}/Contacts`,
    )
    console.log(`[v0] sync-fullnames: fetched ${karbonContacts.length} contacts`)

    console.log("[v0] sync-fullnames: fetching organizations list from Karbon...")
    const karbonOrgs = await fetchAllPages<KarbonListOrganization>(
      `${KARBON_API_BASE}/Organizations`,
    )
    console.log(`[v0] sync-fullnames: fetched ${karbonOrgs.length} organizations`)

    let contactsUpdated = 0
    let contactsSkipped = 0
    let organizationsUpdated = 0
    const errors: string[] = []

    // ---------- CONTACTS ----------
    // contacts.full_name is GENERATED ALWAYS (TRIM(first_name || ' ' || last_name)),
    // so we MUST write to first_name / last_name only, never full_name itself.
    for (const contact of karbonContacts) {
      if (!contact.ContactKey) continue
      const { first, last } = parseContactFullName(contact.FullName, contact.PreferredName)

      if (!first && !last) {
        contactsSkipped++
        continue
      }

      const update: Record<string, unknown> = {
        first_name: first,
        last_name: last,
        preferred_name: contact.PreferredName || null,
        karbon_modified_at: contact.LastModifiedDateTime || null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const { error } = await supabase
        .from("contacts")
        .update(update)
        .eq("karbon_contact_key", contact.ContactKey)

      if (error) {
        errors.push(`Contact ${contact.ContactKey} (${contact.FullName}): ${error.message}`)
      } else {
        contactsUpdated++
      }
    }

    // ---------- ORGANIZATIONS ----------
    // organizations table has no generated columns — both name and full_name are writable.
    for (const org of karbonOrgs) {
      if (!org.OrganizationKey) continue
      const orgName = (org.FullName || org.Name || "").trim()
      if (!orgName) continue

      const { error } = await supabase
        .from("organizations")
        .update({
          name: orgName,
          full_name: orgName,
          karbon_modified_at: org.LastModifiedDateTime || null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("karbon_organization_key", org.OrganizationKey)

      if (error) {
        errors.push(`Organization ${org.OrganizationKey} (${orgName}): ${error.message}`)
      } else {
        organizationsUpdated++
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        karbonContactsFetched: karbonContacts.length,
        karbonOrganizationsFetched: karbonOrgs.length,
        contactsUpdated,
        contactsSkipped,
        organizationsUpdated,
        errorCount: errors.length,
      },
      errors: errors.slice(0, 20),
    })
  } catch (error) {
    console.error("[v0] sync-fullnames error:", error)
    return NextResponse.json(
      { error: "Failed to sync names from Karbon", details: String(error) },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: "POST to sync contact + organization names from Karbon to Supabase",
    description:
      "Pulls /Contacts and /Organizations list endpoints from Karbon (no $expand, which is rejected by the list endpoint), parses the 'Last, First' FullName format on contacts, and updates only writable columns. The contacts.full_name column is GENERATED ALWAYS in Postgres and is recomputed automatically from first_name + last_name.",
  })
}
