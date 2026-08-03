import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/tax/clients/[clientId]/relationships
 *
 * Per-client relationship view used by the profile cards. Returns
 * confirmed + needs_review rows where this client appears on either
 * side, split by `as_individual` (this client is the individual side)
 * vs `as_business` (this client is the business side).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await params
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("tax_client_relationships_enriched")
      .select("*")
      .or(
        `individual_proconnect_client_id.eq.${clientId},business_proconnect_client_id.eq.${clientId}`,
      )
      .neq("status", "rejected")
      .order("confidence", { ascending: false })
    if (error) {
      console.error("[v0] /api/tax/clients/:id/relationships failed", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const rows = data ?? []
    return NextResponse.json({
      ok: true,
      as_individual: rows.filter(
        (r) => r.individual_proconnect_client_id === clientId,
      ),
      as_business: rows.filter(
        (r) => r.business_proconnect_client_id === clientId,
      ),
    })
  } catch (err) {
    console.error("[v0] per-client relationships threw", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "request failed" },
      { status: 500 },
    )
  }
}
