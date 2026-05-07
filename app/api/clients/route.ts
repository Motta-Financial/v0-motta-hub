import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * PostgREST `.or(...)` uses commas to separate clauses and `%` as a
 * wildcard inside `ilike`. If we splat raw user input into a clause string,
 * a comma in the query would terminate the `or()` early (PostgREST silently
 * drops the rest), so strip both characters before interpolation.
 */
function safe(input: string): string {
  return input.replace(/[%,]/g, "")
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // "contacts", "organizations", or null for both
    const search = searchParams.get("search")
    const status = searchParams.get("status")
    const limit = Number.parseInt(searchParams.get("limit") || "100")

    const clients: any[] = []
    // Pre-build the ilike pattern once so we don't repeat the escape +
    // wrap dance in every clause.
    const ilike = search ? `%${safe(search)}%` : null

    // Fetch contacts
    if (!type || type === "contacts" || type === "all") {
      let contactsQuery = supabase
        .from("contacts")
        .select(`
          id,
          karbon_contact_key,
          first_name,
          last_name,
          full_name,
          primary_email,
          phone_primary,
          contact_type,
          status,
          karbon_url,
          city,
          state,
          created_at,
          updated_at
        `)
        .limit(limit)

      if (ilike) {
        // Search every field a teammate might paste into the picker — full
        // name, name parts, preferred name, both emails, primary phone,
        // Karbon contact key, contact type, city, state. Keeps the
        // ClientPicker's UX consistent with the global Cmd+K palette.
        contactsQuery = contactsQuery.or(
          [
            `full_name.ilike.${ilike}`,
            `first_name.ilike.${ilike}`,
            `last_name.ilike.${ilike}`,
            `preferred_name.ilike.${ilike}`,
            `primary_email.ilike.${ilike}`,
            `secondary_email.ilike.${ilike}`,
            `phone_primary.ilike.${ilike}`,
            `karbon_contact_key.ilike.${ilike}`,
            `contact_type.ilike.${ilike}`,
            `city.ilike.${ilike}`,
            `state.ilike.${ilike}`,
          ].join(","),
        )
      }
      if (status) {
        contactsQuery = contactsQuery.eq("status", status)
      }

      const { data: contacts, error: contactsError } = await contactsQuery

      if (contactsError) throw contactsError

      clients.push(
        ...(contacts || []).map((c) => ({
          id: c.id,
          karbon_key: c.karbon_contact_key,
          name: c.full_name || `${c.first_name || ""} ${c.last_name || ""}`.trim(),
          email: c.primary_email,
          phone: c.phone_primary,
          type: "Contact",
          clientType: c.contact_type,
          status: c.status,
          karbon_url: c.karbon_url,
          created_at: c.created_at,
          updated_at: c.updated_at,
        })),
      )
    }

    // Fetch organizations
    if (!type || type === "organizations" || type === "all") {
      let orgsQuery = supabase
        .from("organizations")
        .select(`
          id,
          karbon_organization_key,
          name,
          full_name,
          legal_name,
          trading_name,
          primary_email,
          phone,
          entity_type,
          status,
          karbon_url,
          city,
          state,
          created_at,
          updated_at
        `)
        .limit(limit)

      if (ilike) {
        // Cover every legibly-named variant we store on an org row plus the
        // Karbon key, primary email, phone, entity type, city, and state —
        // matches the field set used by /api/search for the Cmd+K palette.
        orgsQuery = orgsQuery.or(
          [
            `name.ilike.${ilike}`,
            `full_name.ilike.${ilike}`,
            `legal_name.ilike.${ilike}`,
            `trading_name.ilike.${ilike}`,
            `primary_email.ilike.${ilike}`,
            `phone.ilike.${ilike}`,
            `karbon_organization_key.ilike.${ilike}`,
            `entity_type.ilike.${ilike}`,
            `city.ilike.${ilike}`,
            `state.ilike.${ilike}`,
          ].join(","),
        )
      }
      if (status) {
        orgsQuery = orgsQuery.eq("status", status)
      }

      const { data: orgs, error: orgsError } = await orgsQuery

      if (orgsError) throw orgsError

      clients.push(
        ...(orgs || []).map((o) => ({
          id: o.id,
          karbon_key: o.karbon_organization_key,
          name: o.name,
          email: o.primary_email,
          phone: o.phone,
          type: "Organization",
          clientType: o.entity_type,
          status: o.status,
          karbon_url: o.karbon_url,
          created_at: o.created_at,
          updated_at: o.updated_at,
        })),
      )
    }

    // Sort by name
    clients.sort((a, b) => (a.name || "").localeCompare(b.name || ""))

    return NextResponse.json({ clients, total: clients.length })
  } catch (error) {
    console.error("Error fetching clients:", error)
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 })
  }
}
