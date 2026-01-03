import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientKey } = await params
  const supabase = await createClient()

  // Check if it's a valid UUID first
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientKey)

  let organizationId: string | null = null
  let contactId: string | null = null

  if (isUUID) {
    // If it's already a UUID, use it directly
    organizationId = clientKey
    contactId = clientKey
  } else {
    // Look up the organization UUID by karbon_organization_key
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("karbon_organization_key", clientKey)
      .single()

    if (org) {
      organizationId = org.id
    }

    // Look up the contact UUID by karbon_contact_key
    const { data: contact } = await supabase.from("contacts").select("id").eq("karbon_contact_key", clientKey).single()

    if (contact) {
      contactId = contact.id
    }
  }

  // Build the query conditions based on what we found
  const conditions: string[] = []
  if (organizationId) conditions.push(`organization_id.eq.${organizationId}`)
  if (contactId) conditions.push(`contact_id.eq.${contactId}`)

  if (conditions.length > 0) {
    const { data: notes, error } = await supabase
      .from("notes")
      .select("*")
      .or(conditions.join(","))
      .order("created_at", { ascending: false })

    if (!error && notes && notes.length > 0) {
      return NextResponse.json({ notes })
    }
  }

  // Fallback: try karbon_notes table if no notes found
  const { data: karbonNotes } = await supabase
    .from("karbon_notes")
    .select("*")
    .or(`karbon_contact_key.eq.${clientKey},karbon_organization_key.eq.${clientKey}`)
    .order("karbon_created_at", { ascending: false })

  return NextResponse.json({ notes: karbonNotes || [] })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientKey } = await params
  const supabase = await createClient()
  const body = await request.json()

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientKey)

  let organizationId: string | null = null
  let contactId: string | null = null

  if (isUUID) {
    organizationId = clientKey
  } else {
    // Look up the organization UUID by karbon_organization_key
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("karbon_organization_key", clientKey)
      .single()

    if (org) {
      organizationId = org.id
    } else {
      // Try contacts
      const { data: contact } = await supabase
        .from("contacts")
        .select("id")
        .eq("karbon_contact_key", clientKey)
        .single()

      if (contact) {
        contactId = contact.id
      }
    }
  }

  const insertData: Record<string, unknown> = { ...body }
  if (organizationId) insertData.organization_id = organizationId
  if (contactId) insertData.contact_id = contactId

  const { data, error } = await supabase.from("notes").insert(insertData).select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ note: data[0] })
}
