import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // "contacts", "organizations", or null for both
    const search = searchParams.get("search")
    const status = searchParams.get("status")
    const limit = Number.parseInt(searchParams.get("limit") || "100")

    const clients: any[] = []

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
          created_at,
          updated_at
        `)
        .limit(limit)

      if (search) {
        contactsQuery = contactsQuery.or(`full_name.ilike.%${search}%,primary_email.ilike.%${search}%`)
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
          primary_email,
          phone,
          entity_type,
          status,
          karbon_url,
          created_at,
          updated_at
        `)
        .limit(limit)

      if (search) {
        orgsQuery = orgsQuery.or(`name.ilike.%${search}%,primary_email.ilike.%${search}%`)
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
