/**
 * GET /api/supabase/signed-proposal-clients
 *
 * Returns the set of contact_ids and organization_ids that have at
 * least one Ignition proposal in a "signed" state (accepted/completed).
 *
 * The Clients list uses this to compute `isProspect` based on the
 * source of truth (a signed proposal in Ignition) rather than the
 * Karbon-imported `contact_type` field, which is frequently stale —
 * a freshly-signed client may still show as "Prospect" in Karbon for
 * weeks before the bookkeeping cleanup catches up.
 *
 * Lifecycle:
 *   - `accepted` / `completed` → counts as signed (active client)
 *   - `revoked` / `archived` / `lost` → does NOT count
 *   - everything else (sent, draft) → does NOT count
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const revalidate = 60

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Pull every proposal that has reached a signed state. We look
    // at status text first (most reliable signal across both native
    // Ignition syncs and the legacy HubSpot import) and additionally
    // honor `accepted_at` / `completed_at` so that any historical row
    // missing the status string still counts.
    const { data, error } = await supabase
      .from("ignition_proposals")
      .select("contact_id, organization_id, status, accepted_at, completed_at, revoked_at, archived_at, lost_at")
      .limit(20000)

    if (error) {
      console.error("[signed-proposal-clients] error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const contactIds = new Set<string>()
    const organizationIds = new Set<string>()

    for (const row of data || []) {
      // Skip terminated proposals — a revoked/archived/lost row
      // never proves an active client, even if it was once accepted.
      if (row.revoked_at || row.archived_at || row.lost_at) continue
      const status = (row.status || "").toLowerCase()
      if (status === "lost" || status === "revoked" || status === "archived") continue

      const isSigned =
        status === "accepted" ||
        status === "completed" ||
        !!row.accepted_at ||
        !!row.completed_at
      if (!isSigned) continue

      if (row.contact_id) contactIds.add(row.contact_id)
      if (row.organization_id) organizationIds.add(row.organization_id)
    }

    return NextResponse.json({
      contactIds: Array.from(contactIds),
      organizationIds: Array.from(organizationIds),
      total: contactIds.size + organizationIds.size,
    })
  } catch (e: any) {
    console.error("[signed-proposal-clients] exception:", e)
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 })
  }
}
