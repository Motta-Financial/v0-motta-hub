import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchAllPaged } from "@/lib/supabase/fetch-all"

export const maxDuration = 300

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
    let workItemsRefreshed = 0
    const errors: string[] = []

    // Build maps from karbon_*_key -> resolved display name. We populate them as
    // we walk the Karbon contacts/organizations so we can also use them later to
    // refresh denormalized name columns on linked tables (work_items).
    const contactKeyToFullName = new Map<string, string>()
    const orgKeyToFullName = new Map<string, string>()

    // Bounded concurrency for the per-row UPDATE batches below — one awaited
    // round trip per row would mean thousands of serial Supabase calls.
    const CONCURRENCY = 25

    // ---------- CONTACTS ----------
    // contacts.full_name is GENERATED ALWAYS (TRIM(first_name || ' ' || last_name)),
    // so we MUST write to first_name / last_name only, never full_name itself.
    const contactUpdates: { contact: KarbonListContact; first: string | null; last: string | null }[] = []
    for (const contact of karbonContacts) {
      if (!contact.ContactKey) continue
      const { first, last } = parseContactFullName(contact.FullName, contact.PreferredName)

      if (!first && !last) {
        contactsSkipped++
        continue
      }

      contactUpdates.push({ contact, first, last })
    }

    for (let i = 0; i < contactUpdates.length; i += CONCURRENCY) {
      const batch = contactUpdates.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map(({ contact, first, last }) =>
          supabase
            .from("contacts")
            .update({
              first_name: first,
              last_name: last,
              preferred_name: contact.PreferredName || null,
              karbon_modified_at: contact.LastModifiedDateTime || null,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("karbon_contact_key", contact.ContactKey),
        ),
      )
      results.forEach((res, idx) => {
        const { contact, first, last } = batch[idx]
        if (res.error) {
          errors.push(`Contact ${contact.ContactKey} (${contact.FullName}): ${res.error.message}`)
        } else {
          contactsUpdated++
          const computed = [first, last].filter(Boolean).join(" ").trim()
          if (computed) contactKeyToFullName.set(contact.ContactKey, computed)
        }
      })
    }

    // ---------- ORGANIZATIONS ----------
    // organizations table has no generated columns — both name and full_name are writable.
    const orgUpdates: { org: KarbonListOrganization; orgName: string }[] = []
    for (const org of karbonOrgs) {
      if (!org.OrganizationKey) continue
      const orgName = (org.FullName || org.Name || "").trim()
      if (!orgName) continue

      orgUpdates.push({ org, orgName })
    }

    for (let i = 0; i < orgUpdates.length; i += CONCURRENCY) {
      const batch = orgUpdates.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map(({ org, orgName }) =>
          supabase
            .from("organizations")
            .update({
              name: orgName,
              full_name: orgName,
              karbon_modified_at: org.LastModifiedDateTime || null,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("karbon_organization_key", org.OrganizationKey),
        ),
      )
      results.forEach((res, idx) => {
        const { org, orgName } = batch[idx]
        if (res.error) {
          errors.push(`Organization ${org.OrganizationKey} (${orgName}): ${res.error.message}`)
        } else {
          organizationsUpdated++
          orgKeyToFullName.set(org.OrganizationKey, orgName)
        }
      })
    }

    // ---------- WORK_ITEMS (denormalized client_name refresh) ----------
    // Several pages (Tax Estimates, Triage, Service-line dashboards, BusySeason)
    // read work_items.client_name directly. Karbon originally stored it in
    // "Last, First" format and it goes stale every time a contact's name
    // changes upstream. Re-derive it from the just-synced contacts/organizations.
    console.log("[v0] sync-fullnames: refreshing work_items.client_name...")
    // work_items is well past PostgREST's silent 1,000-row response cap, so
    // page through the table — an un-ranged select would skip most of it.
    let workItems:
      | { id: string; karbon_client_key: string | null; client_type: string | null; client_name: string | null }[]
      | null = null
    let wiErr: Error | null = null
    try {
      workItems = await fetchAllPaged<{
        id: string
        karbon_client_key: string | null
        client_type: string | null
        client_name: string | null
      }>(() =>
        supabase
          .from("work_items")
          .select("id, karbon_client_key, client_type, client_name")
          .not("karbon_client_key", "is", null),
      )
    } catch (err) {
      wiErr = err instanceof Error ? err : new Error(String(err))
    }

    if (wiErr) {
      errors.push(`work_items fetch failed: ${wiErr.message}`)
    } else if (workItems) {
      const stale: { id: string; client_name: string }[] = []
      for (const wi of workItems) {
        if (!wi.karbon_client_key) continue
        // Prefer org match for "Organization" rows, contact match otherwise.
        // Fall back to the other map if the primary lookup is empty so that
        // mis-typed Karbon rows still resolve.
        const orgName = orgKeyToFullName.get(wi.karbon_client_key)
        const contactName = contactKeyToFullName.get(wi.karbon_client_key)
        const expected =
          wi.client_type === "Organization"
            ? orgName || contactName
            : contactName || orgName
        if (expected && expected !== wi.client_name) {
          stale.push({ id: wi.id, client_name: expected })
        }
      }

      // Run updates with bounded concurrency to keep the route responsive.
      for (let i = 0; i < stale.length; i += CONCURRENCY) {
        const batch = stale.slice(i, i + CONCURRENCY)
        const results = await Promise.all(
          batch.map((row) =>
            supabase
              .from("work_items")
              .update({ client_name: row.client_name, updated_at: new Date().toISOString() })
              .eq("id", row.id),
          ),
        )
        for (const res of results) {
          if (res.error) {
            errors.push(`work_items update: ${res.error.message}`)
          } else {
            workItemsRefreshed++
          }
        }
      }
      console.log(
        `[v0] sync-fullnames: refreshed ${workItemsRefreshed} of ${stale.length} stale work_items.client_name`,
      )
    }

    return NextResponse.json({
      success: true,
      summary: {
        karbonContactsFetched: karbonContacts.length,
        karbonOrganizationsFetched: karbonOrgs.length,
        contactsUpdated,
        contactsSkipped,
        organizationsUpdated,
        workItemsRefreshed,
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
