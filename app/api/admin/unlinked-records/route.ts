import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const searchParams = request.nextUrl.searchParams
  const type = searchParams.get("type") || "ignition_clients"
  const limit = Number.parseInt(searchParams.get("limit") || "50")

  try {
    let records: Array<{
      id: string
      type: string
      name: string
      email?: string | null
      businessName?: string | null
      status?: string | null
      createdAt?: string | null
      extra?: Record<string, unknown>
    }> = []

    switch (type) {
      case "ignition_clients": {
        const { data, error } = await supabase
          .from("ignition_clients")
          .select("ignition_client_id, name, email, business_name, client_type, created_at")
          .is("contact_id", null)
          .is("organization_id", null)
          .order("created_at", { ascending: false })
          .limit(limit)

        if (error) throw error

        records = (data || []).map((r) => ({
          id: r.ignition_client_id,
          type: "ignition_client" as const,
          name: r.name || r.business_name || "Unknown",
          email: r.email,
          businessName: r.business_name,
          status: r.client_type,
          createdAt: r.created_at,
        }))
        break
      }

      case "ignition_proposals": {
        const { data, error } = await supabase
          .from("ignition_proposals")
          .select("proposal_id, client_name, client_email, status, created_at")
          .is("contact_id", null)
          .is("organization_id", null)
          .order("created_at", { ascending: false })
          .limit(limit)

        if (error) throw error

        records = (data || []).map((r) => ({
          id: r.proposal_id,
          type: "ignition_proposal" as const,
          name: r.client_name || "Unknown",
          email: r.client_email,
          status: r.status,
          createdAt: r.created_at,
        }))
        break
      }

      case "calendly_invitees": {
        const { data, error } = await supabase
          .from("calendly_invitees")
          .select("id, name, email, status, created_at")
          .is("contact_id", null)
          .order("created_at", { ascending: false })
          .limit(limit)

        if (error) throw error

        records = (data || []).map((r) => ({
          id: r.id,
          type: "calendly_invitee" as const,
          name: r.name || "Unknown",
          email: r.email,
          status: r.status,
          createdAt: r.created_at,
        }))
        break
      }

      case "debriefs": {
        const { data, error } = await supabase
          .from("debriefs")
          .select("id, organization_name, debrief_date, debrief_type, notes, created_at")
          .is("contact_id", null)
          .is("organization_id", null)
          .order("created_at", { ascending: false })
          .limit(limit)

        if (error) throw error

        records = (data || []).map((r) => ({
          id: r.id,
          type: "debrief" as const,
          name: r.organization_name || "Untitled Debrief",
          status: r.debrief_type,
          createdAt: r.created_at,
          extra: {
            debrief_date: r.debrief_date,
            notes: r.notes?.substring(0, 100),
          },
        }))
        break
      }

      default:
        return NextResponse.json({ error: "Invalid type" }, { status: 400 })
    }

    return NextResponse.json({ records })
  } catch (error) {
    console.error("Error fetching unlinked records:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
