import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = createAdminClient()

  try {
    const [ignitionClients, ignitionProposals, calendlyInvitees, debriefs] = await Promise.all([
      supabase
        .from("ignition_clients")
        .select("ignition_client_id", { count: "exact", head: true })
        .is("contact_id", null)
        .is("organization_id", null),
      supabase
        .from("ignition_proposals")
        .select("proposal_id", { count: "exact", head: true })
        .is("contact_id", null)
        .is("organization_id", null),
      supabase
        .from("calendly_invitees")
        .select("id", { count: "exact", head: true })
        .is("contact_id", null),
      supabase
        .from("debriefs")
        .select("id", { count: "exact", head: true })
        .is("contact_id", null)
        .is("organization_id", null),
    ])

    return NextResponse.json({
      ignition_clients: ignitionClients.count || 0,
      ignition_proposals: ignitionProposals.count || 0,
      calendly_invitees: calendlyInvitees.count || 0,
      debriefs: debriefs.count || 0,
    })
  } catch (error) {
    console.error("Error fetching unlinked stats:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
