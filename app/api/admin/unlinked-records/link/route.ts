import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  try {
    const body = await request.json()
    const { recordType, recordId, clientId, clientKind } = body

    if (!recordType || !recordId || !clientId || !clientKind) {
      return NextResponse.json(
        { error: "Missing required fields: recordType, recordId, clientId, clientKind" },
        { status: 400 }
      )
    }

    const updateData =
      clientKind === "organization"
        ? { organization_id: clientId, contact_id: null }
        : { contact_id: clientId, organization_id: null }

    let tableName: string
    let idColumn: string

    switch (recordType) {
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
        // Calendly invitees only link to contacts
        if (clientKind === "organization") {
          return NextResponse.json(
            { error: "Calendly invitees can only be linked to contacts" },
            { status: 400 }
          )
        }
        break
      case "debrief":
        tableName = "debriefs"
        idColumn = "id"
        break
      default:
        return NextResponse.json({ error: "Invalid record type" }, { status: 400 })
    }

    const { error } = await supabase
      .from(tableName)
      .update(updateData)
      .eq(idColumn, recordId)

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true, recordType, recordId, clientId, clientKind })
  } catch (error) {
    console.error("Error linking record:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
