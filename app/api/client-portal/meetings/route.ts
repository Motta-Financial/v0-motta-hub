/**
 * GET /api/client-portal/meetings
 *
 * Meeting recaps the firm has DELIBERATELY shared with this client.
 *
 * The obvious implementation — return the client's debriefs — is the one
 * thing this must not do. `debriefs.notes` is internal: fee adjustments,
 * candid assessments, things said about a client rather than to them.
 * scripts/420 adds a separate `client_summary` that a staff member writes,
 * and a `shared_with_client` flag that defaults to false.
 *
 * So this route selects the client-facing columns only. It never reads
 * `notes`, and never reads `action_items` — those are internal-authored
 * too, and a client-facing to-do list needs its own field before it can be
 * shown. Until then the portal Meetings page shows recaps without to-dos
 * rather than leaking the internal ones.
 */
import { NextResponse } from "next/server"

import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  const orFilters = [
    portalUser.contactIds.length > 0 ? `contact_id.in.(${portalUser.contactIds.join(",")})` : null,
    portalUser.organizationIds.length > 0
      ? `organization_id.in.(${portalUser.organizationIds.join(",")})`
      : null,
  ].filter(Boolean)

  if (orFilters.length === 0) {
    return NextResponse.json({ meetings: [] })
  }

  const { data, error } = await supabase
    .from("debriefs")
    // Explicit column list, not "*" — a future internal column added to
    // debriefs must not silently start reaching clients.
    .select("id, debrief_date, debrief_type, client_summary, shared_at")
    .or(orFilters.join(","))
    .eq("shared_with_client", true)
    .is("deleted_at", null)
    .order("debrief_date", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    meetings: (data ?? []).map((d) => ({
      id: d.id,
      date: d.debrief_date,
      type: d.debrief_type,
      recap: d.client_summary,
      sharedAt: d.shared_at,
    })),
  })
}
