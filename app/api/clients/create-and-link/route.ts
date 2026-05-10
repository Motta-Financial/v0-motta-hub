import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"

interface CreateClientBody {
  type: "contact" | "organization"
  firstName?: string
  lastName?: string
  name?: string
  email?: string
  phone?: string
  createInKarbon?: boolean
  linkToRecord?: {
    type: "ignition_client" | "ignition_proposal" | "calendly_invitee" | "debrief"
    id: string
  }
}

async function createKarbonContact(data: {
  firstName: string
  lastName: string
  email?: string
  phone?: string
}): Promise<{ contactKey: string } | null> {
  const credentials = getKarbonCredentials()
  if (!credentials) {
    console.error("Karbon credentials not configured")
    return null
  }

  const body = {
    FirstName: data.firstName,
    LastName: data.lastName,
    EmailAddress: data.email || null,
    PhoneNumber: data.phone || null,
    ContactType: "Client",
  }

  const { data: result, error } = await karbonFetch<{ ContactKey: string }>(
    "/Contacts",
    credentials,
    { method: "POST", body }
  )

  if (error || !result) {
    console.error("Failed to create Karbon contact:", error)
    return null
  }

  return { contactKey: result.ContactKey }
}

async function createKarbonOrganization(data: {
  name: string
  email?: string
  phone?: string
}): Promise<{ organizationKey: string } | null> {
  const credentials = getKarbonCredentials()
  if (!credentials) {
    console.error("Karbon credentials not configured")
    return null
  }

  const body = {
    Name: data.name,
    EmailAddress: data.email || null,
    PhoneNumber: data.phone || null,
  }

  const { data: result, error } = await karbonFetch<{ OrganizationKey: string }>(
    "/Organizations",
    credentials,
    { method: "POST", body }
  )

  if (error || !result) {
    console.error("Failed to create Karbon organization:", error)
    return null
  }

  return { organizationKey: result.OrganizationKey }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  try {
    const body: CreateClientBody = await request.json()
    const { type, firstName, lastName, name, email, phone, createInKarbon, linkToRecord } = body

    // Validate required fields
    if (type === "contact" && (!firstName || !lastName)) {
      return NextResponse.json(
        { error: "First name and last name are required for contacts" },
        { status: 400 }
      )
    }
    if (type === "organization" && !name) {
      return NextResponse.json(
        { error: "Name is required for organizations" },
        { status: 400 }
      )
    }

    let karbonKey: string | null = null
    let clientId: string | null = null

    if (type === "contact") {
      // Create in Karbon first if requested
      if (createInKarbon) {
        const karbonResult = await createKarbonContact({
          firstName: firstName!,
          lastName: lastName!,
          email,
          phone,
        })
        if (karbonResult) {
          karbonKey = karbonResult.contactKey
        }
      }

      // Create in Supabase
      const { data, error } = await supabase
        .from("contacts")
        .insert({
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`,
          primary_email: email || null,
          phone_primary: phone || null,
          karbon_contact_key: karbonKey,
          status: "Active",
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single()

      if (error) throw error
      clientId = data.id
    } else {
      // Create organization
      if (createInKarbon) {
        const karbonResult = await createKarbonOrganization({
          name: name!,
          email,
          phone,
        })
        if (karbonResult) {
          karbonKey = karbonResult.organizationKey
        }
      }

      // Create in Supabase
      const { data, error } = await supabase
        .from("organizations")
        .insert({
          name,
          primary_email: email || null,
          phone_primary: phone || null,
          karbon_organization_key: karbonKey,
          status: "Active",
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single()

      if (error) throw error
      clientId = data.id
    }

    // Link to the source record if provided
    if (linkToRecord && clientId) {
      const updateData =
        type === "organization"
          ? { organization_id: clientId, contact_id: null }
          : { contact_id: clientId, organization_id: null }

      let tableName: string
      let idColumn: string

      switch (linkToRecord.type) {
        case "ignition_client":
          tableName = "ignition_clients"
          idColumn = "ignition_client_id"
          break
        case "ignition_proposal":
          tableName = "ignition_proposals"
          idColumn = "proposal_id"
          break
        case "calendly_invitee":
          tableName = "calendly_invitees"
          idColumn = "id"
          break
        case "debrief":
          tableName = "debriefs"
          idColumn = "id"
          break
        default:
          console.warn("Unknown record type for linking:", linkToRecord.type)
          tableName = ""
          idColumn = ""
      }

      if (tableName) {
        await supabase
          .from(tableName)
          .update(updateData)
          .eq(idColumn, linkToRecord.id)
      }
    }

    return NextResponse.json({
      success: true,
      client: {
        id: clientId,
        type,
        name: type === "contact" ? `${firstName} ${lastName}` : name,
        karbonKey,
      },
    })
  } catch (error) {
    console.error("Error creating client:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
